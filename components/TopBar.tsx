"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

export default function TopBar() {
    const router = useRouter();
    const pathname = usePathname();
    const [user, setUser] = useState<{ first_name: string; last_name: string; role?: string } | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const stored = localStorage.getItem("shift_user");
        if (stored) setUser(JSON.parse(stored));
    }, []);

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
        router.push("/login");
    };

    return (
        <div className="flex justify-between items-center px-6 py-4 border-b">
            <Link
                href="/"
                className="text-xl font-bold hover:opacity-80 transition-opacity"
            >
                Warrane Door Shifts {new Date().getFullYear()}
            </Link>

            {user && (
                <nav className="flex gap-1">
                    {[
                        { href: "/", label: "Calendar" },
                        { href: "/my-shifts", label: "My Shifts" },
                        ...(user?.role !== "staff" ? [{ href: "/payouts", label: "Payouts" }] : []),
                        ...(user?.role === "admin" ? [{ href: "/admin", label: "Admin" }] : []),
                    ].map(({ href, label }) => (
                        <Link
                            key={href}
                            href={href}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                pathname === href
                                    ? "bg-slate-800 text-white"
                                    : "text-slate-400 hover:text-white hover:bg-slate-800"
                            }`}
                        >
                            {label}
                        </Link>
                    ))}
                </nav>
            )}

            {user ? (
                <div className="relative" ref={menuRef}>
                    <div
                        onClick={() => setMenuOpen((v) => !v)}
                        className="w-9 h-9 rounded-full bg-black text-white flex items-center justify-center font-bold text-sm cursor-pointer select-none"
                    >
                        {user.first_name?.[0]?.toUpperCase() ?? "?"}
                    </div>
                    {menuOpen && (
                        <div className="absolute right-0 mt-1 w-40 bg-white border rounded-lg shadow-lg z-50">
                            <div className="px-3 py-2 text-xs text-slate-500 border-b truncate">
                                {user.first_name} {user.last_name}
                            </div>
                            <button
                                onClick={handleLogout}
                                className="w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-slate-50 rounded-b-lg cursor-pointer"
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
    );
}
