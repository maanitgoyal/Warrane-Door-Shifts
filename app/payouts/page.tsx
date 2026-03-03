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

export default function PayoutsPage() {
    const router = useRouter();
    const [user, setUser] = useState<any>(null);
    const [shifts, setShifts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const stored = localStorage.getItem("shift_user");
        if (!stored) { router.push("/login"); return; }
        const u = JSON.parse(stored);
        setUser(u);
        if (u.role === "staff") { setLoading(false); return; }
        fetchPayouts(u.username);
    }, []);

    async function fetchPayouts(username: string) {
        setLoading(true);
        const now = new Date().toISOString();

        const { data: claimsRaw } = await supabase
            .from("claims")
            .select("shift_id")
            .eq("username", username)
            .eq("status", "approved");

        if (!claimsRaw || claimsRaw.length === 0) { setShifts([]); setLoading(false); return; }

        const shiftIds = claimsRaw.map((c) => c.shift_id);
        const { data: shiftsRaw } = await supabase
            .from("shifts")
            .select("id, start_at, end_at")
            .in("id", shiftIds)
            .lt("end_at", now);

        setShifts(
            (shiftsRaw ?? []).sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime())
        );
        setLoading(false);
    }

    const total = shifts.reduce((sum, sh) => sum + calculatePay(sh.start_at, sh.end_at), 0);

    return (
        <div className="p-6 max-w-3xl mx-auto">
            <h1 className="text-2xl font-bold text-white mb-1">Payouts</h1>
            <p className="text-slate-400 text-sm mb-8">
                {user ? `${user.first_name} ${user.last_name}` : ""}
            </p>

            {loading ? (
                <p className="text-slate-500 text-sm">Loading...</p>
            ) : user?.role === "staff" ? (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
                    <p className="text-slate-400">Payouts are not applicable for staff members.</p>
                </div>
            ) : shifts.length === 0 ? (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
                    <p className="text-slate-400">No completed shifts yet.</p>
                </div>
            ) : (
                <>
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                            Completed Shifts
                        </h2>
                        <span className="text-green-400 font-bold text-xl">${total.toFixed(2)}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                        {shifts.map((sh) => {
                            const night = isNightShift(sh.start_at, sh.end_at);
                            const pay = calculatePay(sh.start_at, sh.end_at);
                            const start = new Date(sh.start_at);
                            const end = new Date(sh.end_at);
                            const hours = !night ? (end.getTime() - start.getTime()) / 3600000 : null;
                            return (
                                <div key={sh.id} className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
                                    <div>
                                        <div className="text-white text-sm font-medium">
                                            {formatUTCTime(start)} – {formatUTCTime(end)}
                                        </div>
                                        <div className="text-slate-400 text-xs mt-0.5">
                                            {getTriWeekLabel(start)} · {start.toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" })}
                                            {night ? " · Night shift — $30 flat" : ` · ${hours}h × $20/hr`}
                                        </div>
                                    </div>
                                    <div className="text-green-400 font-semibold text-base flex-shrink-0">${pay.toFixed(2)}</div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}
