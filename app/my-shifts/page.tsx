"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

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

const STATUS_STYLES: Record<string, string> = {
    pending:  "bg-amber-500/20 text-amber-400 border-amber-500/30",
    approved: "bg-green-600/20 text-green-400 border-green-600/30",
    rejected: "bg-red-600/20 text-red-400 border-red-600/30",
};

const STATUS_ORDER = ["pending", "approved", "rejected"];

type ClaimWithShift = {
    id: string;
    status: string;
    created_at: string;
    shift: {
        id: string;
        start_at: string;
        end_at: string;
    };
};

export default function MyShiftsPage() {
    const router = useRouter();
    const [user, setUser] = useState<any>(null);
    const [claims, setClaims] = useState<ClaimWithShift[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const stored = localStorage.getItem("shift_user");
        if (!stored) { router.push("/login"); return; }
        const u = JSON.parse(stored);
        setUser(u);
        fetchClaims(u.username);
    }, []);

    async function fetchClaims(username: string) {
        setLoading(true);
        console.log("[MyShifts] fetching for username:", username);

        const { data: claimsData, error } = await supabase
            .from("claims")
            .select("*")
            .eq("username", username)
            .order("created_at", { ascending: false });

        console.log("[MyShifts] claimsData:", claimsData, "error:", error);

        if (error || !claimsData) { setLoading(false); return; }

        const shiftIds = claimsData.map((c) => c.shift_id);
        const { data: shiftsData } = await supabase
            .from("shifts")
            .select("id, start_at, end_at")
            .in("id", shiftIds);

        const shiftMap = Object.fromEntries((shiftsData ?? []).map((s) => [s.id, s]));

        const merged: ClaimWithShift[] = claimsData
            .filter((c) => shiftMap[c.shift_id])
            .map((c) => ({ ...c, shift: shiftMap[c.shift_id] }));

        setClaims(merged);
        setLoading(false);
    }

    const grouped = STATUS_ORDER.reduce<Record<string, ClaimWithShift[]>>((acc, status) => {
        acc[status] = claims.filter((c) => c.status === status);
        return acc;
    }, {});

    return (
        <div className="p-6 max-w-3xl mx-auto">
            <h1 className="text-2xl font-bold text-white mb-1">My Shifts</h1>
            <p className="text-slate-400 text-sm mb-8">
                {user ? `${user.first_name} ${user.last_name}` : ""}
            </p>

            {loading ? (
                <p className="text-slate-500 text-sm">Loading...</p>
            ) : claims.length === 0 ? (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
                    <p className="text-slate-400">You haven&apos;t claimed any shifts yet.</p>
                </div>
            ) : (
                <div className="flex flex-col gap-8">
                    {STATUS_ORDER.map((status) => {
                        const group = grouped[status];
                        if (group.length === 0) return null;
                        return (
                            <div key={status}>
                                <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">
                                    {status} ({group.length})
                                </h2>
                                <div className="flex flex-col gap-3">
                                    {group.map((claim) => {
                                        const start = new Date(claim.shift.start_at);
                                        const end = new Date(claim.shift.end_at);
                                        const dayName = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][start.getUTCDay()];
                                        const dateStr = start.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
                                        const timeLabel = `${formatUTCTime(start)} – ${formatUTCTime(end)}`;
                                        const weekLabel = getTriWeekLabel(start);

                                        return (
                                            <div
                                                key={claim.id}
                                                className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between gap-4"
                                            >
                                                <div className="flex items-center gap-4">
                                                    <div className="text-center w-12">
                                                        <div className="text-slate-400 text-xs">{dayName.slice(0, 3)}</div>
                                                        <div className="text-white font-bold text-xl leading-tight">{start.getUTCDate()}</div>
                                                        <div className="text-slate-500 text-xs">{start.toLocaleDateString("en-AU", { month: "short", timeZone: "UTC" })}</div>
                                                    </div>
                                                    <div className="w-px h-10 bg-slate-700" />
                                                    <div>
                                                        <div className="text-white font-semibold text-sm">{timeLabel}</div>
                                                        <div className="text-slate-400 text-xs mt-0.5">{weekLabel} · {dateStr}</div>
                                                    </div>
                                                </div>
                                                <span className={`text-xs font-semibold px-3 py-1 rounded-full border capitalize ${STATUS_STYLES[claim.status] ?? "bg-slate-700 text-slate-300"}`}>
                                                    {claim.status}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
