"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

/* ─── helpers ─── */

const TRIMESTERS = [
    { label: "T1", start: new Date(Date.UTC(2026, 1, 8)) },
    { label: "T2", start: new Date(Date.UTC(2026, 4, 25)) },
];

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

    const [assignDate, setAssignDate] = useState(() => new Date().toISOString().split("T")[0]);
    const [dateShifts, setDateShifts] = useState<any[]>([]);
    const [assignModal, setAssignModal] = useState<any>(null);

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
        ]);
        setProcessing(null);
        fetchData();
    }

    async function rejectClaim(claim: PendingClaim) {
        setProcessing(claim.id);
        await supabase.from("claims").update({ status: "rejected" }).eq("id", claim.id);
        setProcessing(null);
        fetchData();
    }

    async function approveSwap(swap: PendingSwap) {
        setProcessing(swap.id);
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
        setProcessing(null);
        fetchData();
    }

    async function rejectSwap(swap: PendingSwap) {
        setProcessing(swap.id);
        await supabase.from("swaps").update({ status: "rejected" }).eq("id", swap.id);
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

        if (action === "approve") {
            await Promise.all([
                ...claims.map((c) => Promise.all([
                    supabase.from("claims").update({ status: "approved" }).eq("id", c.id),
                    supabase.from("shifts").update({ status: "taken" }).eq("id", c.shift_id),
                ])),
                ...swaps.map(async (s) => {
                    const { data: tu } = await supabase.from("users").select("id").eq("username", s.target_username).maybeSingle();
                    return Promise.all([
                        supabase.from("swaps").update({ status: "approved" }).eq("id", s.id),
                        supabase.from("claims").update({
                            username: s.target_username,
                            claimant_name: s.target_name,
                            ...(tu ? { user_id: tu.id } : {}),
                        }).eq("shift_id", s.shift_id).eq("username", s.requester_username).eq("status", "approved"),
                    ]);
                }),
            ]);
        } else {
            await Promise.all([
                ...claims.map((c) => supabase.from("claims").update({ status: "rejected" }).eq("id", c.id)),
                ...swaps.map((s) => supabase.from("swaps").update({ status: "rejected" }).eq("id", s.id)),
            ]);
        }
        setProcessing(null);
        setSelectedIds(new Set());
        fetchData();
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
                                                    <div className="text-slate-500 text-xs">{group.username}</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs text-slate-400">{count} request{count !== 1 ? "s" : ""}</span>
                                                <span className="text-slate-500 text-xs">{isExpanded ? "▲" : "▼"}</span>
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
                                                            {s && e && <div className="text-slate-400 text-xs">{formatUTCTime(s)} – {formatUTCTime(e)}</div>}
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
                                                            {s && e && <div className="text-slate-400 text-xs">{formatUTCTime(s)} – {formatUTCTime(e)}</div>}
                                                            {isPartial && (
                                                                <div className="text-violet-400 text-xs mt-0.5">
                                                                    Partial: {formatUTCTime(new Date(swap.custom_start_at!))} – {formatUTCTime(new Date(swap.custom_end_at!))}
                                                                </div>
                                                            )}
                                                            {/* Who → who */}
                                                            <div className="flex items-center gap-1.5 mt-1.5">
                                                                <span className="text-slate-200 text-xs font-medium">{swap.requester_name}</span>
                                                                <span className="text-slate-500 text-xs">→</span>
                                                                <span className="text-slate-200 text-xs font-medium">{swap.target_name}</span>
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
                                    <button
                                        onClick={() => setAssignModal(shift)}
                                        className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 cursor-pointer transition-colors flex-shrink-0"
                                    >
                                        Assign
                                    </button>
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
        </div>
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

    useEffect(() => {
        // Fetch users
        supabase.from("users").select("id, first_name, last_name, username").then(({ data }) => {
            if (data) setUsers(data);
        });
        // Fetch all shifts in the same weekly slot
        const dayOfWeek = new Date(shift.start_at).getUTCDay();
        const startTime = shift.start_at.slice(11, 16); // "HH:MM"
        const endTime = shift.end_at.slice(11, 16);
        supabase.from("shifts").select("id, start_at, end_at, status").order("start_at").then(({ data }) => {
            if (!data) return;
            const same = data.filter((s) => {
                const d = new Date(s.start_at);
                return d.getUTCDay() === dayOfWeek
                    && s.start_at.slice(11, 16) === startTime
                    && s.end_at.slice(11, 16) === endTime;
            });
            setSlotShifts(same.length > 0 ? same : [shift]);
            setSelectedShiftIds([shift.id]);
        });
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

    async function assign() {
        if (!selectedUser || selectedShiftIds.length === 0) return;
        setSubmitting(true);
        await Promise.all(selectedShiftIds.map(async (shiftId) => {
            await Promise.all([
                supabase.from("claims").update({ status: "rejected" }).eq("shift_id", shiftId).eq("status", "pending"),
                supabase.from("claims").delete().eq("shift_id", shiftId).eq("status", "approved"),
            ]);
            await supabase.from("claims").insert({
                user_id: selectedUser.id,
                shift_id: shiftId,
                status: "approved",
                claimant_name: `${selectedUser.first_name} ${selectedUser.last_name}`,
                username: selectedUser.username,
            });
            await supabase.from("shifts").update({ status: "taken" }).eq("id", shiftId);
        }));
        setSubmitting(false);
        onSuccess();
    }

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-[26rem] max-h-[90vh] overflow-y-auto" onClick={(ev) => ev.stopPropagation()}>
                <div className="flex justify-between items-start mb-5">
                    <div>
                        <h2 className="text-white font-semibold text-lg">Assign Shift</h2>
                        <p className="text-slate-400 text-sm mt-0.5">
                            {DAY_FULL[s.getUTCDay()]} · {formatUTCTime(s)} – {formatUTCTime(e)}
                        </p>
                        <p className="text-slate-500 text-xs mt-0.5">{getTriWeekLabel(s)}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-500 hover:text-white text-xl cursor-pointer">✕</button>
                </div>

                {shift.assignedTo && (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5 mb-4 text-amber-400 text-xs">
                        Currently assigned to <span className="font-semibold">{shift.assignedTo.claimant_name}</span>. Assigning will override existing assignments.
                    </div>
                )}

                <p className="text-slate-400 text-sm mb-2">Assign to:</p>
                <div className="relative mb-5">
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

                {/* Week selector */}
                {slotShifts.length > 1 && (
                    <>
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-slate-400 text-sm">Select weeks:</p>
                            <button
                                onClick={() => setSelectedShiftIds(
                                    selectedShiftIds.length === slotShifts.length ? [shift.id] : slotShifts.map((s) => s.id)
                                )}
                                className="text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer"
                            >
                                {selectedShiftIds.length === slotShifts.length ? "Deselect all" : "Select all"}
                            </button>
                        </div>
                        <div className="flex flex-col gap-1.5 mb-5 max-h-48 overflow-y-auto">
                            {slotShifts.map((sl) => {
                                const slDate = new Date(sl.start_at);
                                const label = getTriWeekLabel(slDate);
                                const dateStr = slDate.toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
                                return (
                                    <label key={sl.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-800 cursor-pointer hover:bg-slate-700 transition-colors">
                                        <input
                                            type="checkbox"
                                            checked={selectedShiftIds.includes(sl.id)}
                                            onChange={() => toggleShift(sl.id)}
                                            className="accent-indigo-500 w-4 h-4"
                                        />
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
                    onClick={assign}
                    disabled={submitting || !selectedUser || selectedShiftIds.length === 0}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-2 rounded-xl cursor-pointer transition-colors"
                >
                    {submitting ? "Assigning…" : `Assign ${selectedShiftIds.length} Shift${selectedShiftIds.length !== 1 ? "s" : ""}`}
                </button>
            </div>
        </div>
    );
}
