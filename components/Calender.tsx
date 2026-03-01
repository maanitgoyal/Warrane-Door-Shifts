"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const HOUR_HEIGHT = 30;

export default function Calendar() {
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [shifts, setShifts] = useState<any[]>([]);
    const [openShifts, setOpenShifts] = useState<any[]>([]);
    const [user, setUser] = useState<any>(null);

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
        const todayStr = now.toISOString().split("T")[0];

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
        if (!error && data) setOpenShifts(data);
    }

    async function fetchShifts() {
  const dateString = selectedDate.toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("shifts")
    .select("*")
    .gte("start_at", `${dateString}T00:00:00`)
    .lt("start_at", `${dateString}T23:59:59`)
    .order("start_at");

  console.log("Rows Found:", data?.length);
  console.log("Error:", error);

  if (!error && data) {
    const formatted = data.map((shift) => {
      const shiftStart = new Date(shift.start_at);
      const shiftEnd = new Date(shift.end_at);

      const start =
        shiftStart.getUTCHours() +
        shiftStart.getUTCMinutes() / 60;

      const end =
        shiftEnd.getUTCHours() +
        shiftEnd.getUTCMinutes() / 60;

      return {
        ...shift,
        start,
        end,
      };
    });

    setShifts(formatted);
  }
}

    async function claimShift(shift: any) {
        if (!user) {
            alert("Please login first.");
            return;
        }

        if (shift.status !== "open") return;

        const { data, error } = await supabase
            .from("shifts")
            .update({
                assigned_to: user.id,
                status: "taken",
            })
            .eq("id", shift.id)
            .eq("status", "open")
            .select(); // 👈 VERY IMPORTANT

        if (error) {
            console.error(error);
            return;
        }

        if (data && data.length > 0) {
            fetchShifts();
        } else {
            alert("Shift already taken.");
        }

    }

    const weekDates = getWeekDates(selectedDate);

    return (
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
                    {user && <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                        <h2 className="text-white font-semibold text-sm mb-3">
                            Available Shifts
                        </h2>

                        {(() => {
                            const dateStr = selectedDate.toISOString().split("T")[0];
                            const forDate = openShifts.filter((s) => s.start_at.startsWith(dateStr));
                            if (forDate.length === 0) return <p className="text-slate-500 text-xs">No open shifts for this day.</p>;

                            return (
                                <div className="flex flex-col gap-2">
                                    {groupBySlot(forDate).map((group) => {
                                        const first = new Date(group[0].start_at);
                                        const firstEnd = new Date(group[0].end_at);
                                        const slotKey = `${first.getUTCDay()}-${first.getUTCHours()}:${first.getUTCMinutes()}-${firstEnd.getUTCHours()}:${firstEnd.getUTCMinutes()}`;
                                        const dayName = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][first.getUTCDay()];
                                        const timeLabel = `${formatUTCTime(first)} – ${formatUTCTime(firstEnd)}`;

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
                                                className="bg-slate-800 border border-slate-700 rounded-xl p-3"
                                            >
                                                <div className="text-white text-sm font-semibold">{dayName}</div>
                                                <div className="text-slate-400 text-xs mb-2">{timeLabel}</div>
                                                <div className="flex flex-wrap gap-1">
                                                    {group.map((shift) => (
                                                        <span
                                                            key={shift.id}
                                                            title={new Date(shift.start_at).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}
                                                            className="text-xs bg-green-600/20 text-green-400 px-2 py-0.5 rounded-full cursor-default"
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
                                                                    className="text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full cursor-default"
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
                    </div>}
                </div>

                {/* RIGHT SIDE */}
                <div className="flex-1">
                    {/* WEEK STRIP */}
                    <div className="flex justify-between items-center mb-6">
                        <button
                            onClick={() =>
                                setSelectedDate(
                                    new Date(
                                        selectedDate.setDate(
                                            selectedDate.getDate() - 7
                                        )
                                    )
                                )
                            }
                            className="bg-slate-800 text-slate-300 px-3 py-2 rounded-lg cursor-pointer"
                        >
                            ◀
                        </button>

                        <div className="flex gap-3">
                            {weekDates.map((date, index) => {
                                const isSelected =
                                    date.toDateString() ===
                                    selectedDate.toDateString();

                                return (
                                    <div
                                        key={index}
                                        onClick={() =>
                                            setSelectedDate(new Date(date))
                                        }
                                        className={`cursor-pointer px-4 py-2 rounded-xl min-w-[80px] text-center transition ${isSelected
                                            ? "bg-white text-black"
                                            : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                                            }`}
                                    >
                                        <div className="text-xs">
                                            {date.toLocaleDateString("en-US", {
                                                weekday: "short",
                                            })}
                                        </div>
                                        <div className="text-lg font-semibold">
                                            {date.getDate()}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <button
                            onClick={() =>
                                setSelectedDate(
                                    new Date(
                                        selectedDate.setDate(
                                            selectedDate.getDate() + 7
                                        )
                                    )
                                )
                            }
                            className="bg-slate-800 text-slate-300 px-3 py-2 rounded-lg cursor-pointer"
                        >
                            ▶
                        </button>
                    </div>

                    {/* TIMELINE */}
                    <div className="relative rounded-2xl p-6 bg-slate-900 border border-slate-800 overflow-hidden">
                        {shifts.map((shift, index) => {
                            const height =
                                (shift.end - shift.start) * HOUR_HEIGHT;

                            const isSmall = height < 40;

                            const bgColor =
                                shift.status === "open"
                                    ? "bg-green-600 cursor-pointer"
                                    : shift.status === "taken"
                                        ? "bg-red-600"
                                        : "bg-slate-600";

                            return (
                                <div
                                    key={index}
                                    onClick={() => claimShift(shift)}
                                    className={`absolute left-16 right-4 rounded-xl shadow-lg ${bgColor}`}
                                    style={{
                                        top: `${shift.start * HOUR_HEIGHT}px`,
                                        height: `${height}px`,
                                        padding: "6px 10px",
                                        display: "flex",
                                        flexDirection: "column",
                                        justifyContent: "center",
                                    }}
                                >
                                    {isSmall ? (
                                        <div className="font-semibold text-sm leading-tight">
                                            {shift.start_at.slice(11, 16)} - {shift.end_at.slice(11, 16)}
                                        </div>
                                    ) : (
                                        <>
                                            <div className="font-semibold text-sm leading-tight">
                                                {shift.start_at.slice(11, 16)} - {shift.end_at.slice(11, 16)}
                                            </div>
                                            <div className="opacity-80 text-xs leading-tight">
                                                {shift.status.toUpperCase()}
                                            </div>
                                        </>
                                    )}
                                </div>
                            );
                        })}

                        {/* CURRENT TIME LINE */}
                        {selectedDate.toDateString() === new Date().toDateString() && (() => {
                            const now = new Date();
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
                                style={{
                                    top: `${hour * HOUR_HEIGHT}px`,
                                }}
                            >
                                {formatHour(hour)}
                            </div>
                        ))}

                        <div style={{ height: `${24 * HOUR_HEIGHT}px` }} />
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ---------------- MINI CALENDAR ---------------- */

function MiniCalendar({
    selectedDate,
    onSelect,
}: any) {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const daysInMonth = lastDay.getDate();
    const startOffset = firstDay.getDay();

    const cells = [];

    for (let i = 0; i < startOffset; i++) {
        cells.push(null);
    }

    for (let d = 1; d <= daysInMonth; d++) {
        cells.push(new Date(year, month, d));
    }

    return (
        <div>
            <div className="text-center text-white font-semibold mb-4">
                {firstDay.toLocaleString("en-US", {
                    month: "long",
                })}{" "}
                {year}
            </div>

            <div className="grid grid-cols-7 gap-2 text-xs text-slate-400 mb-2">
                {["S", "M", "T", "W", "T", "F", "S"].map(
                    (d, i) => (
                        <div key={i}>{d}</div>
                    )
                )}
            </div>

            <div className="grid grid-cols-7 gap-2">
                {cells.map((date, index) =>
                    date ? (
                        <div
                            key={index}
                            onClick={() => onSelect(date)}
                            className={`cursor-pointer text-center p-2 rounded-lg text-sm ${date.toDateString() ===
                                selectedDate.toDateString()
                                ? "bg-indigo-600 text-white"
                                : "text-slate-300 hover:bg-slate-800"
                                }`}
                        >
                            {date.getDate()}
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

const TRIMESTERS = [
    { label: "T1", start: new Date(Date.UTC(2026, 1, 8)) },  // 8 Feb 2026
    { label: "T2", start: new Date(Date.UTC(2026, 4, 25)) }, // 25 May 2026
];

function getTriWeekLabel(date: Date): string {
    for (const tri of TRIMESTERS) {
        const diffDays = Math.floor((date.getTime() - tri.start.getTime()) / 86400000);
        const week = Math.floor(diffDays / 7);
        if (diffDays >= 0 && week <= 10) {
            return `${tri.label} Wk${week}`;
        }
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

function getWeekDates(baseDate: Date) {
    const start = new Date(baseDate);
    start.setDate(
        baseDate.getDate() - baseDate.getDay()
    );

    const dates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        dates.push(new Date(d));
    }
    return dates;
}
