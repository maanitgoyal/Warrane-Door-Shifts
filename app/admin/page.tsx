"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

/* ─── helpers ─── */

const TRIMESTERS = [
    { label: "T1", start: new Date(Date.UTC(2026, 1, 8)) },
    { label: "T2", start: new Date(Date.UTC(2026, 4, 25)) },
];

async function logHistory(shiftId: string, action: string, data: {
    user_username?: string; user_name?: string;
    from_username?: string; from_name?: string;
    notes?: string;
} = {}) {
    await supabase.from("shift_history").insert({ shift_id: shiftId, action, ...data });
}

function getTriWeekLabel(date: Date): string {
    for (const tri of TRIMESTERS) {
        const diffDays = Math.floor((date.getTime() - tri.start.getTime()) / 86400000);
        const week = Math.floor(diffDays / 7);
        if (diffDays >= 0 && week <= 10) return `${tri.label} Wk${week}`;
    }
    return date.toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
}

function formatUTCTime(date: Date) {
    const h = date.getUTCHours();
    const m = date.getUTCMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];


/* ─── types ─── */

type PendingClaim = {
    id: string;
    username: string;
    claimant_name: string;
    shift_id: string;
    status: string;
    created_at: string;
    shift?: { id: string; start_at: string; end_at: string };
};

type PendingSwap = {
    id: string;
    requester_username: string;
    requester_name: string;
    target_username: string;
    target_name: string;
    shift_id: string;
    status: string;
    custom_start_at: string | null;
    custom_end_at: string | null;
    created_at: string;
    shift?: { id: string; start_at: string; end_at: string };
};

type UserGroup = {
    username: string;
    name: string;
    claims: PendingClaim[];
    swaps: PendingSwap[];
};

/* ─── partial swap helper ─── */

async function approvePartialSwap(swap: PendingSwap): Promise<void> {
    const customStart = swap.custom_start_at!;
    const customEnd = swap.custom_end_at!;

    // Fetch the original shift (use maybeSingle so we never throw)
    const { data: originalShift } = await supabase
        .from("shifts").select("start_at, end_at, category").eq("id", swap.shift_id).maybeSingle();

    const { data: targetUser } = await supabase
        .from("users").select("id").eq("username", swap.target_username).maybeSingle();

    const { data: requesterClaim } = await supabase
        .from("claims").select("id, user_id")
        .eq("shift_id", swap.shift_id)
        .eq("username", swap.requester_username)
        .eq("status", "approved")
        .maybeSingle();

    // Always approve the swap record regardless of what happens below
    await supabase.from("swaps").update({ status: "approved" }).eq("id", swap.id);

    if (!originalShift) {
        // No shift found — fall back: just transfer the whole claim
        await supabase.from("claims").update({
            username: swap.target_username,
            claimant_name: swap.target_name,
            ...(targetUser ? { user_id: targetUser.id } : {}),
        }).eq("shift_id", swap.shift_id).eq("username", swap.requester_username).eq("status", "approved");
        return;
    }

    const customStartMs = new Date(customStart).getTime();
    const customEndMs = new Date(customEnd).getTime();
    const shiftStartMs = new Date(originalShift.start_at).getTime();
    const shiftEndMs = new Date(originalShift.end_at).getTime();

    const hasBefore = customStartMs > shiftStartMs;
    const hasAfter = customEndMs < shiftEndMs;

    // Edge case: custom range covers the entire shift — treat as whole swap
    if (!hasBefore && !hasAfter) {
        await supabase.from("claims").update({
            username: swap.target_username,
            claimant_name: swap.target_name,
            ...(targetUser ? { user_id: targetUser.id } : {}),
        }).eq("shift_id", swap.shift_id).eq("username", swap.requester_username).eq("status", "approved");
        return;
    }

    const shiftCategory = originalShift.category ?? null;

    // Try to create a new shift for the swapped portion (assigned to target).
    // Use .select() without .single() so a DB error doesn't throw.
    const { data: swappedShifts, error: swappedError } = await supabase
        .from("shifts")
        .insert({ start_at: customStart, end_at: customEnd, status: "taken", ...(shiftCategory ? { category: shiftCategory } : {}) })
        .select("id");
    if (swappedError) console.error("[partialSwap] shift insert failed:", swappedError.message, swappedError.details, swappedError.hint);
    const swappedShiftId = swappedShifts?.[0]?.id ?? null;

    if (swappedShiftId) {
        // New shift created for target — adjust original for requester
        await supabase.from("claims").insert({
            shift_id: swappedShiftId,
            username: swap.target_username,
            claimant_name: swap.target_name,
            status: "approved",
            ...(targetUser ? { user_id: targetUser.id } : {}),
        });
        await logHistory(swappedShiftId, "swap_approved", {
            user_username: swap.target_username,
            user_name: swap.target_name,
            from_username: swap.requester_username,
            from_name: swap.requester_name,
            notes: "Partial swap",
        });
        await logHistory(swap.shift_id, "swap_partial_kept", {
            user_username: swap.requester_username,
            user_name: swap.requester_name,
            notes: "Remaining portion after partial swap",
        });
        // Record swap history on the new shift so its timeline shows origin
        await supabase.from("swaps").insert({
            shift_id: swappedShiftId,
            requester_username: swap.requester_username,
            requester_name: swap.requester_name,
            target_username: swap.target_username,
            target_name: swap.target_name,
            status: "approved",
            custom_start_at: swap.custom_start_at ?? null,
            custom_end_at: swap.custom_end_at ?? null,
        });

        if (hasBefore && hasAfter) {
            // Middle was swapped: original becomes the "before" block, create "after"
            await supabase.from("shifts").update({ end_at: customStart }).eq("id", swap.shift_id);
            const { data: afterShifts } = await supabase
                .from("shifts")
                .insert({ start_at: customEnd, end_at: originalShift.end_at, status: "taken", ...(shiftCategory ? { category: shiftCategory } : {}) })
                .select("id");
            const afterShiftId = afterShifts?.[0]?.id ?? null;
            if (afterShiftId) {
                await supabase.from("claims").insert({
                    shift_id: afterShiftId,
                    username: swap.requester_username,
                    claimant_name: swap.requester_name,
                    status: "approved",
                    ...(requesterClaim ? { user_id: requesterClaim.user_id } : {}),
                });
            }
        } else if (hasBefore) {
            // End was swapped: shorten original to the "before" block
            await supabase.from("shifts").update({ end_at: customStart }).eq("id", swap.shift_id);
        } else {
            // Start was swapped: advance original start to the "after" block
            await supabase.from("shifts").update({ start_at: customEnd }).eq("id", swap.shift_id);
        }
    } else {
        // Shift creation failed — fall back: transfer the whole claim to the target
        await supabase.from("claims").update({
            username: swap.target_username,
            claimant_name: swap.target_name,
            ...(targetUser ? { user_id: targetUser.id } : {}),
        }).eq("shift_id", swap.shift_id).eq("username", swap.requester_username).eq("status", "approved");
    }
}

