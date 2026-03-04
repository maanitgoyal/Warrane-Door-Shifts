"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

export default function TopBar() {
    const router = useRouter();
    const pathname = usePathname();
    const [user, setUser] = useState<{ first_name: string; last_name: string; role?: string; password_hash?: string | null } | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const [showPasswordReminder, setShowPasswordReminder] = useState(false);

    useEffect(() => {
        const stored = localStorage.getItem("shift_user");
        if (stored) setUser(JSON.parse(stored));
        if (sessionStorage.getItem("show_password_reminder")) setShowPasswordReminder(true);
    }, []);

    useEffect(() => {
        function onUserUpdated() {
            const stored = localStorage.getItem("shift_user");
            if (stored) setUser(JSON.parse(stored));
        }
        window.addEventListener("shift_user_updated", onUserUpdated);
        return () => window.removeEventListener("shift_user_updated", onUserUpdated);
    }, []);

    function dismissReminder() {
        sessionStorage.removeItem("show_password_reminder");
        setShowPasswordReminder(false);
    }

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleLogout = () => {
        localStorage.removeItem("shift_user");
        setUser(null);
        router.push("/");
    };

    const isProfileIncomplete = user && !user.password_hash;

    return (
        <>
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-800">
            <Link
                href="/"
                className="text-xl font-bold hover:opacity-80 transition-opacity"
            >
                Warrane Door Shifts {new Date().getFullYear()}
            </Link>

            <div className="flex items-center gap-3">
            {user && (
                <nav className="flex gap-1">
                    {[
                        { href: "/", label: "Calendar" },
                        ...(user?.role !== "admin" ? [{ href: "/my-shifts", label: "My Shifts" }] : []),
                        ...(user?.role !== "admin" && user?.role !== "staff" ? [{ href: "/payouts", label: "Payouts" }] : []),
                        { href: "/profile", label: "Profile" },
                        ...(user?.role === "admin" ? [{ href: "/admin", label: "Admin" }] : []),
                    ].map(({ href, label }) => (
                        <Link
                            key={href}
                            href={href}
                            className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                pathname === href
                                    ? "bg-slate-800 text-white"
                                    : "text-slate-400 hover:text-white hover:bg-slate-800"
                            }`}
                        >
                            {label}
                            {label === "Profile" && isProfileIncomplete && (
                                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-amber-500 rounded-full" />
                            )}
                        </Link>
                    ))}
                </nav>
            )}

            {user ? (
                <div className="relative" ref={menuRef}>
                    <div
                        onClick={() => setMenuOpen((v) => !v)}
                        className="relative w-9 h-9 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm cursor-pointer select-none hover:bg-indigo-500 transition-colors"
                    >
                        {user.first_name?.[0]?.toUpperCase() ?? "?"}
                        {isProfileIncomplete && (
                            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-amber-500 rounded-full border-2 border-slate-950" />
                        )}
                    </div>
                    {menuOpen && (
                        <div className="absolute right-0 mt-2 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
                            <div className="px-4 py-3 border-b border-slate-800">
                                <p className="text-white text-sm font-semibold truncate">{user.first_name} {user.last_name}</p>
                                <p className="text-slate-500 text-xs truncate">@{(user as any).username}</p>
                            </div>
                            <Link
                                href="/profile"
                                onClick={() => setMenuOpen(false)}
                                className="w-full text-left flex items-center justify-between px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800 cursor-pointer transition-colors"
                            >
                                Profile
                                {isProfileIncomplete && (
                                    <span className="w-2 h-2 bg-amber-500 rounded-full flex-shrink-0" />
                                )}
                            </Link>
                            <button
                                onClick={handleLogout}
                                className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-slate-800 cursor-pointer transition-colors"
                            >
                                Logout
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                <div className="relative group/login">
                    <button
                        onClick={() => router.push("/login")}
                        className="bg-black text-white px-4 py-2 rounded-lg hover:opacity-80 transition-opacity cursor-pointer"
                    >
                        Login
                    </button>
                    <div className="absolute right-0 top-full mt-2 px-2 py-1 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover/login:opacity-100 transition-opacity pointer-events-none z-10">
                        Sign in
                    </div>
                </div>
            )}
            </div>
        </div>
        {showPasswordReminder && (
            <div className="flex items-center justify-between gap-3 bg-amber-500/10 border-b border-amber-500/25 px-6 py-2.5">
                <div className="flex items-center gap-2.5">
                    <span className="w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center text-black text-[10px] font-black flex-shrink-0">!</span>
                    <span className="text-amber-400 text-sm">Set a password to secure your account.</span>
                    <Link href="/profile" onClick={dismissReminder} className="text-amber-400 underline text-sm font-semibold">Go to profile →</Link>
                </div>
                <button onClick={dismissReminder} className="text-amber-400/60 hover:text-amber-400 text-lg cursor-pointer leading-none">✕</button>
            </div>
        )}
        </>
    );
}
