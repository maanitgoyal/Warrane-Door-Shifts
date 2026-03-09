"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import SwapModal from "@/components/SwapModal";

const HOUR_HEIGHT = 48;

export default function Calendar() {
    const [selectedDate, setSelectedDate] = useState(() => localToUTCMidnight());
    const [shifts, setShifts] = useState<any[]>([]);
    const [openShifts, setOpenShifts] = useState<any[]>([]);
    const [user, setUser] = useState<any>(null);
    const [claimModal, setClaimModal] = useState<{ shift: any; slotShifts: any[] } | null>(null);
    const [userShifts, setUserShifts] = useState<any[]>([]);
    const [swapModal, setSwapModal] = useState<{ shift: any; slotShifts: any[] } | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadingOpen, setLoadingOpen] = useState(false);
    const [timelineShift, setTimelineShift] = useState<any | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const stored = localStorage.getItem("shift_user");
        if (stored) setUser(JSON.parse(stored));
    }, []);

    useEffect(() => { fetchShifts(); }, [selectedDate]);
    useEffect(() => { fetchOpenShifts(); }, [selectedDate]);

    async function fetchOpenShifts() {
        setLoadingOpen(true);
        const now = new Date();
        const sp = getSydneyParts();
        const fakeNowIso = new Date(Date.UTC(sp.year, sp.month, sp.day, sp.hour, sp.minute, sp.second)).toISOString();

        const currentTri = TRIMESTERS.find((tri) => {
            const end = new Date(tri.start.getTime() + 77 * 86400000);
            return now >= tri.start && now < end;
        });

        let query = supabase.from("shifts").select("*").eq("status", "open").gte("start_at", fakeNowIso).order("start_at");
        if (currentTri) {
            const trimEnd = new Date(currentTri.start.getTime() + 77 * 86400000);
            query = query.lt("start_at", trimEnd.toISOString());
        }

        const { data, error } = await query;
        if (!error && data) {
            const shiftIds = data.map((s) => s.id);
            let excludeIds = new Set<string>();
            if (shiftIds.length > 0) {
                const [{ data: pendingData }, { data: approvedData }] = await Promise.all([
                    supabase.from("claims").select("shift_id").in("shift_id", shiftIds).eq("status", "pending"),
                    supabase.from("claims").select("shift_id").in("shift_id", shiftIds).eq("status", "approved"),
                ]);
                for (const c of [...(pendingData ?? []), ...(approvedData ?? [])]) excludeIds.add(c.shift_id);
            }
            setOpenShifts(data.filter((s) => !excludeIds.has(s.id)));
        }
        setLoadingOpen(false);
    }

    async function fetchShifts() {
        setLoading(true);
        const wd = getWeekDates(selectedDate);
        const weekStart = wd[0];
        const weekEndExclusive = new Date(wd[6].getTime() + 86400000);
        const prevDay = new Date(weekStart.getTime() - 86400000);
        const weekDateStrings = new Set(wd.map((d) => d.toISOString().split("T")[0]));

        const [{ data: weekData }, { data: overnightData }] = await Promise.all([
            supabase.from("shifts").select("*")
                .gte("start_at", weekStart.toISOString())
                .lt("start_at", weekEndExclusive.toISOString())
                .order("start_at"),
            supabase.from("shifts").select("*")
                .gte("start_at", prevDay.toISOString())
                .lt("start_at", weekStart.toISOString())
                .gt("end_at", weekStart.toISOString())
                .order("start_at"),
        ]);

        const allData = [...(weekData ?? []), ...(overnightData ?? [])];
        if (allData.length === 0) { setShifts([]); return; }

        const ids = allData.map((s) => s.id);
        const [{ data: pendingClaims }, { data: approvedClaims }, { data: pendingSwaps }] = await Promise.all([
            supabase.from("claims").select("shift_id, claimant_name, username").in("shift_id", ids).eq("status", "pending"),
            supabase.from("claims").select("shift_id, claimant_name, username").in("shift_id", ids).eq("status", "approved"),
            supabase.from("swaps").select("shift_id, requester_username, requester_name, target_username, target_name").in("shift_id", ids).eq("status", "pending"),
        ]);

        const pendingMap: Record<string, any> = Object.fromEntries((pendingClaims ?? []).map((c) => [c.shift_id, c]));
        const approvedMap: Record<string, any> = Object.fromEntries((approvedClaims ?? []).map((c) => [c.shift_id, c]));
        const swapMap: Record<string, any> = Object.fromEntries((pendingSwaps ?? []).map((s) => [s.shift_id, s]));

        const formatted: any[] = [];
        for (const shift of allData) {
            const shiftDateStr = shift.start_at.slice(0, 10);
            const isFromPrevWeek = !weekDateStrings.has(shiftDateStr);
            const startDate = new Date(shift.start_at);
            const endDate = new Date(shift.end_at);
            const base = {
                ...shift,
                pendingClaim: pendingMap[shift.id] ?? null,
                approvedClaim: approvedMap[shift.id] ?? null,
                pendingSwap: swapMap[shift.id] ?? null,
            };

            if (isFromPrevWeek) {
                formatted.push({ ...base, displayColDate: wd[0].toISOString().split("T")[0], start: 0, end: endDate.getUTCHours() + endDate.getUTCMinutes() / 60, _isCont: false });
            } else {
                const crossesMidnight = endDate.toISOString().slice(0, 10) !== shiftDateStr;
                formatted.push({
                    ...base,
                    displayColDate: shiftDateStr,
                    start: startDate.getUTCHours() + startDate.getUTCMinutes() / 60,
                    end: crossesMidnight ? 24 : endDate.getUTCHours() + endDate.getUTCMinutes() / 60,
                    _isCont: false,
                });
                if (crossesMidnight) {
                    const nextDayStr = endDate.toISOString().slice(0, 10);
                    if (weekDateStrings.has(nextDayStr)) {
                        formatted.push({
                            ...base,
                            displayColDate: nextDayStr,
                            start: 0,
                            end: endDate.getUTCHours() + endDate.getUTCMinutes() / 60,
                            _isCont: true,
                        });
                    }
                }
            }
        }

        setShifts(formatted);
        setLoading(false);
    }

    function getSlotShifts(shift: any): any[] {
        const s = new Date(shift.start_at);
        const e = new Date(shift.end_at);
        const key = `${s.getUTCDay()}-${s.getUTCHours()}:${s.getUTCMinutes()}-${e.getUTCHours()}:${e.getUTCMinutes()}`;
        return openShifts.filter((os) => {
            const ss = new Date(os.start_at);
            const se = new Date(os.end_at);
            return `${ss.getUTCDay()}-${ss.getUTCHours()}:${ss.getUTCMinutes()}-${se.getUTCHours()}:${se.getUTCMinutes()}` === key;
        });
    }

    function openClaimModal(shift: any, slotShifts?: any[]) {
        if (!user) { alert("Please login first."); return; }
        if (shift.status !== "open") return;
        if (shift.pendingClaim) return;
        const all = slotShifts ?? getSlotShifts(shift);
        setClaimModal({ shift, slotShifts: all.length > 0 ? all : [shift] });
    }

    async function fetchUserShifts() {
        if (!user?.username) return;
        const { data: claimsData } = await supabase.from("claims").select("shift_id").eq("username", user.username).eq("status", "approved");
        if (!claimsData || claimsData.length === 0) { setUserShifts([]); return; }
        const shiftIds = claimsData.map((c) => c.shift_id);
        const { data: shiftsData } = await supabase.from("shifts").select("*").in("id", shiftIds).order("start_at");
        if (shiftsData) setUserShifts(shiftsData);
    }

    function getSlotUserShifts(shift: any): any[] {
        const s = new Date(shift.start_at);
        const e = new Date(shift.end_at);
        const key = `${s.getUTCDay()}-${s.getUTCHours()}:${s.getUTCMinutes()}-${e.getUTCHours()}:${e.getUTCMinutes()}`;
        return userShifts.filter((us) => {
            const ss = new Date(us.start_at);
            const se = new Date(us.end_at);
            return `${ss.getUTCDay()}-${ss.getUTCHours()}:${ss.getUTCMinutes()}-${se.getUTCHours()}:${se.getUTCMinutes()}` === key;
        });
    }

    function openSwapModal(shift: any) {
        if (!user) return;
        const slotShifts = getSlotUserShifts(shift);
        setSwapModal({ shift, slotShifts: slotShifts.length > 0 ? slotShifts : [shift] });
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { if (user) fetchUserShifts(); }, [user]);

    // Auto-scroll: once shifts first load, scroll to start of active shift (or current time - 1h)
    const [hasScrolled, setHasScrolled] = useState(false);
    useEffect(() => {
        if (loading || hasScrolled || !scrollRef.current) return;
        const sp = getSydneyParts();
        const nowMs = Date.UTC(sp.year, sp.month, sp.day, sp.hour, sp.minute, sp.second);
        const active = shifts.filter((s) => !s._isCont).find(
            (s) => nowMs >= new Date(s.start_at).getTime() && nowMs < new Date(s.end_at).getTime()
        );
        let scrollHour: number;
        if (active) {
            const startH = new Date(active.start_at).getUTCHours() + new Date(active.start_at).getUTCMinutes() / 60;
            scrollHour = Math.max(0, startH - 0.5); // just above shift start
        } else {
            scrollHour = Math.max(0, sp.hour - 1);
        }
        scrollRef.current.scrollTop = scrollHour * HOUR_HEIGHT;
        setHasScrolled(true);
    }, [loading, shifts, hasScrolled]);

    const userShiftIds = new Set(userShifts.map((s) => s.id));
    const weekDates = getWeekDates(selectedDate);
    const todayMs = localToUTCMidnight().getTime();
    const todayInWeek = weekDates.some((d) => d.getTime() === todayMs);

    const weekLabel = (() => {
        const monday = weekDates[0]; // Mon-Sun: weekDates[0] is always Monday
        for (const tri of TRIMESTERS) {
            const diffDays = Math.floor((monday.getTime() - tri.start.getTime()) / 86400000);
            const week = Math.floor(diffDays / 7);
            if (diffDays >= 0 && week <= 10) return `${tri.label} Wk${week}`;
        }
        return "";
    })();

    return (
        <>
            <div className="p-4 max-w-[1400px] mx-auto w-full">
                <div className="flex gap-5">

                    {/* LEFT SIDEBAR */}
                    <div className="hidden lg:flex lg:flex-col gap-4 w-56 flex-shrink-0">
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                            <MiniCalendar selectedDate={selectedDate} onSelect={(date: Date) => setSelectedDate(date)} />
                        </div>

                        {user && (
                            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h2 className="text-white font-semibold text-sm">Available Shifts</h2>
                                    <button
                                        onClick={() => fetchOpenShifts()}
                                        disabled={loadingOpen}
                                        className="text-slate-400 hover:text-white disabled:opacity-40 cursor-pointer transition-colors"
                                        title="Refresh"
                                    >
                                        <svg className={`w-3.5 h-3.5 ${loadingOpen ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                        </svg>
                                    </button>
                                </div>
                                {(() => {
                                    const todayStr = localToUTCMidnight().toISOString().split("T")[0];
                                    const forWeek = openShifts.filter((s) => s.start_at.slice(0, 10) === todayStr);

                                    if (forWeek.length === 0)
                                        return <p className="text-slate-500 text-xs">No open shifts today.</p>;

                                    return (
                                        <div className="flex flex-col gap-2">
                                            {groupBySlot(forWeek).map((group) => {
                                                const first = new Date(group[0].start_at);
                                                const firstEnd = new Date(group[0].end_at);
                                                const slotKey = `${first.getUTCDay()}-${first.getUTCHours()}:${first.getUTCMinutes()}-${firstEnd.getUTCHours()}:${firstEnd.getUTCMinutes()}`;
                                                const dayName = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][first.getUTCDay()];
                                                const timeLabel = `${formatUTCTime(first)} -- ${formatUTCTime(firstEnd)}`;

                                                const alsoAvailable = openShifts.filter((s) => {
                                                    if (s.start_at.slice(0, 10) === todayStr) return false;
                                                    const ss = new Date(s.start_at);
                                                    const se = new Date(s.end_at);
                                                    return `${ss.getUTCDay()}-${ss.getUTCHours()}:${ss.getUTCMinutes()}-${se.getUTCHours()}:${se.getUTCMinutes()}` === slotKey;
                                                });

                                                return (
                                                    <div
                                                        key={slotKey}
                                                        onClick={() => openClaimModal(group[0], [...group, ...alsoAvailable])}
                                                        className="bg-slate-800 border border-slate-700 rounded-xl p-3 cursor-pointer hover:bg-slate-700 transition-colors"
                                                    >
                                                        <div className="text-white text-xs font-semibold">{dayName}</div>
                                                        <div className="text-slate-400 text-xs mb-2">{timeLabel}</div>
                                                        <div className="flex flex-wrap gap-1">
                                                            {group.map((shift) => (
                                                                <span key={shift.id} className="text-xs bg-green-600/20 text-green-400 px-2 py-0.5 rounded-full">
                                                                    {getTriWeekLabel(new Date(shift.start_at))}
                                                                </span>
                                                            ))}
                                                        </div>
                                                        {alsoAvailable.length > 0 && (
                                                            <>
                                                                <div className="text-slate-500 text-xs mt-2 mb-1">Other weeks:</div>
                                                                <div className="flex flex-wrap gap-1">
                                                                    {alsoAvailable.map((shift) => (
                                                                        <span key={shift.id} className="text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">
                                                                            {getTriWeekLabel(new Date(shift.start_at))}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </div>

                    {/* MAIN WEEK VIEW */}
                    <div className="flex-1 min-w-0">

                        {/* Currently on door */}
                        {todayInWeek && (() => {
                            const sp = getSydneyParts();
                            const nowMs = Date.UTC(sp.year, sp.month, sp.day, sp.hour, sp.minute, sp.second);
                            const active = shifts.find(
                                (s) => nowMs >= new Date(s.start_at).getTime() && nowMs < new Date(s.end_at).getTime()
                            );
                            if (!active) return null;
                            const claim = active.approvedClaim;
                            const name = claim?.claimant_name || claim?.username || (active.status === "taken" ? "Someone" : null);
                            if (!name) return null;
                            return (
                                <div className="mb-3 flex items-center gap-2.5 border border-green-600/30 rounded-xl px-4 py-2.5">
                                    <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0 animate-pulse" />
                                    <span className="text-green-400 text-sm font-medium">Currently on door: {name}</span>
                                </div>
                            );
                        })()}

                        {/* WEEK GRID */}
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden relative">
                            {loading && (
                                <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-slate-900/80 backdrop-blur-[2px]">
                                    <div className="relative w-10 h-10">
                                        <div className="absolute inset-0 rounded-full border-2 border-indigo-500/20" />
                                        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-indigo-400 animate-spin" />
                                    </div>
                                    <span className="text-slate-400 text-xs font-medium tracking-wide">Loading shifts…</span>
                                </div>
                            )}
                            <div
                                ref={scrollRef}
                                className="overflow-y-auto"
                                style={{ maxHeight: "calc(100vh - 240px)" }}
                            >
                            {/* Sticky header: nav row + day names */}
                            <div className="sticky top-0 bg-slate-900 z-20">
                                {/* Navigation & week label — all inline */}
                                <div className="flex items-center border-b border-slate-800/60">
                                    <div className="w-14 flex-shrink-0" />
                                    <div className="flex-1 flex items-center justify-center gap-1 px-3 py-2.5">
                                        <button
                                            onClick={() => setSelectedDate(new Date(selectedDate.getTime() - 7 * 86400000))}
                                            className="text-slate-400 hover:text-white text-lg w-7 h-7 flex items-center justify-center rounded cursor-pointer transition-colors flex-shrink-0"
                                        >‹</button>
                                        <span className="text-white font-semibold text-sm whitespace-nowrap">
                                            {weekDates[0].toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" })}
                                            {" -- "}
                                            {weekDates[6].toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
                                            {weekLabel && <span className="text-indigo-400 font-medium"> · {weekLabel}</span>}
                                        </span>
                                        <button
                                            onClick={() => setSelectedDate(new Date(selectedDate.getTime() + 7 * 86400000))}
                                            className="text-slate-400 hover:text-white text-lg w-7 h-7 flex items-center justify-center rounded cursor-pointer transition-colors flex-shrink-0"
                                        >›</button>
                                    </div>
                                </div>
                                {/* Day name columns */}
                                <div className="flex border-b border-slate-800">
                                    <div className="w-14 flex-shrink-0" />
                                    {weekDates.map((date, i) => {
                                        const isToday = date.getTime() === todayMs;
                                        return (
                                            <div
                                                key={i}
                                                className={`flex-1 text-center py-3 border-l border-slate-800 ${isToday ? "bg-indigo-600/10" : ""}`}
                                            >
                                                <div className={`text-[10px] font-semibold uppercase tracking-wider ${isToday ? "text-indigo-400" : "text-slate-500"}`}>
                                                    {date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}
                                                </div>
                                                <div className={`text-lg font-bold mt-0.5 leading-none ${isToday ? "text-indigo-300" : "text-slate-300"}`}>
                                                    {date.getUTCDate()}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Time grid body */}
                            <div className="flex">
                                {/* Time labels */}
                                <div className="w-14 flex-shrink-0 relative" style={{ height: `${24 * HOUR_HEIGHT}px` }}>
                                    {Array.from({ length: 24 }, (_, h) => (
                                        <div
                                            key={h}
                                            className="absolute right-2 text-[10px] text-slate-500 -translate-y-2.5 select-none"
                                            style={{ top: `${h * HOUR_HEIGHT}px` }}
                                        >
                                            {h === 0 ? "" : formatHour(h)}
                                        </div>
                                    ))}
                                </div>

                                {/* Day columns */}
                                {weekDates.map((date, dayIndex) => {
                                    const dateStr = date.toISOString().split("T")[0];
                                    const isToday = date.getTime() === todayMs;
                                    const dayShifts = shifts.filter((s) => s.displayColDate === dateStr);

                                    return (
                                        <div
                                            key={dayIndex}
                                            className={`flex-1 relative border-l border-slate-800 ${isToday ? "bg-indigo-500/[0.03]" : ""}`}
                                            style={{ height: `${24 * HOUR_HEIGHT}px` }}
                                        >
                                            {/* Hour lines */}
                                            {Array.from({ length: 24 }, (_, h) => (
                                                <div
                                                    key={h}
                                                    className="absolute left-0 right-0 border-t border-slate-800/50"
                                                    style={{ top: `${h * HOUR_HEIGHT}px` }}
                                                />
                                            ))}

                                            {/* Shift blocks */}
                                            {dayShifts.map((shift) => {
                                                const height = (shift.end - shift.start) * HOUR_HEIGHT;
                                                const sp = getSydneyParts();
                                                const fakeNowMs = Date.UTC(sp.year, sp.month, sp.day, sp.hour, sp.minute, sp.second);
                                                const displayEndMs = new Date(`${shift.displayColDate}T00:00:00Z`).getTime() + shift.end * 3600000;
                                                const isPast = displayEndMs < fakeNowMs;
                                                const isUserShift = userShiftIds.has(shift.id);
                                                const hasApprovedClaim = !!shift.approvedClaim;
                                                const claimantName = shift.approvedClaim?.claimant_name;
                                                const isMyPendingClaim = !isUserShift && !hasApprovedClaim && shift.pendingClaim?.username === user?.username;
                                                const isPendingClaim = !isUserShift && !hasApprovedClaim && !!shift.pendingClaim && !isMyPendingClaim;
                                                const hasPendingSwap = !!shift.pendingSwap;

                                                let bgColor: string;
                                                if (isPast) bgColor = "bg-slate-700/70 cursor-default";
                                                else if (isUserShift) bgColor = "bg-green-600 hover:bg-green-500 cursor-pointer";
                                                else if (hasApprovedClaim && hasPendingSwap) bgColor = "bg-violet-600 cursor-default";
                                                else if (hasApprovedClaim) bgColor = "bg-green-700 cursor-default";
                                                else if (isMyPendingClaim) bgColor = "bg-amber-500 cursor-default";
                                                else if (isPendingClaim) bgColor = "bg-amber-600 cursor-default";
                                                else if (shift.status === "open") bgColor = "bg-blue-600 hover:bg-blue-500 cursor-pointer";
                                                else bgColor = "bg-slate-600 cursor-default";

                                                let nameLine = "";
                                                if (hasApprovedClaim && hasPendingSwap) nameLine = shift.pendingSwap.target_name;
                                                else if (hasApprovedClaim) nameLine = claimantName ?? "";
                                                else if (isMyPendingClaim || isPendingClaim) nameLine = shift.pendingClaim?.claimant_name ?? "";
                                                else if (shift.status === "open") nameLine = "Open";

                                                const shiftEndDate = new Date(shift.end_at);
                                                const realEndH = shiftEndDate.getUTCHours() + shiftEndDate.getUTCMinutes() / 60;
                                                const timeLabel = `${formatHourDecimal(shift.start)} -- ${formatHourDecimal(realEndH)}`;
                                                const minHeight = Math.max(height, 20);

                                                return (
                                                    <div
                                                        key={`${shift.id}${shift._isCont ? "_c" : ""}`}
                                                        onClick={() => {
                                                            if (isPast) return;
                                                            if (isUserShift) openSwapModal(shift);
                                                            else if (!hasApprovedClaim && !isPendingClaim && !isMyPendingClaim) openClaimModal(shift);
                                                        }}
                                                        title={`${formatHourDecimal(shift.start)} -- ${formatHourDecimal(shift.end)}${nameLine ? ` · ${nameLine}` : ""}`}
                                                        className={`absolute inset-x-0.5 rounded-md text-white overflow-hidden transition-colors ${bgColor}`}
                                                        style={{
                                                            top: `${shift.start * HOUR_HEIGHT + 1}px`,
                                                            height: `${minHeight - 2}px`,
                                                            padding: "2px 5px",
                                                        }}
                                                    >
                                                        <div className="text-[9px] font-medium opacity-75 leading-tight">{timeLabel}</div>
                                                        {nameLine && (
                                                            <div className="text-[10px] font-bold truncate leading-tight">{nameLine}</div>
                                                        )}
                                                        {minHeight >= 20 && (
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setTimelineShift(shift); }}
                                                                className="absolute bottom-1 right-1 w-4 h-4 rounded flex items-center justify-center bg-black/25 hover:bg-black/50 transition-colors"
                                                                title="View history"
                                                            >
                                                                <svg className="w-2.5 h-2.5 text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                                </svg>
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            })}

                                            {/* Current time line */}
                                            {isToday && (() => {
                                                const { hour, minute } = getSydneyParts();
                                                return (
                                                    <div
                                                        className="absolute left-0 right-0 flex items-center pointer-events-none z-10"
                                                        style={{ top: `${(hour + minute / 60) * HOUR_HEIGHT}px` }}
                                                    >
                                                        <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0 -ml-1" />
                                                        <div className="flex-1 h-px bg-amber-400" />
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    );
                                })}
                            </div>
                            </div>{/* end scrollRef */}
                        </div>{/* end week grid */}

                        {/* Legend */}
                        <div className="flex flex-wrap gap-3 mt-3 px-1">
                            {[
                                { color: "bg-blue-600", label: "Open" },
                                { color: "bg-green-600", label: "My shift" },
                                { color: "bg-green-700", label: "Taken" },
                                { color: "bg-amber-500", label: "Pending" },
                                { color: "bg-violet-600", label: "Swap requested" },
                                { color: "bg-slate-700", label: "Past" },
                            ].map(({ color, label }) => (
                                <div key={label} className="flex items-center gap-1.5">
                                    <div className={`w-2.5 h-2.5 rounded-sm ${color}`} />
                                    <span className="text-slate-500 text-xs">{label}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {claimModal && (
                <ClaimModal
                    shift={claimModal.shift}
                    slotShifts={claimModal.slotShifts}
                    user={user}
                    onClose={() => setClaimModal(null)}
                    onSuccess={() => { fetchOpenShifts(); fetchShifts(); }}
                />
            )}

            {swapModal && user && (
                <SwapModal
                    shift={swapModal.shift}
                    slotShifts={swapModal.slotShifts}
                    currentUser={user}
                    onClose={() => setSwapModal(null)}
                    onSuccess={() => { fetchUserShifts(); fetchShifts(); }}
                />
            )}

            {timelineShift && (
                <TimelineModal shift={timelineShift} onClose={() => setTimelineShift(null)} />
            )}
        </>
    );
}

/* ---------------- TIMELINE MODAL ---------------- */

function TimelineModal({ shift, onClose }: { shift: any; onClose: () => void }) {
    const [events, setEvents] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            setLoading(true);
            const [{ data: claims }, { data: swaps }] = await Promise.all([
                supabase.from("claims").select("*").eq("shift_id", shift.id).order("created_at"),
                supabase.from("swaps").select("*").eq("shift_id", shift.id).order("created_at"),
            ]);

            const list: any[] = [{ type: "open", label: "Shift posted as open" }];

            for (const c of claims ?? []) {
                const name = c.claimant_name || c.username || "Someone";
                list.push({ type: "pending",  label: `${name} requested admin approval` });
                if (c.status === "approved")  list.push({ type: "approved", label: `Admin approved ${name} for this shift` });
                if (c.status === "rejected")  list.push({ type: "rejected", label: `${name}'s request was rejected by admin` });
            }
            for (const s of swaps ?? []) {
                const from = s.requester_name || s.requester_username || "Someone";
                const to   = s.target_name    || s.target_username    || "Someone";
                list.push({ type: "swap_pending", label: `${from} requested a swap with ${to}` });
                if (s.status === "approved") list.push({ type: "swap_approved", label: `Swap approved: ${from} --> ${to}` });
                if (s.status === "rejected") list.push({ type: "swap_rejected", label: `Swap request by ${from} was rejected` });
            }

            setEvents(list);
            setLoading(false);
        }
        load();
    }, [shift.id]);

    const startDate = new Date(shift.start_at);
    const endDate   = new Date(shift.end_at);
    const dayName   = startDate.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
    const timeRange = `${formatUTCTime(startDate)} -- ${formatUTCTime(endDate)}`;

    const dot: Record<string, string> = {
        open:          "bg-slate-400",
        pending:       "bg-amber-400",
        approved:      "bg-green-400",
        rejected:      "bg-red-400",
        swap_pending:  "bg-violet-400",
        swap_approved: "bg-green-400",
        swap_rejected: "bg-red-400",
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-96 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-start mb-5">
                    <div>
                        <h2 className="text-white font-semibold text-base">{dayName}</h2>
                        <p className="text-slate-400 text-sm">{timeRange}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-500 hover:text-white text-xl cursor-pointer">✕</button>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-8 gap-3">
                        <div className="w-5 h-5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                        <span className="text-slate-400 text-sm">Loading history…</span>
                    </div>
                ) : (
                    <div className="relative pl-4">
                        {/* vertical line */}
                        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-700" />
                        <div className="flex flex-col gap-4">
                            {events.map((ev, i) => (
                                <div key={i} className="flex items-start gap-3">
                                    <div className={`w-3.5 h-3.5 rounded-full flex-shrink-0 mt-0.5 ring-2 ring-slate-900 ${dot[ev.type] ?? "bg-slate-400"}`} />
                                    <span className="text-slate-300 text-sm leading-snug">{ev.label}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

/* ---------------- CLAIM MODAL ---------------- */

function ClaimModal({ shift, slotShifts, user, onClose, onSuccess }: {
    shift: any;
    slotShifts: any[];
    user: any;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [selected, setSelected] = useState<string[]>([shift.id]);
    const [submitting, setSubmitting] = useState(false);
    const [done, setDone] = useState(false);

    const first = new Date(shift.start_at);
    const firstEnd = new Date(shift.end_at);
    const dayName = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][first.getUTCDay()];
    const timeLabel = `${formatUTCTime(first)} -- ${formatUTCTime(firstEnd)}`;
    const allIds = slotShifts.map((s: any) => s.id);

    function toggleShift(id: string) {
        setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
    }

    function toggleAll() {
        setSelected(selected.length === allIds.length ? [] : allIds);
    }

    async function submitClaim() {
        if (selected.length === 0) return;
        setSubmitting(true);
        const claims = selected.map((shiftId) => ({
            user_id: user.id,
            shift_id: shiftId,
            status: "pending",
            claimant_name: `${user.first_name} ${user.last_name}`,
            username: user.username,
        }));
        const { error } = await supabase.from("claims").insert(claims);
        setSubmitting(false);
        if (!error) {
            setDone(true);
            setTimeout(() => { onSuccess(); onClose(); }, 1500);
        } else {
            console.error("Claim error:", error?.message, error?.details, error?.hint);
        }
    }

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
            <div
                className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-96 max-h-[80vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                {done ? (
                    <div className="text-center py-8">
                        <div className="text-green-400 text-4xl mb-3">✓</div>
                        <div className="text-white font-semibold">Claim submitted!</div>
                        <div className="text-slate-400 text-sm mt-1">Waiting for admin approval.</div>
                    </div>
                ) : (
                    <>
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h2 className="text-white font-semibold text-lg">{dayName}</h2>
                                <p className="text-slate-400 text-sm">{timeLabel}</p>
                            </div>
                            <button onClick={onClose} className="text-slate-500 hover:text-white text-xl cursor-pointer">✕</button>
                        </div>

                        <p className="text-slate-400 text-sm mb-3">Select the weeks you want to claim:</p>

                        {slotShifts.length > 1 && (
                            <button
                                onClick={toggleAll}
                                className="w-full text-left text-sm px-3 py-2 rounded-lg mb-3 border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer transition-colors"
                            >
                                {selected.length === allIds.length ? "Deselect All" : "Select All (Whole Term)"}
                            </button>
                        )}

                        <div className="flex flex-col gap-2 mb-5">
                            {slotShifts.map((s: any) => {
                                const label = getTriWeekLabel(new Date(s.start_at));
                                const date = new Date(s.start_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
                                const isChecked = selected.includes(s.id);
                                return (
                                    <label key={s.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-800 cursor-pointer hover:bg-slate-700 transition-colors">
                                        <input type="checkbox" checked={isChecked} onChange={() => toggleShift(s.id)} className="accent-green-500 w-4 h-4" />
                                        <span className="text-white text-sm font-medium">{label}</span>
                                        <span className="text-slate-400 text-xs ml-auto">{date}</span>
                                    </label>
                                );
                            })}
                        </div>

                        <button
                            onClick={submitClaim}
                            disabled={submitting || selected.length === 0}
                            className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold py-2 rounded-xl cursor-pointer transition-colors"
                        >
                            {submitting ? "Submitting..." : `Claim ${selected.length} Shift${selected.length !== 1 ? "s" : ""}`}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

/* ---------------- MINI CALENDAR ---------------- */

function MiniCalendar({ selectedDate, onSelect }: any) {
    const [viewDate, setViewDate] = useState(() =>
        new Date(Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), 1))
    );

    useEffect(() => {
        setViewDate(new Date(Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), 1)));
    }, [selectedDate.getUTCFullYear(), selectedDate.getUTCMonth()]);

    const year = viewDate.getUTCFullYear();
    const month = viewDate.getUTCMonth();
    const firstDay = new Date(Date.UTC(year, month, 1));
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const startOffset = (firstDay.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    const todayMs = localToUTCMidnight().getTime();

    const weekDates = getWeekDates(selectedDate);
    const weekMs = new Set(weekDates.map((d) => d.getTime()));

    const cells: (Date | null)[] = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(Date.UTC(year, month, d)));

    function prevMonth() { setViewDate(new Date(Date.UTC(year, month - 1, 1))); }
    function nextMonth() { setViewDate(new Date(Date.UTC(year, month + 1, 1))); }

    return (
        <div>
            <div className="flex items-center justify-between mb-4">
                <button onClick={prevMonth} className="text-slate-400 hover:text-white cursor-pointer px-1 transition-colors text-sm">◀</button>
                <div className="text-white font-semibold text-sm">
                    {firstDay.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} {year}
                </div>
                <button onClick={nextMonth} className="text-slate-400 hover:text-white cursor-pointer px-1 transition-colors text-sm">▶</button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-xs text-slate-500 mb-1">
                {["M","T","W","T","F","S","S"].map((d, i) => (
                    <div key={i} className="text-center">{d}</div>
                ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
                {cells.map((date, index) =>
                    date ? (
                        <div
                            key={index}
                            onClick={() => onSelect(date)}
                            className={`cursor-pointer text-center py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                weekMs.has(date.getTime())
                                    ? date.getTime() === todayMs
                                        ? "bg-indigo-600 text-white"
                                        : "bg-indigo-600/20 text-indigo-300"
                                    : "text-slate-400 hover:bg-slate-800 hover:text-white"
                            }`}
                        >
                            {date.getUTCDate()}
                        </div>
                    ) : (
                        <div key={index} />
                    )
                )}
            </div>
        </div>
    );
}

/* ---------------- HELPERS ---------------- */

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

function localToUTCMidnight(d: Date = new Date()): Date {
    const { year, month, day } = getSydneyParts(d);
    return new Date(Date.UTC(year, month, day));
}

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

function groupBySlot(shifts: any[]): any[][] {
    const groups: Record<string, any[]> = {};
    for (const shift of shifts) {
        const s = new Date(shift.start_at);
        const e = new Date(shift.end_at);
        const key = `${s.getUTCDay()}-${s.getUTCHours()}:${s.getUTCMinutes()}-${e.getUTCHours()}:${e.getUTCMinutes()}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(shift);
    }
    return Object.values(groups);
}

function formatUTCTime(date: Date) {
    const h = date.getUTCHours();
    const m = date.getUTCMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatHour(hour: number) {
    const ampm = hour >= 12 ? "PM" : "AM";
    const h = hour % 12 || 12;
    return `${h}${ampm}`;
}

function formatHourDecimal(h: number): string {
    if (h >= 24) return "12AM";
    const hours = Math.floor(h);
    const minutes = Math.round((h - hours) * 60);
    const ampm = hours >= 12 ? "PM" : "AM";
    const hour12 = hours % 12 || 12;
    return minutes === 0 ? `${hour12}${ampm}` : `${hour12}:${String(minutes).padStart(2, "0")}${ampm}`;
}

function getWeekDates(baseDate: Date) {
    const dayOfWeek = baseDate.getUTCDay(); // 0=Sun … 6=Sat
    const mondayMs = baseDate.getTime() - ((dayOfWeek + 6) % 7) * 86400000;
    return Array.from({ length: 7 }, (_, i) => new Date(mondayMs + i * 86400000));
    // Returns [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
}
