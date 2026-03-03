"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";

const TRIMESTERS = [
    { label: "T1", start: new Date(Date.UTC(2026, 1, 8)) },
    { label: "T2", start: new Date(Date.UTC(2026, 4, 25)) },
];

function getSydneyParts(d: Date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-AU", {
        timeZone: "Australia/Sydney",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false,
    }).formatToParts(d);
    const get = (type: string) => parseInt(parts.find(p => p.type === type)!.value);
    return { year: get("year"), month: get("month") - 1, day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

function fakeUtcNow(): Date {
    const sp = getSydneyParts();
    return new Date(Date.UTC(sp.year, sp.month, sp.day, sp.hour, sp.minute, sp.second));
}

function getCurrentTriStart(): Date {
    const now = fakeUtcNow();
    for (let i = TRIMESTERS.length - 1; i >= 0; i--) {
        if (now >= TRIMESTERS[i].start) return TRIMESTERS[i].start;
    }
    return TRIMESTERS[0].start;
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

function isNightShift(startAt: string, endAt: string): boolean {
    const s = new Date(startAt);
    const e = new Date(endAt);
    return s.getUTCHours() === 23 && e.getUTCHours() === 7;
}

function calculatePay(startAt: string, endAt: string): number {
    if (isNightShift(startAt, endAt)) return 30;
    const hours = (new Date(endAt).getTime() - new Date(startAt).getTime()) / 3600000;
    return hours * 20;
}

type PayoutGroup = { username: string; name: string; shifts: any[] };

export default function AdminPayoutsPage() {
    const router = useRouter();
    const [payoutGroups, setPayoutGroups] = useState<PayoutGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const triStart = getCurrentTriStart();
    const [dateFrom, setDateFrom] = useState(() => triStart.toISOString().split("T")[0]);
    const [dateTo, setDateTo] = useState(() => fakeUtcNow().toISOString().split("T")[0]);

    useEffect(() => {
        const stored = localStorage.getItem("shift_user");
        if (!stored) { router.push("/login"); return; }
        const u = JSON.parse(stored);
        if (u.role !== "admin") { router.push("/"); return; }
        fetchPayouts();
    }, []);

    async function fetchPayouts() {
        setLoading(true);
        const now = fakeUtcNow().toISOString();

        const [{ data: usersRaw }, { data: claimsRaw }] = await Promise.all([
            supabase.from("users").select("username, role"),
            supabase.from("claims").select("shift_id, username, claimant_name").eq("status", "approved"),
        ]);

        if (!claimsRaw || claimsRaw.length === 0) { setPayoutGroups([]); setLoading(false); return; }

        const staffUsernames = new Set(
            (usersRaw ?? []).filter((u) => u.role === "staff").map((u) => u.username)
        );

        const filteredClaims = claimsRaw.filter((c) => !staffUsernames.has(c.username));
        if (filteredClaims.length === 0) { setPayoutGroups([]); setLoading(false); return; }

        const shiftIds = [...new Set(filteredClaims.map((c) => c.shift_id))];
        const { data: shiftsRaw } = await supabase
            .from("shifts")
            .select("id, start_at, end_at")
            .in("id", shiftIds)
            .lt("end_at", now);

        const pastIds = new Set((shiftsRaw ?? []).map((s) => s.id));
        const shiftMap = Object.fromEntries((shiftsRaw ?? []).map((s) => [s.id, s]));

        const byUser: Record<string, PayoutGroup> = {};
        for (const c of filteredClaims) {
            if (!pastIds.has(c.shift_id)) continue;
            if (!byUser[c.username]) byUser[c.username] = { username: c.username, name: c.claimant_name, shifts: [] };
            byUser[c.username].shifts.push(shiftMap[c.shift_id]);
        }

        setPayoutGroups(Object.values(byUser).sort((a, b) => a.name.localeCompare(b.name)));
        setLoading(false);
    }

    function toggleExpand(username: string) {
        setExpanded((prev) => {
            const next = new Set(prev);
            next.has(username) ? next.delete(username) : next.add(username);
            return next;
        });
    }

    // Apply search + date range filter
    const fromMs = new Date(dateFrom + "T00:00:00Z").getTime();
    const toMs = new Date(dateTo + "T23:59:59Z").getTime();

    const filtered = payoutGroups
        .map((g) => ({
            ...g,
            shifts: g.shifts.filter((sh) => {
                const t = new Date(sh.start_at).getTime();
                return t >= fromMs && t <= toMs;
            }),
        }))
        .filter((g) => g.shifts.length > 0 && g.name.toLowerCase().includes(search.toLowerCase()));

    const grandTotal = filtered.reduce(
        (sum, g) => sum + g.shifts.reduce((s, sh) => s + calculatePay(sh.start_at, sh.end_at), 0),
        0
    );

    function exportToExcel() {
        const rows: (string | number)[][] = [];

        // Header
        rows.push(["Name", "Date", "Day", "Week", "Time", "Type", "Pay (AUD)"]);

        for (const group of filtered) {
            const sorted = [...group.shifts].sort(
                (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
            );
            let firstRow = true;
            for (const sh of sorted) {
                const night = isNightShift(sh.start_at, sh.end_at);
                const pay = calculatePay(sh.start_at, sh.end_at);
                const start = new Date(sh.start_at);
                const end = new Date(sh.end_at);
                const hours = !night ? (end.getTime() - start.getTime()) / 3600000 : null;
                rows.push([
                    firstRow ? group.name : "",
                    start.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
                    DAY[start.getUTCDay()],
                    getTriWeekLabel(start),
                    `${formatUTCTime(start)} -- ${formatUTCTime(end)}`,
                    night ? "Night shift" : `${hours}h x $20/hr`,
                    pay,
                ]);
                firstRow = false;
            }
            // Subtotal
            const total = group.shifts.reduce((s, sh) => s + calculatePay(sh.start_at, sh.end_at), 0);
            rows.push(["", "", "", "", "", "Subtotal", total]);
            rows.push([]);
        }

        // Grand total
        rows.push(["", "", "", "", "", "Grand Total", grandTotal]);

        const ws = XLSX.utils.aoa_to_sheet(rows);

        // Column widths
        ws["!cols"] = [
            { wch: 22 }, // Name
            { wch: 16 }, // Date
            { wch: 6 },  // Day
            { wch: 10 }, // Week
            { wch: 20 }, // Time
            { wch: 18 }, // Type
            { wch: 12 }, // Pay
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Payouts");
        XLSX.writeFile(wb, `payouts-${dateFrom}-to-${dateTo}.xlsx`);
    }

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <div className="flex items-center gap-3 mb-1">
                        <Link href="/admin" className="text-slate-500 hover:text-slate-300 text-sm transition-colors">
                            ← Admin
                        </Link>
                    </div>
                    <h1 className="text-2xl font-bold text-white">Payouts</h1>
                    <p className="text-slate-400 text-sm mt-0.5">All completed shift earnings</p>
                </div>
                <div className="flex items-center gap-3">
                    {!loading && filtered.length > 0 && (
                        <span className="text-green-400 font-bold text-xl">${grandTotal.toFixed(2)}</span>
                    )}
                    <button
                        onClick={fetchPayouts}
                        className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 cursor-pointer transition-colors"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {/* Filters row */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
                {/* Date range picker */}
                <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2.5">
                        <span className="text-slate-500 text-xs font-medium uppercase tracking-wide">From</span>
                        <input
                            type="date"
                            value={dateFrom}
                            max={dateTo}
                            onChange={(e) => setDateFrom(e.target.value)}
                            className="bg-transparent text-white text-sm focus:outline-none cursor-pointer"
                        />
                    </div>
                    <div className="text-slate-600 px-1 select-none">→</div>
                    <div className="flex items-center gap-2 px-4 py-2.5">
                        <span className="text-slate-500 text-xs font-medium uppercase tracking-wide">To</span>
                        <input
                            type="date"
                            value={dateTo}
                            min={dateFrom}
                            onChange={(e) => setDateTo(e.target.value)}
                            className="bg-transparent text-white text-sm focus:outline-none cursor-pointer"
                        />
                    </div>
                </div>

                {/* Search */}
                <input
                    type="text"
                    placeholder="Search by name..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="flex-1 min-w-40 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-slate-500 text-sm"
                />

                {/* Export button */}
                {!loading && filtered.length > 0 && (
                    <button
                        onClick={exportToExcel}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium cursor-pointer transition-colors flex-shrink-0"
                    >
                        <span>↓</span> Export Excel
                    </button>
                )}
            </div>

            {loading ? (
                <p className="text-slate-500 text-sm">Loading...</p>
            ) : filtered.length === 0 ? (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
                    <p className="text-slate-400">{search ? "No results found." : "No completed shifts for this period."}</p>
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {filtered.map((group) => {
                        const total = group.shifts.reduce((s, sh) => s + calculatePay(sh.start_at, sh.end_at), 0);
                        const isOpen = expanded.has(group.username);
                        const initials = group.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
                        return (
                            <div key={group.username} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                                <button
                                    onClick={() => toggleExpand(group.username)}
                                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-800/50 transition-colors cursor-pointer"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                            {initials}
                                        </div>
                                        <div className="text-left">
                                            <div className="text-white font-semibold text-sm">{group.name}</div>
                                            <div className="text-slate-500 text-xs">{group.shifts.length} shift{group.shifts.length !== 1 ? "s" : ""}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-green-400 font-bold">${total.toFixed(2)}</span>
                                        <span className="text-slate-500 text-xs">{isOpen ? "▲" : "▼"}</span>
                                    </div>
                                </button>

                                {isOpen && (
                                    <div className="border-t border-slate-800 divide-y divide-slate-800/60">
                                        {group.shifts
                                            .sort((a: any, b: any) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime())
                                            .map((sh: any) => {
                                                const night = isNightShift(sh.start_at, sh.end_at);
                                                const pay = calculatePay(sh.start_at, sh.end_at);
                                                const start = new Date(sh.start_at);
                                                const end = new Date(sh.end_at);
                                                const hours = !night ? (end.getTime() - start.getTime()) / 3600000 : null;
                                                return (
                                                    <div key={sh.id} className="px-5 py-3 flex items-center justify-between gap-4">
                                                        <div>
                                                            <div className="text-white text-sm font-medium">
                                                                {formatUTCTime(start)} -- {formatUTCTime(end)}
                                                            </div>
                                                            <div className="text-slate-400 text-xs mt-0.5">
                                                                {getTriWeekLabel(start)} · {DAY[start.getUTCDay()]} {start.toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" })}
                                                                {night ? " · Night shift" : ` · ${hours}h x $20/hr`}
                                                            </div>
                                                        </div>
                                                        <div className="text-green-400 font-semibold flex-shrink-0">${pay.toFixed(2)}</div>
                                                    </div>
                                                );
                                            })}
                                        <div className="px-5 py-3 flex justify-between items-center bg-slate-800/40">
                                            <span className="text-slate-400 text-xs font-medium">Total</span>
                                            <span className="text-green-400 font-bold">${total.toFixed(2)}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
