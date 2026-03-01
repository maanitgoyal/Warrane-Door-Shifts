"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const HOUR_HEIGHT = 30;

export default function Calendar() {
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [shifts, setShifts] = useState<any[]>([]);
    const [user, setUser] = useState<any>(null);

    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => {
            setUser(data.user);
        });

        const { data: listener } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                setUser(session?.user ?? null);
            }
        );

        return () => {
            listener.subscription.unsubscribe();
        };
    }, []);

    useEffect(() => {
        fetchShifts();
    }, [selectedDate]);

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
                <div className="hidden md:block w-64 bg-slate-900 border border-slate-800 rounded-2xl p-4 h-fit">
                    <MiniCalendar
                        selectedDate={selectedDate}
                        onSelect={(date: Date) => setSelectedDate(date)}
                    />
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
                            className="bg-slate-800 text-slate-300 px-3 py-2 rounded-lg"
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
                            className="bg-slate-800 text-slate-300 px-3 py-2 rounded-lg"
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
