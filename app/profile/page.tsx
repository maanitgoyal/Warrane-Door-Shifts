"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import bcryptjs from "bcryptjs";
import { supabase } from "@/lib/supabase";

const OFFSETS = [
    { label: "24h", value: 1440 },
    { label: "6h", value: 360 },
    { label: "2h", value: 120 },
    { label: "30 min", value: 30 },
];

type Msg = { type: "ok" | "err"; text: string };

function Toggle({ enabled, onToggle, disabled }: { enabled: boolean; onToggle: () => void; disabled?: boolean }) {
    return (
        <button
            onClick={onToggle}
            disabled={disabled}
            aria-label="Toggle notifications"
            className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none ${enabled ? "bg-indigo-600" : "bg-slate-700"}`}
        >
            <span
                className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`}
            />
        </button>
    );
}

function InlineMsg({ msg }: { msg: Msg | null }) {
    if (!msg) return null;
    return (
        <p className={`text-xs mt-2 ${msg.type === "ok" ? "text-green-400" : "text-red-400"}`}>
            {msg.text}
        </p>
    );
}

export default function ProfilePage() {
    const router = useRouter();
    const [user, setUser] = useState<any>(null);

    // Password state
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [passwordSaving, setPasswordSaving] = useState(false);
    const [passwordMsg, setPasswordMsg] = useState<Msg | null>(null);
    const [showPasswords, setShowPasswords] = useState(false);

    // Email state
    const [email, setEmail] = useState("");
    const [emailSaving, setEmailSaving] = useState(false);
    const [emailMsg, setEmailMsg] = useState<Msg | null>(null);

    // Notification state
    const [notifEnabled, setNotifEnabled] = useState(false);
    const [offsets, setOffsets] = useState<number[]>([]);
    const [notifSaving, setNotifSaving] = useState(false);

    useEffect(() => {
        const stored = localStorage.getItem("shift_user");
        if (!stored) { router.push("/login"); return; }
        const u = JSON.parse(stored);
        setUser(u);
        setEmail(u.email ?? "");
        setNotifEnabled(u.notification_enabled ?? false);
        setOffsets(u.notification_offsets ?? []);
    }, []);

    function patchLocalStorage(updates: Record<string, unknown>) {
        const stored = localStorage.getItem("shift_user");
        if (!stored) return;
        const updated = { ...JSON.parse(stored), ...updates };
        localStorage.setItem("shift_user", JSON.stringify(updated));
        setUser(updated);
    }

    async function savePassword() {
        if (!newPassword) { setPasswordMsg({ type: "err", text: "Enter a password." }); return; }
        if (newPassword.length < 6) { setPasswordMsg({ type: "err", text: "Minimum 6 characters." }); return; }
        if (newPassword !== confirmPassword) { setPasswordMsg({ type: "err", text: "Passwords don't match." }); return; }
        setPasswordSaving(true);
        const hash = await bcryptjs.hash(newPassword, 10);
        const { error } = await supabase.from("users").update({ password_hash: hash }).eq("username", user.username);
        setPasswordSaving(false);
        if (error) {
            setPasswordMsg({ type: "err", text: "Failed to save. Try again." });
        } else {
            setPasswordMsg({ type: "ok", text: "Password saved!" });
            setNewPassword("");
            setConfirmPassword("");
            patchLocalStorage({ password_hash: hash });
        }
    }

    async function saveEmail() {
        const trimmed = email.trim();
        if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
            setEmailMsg({ type: "err", text: "Invalid email address." });
            return;
        }
        setEmailSaving(true);
        const { error } = await supabase.from("users").update({ email: trimmed || null }).eq("username", user.username);
        setEmailSaving(false);
        if (error) {
            setEmailMsg({ type: "err", text: "Failed to save. Try again." });
        } else {
            setEmailMsg({ type: "ok", text: "Email saved!" });
            patchLocalStorage({ email: trimmed || null });
        }
    }

    async function saveNotifications(enabled: boolean, newOffsets: number[]) {
        setNotifSaving(true);
        await supabase.from("users").update({
            notification_enabled: enabled,
            notification_offsets: newOffsets,
        }).eq("username", user.username);
        setNotifSaving(false);
        patchLocalStorage({ notification_enabled: enabled, notification_offsets: newOffsets });
    }

    function toggleOffset(value: number) {
        const next = offsets.includes(value) ? offsets.filter((o) => o !== value) : [...offsets, value];
        setOffsets(next);
        saveNotifications(notifEnabled, next);
    }

    function handleToggleNotif() {
        const next = !notifEnabled;
        setNotifEnabled(next);
        saveNotifications(next, offsets);
    }

    if (!user) return null;

    const initials = `${user.first_name?.[0] ?? ""}${user.last_name?.[0] ?? ""}`.toUpperCase();
    const hasEmail = !!(user.email);
    const hasPassword = !!(user.password_hash);
    const isIncomplete = !hasEmail || !hasPassword;

    const roleConfig: Record<string, string> = {
        admin: "bg-amber-500/20 text-amber-400 border-amber-500/30",
        staff: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    };
    const roleCls = roleConfig[user.role] ?? "bg-slate-700/60 text-slate-300 border-slate-600";

    return (
        <div className="min-h-screen bg-slate-950">
            <div className="max-w-2xl mx-auto px-6 py-8">
                {/* Back link */}
                <Link href="/" className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-300 text-sm transition-colors mb-8">
                    ← Back
                </Link>

                {/* Incomplete profile banner */}
                {isIncomplete && (
                    <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/25 rounded-2xl px-5 py-4 mb-8">
                        <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <span className="text-black text-[11px] font-black">!</span>
                        </div>
                        <div>
                            <p className="text-amber-400 text-sm font-semibold">Complete your profile</p>
                            <p className="text-amber-400/70 text-xs mt-0.5 leading-relaxed">
                                {!hasPassword && !hasEmail
                                    ? "Set a password to secure your account and add your email to receive shift reminders."
                                    : !hasPassword
                                        ? "Set a password to protect your account — anyone with your username can currently log in."
                                        : "Add your email to receive shift reminder notifications."}
                            </p>
                        </div>
                    </div>
                )}

                {/* Hero */}
                <div className="flex items-center gap-5 mb-10">
                    <div className="relative flex-shrink-0">
                        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-indigo-500/20">
                            {initials}
                        </div>
                        {isIncomplete && (
                            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-amber-500 rounded-full border-2 border-slate-950" />
                        )}
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-white tracking-tight">{user.first_name} {user.last_name}</h1>
                        <p className="text-slate-500 text-sm mt-0.5">@{user.username}</p>
                        <span className={`inline-flex items-center mt-2 text-xs font-semibold px-2.5 py-0.5 rounded-full border capitalize ${roleCls}`}>
                            {user.role ?? "member"}
                        </span>
                    </div>
                </div>

                {/* ── Security ── */}
                <section className="mb-6">
                    <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Security</h2>
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                        <div className="px-5 pt-5 pb-4">
                            {/* Header row */}
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <p className="text-white text-sm font-semibold">Password</p>
                                    <p className="text-slate-500 text-xs mt-0.5">
                                        {hasPassword
                                            ? "Your account is password-protected."
                                            : "No password set!! Anyone with your username can log in."}
                                    </p>
                                </div>
                                {hasPassword && (
                                    <span className="text-xs bg-green-600/15 text-green-400 border border-green-600/30 px-2.5 py-0.5 rounded-full font-medium">
                                        Set ✓
                                    </span>
                                )}
                            </div>

                            {/* Expandable inputs */}
                            {!showPasswords ? (
                                <button
                                    onClick={() => setShowPasswords(true)}
                                    className="text-sm px-4 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 cursor-pointer transition-colors"
                                >
                                    {hasPassword ? "Change password" : "Set password"}
                                </button>
                            ) : (
                                <div className="flex flex-col gap-2.5">
                                    <input
                                        type="password"
                                        placeholder={hasPassword ? "New password" : "Choose a password"}
                                        value={newPassword}
                                        onChange={(e) => { setNewPassword(e.target.value); setPasswordMsg(null); }}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/60 text-sm transition-colors"
                                        autoFocus
                                    />
                                    <input
                                        type="password"
                                        placeholder="Confirm password"
                                        value={confirmPassword}
                                        onChange={(e) => { setConfirmPassword(e.target.value); setPasswordMsg(null); }}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/60 text-sm transition-colors"
                                    />
                                    <div className="flex items-center justify-between pt-1">
                                        <div>
                                            <InlineMsg msg={passwordMsg} />
                                            {!passwordMsg && (
                                                <button
                                                    onClick={() => { setShowPasswords(false); setNewPassword(""); setConfirmPassword(""); setPasswordMsg(null); }}
                                                    className="text-xs text-slate-500 hover:text-slate-300 cursor-pointer transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                            )}
                                        </div>
                                        <button
                                            onClick={savePassword}
                                            disabled={passwordSaving}
                                            className="text-sm px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-50 cursor-pointer transition-colors"
                                        >
                                            {passwordSaving ? "Saving…" : "Save"}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                {/* ── Notifications ── */}
                <section>
                    <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Notifications</h2>

                    <div className="flex flex-col gap-3">
                        {/* Email card */}
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl px-5 py-4">
                            <div className="flex items-center justify-between mb-1">
                                <p className="text-white text-sm font-semibold">Email Address</p>
                                {hasEmail && (
                                    <span className="text-xs bg-green-600/15 text-green-400 border border-green-600/30 px-2.5 py-0.5 rounded-full font-medium">Saved ✓</span>
                                )}
                            </div>
                            <p className="text-slate-500 text-xs mb-3">Used for shift reminders and account recovery</p>
                            <div className="flex gap-2">
                                <input
                                    type="email"
                                    placeholder="your@email.com"
                                    value={email}
                                    onChange={(e) => { setEmail(e.target.value); setEmailMsg(null); }}
                                    onKeyDown={(e) => e.key === "Enter" && saveEmail()}
                                    className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/60 text-sm transition-colors"
                                />
                                <button
                                    onClick={saveEmail}
                                    disabled={emailSaving}
                                    className="text-sm px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-50 cursor-pointer transition-colors flex-shrink-0"
                                >
                                    {emailSaving ? "…" : "Save"}
                                </button>
                            </div>
                            <InlineMsg msg={emailMsg} />
                        </div>

                        {/* Reminders card */}
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl px-5 py-4">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <p className="text-white text-sm font-semibold">Shift Reminders</p>
                                    <p className="text-slate-500 text-xs mt-0.5">
                                        {!hasEmail
                                            ? "Add your email above to enable reminders"
                                            : notifEnabled
                                                ? "You'll receive email reminders before your shifts"
                                                : "Turn on to receive email reminders before your shifts"}
                                    </p>
                                </div>
                                <Toggle
                                    enabled={notifEnabled && hasEmail}
                                    onToggle={handleToggleNotif}
                                    disabled={!hasEmail || notifSaving}
                                />
                            </div>

                            {notifEnabled && hasEmail && (
                                <div className="mt-5 pt-4 border-t border-slate-800">
                                    <p className="text-slate-400 text-xs font-medium mb-3 uppercase tracking-wide">Remind me before my shift</p>
                                    <div className="flex gap-2 flex-wrap">
                                        {OFFSETS.map(({ label, value }) => {
                                            const active = offsets.includes(value);
                                            return (
                                                <button
                                                    key={value}
                                                    onClick={() => toggleOffset(value)}
                                                    className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer border ${active
                                                        ? "bg-indigo-600 border-indigo-500 text-white shadow-sm shadow-indigo-500/20"
                                                        : "bg-slate-800 border-slate-700 text-slate-400 hover:text-white hover:border-slate-500"
                                                        }`}
                                                >
                                                    {label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {offsets.length === 0 && (
                                        <p className="text-amber-400/80 text-xs mt-3 flex items-center gap-1.5">
                                            <span className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" />
                                            Select at least one reminder time
                                        </p>
                                    )}
                                    {notifSaving && (
                                        <p className="text-slate-500 text-xs mt-2">Saving…</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                {/* Bottom spacer */}
                <div className="h-12" />
            </div>
        </div>
    );
}