/* ─── page ─── */

export default function AdminPage() {
    const router = useRouter();
    const [user, setUser] = useState<any>(null);
    const [userGroups, setUserGroups] = useState<UserGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
    const [processing, setProcessing] = useState<string | null>(null);
    const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const [assignDate, setAssignDate] = useState(() => {
        const n = new Date();
        return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())).toISOString().split("T")[0];
    });
    const [dateShifts, setDateShifts] = useState<any[]>([]);
    const [assignModal, setAssignModal] = useState<any>(null);
    const [deleteConfirmShift, setDeleteConfirmShift] = useState<any>(null);

    useEffect(() => {
        const stored = localStorage.getItem("shift_user");
        if (!stored) { router.push("/login"); return; }
        const u = JSON.parse(stored);
        if (u.role !== "admin") { router.push("/"); return; }
        setUser(u);
    }, []);

    // Poll every 10 seconds
    useEffect(() => {
        if (!user) return;
        fetchData();
        fetchDateShifts();
        const interval = setInterval(fetchData, 10000);
        return () => clearInterval(interval);
    }, [user]);

    useEffect(() => {
        if (user) fetchDateShifts();
    }, [user, assignDate]);

    async function fetchData() {
        const [{ data: claimsRaw }, { data: swapsRaw }] = await Promise.all([
            supabase.from("claims").select("*").eq("status", "pending").order("created_at"),
            supabase.from("swaps").select("*").eq("status", "pending").order("created_at"),
        ]);

        const shiftIds = [...new Set([
            ...(claimsRaw ?? []).map((c) => c.shift_id),
            ...(swapsRaw ?? []).map((s) => s.shift_id),
        ])];

        let shiftMap: Record<string, any> = {};
        if (shiftIds.length > 0) {
            const { data: shiftsRaw } = await supabase
                .from("shifts").select("id, start_at, end_at").in("id", shiftIds);
            shiftMap = Object.fromEntries((shiftsRaw ?? []).map((s) => [s.id, s]));
        }

        const groups: Record<string, UserGroup> = {};

        for (const c of (claimsRaw ?? [])) {
            if (!groups[c.username]) groups[c.username] = { username: c.username, name: c.claimant_name, claims: [], swaps: [] };
            groups[c.username].claims.push({ ...c, shift: shiftMap[c.shift_id] });
        }
        for (const s of (swapsRaw ?? [])) {
            if (!groups[s.requester_username]) groups[s.requester_username] = { username: s.requester_username, name: s.requester_name, claims: [], swaps: [] };
            groups[s.requester_username].swaps.push({ ...s, shift: shiftMap[s.shift_id] });
        }

        setUserGroups(Object.values(groups));
        setLoading(false);
        setLastRefreshed(new Date());
    }

    async function fetchDateShifts() {
        const { data: shiftsRaw } = await supabase
            .from("shifts")
            .select("*")
            .gte("start_at", `${assignDate}T00:00:00`)
            .lt("start_at", `${assignDate}T23:59:59`)
            .order("start_at");

        if (!shiftsRaw) { setDateShifts([]); return; }

        const ids = shiftsRaw.map((s) => s.id);
        let claimMap: Record<string, any> = {};
        if (ids.length > 0) {
            const { data: approved } = await supabase
                .from("claims").select("shift_id, claimant_name, username")
                .in("shift_id", ids).eq("status", "approved");
            if (approved) claimMap = Object.fromEntries(approved.map((c) => [c.shift_id, c]));
        }
        setDateShifts(shiftsRaw.map((s) => ({ ...s, assignedTo: claimMap[s.id] ?? null })));
    }

    function deleteShift(shift: any) {
        setDeleteConfirmShift(shift);
    }

    async function confirmDelete() {
        if (!deleteConfirmShift) return;
        await supabase.from("claims").delete().eq("shift_id", deleteConfirmShift.id);
        await supabase.from("shifts").delete().eq("id", deleteConfirmShift.id);
        setDeleteConfirmShift(null);
        fetchDateShifts();
    }

    async function makeShiftOpen(shiftId: string) {
        const { data: clm } = await supabase.from("claims").select("username, claimant_name").eq("shift_id", shiftId).eq("status", "approved").maybeSingle();
        await supabase.from("claims").delete().eq("shift_id", shiftId).eq("status", "approved");
        await supabase.from("shifts").update({ status: "open" }).eq("id", shiftId);
        if (clm) await logHistory(shiftId, "admin_unassigned", { user_username: clm.username, user_name: clm.claimant_name });
        fetchDateShifts();
    }

    function toggleExpand(username: string) {
        setExpandedUsers((prev) => {
            const next = new Set(prev);
            next.has(username) ? next.delete(username) : next.add(username);
            return next;
        });
    }

    async function approveClaim(claim: PendingClaim) {
        setProcessing(claim.id);
        await Promise.all([
            supabase.from("claims").update({ status: "approved" }).eq("id", claim.id),
            supabase.from("shifts").update({ status: "taken" }).eq("id", claim.shift_id),
            supabase.from("claims").update({ status: "rejected" }).eq("shift_id", claim.shift_id).eq("status", "pending").neq("id", claim.id),
        ]);
        await logHistory(claim.shift_id, "claim_approved", { user_username: claim.username, user_name: claim.claimant_name });
        setProcessing(null);
        fetchData();
    }

    async function rejectClaim(claim: PendingClaim) {
        setProcessing(claim.id);
        await supabase.from("claims").update({ status: "rejected" }).eq("id", claim.id);
        await logHistory(claim.shift_id, "claim_rejected", { user_username: claim.username, user_name: claim.claimant_name });
        setProcessing(null);
        fetchData();
    }

    async function approveSwap(swap: PendingSwap) {
        setProcessing(swap.id);
        try {
            if (swap.custom_start_at && swap.custom_end_at) {
                await approvePartialSwap(swap);
            } else {
                const { data: targetUser } = await supabase
                    .from("users").select("id").eq("username", swap.target_username).maybeSingle();
                await Promise.all([
                    supabase.from("swaps").update({ status: "approved" }).eq("id", swap.id),
                    supabase.from("claims")
                        .update({
                            username: swap.target_username,
                            claimant_name: swap.target_name,
                            ...(targetUser ? { user_id: targetUser.id } : {}),
                        })
                        .eq("shift_id", swap.shift_id)
                        .eq("username", swap.requester_username)
                        .eq("status", "approved"),
                ]);
                await logHistory(swap.shift_id, "swap_approved", {
                    user_username: swap.target_username,
                    user_name: swap.target_name,
                    from_username: swap.requester_username,
                    from_name: swap.requester_name,
                });
            }
        } finally {
            setProcessing(null);
            fetchData();
        }
    }

    async function rejectSwap(swap: PendingSwap) {
        setProcessing(swap.id);
        await supabase.from("swaps").update({ status: "rejected" }).eq("id", swap.id);
        await logHistory(swap.shift_id, "swap_rejected", { user_username: swap.requester_username, user_name: swap.requester_name });
        setProcessing(null);
        fetchData();
    }

    function toggleSelect(type: "claim" | "swap", id: string) {
        const key = `${type}-${id}`;
        setSelectedIds((prev) => {
            const next = new Set(prev);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
        });
    }

    function groupKeys(group: UserGroup) {
        return [
            ...group.claims.map((c) => `claim-${c.id}`),
            ...group.swaps.map((s) => `swap-${s.id}`),
        ];
    }

    function toggleGroupSelect(group: UserGroup) {
        const keys = groupKeys(group);
        const allSelected = keys.every((k) => selectedIds.has(k));
        setSelectedIds((prev) => {
            const next = new Set(prev);
            keys.forEach((k) => allSelected ? next.delete(k) : next.add(k));
            return next;
        });
    }

    function toggleAllSelect() {
        const allKeys = userGroups.flatMap(groupKeys);
        const allSelected = allKeys.every((k) => selectedIds.has(k));
        setSelectedIds((prev) => {
            const next = new Set(prev);
            allKeys.forEach((k) => allSelected ? next.delete(k) : next.add(k));
            return next;
        });
    }

    async function batchAction(action: "approve" | "reject") {
        setProcessing("batch");
        const allClaims = userGroups.flatMap((g) => g.claims);
        const allSwaps = userGroups.flatMap((g) => g.swaps);
        const claims = [...selectedIds]
            .filter((k) => k.startsWith("claim-"))
            .map((k) => allClaims.find((c) => c.id === k.slice(6)))
            .filter(Boolean) as PendingClaim[];
        const swaps = [...selectedIds]
            .filter((k) => k.startsWith("swap-"))
            .map((k) => allSwaps.find((s) => s.id === k.slice(5)))
            .filter(Boolean) as PendingSwap[];

        try {
            if (action === "approve") {
                const wholeSwaps = swaps.filter((s) => !s.custom_start_at);
                const partialSwaps = swaps.filter((s) => !!s.custom_start_at);
                await Promise.all([
                    ...claims.map((c) => Promise.all([
                        supabase.from("claims").update({ status: "approved" }).eq("id", c.id),
                        supabase.from("shifts").update({ status: "taken" }).eq("id", c.shift_id),
                        supabase.from("claims").update({ status: "rejected" }).eq("shift_id", c.shift_id).eq("status", "pending").neq("id", c.id),
                        logHistory(c.shift_id, "claim_approved", { user_username: c.username, user_name: c.claimant_name }),
                    ])),
                    ...wholeSwaps.map(async (s) => {
                        const { data: tu } = await supabase.from("users").select("id").eq("username", s.target_username).maybeSingle();
                        await Promise.all([
                            supabase.from("swaps").update({ status: "approved" }).eq("id", s.id),
                            supabase.from("claims").update({
                                username: s.target_username,
                                claimant_name: s.target_name,
                                ...(tu ? { user_id: tu.id } : {}),
                            }).eq("shift_id", s.shift_id).eq("username", s.requester_username).eq("status", "approved"),
                        ]);
                        await logHistory(s.shift_id, "swap_approved", {
                            user_username: s.target_username,
                            user_name: s.target_name,
                            from_username: s.requester_username,
                            from_name: s.requester_name,
                        });
                    }),
                ]);
                for (const s of partialSwaps) {
                    await approvePartialSwap(s);
                }
            } else {
                await Promise.all([
                    ...claims.map((c) => Promise.all([
                        supabase.from("claims").update({ status: "rejected" }).eq("id", c.id),
                        logHistory(c.shift_id, "claim_rejected", { user_username: c.username, user_name: c.claimant_name }),
                    ])),
                    ...swaps.map((s) => Promise.all([
                        supabase.from("swaps").update({ status: "rejected" }).eq("id", s.id),
                        logHistory(s.shift_id, "swap_rejected", { user_username: s.requester_username, user_name: s.requester_name }),
                    ])),
                ]);
            }
        } finally {
            setProcessing(null);
            setSelectedIds(new Set());
            fetchData();
        }
    }

    const totalPending = userGroups.reduce((n, g) => n + g.claims.length + g.swaps.length, 0);

    return (
        <div className="p-6 max-w-4xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-white">Admin Panel</h1>
                    <p className="text-slate-400 text-sm mt-0.5">{user?.first_name} {user?.last_name}</p>
                </div>
                <div className="flex items-center gap-3">
                    {lastRefreshed && (
                        <span className="text-xs text-slate-500">
                            Updated {lastRefreshed.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                    )}
                    <button
                        onClick={() => { fetchData(); fetchDateShifts(); }}
                        className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 cursor-pointer transition-colors"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {/* ── Pending Approvals ── */}
            <section className="mb-12">
                <div className="flex items-center gap-3 mb-4">
                    <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Pending Approvals</h2>
                    {totalPending > 0 && (
                        <span className="bg-amber-500 text-black text-xs font-bold px-2 py-0.5 rounded-full leading-none">
                            {totalPending}
                        </span>
                    )}
                    {userGroups.length > 0 && (
                        <label className="ml-auto flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={userGroups.flatMap(groupKeys).length > 0 && userGroups.flatMap(groupKeys).every((k) => selectedIds.has(k))}
                                onChange={toggleAllSelect}
                                className="accent-slate-400 w-4 h-4 cursor-pointer"
                            />
                            <span className="text-xs text-slate-500">Select all</span>
                        </label>
                    )}
                </div>

                {loading ? (
                    <p className="text-slate-500 text-sm">Loading…</p>
                ) : userGroups.length === 0 ? (
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
                        <p className="text-slate-400">No pending requests.</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {userGroups.map((group) => {
                            const isExpanded = expandedUsers.has(group.username);
                            const count = group.claims.length + group.swaps.length;
                            const initials = group.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
                            return (
                                <div key={group.username} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                                    {/* Row header */}
                                    <div className="flex items-center hover:bg-slate-800/50 transition-colors">
                                        {/* Per-person select-all checkbox */}
                                        <div className="pl-5 py-4 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                            <input
                                                type="checkbox"
                                                checked={groupKeys(group).every((k) => selectedIds.has(k))}
                                                onChange={() => toggleGroupSelect(group)}
                                                className="accent-slate-400 w-4 h-4 cursor-pointer"
                                            />
                                        </div>
                                        <button
                                            onClick={() => toggleExpand(group.username)}
                                            className="flex-1 flex items-center justify-between px-4 py-4 cursor-pointer"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                                    {initials}
                                                </div>
                                                <div className="text-left">
                                                    <div className="text-white font-semibold text-sm">{group.name}</div>
                                                    <div className="text-slate-400 text-xs">{group.username}</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs text-slate-300">{count} request{count !== 1 ? "s" : ""}</span>
                                                <span className="text-slate-400 text-xs">{isExpanded ? "▲" : "▼"}</span>
                                            </div>
                                        </button>
                                    </div>

                                    {/* Expanded content */}
                                    {isExpanded && (
                                        <div className="border-t border-slate-800 divide-y divide-slate-800/60">
                                            {group.claims.map((claim) => {
                                                const s = claim.shift ? new Date(claim.shift.start_at) : null;
                                                const e = claim.shift ? new Date(claim.shift.end_at) : null;
                                                const busy = processing === claim.id || processing === "batch";
                                                const key = `claim-${claim.id}`;
                                                return (
                                                    <div key={claim.id} className="px-5 py-4 flex items-center gap-3">
                                                        <input type="checkbox" checked={selectedIds.has(key)}
                                                            onChange={() => toggleSelect("claim", claim.id)}
                                                            className="accent-green-500 w-4 h-4 flex-shrink-0 cursor-pointer" />
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                                                <span className="text-xs bg-green-600/20 text-green-400 border border-green-600/30 px-2 py-0.5 rounded-full">Claim</span>
                                                                {s && <span className="text-white text-sm font-medium">{getTriWeekLabel(s)} · {DAY[s.getUTCDay()]}</span>}
                                                            </div>
                                                            {s && e && <div className="text-slate-300 text-xs">{formatUTCTime(s)} – {formatUTCTime(e)}</div>}
                                                        </div>
                                                        <div className="flex gap-2 flex-shrink-0">
                                                            <button onClick={() => approveClaim(claim)} disabled={!!busy}
                                                                className="text-xs px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white font-medium disabled:opacity-50 cursor-pointer transition-colors">
                                                                {busy ? "…" : "Approve"}
                                                            </button>
                                                            <button onClick={() => rejectClaim(claim)} disabled={!!busy}
                                                                className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-red-600/30 text-slate-300 hover:text-red-400 font-medium disabled:opacity-50 cursor-pointer transition-colors">
                                                                Reject
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}

                                            {group.swaps.map((swap) => {
                                                const s = swap.shift ? new Date(swap.shift.start_at) : null;
                                                const e = swap.shift ? new Date(swap.shift.end_at) : null;
                                                const isPartial = !!(swap.custom_start_at && swap.custom_end_at);
                                                const busy = processing === swap.id || processing === "batch";
                                                const key = `swap-${swap.id}`;
                                                return (
                                                    <div key={swap.id} className="px-5 py-4 flex items-center gap-3">
                                                        <input type="checkbox" checked={selectedIds.has(key)}
                                                            onChange={() => toggleSelect("swap", swap.id)}
                                                            className="accent-violet-500 w-4 h-4 flex-shrink-0 cursor-pointer" />
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                                                <span className="text-xs bg-violet-600/20 text-violet-400 border border-violet-600/30 px-2 py-0.5 rounded-full">Swap</span>
                                                                {s && <span className="text-white text-sm font-medium">{getTriWeekLabel(s)} · {DAY[s.getUTCDay()]}</span>}
                                                            </div>
                                                            {s && e && <div className="text-slate-300 text-xs">{formatUTCTime(s)} – {formatUTCTime(e)}</div>}
                                                            {isPartial && (
                                                                <div className="text-violet-400 text-xs mt-0.5">
                                                                    Partial: {formatUTCTime(new Date(swap.custom_start_at!))} – {formatUTCTime(new Date(swap.custom_end_at!))}
                                                                </div>
                                                            )}
                                                            {/* Who → who */}
                                                            <div className="flex items-center gap-1.5 mt-1.5">
                                                                <span className="text-white text-xs font-medium">{swap.requester_name}</span>
                                                                <span className="text-slate-400 text-xs">→</span>
                                                                <span className="text-white text-xs font-medium">{swap.target_name}</span>
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-2 flex-shrink-0">
                                                            <button onClick={() => approveSwap(swap)} disabled={!!busy}
                                                                className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium disabled:opacity-50 cursor-pointer transition-colors">
                                                                {busy ? "…" : "Approve"}
                                                            </button>
                                                            <button onClick={() => rejectSwap(swap)} disabled={!!busy}
                                                                className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-red-600/30 text-slate-300 hover:text-red-400 font-medium disabled:opacity-50 cursor-pointer transition-colors">
                                                                Reject
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* ── Shift Assignment ── */}
            <section>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">Shift Assignment</h2>

                <div className="flex items-center gap-3 mb-5">
                    <label className="text-slate-400 text-sm">Date:</label>
                    <input
                        type="date"
                        value={assignDate}
                        onChange={(e) => setAssignDate(e.target.value)}
                        className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-slate-500 cursor-pointer"
                    />
                </div>

                {dateShifts.length === 0 ? (
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center">
                        <p className="text-slate-400 text-sm">No shifts for this date.</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {dateShifts.map((shift) => {
                            const s = new Date(shift.start_at);
                            const e = new Date(shift.end_at);
                            return (
                                <div key={shift.id} className="bg-slate-900 border border-slate-800 rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
                                    <div>
                                        <div className="text-white font-medium text-sm">{formatUTCTime(s)} – {formatUTCTime(e)}</div>
                                        <div className="text-slate-400 text-xs mt-0.5">
                                            {getTriWeekLabel(s)}
                                            {shift.assignedTo
                                                ? <span className="ml-2 text-green-400">→ {shift.assignedTo.claimant_name}</span>
                                                : <span className="ml-2 text-slate-500">Open</span>
                                            }
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        {shift.assignedTo && (
                                            <button
                                                onClick={() => makeShiftOpen(shift.id)}
                                                title="Remove the current assignee of the shift"
                                                className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-400 hover:text-amber-400 hover:border-amber-500/50 cursor-pointer transition-colors"
                                            >
                                                Make Open
                                            </button>
                                        )}
                                        <button
                                            onClick={() => setAssignModal(shift)}
                                            title="Assign the shift to someone"
                                            className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 cursor-pointer transition-colors"
                                        >
                                            Assign
                                        </button>
                                        <button
                                            onClick={() => deleteShift(shift)}
                                            title="Delete the shift"
                                            className="text-xs px-3 py-1.5 rounded-lg border border-red-600/30 text-red-400 hover:bg-red-600/20 cursor-pointer transition-colors"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* ── Payouts link ── */}
            <section className="mt-12">
                <Link
                    href="/admin/payouts"
                    className="flex items-center justify-between bg-slate-900 border border-slate-800 hover:border-slate-600 rounded-2xl px-5 py-4 transition-colors group"
                >
                    <div>
                        <h2 className="text-white font-semibold text-sm">Payouts</h2>
                        <p className="text-slate-500 text-xs mt-0.5">View completed shift earnings for all users</p>
                    </div>
                    <span className="text-slate-500 group-hover:text-slate-300 transition-colors text-sm">→</span>
                </Link>
            </section>

            {/* Floating batch action bar */}
            {selectedIds.size > 0 && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 border border-slate-700 rounded-2xl px-5 py-3 flex items-center gap-4 shadow-2xl z-50">
                    <span className="text-white text-sm font-medium">{selectedIds.size} selected</span>
                    <button onClick={() => batchAction("approve")} disabled={processing === "batch"}
                        className="bg-green-600 hover:bg-green-500 text-white text-sm px-4 py-1.5 rounded-lg font-medium disabled:opacity-50 cursor-pointer transition-colors">
                        {processing === "batch" ? "…" : "Approve All"}
                    </button>
                    <button onClick={() => batchAction("reject")} disabled={processing === "batch"}
                        className="bg-red-600/20 hover:bg-red-600/40 text-red-400 text-sm px-4 py-1.5 rounded-lg font-medium disabled:opacity-50 cursor-pointer transition-colors">
                        Reject All
                    </button>
                    <button onClick={() => setSelectedIds(new Set())} className="text-slate-400 hover:text-white cursor-pointer text-lg leading-none">✕</button>
                </div>
            )}

            {assignModal && (
                <AssignModal
                    shift={assignModal}
                    onClose={() => setAssignModal(null)}
                    onSuccess={() => { setAssignModal(null); fetchDateShifts(); fetchData(); }}
                />
            )}

            {deleteConfirmShift && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-80 shadow-2xl">
                        <h3 className="text-white font-semibold text-base mb-2">Delete shift?</h3>
                        <p className="text-slate-400 text-sm mb-1">
                            {formatUTCTime(new Date(deleteConfirmShift.start_at))} – {formatUTCTime(new Date(deleteConfirmShift.end_at))}
                            {" · "}{getTriWeekLabel(new Date(deleteConfirmShift.start_at))}
                        </p>
                        {deleteConfirmShift.assignedTo && (
                            <p className="text-amber-400 text-xs mb-3">Currently assigned to {deleteConfirmShift.assignedTo.claimant_name}</p>
                        )}
                        <p className="text-slate-500 text-xs mb-5">This action cannot be undone.</p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setDeleteConfirmShift(null)}
                                className="flex-1 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 text-sm cursor-pointer transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDelete}
                                className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-sm cursor-pointer transition-colors"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ─── merge adjacent shifts (module scope) ─── */

async function mergeAdjacentShifts(username: string, claimantName: string, userId: string | null, pivotId: string): Promise<void> {
    const { data: pivot } = await supabase.from("shifts").select("start_at, end_at, category").eq("id", pivotId).maybeSingle();
    if (!pivot) return;

    const { data: userClaims } = await supabase.from("claims").select("shift_id").eq("username", username).eq("status", "approved");
    if (!userClaims || userClaims.length < 2) return;

    const otherIds = userClaims.map((c) => c.shift_id).filter((id) => id !== pivotId);
    if (otherIds.length === 0) return;

    const { data: adjacent } = await supabase.from("shifts").select("id, start_at, end_at").in("id", otherIds);
    if (!adjacent || adjacent.length === 0) return;

    let chainStart = pivot.start_at;
    let chainEnd = pivot.end_at;
    const chainIds: string[] = [pivotId];

    let expanded = true;
    while (expanded) {
        expanded = false;
        for (const s of adjacent) {
            if (chainIds.includes(s.id)) continue;
            if (s.end_at === chainStart) {
                chainStart = s.start_at;
                chainIds.push(s.id);
                expanded = true;
                break;
            } else if (s.start_at === chainEnd) {
                chainEnd = s.end_at;
                chainIds.push(s.id);
                expanded = true;
                break;
            }
        }
    }

    if (chainIds.length <= 1) return;

    const cat = pivot.category ?? null;
    const { data: mergedShifts } = await supabase.from("shifts")
        .insert({ start_at: chainStart, end_at: chainEnd, status: "taken", ...(cat ? { category: cat } : {}) })
        .select("id");
    const mergedId = mergedShifts?.[0]?.id ?? null;
    if (!mergedId) return;

    await supabase.from("claims").insert({
        shift_id: mergedId, username, claimant_name: claimantName, status: "approved",
        ...(userId ? { user_id: userId } : {}),
    });
    await supabase.from("claims").delete().in("shift_id", chainIds).eq("status", "approved");
    await supabase.from("shifts").delete().in("id", chainIds);
}

/* ─── Time helpers (module scope) ─── */

function timeToMins(t: string): number {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
}

function minsToLabel(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function parseTimeInput(input: string): string | null {
    const s = input.trim().toLowerCase().replace(/\s+/g, "");
    // HH:MM 24h
    let m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (m) {
        const h = +m[1], min = +m[2];
        if (h <= 23 && min <= 59) return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    }
    // H:MMam/pm
    m = s.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
    if (m) {
        let h = +m[1]; const min = +m[2]; const isPm = m[3] === "pm";
        if (isPm && h !== 12) h += 12;
        if (!isPm && h === 12) h = 0;
        if (h <= 23 && min <= 59) return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    }
    // Ham/pm (e.g. "6pm")
    m = s.match(/^(\d{1,2})(am|pm)$/);
    if (m) {
        let h = +m[1]; const isPm = m[2] === "pm";
        if (isPm && h !== 12) h += 12;
        if (!isPm && h === 12) h = 0;
        if (h <= 23) return `${String(h).padStart(2, "0")}:00`;
    }
    return null;
}

function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const toDisplay = (v: string) => v ? minsToLabel(timeToMins(v)) : "";
    const [raw, setRaw] = useState(() => toDisplay(value));
    useEffect(() => { setRaw(toDisplay(value)); }, [value]);
    function handleBlur() {
        const parsed = parseTimeInput(raw);
        if (parsed) {
            onChange(parsed);
            setRaw(minsToLabel(timeToMins(parsed)));
        } else {
            setRaw(toDisplay(value));
        }
    }
    return (
        <input
            type="text"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={handleBlur}
            placeholder="e.g. 6:30 PM"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500/60 placeholder:text-slate-500 transition-colors"
        />
    );
}

/* ─── Time Select (dropdown for partial shift) ─── */

function TimeSelect({ value, onChange, shiftStart, shiftEnd }: { value: string; onChange: (v: string) => void; shiftStart: string; shiftEnd: string }) {
    const options = useMemo(() => {
        const startMins = timeToMins(shiftStart);
        const endMins = timeToMins(shiftEnd);
        const set = new Set<string>();
        for (let m = startMins; m <= endMins; m += 30) {
            set.add(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
        }
        // Always include exact shift start/end
        set.add(shiftStart);
        set.add(shiftEnd);
        return [...set].sort();
    }, [shiftStart, shiftEnd]);

    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500/60 transition-colors cursor-pointer"
        >
            {options.map((t) => (
                <option key={t} value={t}>{minsToLabel(timeToMins(t))}</option>
            ))}
        </select>
    );
}

/* ─── Assign Modal ─── */

function AssignModal({ shift, onClose, onSuccess }: { shift: any; onClose: () => void; onSuccess: () => void }) {
    const [users, setUsers] = useState<any[]>([]);
    const [search, setSearch] = useState("");
    const [selectedUser, setSelectedUser] = useState<any>(null);
    const [submitting, setSubmitting] = useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const [slotShifts, setSlotShifts] = useState<any[]>([shift]);
    const [selectedShiftIds, setSelectedShiftIds] = useState<string[]>([shift.id]);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const [isPartial, setIsPartial] = useState(false);
    const [partialStart, setPartialStart] = useState(shift.start_at.slice(11, 16));
    const [partialEnd, setPartialEnd] = useState(shift.end_at.slice(11, 16));
    const [existingClaim, setExistingClaim] = useState<any>(null);
    const [step, setStep] = useState<"setup" | "preview">("setup");
    const [timeError, setTimeError] = useState<string | null>(null);

    const shiftStartTime = shift.start_at.slice(11, 16);
    const shiftEndTime = shift.end_at.slice(11, 16);

    useEffect(() => {
        supabase.from("users").select("id, first_name, last_name, username").then(({ data }) => {
            if (data) setUsers(data);
        });
        const dayOfWeek = new Date(shift.start_at).getUTCDay();
        const startTime = shift.start_at.slice(11, 16);
        const endTime = shift.end_at.slice(11, 16);
        const shiftDate = new Date(shift.start_at);
        const currentTri = TRIMESTERS.find((tri) => {
            const diff = Math.floor((shiftDate.getTime() - tri.start.getTime()) / 86400000);
            return diff >= 0 && diff < 77;
        });
        const triStart = currentTri?.start ?? null;
        const triEnd = currentTri ? new Date(currentTri.start.getTime() + 77 * 86400000) : null;
        supabase.from("shifts").select("id, start_at, end_at, status").order("start_at").then(({ data }) => {
            if (!data) return;
            const same = data.filter((s) => {
                const d = new Date(s.start_at);
                const inTri = triStart && triEnd ? d >= triStart && d < triEnd : true;
                return inTri
                    && d.getUTCDay() === dayOfWeek
                    && s.start_at.slice(11, 16) === startTime
                    && s.end_at.slice(11, 16) === endTime;
            });
            setSlotShifts(same.length > 0 ? same : [shift]);
            setSelectedShiftIds([shift.id]);
        });
        supabase.from("claims").select("id, username, claimant_name, user_id")
            .eq("shift_id", shift.id).eq("status", "approved").maybeSingle()
            .then(({ data }) => setExistingClaim(data ?? null));
    }, []);

    useEffect(() => {
        if (highlightedIndex >= 0 && listRef.current) {
            const item = listRef.current.children[highlightedIndex] as HTMLElement;
            item?.scrollIntoView({ block: "nearest" });
        }
    }, [highlightedIndex]);

    const filtered = users.filter((u) =>
        `${u.first_name} ${u.last_name}`.toLowerCase().includes(search.toLowerCase())
    );

    const s = new Date(shift.start_at);
    const e = new Date(shift.end_at);

    function toggleShift(id: string) {
        setSelectedShiftIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
    }

    function handleKeyDown(ev: React.KeyboardEvent<HTMLInputElement>) {
        if (!dropdownOpen || filtered.length === 0) return;
        if (ev.key === "ArrowDown") { ev.preventDefault(); setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1)); }
        else if (ev.key === "ArrowUp") { ev.preventDefault(); setHighlightedIndex((i) => Math.max(i - 1, -1)); }
        else if (ev.key === "Enter" && highlightedIndex >= 0) {
            ev.preventDefault();
            setSelectedUser(filtered[highlightedIndex]);
            setDropdownOpen(false);
            setHighlightedIndex(-1);
        } else if (ev.key === "Escape") { setDropdownOpen(false); setHighlightedIndex(-1); }
    }

    type PreviewSeg = { startMins: number; endMins: number; name: string | null; isNew?: boolean };

    function computePreview(): PreviewSeg[] {
        const ss = timeToMins(shiftStartTime);
        const se = timeToMins(shiftEndTime);
        const cs = timeToMins(partialStart);
        const ce = timeToMins(partialEnd);
        const newName = `${selectedUser.first_name} ${selectedUser.last_name}`;
        const existingName = existingClaim?.claimant_name ?? null;
        const segs: PreviewSeg[] = [];
        if (cs > ss) segs.push({ startMins: ss, endMins: cs, name: existingName });
        segs.push({ startMins: cs, endMins: ce, name: newName, isNew: true });
        if (ce < se) segs.push({ startMins: ce, endMins: se, name: existingName });
        return segs;
    }

    function goToPreview() {
        if (!selectedUser) return;
        if (isPartial) {
            const ss = timeToMins(shiftStartTime);
            const se = timeToMins(shiftEndTime);
            const cs = timeToMins(partialStart);
            const ce = timeToMins(partialEnd);
            if (cs < ss || ce > se) { setTimeError(`Times must be within ${minsToLabel(ss)} – ${minsToLabel(se)}.`); return; }
            if (cs >= ce) { setTimeError("Start must be before end."); return; }
        }
        setTimeError(null);
        setStep("preview");
    }

    async function assign() {
        if (!selectedUser || selectedShiftIds.length === 0) return;
        setSubmitting(true);
        if (!isPartial) {
            await Promise.all(selectedShiftIds.map(async (shiftId) => {
                const { data: oldClm } = await supabase.from("claims").select("username, claimant_name").eq("shift_id", shiftId).eq("status", "approved").maybeSingle();
                await supabase.from("claims").update({ status: "rejected" }).eq("shift_id", shiftId).eq("status", "pending");
                await supabase.from("claims").delete().eq("shift_id", shiftId).eq("status", "approved");
                await supabase.from("claims").insert({
                    user_id: selectedUser.id,
                    shift_id: shiftId,
                    status: "approved",
                    claimant_name: `${selectedUser.first_name} ${selectedUser.last_name}`,
                    username: selectedUser.username,
                });
                await supabase.from("shifts").update({ status: "taken" }).eq("id", shiftId);
                await logHistory(shiftId, "admin_assigned", {
                    user_username: selectedUser.username,
                    user_name: `${selectedUser.first_name} ${selectedUser.last_name}`,
                    ...(oldClm ? { from_username: oldClm.username, from_name: oldClm.claimant_name } : {}),
                });
                await mergeAdjacentShifts(selectedUser.username, `${selectedUser.first_name} ${selectedUser.last_name}`, selectedUser.id, shiftId);
            }));
        } else {
            await Promise.all(selectedShiftIds.map((shiftId) => assignPartial(shiftId)));
        }
        setSubmitting(false);
        onSuccess();
    }

    async function assignPartial(shiftId: string) {
        const { data: orig } = await supabase.from("shifts").select("start_at, end_at, category").eq("id", shiftId).maybeSingle();
        if (!orig) return;
        const dateStr = orig.start_at.slice(0, 10);
        const customStart = `${dateStr}T${partialStart}:00`;
        const customEnd = `${dateStr}T${partialEnd}:00`;
        const ss = timeToMins(orig.start_at.slice(11, 16));
        const se = timeToMins(orig.end_at.slice(11, 16));
        const cs = timeToMins(partialStart);
        const ce = timeToMins(partialEnd);
        const hasBefore = cs > ss;
        const hasAfter = ce < se;
        const { data: existingClm } = await supabase.from("claims").select("id, username, claimant_name, user_id")
            .eq("shift_id", shiftId).eq("status", "approved").maybeSingle();
        await supabase.from("claims").update({ status: "rejected" }).eq("shift_id", shiftId).eq("status", "pending");
        if (!hasBefore && !hasAfter) {
            await supabase.from("claims").delete().eq("shift_id", shiftId).eq("status", "approved");
            await supabase.from("claims").insert({ shift_id: shiftId, user_id: selectedUser.id, username: selectedUser.username, claimant_name: `${selectedUser.first_name} ${selectedUser.last_name}`, status: "approved" });
            await supabase.from("shifts").update({ status: "taken" }).eq("id", shiftId);
            return;
        }
        const cat = orig.category ?? null;
        const { data: newShifts } = await supabase.from("shifts")
            .insert({ start_at: customStart, end_at: customEnd, status: "taken", ...(cat ? { category: cat } : {}) })
            .select("id");
        const newShiftId = newShifts?.[0]?.id ?? null;
        if (!newShiftId) {
            await supabase.from("claims").delete().eq("shift_id", shiftId).eq("status", "approved");
            await supabase.from("claims").insert({ shift_id: shiftId, user_id: selectedUser.id, username: selectedUser.username, claimant_name: `${selectedUser.first_name} ${selectedUser.last_name}`, status: "approved" });
            await supabase.from("shifts").update({ status: "taken" }).eq("id", shiftId);
            return;
        }
        await supabase.from("claims").insert({ shift_id: newShiftId, user_id: selectedUser.id, username: selectedUser.username, claimant_name: `${selectedUser.first_name} ${selectedUser.last_name}`, status: "approved" });
        await logHistory(newShiftId, "admin_assigned", {
            user_username: selectedUser.username,
            user_name: `${selectedUser.first_name} ${selectedUser.last_name}`,
            notes: `Partial: ${partialStart}–${partialEnd}`,
            ...(existingClm ? { from_username: existingClm.username, from_name: existingClm.claimant_name } : {}),
        });
        if (hasBefore && hasAfter) {
            await supabase.from("shifts").update({ end_at: customStart }).eq("id", shiftId);
            const { data: afterShifts } = await supabase.from("shifts")
                .insert({ start_at: customEnd, end_at: orig.end_at, status: existingClm ? "taken" : "open", ...(cat ? { category: cat } : {}) })
                .select("id");
            const afterId = afterShifts?.[0]?.id ?? null;
            if (afterId && existingClm) {
                await supabase.from("claims").insert({ shift_id: afterId, username: existingClm.username, claimant_name: existingClm.claimant_name, status: "approved", user_id: existingClm.user_id });
            }
        } else if (hasBefore) {
            await supabase.from("shifts").update({ end_at: customStart }).eq("id", shiftId);
        } else {
            await supabase.from("shifts").update({ start_at: customEnd }).eq("id", shiftId);
        }
    }

    const previewSegs = step === "preview" && selectedUser && isPartial ? computePreview() : null;
    const newName = selectedUser ? `${selectedUser.first_name} ${selectedUser.last_name}` : "";

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-[28rem] max-h-[90vh] overflow-y-auto" onClick={(ev) => ev.stopPropagation()}>
                <div className="flex justify-between items-start mb-5">
                    <div>
                        <h2 className="text-white font-semibold text-lg">Assign Shift</h2>
                        <p className="text-slate-400 text-sm mt-0.5">{DAY_FULL[s.getUTCDay()]} · {formatUTCTime(s)} – {formatUTCTime(e)}</p>
                        <p className="text-slate-500 text-xs mt-0.5">{getTriWeekLabel(s)}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-500 hover:text-white text-xl cursor-pointer">✕</button>
                </div>

                {step === "setup" ? (
                    <>
                        {existingClaim && (
                            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5 mb-4 text-amber-400 text-xs">
                                Currently assigned to <span className="font-semibold">{existingClaim.claimant_name}</span>. Assigning will affect this.
                            </div>
                        )}

                        <p className="text-slate-400 text-sm mb-2">Assign to:</p>
                        <div className="relative mb-4">
                            <input
                                ref={inputRef}
                                type="text"
                                placeholder="Search by name…"
                                value={selectedUser ? `${selectedUser.first_name} ${selectedUser.last_name}` : search}
                                onChange={(ev) => { setSearch(ev.target.value); setSelectedUser(null); setDropdownOpen(true); setHighlightedIndex(-1); }}
                                onFocus={() => setDropdownOpen(true)}
                                onKeyDown={handleKeyDown}
                                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white placeholder:text-slate-500 focus:outline-none focus:border-slate-500 text-sm"
                            />
                            {selectedUser && (
                                <button onClick={() => { setSelectedUser(null); setSearch(""); inputRef.current?.focus(); }}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white cursor-pointer">✕</button>
                            )}
                            {dropdownOpen && !selectedUser && search.length > 0 && (
                                <div ref={listRef} className="absolute left-0 right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-xl overflow-hidden z-10 max-h-48 overflow-y-auto shadow-lg">
                                    {filtered.length > 0 ? filtered.map((u, idx) => (
                                        <button key={u.username}
                                            onMouseDown={() => { setSelectedUser(u); setDropdownOpen(false); setHighlightedIndex(-1); }}
                                            onMouseEnter={() => setHighlightedIndex(idx)}
                                            className={`w-full text-left px-4 py-2.5 text-sm text-white cursor-pointer transition-colors ${idx === highlightedIndex ? "bg-slate-600" : "hover:bg-slate-700"}`}
                                        >
                                            {u.first_name} {u.last_name}
                                            <span className="text-slate-500 ml-2 text-xs">{u.username}</span>
                                        </button>
                                    )) : (
                                        <div className="px-4 py-3 text-slate-500 text-sm">No users found.</div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Partial shift toggle */}
                        <div
                            className="flex items-center gap-3 mb-4 cursor-pointer select-none"
                            onClick={() => { setIsPartial((v) => !v); setTimeError(null); setPartialStart(shiftStartTime); setPartialEnd(shiftEndTime); }}
                        >
                            <div className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${isPartial ? "bg-indigo-600" : "bg-slate-700"}`}>
                                <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${isPartial ? "translate-x-4" : "translate-x-0"}`} />
                            </div>
                            <span className="text-slate-400 text-sm">Partial shift</span>
                        </div>

                        {isPartial && (
                            <div className="flex items-center gap-2 mb-4">
                                <div className="flex-1">
                                    <label className="text-xs text-slate-500 mb-1 block">Start</label>
                                    <TimeSelect
                                        value={partialStart}
                                        onChange={(v) => { setPartialStart(v); setTimeError(null); }}
                                        shiftStart={shiftStartTime}
                                        shiftEnd={shiftEndTime}
                                    />
                                </div>
                                <span className="text-slate-500 mt-5 text-lg">→</span>
                                <div className="flex-1">
                                    <label className="text-xs text-slate-500 mb-1 block">End</label>
                                    <TimeSelect
                                        value={partialEnd}
                                        onChange={(v) => { setPartialEnd(v); setTimeError(null); }}
                                        shiftStart={shiftStartTime}
                                        shiftEnd={shiftEndTime}
                                    />
                                </div>
                            </div>
                        )}

                        {timeError && <p className="text-red-400 text-xs mb-3">{timeError}</p>}

                        {/* Week selector */}
                        {slotShifts.length > 1 && (
                            <>
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-slate-400 text-sm">Select weeks:</p>
                                    <button
                                        onClick={() => setSelectedShiftIds(selectedShiftIds.length === slotShifts.length ? [shift.id] : slotShifts.map((sl) => sl.id))}
                                        className="text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer"
                                    >
                                        {selectedShiftIds.length === slotShifts.length ? "Deselect all" : "Select all"}
                                    </button>
                                </div>
                                <div className="flex flex-col gap-1.5 mb-4 max-h-48 overflow-y-auto">
                                    {slotShifts.map((sl) => {
                                        const slDate = new Date(sl.start_at);
                                        const label = getTriWeekLabel(slDate);
                                        const dateStr = slDate.toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
                                        return (
                                            <label key={sl.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-800 cursor-pointer hover:bg-slate-700 transition-colors">
                                                <input type="checkbox" checked={selectedShiftIds.includes(sl.id)} onChange={() => toggleShift(sl.id)} className="accent-indigo-500 w-4 h-4" />
                                                <span className="text-white text-sm font-medium flex-1">{label}</span>
                                                <span className="text-slate-400 text-xs">{dateStr}</span>
                                                {sl.status === "taken" && <span className="text-red-400 text-xs">taken</span>}
                                                {sl.status === "open" && <span className="text-green-400 text-xs">open</span>}
                                            </label>
                                        );
                                    })}
                                </div>
                            </>
                        )}

                        <button
                            onClick={goToPreview}
                            disabled={!selectedUser || selectedShiftIds.length === 0}
                            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-2 rounded-xl cursor-pointer transition-colors"
                        >
                            Preview →
                        </button>
                    </>
                ) : (
                    <>
                        <p className="text-slate-400 text-sm mb-3">
                            {isPartial ? "Shift preview after assignment:" : "Confirm assignment:"}
                        </p>

                        {isPartial && previewSegs ? (
                            <div className="rounded-xl overflow-hidden border border-slate-700 mb-5">
                                {previewSegs.map((seg, i) => (
                                    <div key={i} className={`flex items-center gap-3 px-4 py-3 ${i < previewSegs.length - 1 ? "border-b border-slate-700" : ""} ${seg.isNew ? "bg-indigo-600/15" : "bg-slate-800"}`}>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-slate-400 text-xs">{minsToLabel(seg.startMins)} → {minsToLabel(seg.endMins)}</p>
                                            <p className={`text-sm font-semibold mt-0.5 truncate ${seg.isNew ? "text-indigo-300" : seg.name ? "text-white" : "text-slate-500 italic"}`}>
                                                {seg.name ?? "Unassigned"}
                                            </p>
                                        </div>
                                        {seg.isNew && <span className="text-[10px] bg-indigo-500 text-white px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide flex-shrink-0">New</span>}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="rounded-xl bg-slate-800 border border-slate-700 px-4 py-3 mb-5">
                                <p className="text-slate-400 text-xs">{formatUTCTime(s)} → {formatUTCTime(e)}</p>
                                <p className="text-white text-sm font-semibold mt-0.5">{newName}</p>
                                {existingClaim && <p className="text-amber-400 text-xs mt-1.5">Replaces: {existingClaim.claimant_name}</p>}
                                {selectedShiftIds.length > 1 && <p className="text-slate-500 text-xs mt-1">Applied to {selectedShiftIds.length} weeks</p>}
                            </div>
                        )}

                        <div className="flex gap-2">
                            <button
                                onClick={() => setStep("setup")}
                                className="flex-1 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 text-sm cursor-pointer transition-colors"
                            >
                                ← Back
                            </button>
                            <button
                                onClick={assign}
                                disabled={submitting}
                                className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-2 rounded-xl cursor-pointer transition-colors"
                            >
                                {submitting ? "Assigning…" : "Confirm"}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
