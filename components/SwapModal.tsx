"use client";

import { useState, useEffect, useRef } from "react";
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

function formatHHMM(hhmm: string): string {
    const [h, m] = hhmm.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

function buildTimeSlots(startAt: string, endAt: string): string[] {
    const start = new Date(startAt);
    const end = new Date(endAt);
    const slots: string[] = [];
    const cur = new Date(Date.UTC(
        start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(),
        start.getUTCHours(), start.getUTCMinutes()
    ));
    while (cur.getTime() <= end.getTime()) {
        slots.push(`${String(cur.getUTCHours()).padStart(2, "0")}:${String(cur.getUTCMinutes()).padStart(2, "0")}`);
        cur.setUTCMinutes(cur.getUTCMinutes() + 30);
    }
    return slots;
}

export type ExistingSwap = {
    targetUsername: string;
    targetName: string;
    customStartAt: string | null;
    customEndAt: string | null;
    preSelectedShiftIds: string[];
};

export default function SwapModal({ shift, slotShifts, currentUser, existingSwap, onClose, onSuccess }: {
    shift: any;
    slotShifts: any[];
    currentUser: any;
    existingSwap?: ExistingSwap;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const isEditMode = !!existingSwap;

    const shiftStartDate = new Date(shift.start_at);
    const shiftEndDate = new Date(shift.end_at);
    const defaultStart = `${String(shiftStartDate.getUTCHours()).padStart(2, "0")}:${String(shiftStartDate.getUTCMinutes()).padStart(2, "0")}`;
    const defaultEnd = `${String(shiftEndDate.getUTCHours()).padStart(2, "0")}:${String(shiftEndDate.getUTCMinutes()).padStart(2, "0")}`;

    const [selected, setSelected] = useState<string[]>(
        existingSwap?.preSelectedShiftIds ?? [shift.id]
    );
    const [users, setUsers] = useState<any[]>([]);
    const [search, setSearch] = useState("");
    const [selectedUser, setSelectedUser] = useState<any>(null);
    const [submitting, setSubmitting] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [done, setDone] = useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const [swapType, setSwapType] = useState<"whole" | "partial">(
        existingSwap?.customStartAt ? "partial" : "whole"
    );
    const [customStart, setCustomStart] = useState(() => {
        if (existingSwap?.customStartAt) {
            const d = new Date(existingSwap.customStartAt);
            return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
        }
        return defaultStart;
    });
    const [customEnd, setCustomEnd] = useState(() => {
        if (existingSwap?.customEndAt) {
            const d = new Date(existingSwap.customEndAt);
            return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
        }
        return defaultEnd;
    });

    const allSlots = buildTimeSlots(shift.start_at, shift.end_at);
    const startOptions = allSlots.slice(0, -1);
    const endOptions = allSlots.filter((t) => t > customStart);

    useEffect(() => {
        supabase
            .from("users")
            .select("id, first_name, last_name, username")
            .then(({ data }) => {
                if (data) {
                    const others = data.filter((u: any) => u.username !== currentUser.username);
                    setUsers(others);
                    if (existingSwap?.targetUsername) {
                        const pre = others.find((u: any) => u.username === existingSwap.targetUsername);
                        if (pre) setSelectedUser(pre);
                    }
                }
            });
    }, []);

    // Scroll highlighted item into view
    useEffect(() => {
        if (highlightedIndex >= 0 && listRef.current) {
            const item = listRef.current.children[highlightedIndex] as HTMLElement;
            item?.scrollIntoView({ block: "nearest" });
        }
    }, [highlightedIndex]);

    const allIds = slotShifts.map((s) => s.id);
    const filtered = users.filter((u) =>
        `${u.first_name} ${u.last_name}`.toLowerCase().includes(search.toLowerCase())
    );

    function toggleShift(id: string) {
        setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
    }

    function toggleAll() {
        setSelected(selected.length === allIds.length ? [] : allIds);
    }

    function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (!dropdownOpen || filtered.length === 0) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlightedIndex((i) => Math.max(i - 1, -1));
        } else if (e.key === "Enter" && highlightedIndex >= 0) {
            e.preventDefault();
            setSelectedUser(filtered[highlightedIndex]);
            setDropdownOpen(false);
            setHighlightedIndex(-1);
        } else if (e.key === "Escape") {
            setDropdownOpen(false);
            setHighlightedIndex(-1);
        }
    }

    const start = new Date(shift.start_at);
    const end = new Date(shift.end_at);
    const dayName = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][start.getUTCDay()];
    const timeLabel = `${formatUTCTime(start)} – ${formatUTCTime(end)}`;

    async function submitSwap() {
        if (!selectedUser || selected.length === 0) return;
        setSubmitting(true);

        // Edit mode: delete the original pending swaps first
        if (isEditMode && existingSwap!.preSelectedShiftIds.length > 0) {
            await supabase
                .from("swaps")
                .delete()
                .eq("requester_username", currentUser.username)
                .in("shift_id", existingSwap!.preSelectedShiftIds)
                .eq("status", "pending");
        }

        const swaps = selected.map((shiftId) => {
            const shiftObj = slotShifts.find((s) => s.id === shiftId) ?? shift;
            let custom_start_at: string | null = null;
            let custom_end_at: string | null = null;
            if (swapType === "partial") {
                const d = new Date(shiftObj.start_at);
                const [sh, sm] = customStart.split(":").map(Number);
                const [eh, em] = customEnd.split(":").map(Number);
                custom_start_at = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), sh, sm)).toISOString();
                custom_end_at = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), eh, em)).toISOString();
            }
            return {
                requester_username: currentUser.username,
                requester_name: `${currentUser.first_name} ${currentUser.last_name}`,
                shift_id: shiftId,
                target_username: selectedUser.username,
                target_name: `${selectedUser.first_name} ${selectedUser.last_name}`,
                status: "pending",
                custom_start_at,
                custom_end_at,
            };
        });

        const { error } = await supabase.from("swaps").insert(swaps);
        setSubmitting(false);
        if (!error) {
            setDone(true);
            setTimeout(() => { onSuccess(); onClose(); }, 1500);
        } else {
            console.error("Swap error:", error?.message);
        }
    }

    async function handleCancelSwap() {
        if (!existingSwap) return;
        setCancelling(true);
        await supabase
            .from("swaps")
            .delete()
            .eq("requester_username", currentUser.username)
            .in("shift_id", existingSwap.preSelectedShiftIds)
            .eq("status", "pending");
        setCancelling(false);
        onSuccess();
        onClose();
    }

    return (
        <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
            onClick={onClose}
        >
            <div
                className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-96 max-h-[85vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                {done ? (
                    <div className="text-center py-8">
                        <div className="text-green-400 text-4xl mb-3">✓</div>
                        <div className="text-white font-semibold">
                            {isEditMode ? "Swap request updated!" : "Swap request submitted!"}
                        </div>
                        <div className="text-slate-400 text-sm mt-1">Waiting for admin approval.</div>
                    </div>
                ) : (
                    <>
                        {/* Header */}
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h2 className="text-white font-semibold text-lg">
                                    {isEditMode ? "Edit Swap Request" : "Request Swap"}
                                </h2>
                                <p className="text-slate-400 text-sm mt-0.5">{dayName} · {timeLabel}</p>
                            </div>
                            <button onClick={onClose} className="text-slate-500 hover:text-white text-xl cursor-pointer">✕</button>
                        </div>

                        {/* Swap type toggle */}
                        <p className="text-slate-400 text-sm mb-2">Swap type:</p>
                        <div className="flex gap-2 mb-5">
                            {(["whole", "partial"] as const).map((t) => (
                                <button
                                    key={t}
                                    onClick={() => setSwapType(t)}
                                    className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors cursor-pointer border ${
                                        swapType === t
                                            ? "bg-violet-600 border-violet-500 text-white"
                                            : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"
                                    }`}
                                >
                                    {t === "whole" ? "Whole Shift" : "Part of Shift"}
                                </button>
                            ))}
                        </div>

                        {/* Partial time pickers */}
                        {swapType === "partial" && (
                            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-5">
                                <p className="text-slate-400 text-xs mb-3">
                                    Select the hours you want to swap
                                    <span className="text-slate-500"> (within {timeLabel})</span>:
                                </p>
                                <div className="flex items-end gap-3">
                                    <div className="flex-1">
                                        <label className="text-slate-500 text-xs mb-1 block">From</label>
                                        <select
                                            value={customStart}
                                            onChange={(e) => {
                                                setCustomStart(e.target.value);
                                                if (customEnd <= e.target.value) {
                                                    const next = allSlots.find((t) => t > e.target.value);
                                                    if (next) setCustomEnd(next);
                                                }
                                            }}
                                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-slate-500 cursor-pointer"
                                        >
                                            {startOptions.map((t) => (
                                                <option key={t} value={t}>{formatHHMM(t)}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <span className="text-slate-500 text-sm pb-2.5">–</span>
                                    <div className="flex-1">
                                        <label className="text-slate-500 text-xs mb-1 block">To</label>
                                        <select
                                            value={customEnd}
                                            onChange={(e) => setCustomEnd(e.target.value)}
                                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-slate-500 cursor-pointer"
                                        >
                                            {endOptions.map((t) => (
                                                <option key={t} value={t}>{formatHHMM(t)}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Week selection */}
                        <p className="text-slate-400 text-sm mb-2">Select weeks to swap:</p>
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
                                    day: "numeric", month: "short", timeZone: "UTC",
                                });
                                return (
                                    <label
                                        key={s.id}
                                        className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-800 cursor-pointer hover:bg-slate-700 transition-colors"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selected.includes(s.id)}
                                            onChange={() => toggleShift(s.id)}
                                            className="accent-violet-500 w-4 h-4"
                                        />
                                        <span className="text-white text-sm font-medium">{label}</span>
                                        <span className="text-slate-400 text-xs ml-auto">{date}</span>
                                    </label>
                                );
                            })}
                        </div>

                        {/* User search */}
                        <p className="text-slate-400 text-sm mb-2">Swap with:</p>
                        <div className="relative mb-5">
                            <input
                                ref={inputRef}
                                type="text"
                                placeholder="Search by name..."
                                value={selectedUser ? `${selectedUser.first_name} ${selectedUser.last_name}` : search}
                                onChange={(e) => {
                                    setSearch(e.target.value);
                                    setSelectedUser(null);
                                    setDropdownOpen(true);
                                    setHighlightedIndex(-1);
                                }}
                                onFocus={() => setDropdownOpen(true)}
                                onKeyDown={handleSearchKeyDown}
                                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white placeholder:text-slate-500 focus:outline-none focus:border-slate-500 text-sm"
                            />
                            {selectedUser && (
                                <button
                                    onClick={() => { setSelectedUser(null); setSearch(""); inputRef.current?.focus(); }}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white cursor-pointer"
                                >✕</button>
                            )}
                            {dropdownOpen && !selectedUser && search.length > 0 && (
                                <div
                                    ref={listRef}
                                    className="absolute left-0 right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-xl overflow-hidden z-10 max-h-48 overflow-y-auto shadow-lg"
                                >
                                    {filtered.length > 0 ? (
                                        filtered.map((u, index) => (
                                            <button
                                                key={u.username}
                                                onMouseDown={() => {
                                                    setSelectedUser(u);
                                                    setDropdownOpen(false);
                                                    setHighlightedIndex(-1);
                                                }}
                                                onMouseEnter={() => setHighlightedIndex(index)}
                                                className={`w-full text-left px-4 py-2.5 text-sm text-white transition-colors cursor-pointer ${
                                                    index === highlightedIndex ? "bg-slate-600" : "hover:bg-slate-700"
                                                }`}
                                            >
                                                {u.first_name} {u.last_name}
                                            </button>
                                        ))
                                    ) : (
                                        <div className="px-4 py-3 text-slate-500 text-sm">No users found.</div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Submit */}
                        <button
                            onClick={submitSwap}
                            disabled={submitting || !selectedUser || selected.length === 0}
                            className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2 rounded-xl cursor-pointer transition-colors mb-3"
                        >
                            {submitting
                                ? (isEditMode ? "Updating..." : "Submitting...")
                                : isEditMode
                                ? `Update Swap (${selected.length} shift${selected.length !== 1 ? "s" : ""})`
                                : `Request Swap (${selected.length} shift${selected.length !== 1 ? "s" : ""})`}
                        </button>

                        {/* Cancel swap (edit mode only) */}
                        {isEditMode && (
                            <button
                                onClick={handleCancelSwap}
                                disabled={cancelling}
                                className="w-full bg-transparent hover:bg-red-500/10 disabled:opacity-50 text-red-400 border border-red-500/30 font-medium py-2 rounded-xl cursor-pointer transition-colors text-sm"
                            >
                                {cancelling ? "Cancelling..." : "Cancel Swap Request"}
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
