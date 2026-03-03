"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import SwapModal from "@/components/SwapModal";

const HOUR_HEIGHT = 30;

export default function Calendar() {
    const [selectedDate, setSelectedDate] = useState(() => localToUTCMidnight());
    const [shifts, setShifts] = useState<any[]>([]);
    const [openShifts, setOpenShifts] = useState<any[]>([]);
    const [user, setUser] = useState<any>(null);
    const [claimModal, setClaimModal] = useState<{ shift: any; slotShifts: any[] } | null>(null);
    const [userShifts, setUserShifts] = useState<any[]>([]);
    const [swapModal, setSwapModal] = useState<{ shift: any; slotShifts: any[] } | null>(null);

    useEffect(() => {
        const stored = localStorage.getItem("shift_user");
        if (stored) setUser(JSON.parse(stored));
    }, []);

    useEffect(() => {
        fetchShifts();
    }, [selectedDate]);

    useEffect(() => {
        fetchOpenShifts();
    }, []);

    async function fetchOpenShifts() {
        const now = new Date();
        const todayStr = localToUTCMidnight(now).toISOString().split("T")[0];

        const currentTri = TRIMESTERS.find((tri) => {
            const end = new Date(tri.start.getTime() + 77 * 86400000);
            return now >= tri.start && now < end;
        });

        let query = supabase
            .from("shifts")
            .select("*")
            .eq("status", "open")
            .gte("start_at", `${todayStr}T00:00:00`)
            .order("start_at");

        if (currentTri) {
            const trimEnd = new Date(currentTri.start.getTime() + 77 * 86400000);
            query = query.lt("start_at", trimEnd.toISOString());
        }

        const { data, error } = await query;
        if (!error && data) {
            const shiftIds = data.map((s) => s.id);
            let pendingIds = new Set<string>();
            if (shiftIds.length > 0) {
                const { data: claimsData } = await supabase
                    .from("claims")
                    .select("shift_id")
                    .in("shift_id", shiftIds)
                    .eq("status", "pending");
                if (claimsData) pendingIds = new Set(claimsData.map((c) => c.shift_id));
            }
            setOpenShifts(data.filter((s) => !pendingIds.has(s.id)));
        }
    }

    async function fetchShifts() {
        const dateStr = selectedDate.toISOString().split("T")[0];

        // Also fetch overnight shifts that started the previous day
        // Subtract exactly 24 h in ms so we stay in UTC-midnight arithmetic
        const prevStr = new Date(selectedDate.getTime() - 86400000).toISOString().split("T")[0];

        const [{ data: todayData }, { data: overnightData }] = await Promise.all([
            supabase.from("shifts").select("*")
                .gte("start_at", `${dateStr}T00:00:00`)
                .lt("start_at", `${dateStr}T23:59:59`)
                .order("start_at"),
            supabase.from("shifts").select("*")
                .gte("start_at", `${prevStr}T00:00:00`)
                .lt("start_at", `${prevStr}T23:59:59`)
                .gt("end_at", `${dateStr}T00:00:00`)
                .order("start_at"),
        ]);

        const allData = [...(todayData ?? []), ...(overnightData ?? [])];
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

        const formatted = allData.map((shift) => {
            const isFromPrevDay = shift.start_at.slice(0, 10) !== dateStr;
            const crossesMidnight = shift.end_at.slice(0, 10) !== shift.start_at.slice(0, 10);
            const shiftStart = new Date(shift.start_at);
            const shiftEnd = new Date(shift.end_at);

            const displayStart = isFromPrevDay ? 0 : shiftStart.getUTCHours() + shiftStart.getUTCMinutes() / 60;
            const displayEnd = isFromPrevDay
                ? shiftEnd.getUTCHours() + shiftEnd.getUTCMinutes() / 60
                : crossesMidnight ? 24 : shiftEnd.getUTCHours() + shiftEnd.getUTCMinutes() / 60;

            return {
                ...shift,
                start: displayStart,
                end: displayEnd,
                isFromPrevDay,
                crossesMidnight,
                pendingClaim: pendingMap[shift.id] ?? null,
                approvedClaim: approvedMap[shift.id] ?? null,
                pendingSwap: swapMap[shift.id] ?? null,
            };
        });

        setShifts(formatted);
    }

    function getSlotShifts(shift: any): any[] {
        const s = new Date(shift.start_at);
        const e = new Date(shift.end_at);
        const key = `${s.getUTCDay()}-${s.getUTCHours()}:${s.getUTCMinutes()}-${e.getUTCHours()}:${e.getUTCMinutes()}`;
        return openShifts.filter((os) => {
            const ss = new Date(os.start_at);
            const se = new Date(os.end_at);
            const k = `${ss.getUTCDay()}-${ss.getUTCHours()}:${ss.getUTCMinutes()}-${se.getUTCHours()}:${se.getUTCMinutes()}`;
            return k === key;
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
        const { data: claimsData } = await supabase
            .from("claims")
            .select("shift_id")
            .eq("username", user.username)
            .eq("status", "approved");
        if (!claimsData || claimsData.length === 0) { setUserShifts([]); return; }
        const shiftIds = claimsData.map((c) => c.shift_id);
        const { data: shiftsData } = await supabase
            .from("shifts")
            .select("*")
            .in("id", shiftIds)
            .order("start_at");
        if (shiftsData) setUserShifts(shiftsData);
    }

    function getSlotUserShifts(shift: any): any[] {
        const s = new Date(shift.start_at);
        const e = new Date(shift.end_at);
        const key = `${s.getUTCDay()}-${s.getUTCHours()}:${s.getUTCMinutes()}-${e.getUTCHours()}:${e.getUTCMinutes()}`;
        return userShifts.filter((us) => {
            const ss = new Date(us.start_at);
            const se = new Date(us.end_at);
            const k = `${ss.getUTCDay()}-${ss.getUTCHours()}:${ss.getUTCMinutes()}-${se.getUTCHours()}:${se.getUTCMinutes()}`;
            return k === key;
        });
    }

    function openSwapModal(shift: any) {
        if (!user) return;
        const slotShifts = getSlotUserShifts(shift);
        setSwapModal({ shift, slotShifts: slotShifts.length > 0 ? slotShifts : [shift] });
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { if (user) fetchUserShifts(); }, [user]);

    const userShiftIds = new Set(userShifts.map((s) => s.id));
    const weekDates = getWeekDates(selectedDate);

    return (
        <>
            <div className="p-4 max-w-6xl mx-auto">
                <div className="flex gap-6">
                    {/* LEFT SIDE CALENDAR */}
                    <div className="hidden md:flex md:flex-col gap-4 w-64">
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                            <MiniCalendar
                                selectedDate={selectedDate}
                                onSelect={(date: Date) => setSelectedDate(date)}
                            />
                        </div>

                        {/* AVAILABLE SHIFTS LIST */}
                        {user && (
                            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                                <h2 className="text-white font-semibold text-sm mb-3">
                                    Available Shifts
                                </h2>

                                {(() => {
                                    const dateStr = selectedDate.toISOString().split("T")[0];
                                    const forDate = openShifts.filter((s) => s.start_at.startsWith(dateStr));
                                    if (forDate.length === 0)
                                        return <p className="text-slate-500 text-xs">No open shifts for this day.</p>;

                                    return (
                                        <div className="flex flex-col gap-2">
                                            {groupBySlot(forDate).map((group) => {
                                                const first = new Date(group[0].start_at);
                                                const firstEnd = new Date(group[0].end_at);
                                                const slotKey = `${first.getUTCDay()}-${first.getUTCHours()}:${first.getUTCMinutes()}-${firstEnd.getUTCHours()}:${firstEnd.getUTCMinutes()}`;
                                                const dayName = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][first.getUTCDay()];
                                                const timeLabel = `${formatUTCTime(first)} -- ${formatUTCTime(firstEnd)}`;

                                                const alsoAvailable = openShifts.filter((s) => {
                                                    if (s.start_at.startsWith(dateStr)) return false;
                                                    const ss = new Date(s.start_at);
                                                    const se = new Date(s.end_at);
                                                    const k = `${ss.getUTCDay()}-${ss.getUTCHours()}:${ss.getUTCMinutes()}-${se.getUTCHours()}:${se.getUTCMinutes()}`;
                                                    return k === slotKey;
                                                });

                                                return (
                                                    <div
                                                        key={slotKey}
                                                        onClick={() => openClaimModal(group[0], [...group, ...alsoAvailable])}
                                                        className="bg-slate-800 border border-slate-700 rounded-xl p-3 cursor-pointer hover:bg-slate-700 transition-colors"
                                                    >
                                                        <div className="text-white text-sm font-semibold">{dayName}</div>
                                                        <div className="text-slate-400 text-xs mb-2">{timeLabel}</div>
                                                        <div className="flex flex-wrap gap-1">
                                                            {group.map((shift) => (
                                                                <span
                                                                    key={shift.id}
                                                                    title={new Date(shift.start_at).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}
                                                                    className="text-xs bg-green-600/20 text-green-400 px-2 py-0.5 rounded-full"
                                                                >
                                                                    {getTriWeekLabel(new Date(shift.start_at))}
                                                                </span>
                                                            ))}
                                                        </div>
                                                        {alsoAvailable.length > 0 && (
                                                            <>
                                                                <div className="text-slate-500 text-xs mt-2 mb-1">Also Available:</div>
                                                                <div className="flex flex-wrap gap-1">
                                                                    {alsoAvailable.map((shift) => (
                                                                        <span
                                                                            key={shift.id}
                                                                            title={new Date(shift.start_at).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}
                                                                            className="text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full"
                                                                        >
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

                    {/* RIGHT SIDE */}
                    <div className="flex-1">
                        {/* WEEK STRIP */}
                        <div className="flex justify-between items-center mb-6">
                            <button
                                onClick={() => setSelectedDate(new Date(selectedDate.getTime() - 7 * 86400000))}
                                className="bg-slate-800 text-slate-300 px-3 py-2 rounded-lg cursor-pointer"
                            >
                                ◀
                            </button>

                            <div className="flex gap-3">
                                {weekDates.map((date, index) => {
                                    const isSelected = date.getTime() === selectedDate.getTime();
                                    return (
                                        <div
                                            key={index}
                                            onClick={() => setSelectedDate(date)}
                                            className={`cursor-pointer px-4 py-2 rounded-xl min-w-[80px] text-center transition ${
                                                isSelected
                                                    ? "bg-white text-black"
                                                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                                            }`}
                                        >
                                            <div className="text-xs">
                                                {date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}
                                            </div>
                                            <div className="text-lg font-semibold">{date.getUTCDate()}</div>
                                        </div>
                                    );
                                })}
                            </div>

                            <button
                                onClick={() => setSelectedDate(new Date(selectedDate.getTime() + 7 * 86400000))}
                                className="bg-slate-800 text-slate-300 px-3 py-2 rounded-lg cursor-pointer"
                            >
                                ▶
                            </button>
                        </div>

                        {/* CURRENTLY ON DOOR */}
                        {selectedDate.getTime() === localToUTCMidnight().getTime() && (() => {
                            // Use "fake UTC" now: local clock hours stored as UTC, matching how shifts are stored
                            const _now = new Date();
                            const nowMs = Date.UTC(_now.getFullYear(), _now.getMonth(), _now.getDate(), _now.getHours(), _now.getMinutes(), _now.getSeconds());
                            const active = shifts.find(
                                (s) => nowMs >= new Date(s.start_at).getTime() && nowMs < new Date(s.end_at).getTime()
                            );
                            if (!active) return null;
                            const name = active.approvedClaim?.claimant_name ?? (active.status === "taken" ? "Unknown" : null);
                            if (!name) return null;
                            return (
                                <div className="mb-3 flex items-center gap-2.5 bg-green-600/10 border border-green-600/30 rounded-xl px-4 py-2.5">
                                    <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0 animate-pulse" />
                                    <span className="text-green-400 text-sm font-medium">Currently on door: {name}</span>
                                </div>
                            );
                        })()}

                        {/* TIMELINE */}
                        <div className="relative rounded-2xl p-6 bg-slate-900 border border-slate-800 overflow-hidden">
                            {shifts.map((shift) => {
                                const height = (shift.end - shift.start) * HOUR_HEIGHT;
                                const isSmall = height < 40;
                                const dateStr = selectedDate.toISOString().split("T")[0];
                                const displayEndMs = new Date(`${dateStr}T00:00:00Z`).getTime() + shift.end * 3600000;
                                // Compare against fake-UTC now (local clock hours as UTC) to match shift storage
                                const _n = new Date();
                                const fakeNowMs = Date.UTC(_n.getFullYear(), _n.getMonth(), _n.getDate(), _n.getHours(), _n.getMinutes(), _n.getSeconds());
                                const isPast = displayEndMs < fakeNowMs;
                                const isUserShift = userShiftIds.has(shift.id);
                                const hasApprovedClaim = !!shift.approvedClaim;
                                const claimantName = shift.approvedClaim?.claimant_name;
                                const isMyPendingClaim = !isUserShift && !hasApprovedClaim && shift.pendingClaim?.username === user?.username;
                                const isPendingClaim = !isUserShift && !hasApprovedClaim && !!shift.pendingClaim && !isMyPendingClaim;
                                const hasPendingSwap = !!shift.pendingSwap;

                                let bgColor: string;
                                if (isPast) bgColor = "bg-slate-700 cursor-default";
                                else if (isUserShift) bgColor = "bg-green-600 cursor-pointer";
                                else if (hasApprovedClaim && hasPendingSwap) bgColor = "bg-violet-600 cursor-default";
                                else if (hasApprovedClaim) bgColor = "bg-green-700 cursor-default";
                                else if (isMyPendingClaim) bgColor = "bg-amber-500 cursor-default";
                                else if (isPendingClaim) bgColor = "bg-amber-500 cursor-default";
                                else if (shift.status === "open") bgColor = "bg-blue-600 cursor-pointer";
                                else bgColor = "bg-slate-600 cursor-default";

                                let sublabel = "";
                                if (hasApprovedClaim && hasPendingSwap) sublabel = `${claimantName} → ${shift.pendingSwap.target_name}`;
                                else if (hasApprovedClaim) sublabel = claimantName ?? "";
                                else if (isMyPendingClaim || isPendingClaim) sublabel = shift.pendingClaim?.claimant_name ?? "";
                                else if (shift.status === "open") sublabel = "Open";

                                // Use display-clipped times (e.g. 11PM–12AM or 12AM–7AM for overnight)
                                const displayTimeLabel = `${formatHourDecimal(shift.start)} -- ${formatHourDecimal(shift.end)}`;

                                return (
                                    <div
                                        key={shift.id}
                                        onClick={() => {
                                            if (isPast) return;
                                            if (isUserShift) openSwapModal(shift);
                                            else if (!hasApprovedClaim && !isPendingClaim && !isMyPendingClaim) openClaimModal(shift);
                                        }}
                                        className={`absolute left-16 right-4 rounded-xl shadow-lg text-white overflow-hidden ${bgColor}`}
                                        style={{
                                            top: `${shift.start * HOUR_HEIGHT}px`,
                                            height: `${Math.max(height, 22)}px`,
                                            padding: "3px 8px",
                                            display: "flex",
                                            alignItems: "center",
                                            overflow: "hidden",
                                        }}
                                    >
                                        <div className="flex items-center gap-1 min-w-0 leading-tight">
                                            <span className={`font-semibold flex-shrink-0 ${isSmall ? "text-[10px]" : "text-xs"}`}>{displayTimeLabel}</span>
                                            {sublabel && <span className={`font-bold truncate ${isSmall ? "text-[11px]" : "text-[13px]"}`}> : {sublabel}</span>}
                                        </div>
                                    </div>
                                );
                            })}

                            {/* CURRENT TIME LINE */}
                            {selectedDate.getTime() === localToUTCMidnight().getTime() && (() => {
                                const now = new Date();
                                // Shifts are stored with UTC hours == local hours ("fake UTC"),
                                // so the current-time line must also use local hours.
                                const top = (now.getHours() + now.getMinutes() / 60) * HOUR_HEIGHT;
                                return (
                                    <div
                                        className="absolute left-0 right-0 flex items-center pointer-events-none z-10"
                                        style={{ top: `${top}px` }}
                                    >
                                        <div className="w-2 h-2 rounded-full bg-amber-400 ml-14 flex-shrink-0" />
                                        <div className="flex-1 h-px bg-amber-400" />
                                    </div>
                                );
                            })()}

                            {/* TIME LABELS */}
                            {Array.from({ length: 24 }, (_, hour) => (
                                <div
                                    key={hour}
                                    className="absolute left-2 text-[10px] text-slate-500"
                                    style={{ top: `${hour * HOUR_HEIGHT}px` }}
                                >
                                    {formatHour(hour)}
                                </div>
                            ))}

                            <div style={{ height: `${24 * HOUR_HEIGHT}px` }} />
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
        </>
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
        setSelected((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
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
        <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
            onClick={onClose}
        >
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
                            <button
                                onClick={onClose}
                                className="text-slate-500 hover:text-white text-xl cursor-pointer"
                            >
                                ✕
                            </button>
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
                                const date = new Date(s.start_at).toLocaleDateString("en-AU", {
                                    day: "numeric",
                                    month: "short",
                                    timeZone: "UTC",
                                });
                                const isChecked = selected.includes(s.id);
                                return (
                                    <label
                                        key={s.id}
                                        className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-800 cursor-pointer hover:bg-slate-700 transition-colors"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={() => toggleShift(s.id)}
                                            className="accent-green-500 w-4 h-4"
                                        />
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
                            {submitting
                                ? "Submitting..."
                                : `Claim ${selected.length} Shift${selected.length !== 1 ? "s" : ""}`}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

/* ---------------- MINI CALENDAR ---------------- */

function MiniCalendar({ selectedDate, onSelect }: any) {
    // Use UTC methods throughout so all dates are UTC-midnight and stay consistent
    const year = selectedDate.getUTCFullYear();
    const month = selectedDate.getUTCMonth();

    const firstDay = new Date(Date.UTC(year, month, 1));
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const startOffset = firstDay.getUTCDay();

    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(Date.UTC(year, month, d)));

    return (
        <div>
            <div className="text-center text-white font-semibold mb-4">
                {firstDay.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} {year}
            </div>

            <div className="grid grid-cols-7 gap-2 text-xs text-slate-400 mb-2">
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                    <div key={i}>{d}</div>
                ))}
            </div>

            <div className="grid grid-cols-7 gap-2">
                {cells.map((date, index) =>
                    date ? (
                        <div
                            key={index}
                            onClick={() => onSelect(date)}
                            className={`cursor-pointer text-center p-2 rounded-lg text-sm ${
                                date.getTime() === selectedDate.getTime()
                                    ? "bg-indigo-600 text-white"
                                    : "text-slate-300 hover:bg-slate-800"
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

// Creates a UTC-midnight Date from the *local* calendar date, so that
// toISOString().split("T")[0] always returns the user's local date string
// regardless of timezone (fixes the Vercel UTC vs AEST display mismatch).
function localToUTCMidnight(d: Date = new Date()): Date {
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

const TRIMESTERS = [
    { label: "T1", start: new Date(Date.UTC(2026, 1, 8)) },  // 8 Feb 2026
    { label: "T2", start: new Date(Date.UTC(2026, 4, 25)) }, // 25 May 2026
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

// Formats a decimal hour (e.g. 23 → "11:00 PM", 24 → "12:00 AM", 0 → "12:00 AM")
function formatHourDecimal(h: number): string {
    if (h >= 24) return "12:00 AM";
    const hours = Math.floor(h);
    const minutes = Math.round((h - hours) * 60);
    const ampm = hours >= 12 ? "PM" : "AM";
    const hour12 = hours % 12 || 12;
    return `${hour12}:${String(minutes).padStart(2, "0")} ${ampm}`;
}

function getWeekDates(baseDate: Date) {
    // Use UTC day-of-week and ms arithmetic so results are always UTC-midnight dates
    const dayOfWeek = baseDate.getUTCDay();
    const sundayMs = baseDate.getTime() - dayOfWeek * 86400000;
    return Array.from({ length: 7 }, (_, i) => new Date(sundayMs + i * 86400000));
}
