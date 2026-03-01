"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function Login() {
    const [username, setUsername] = useState("");
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);

    const handleLogin = async () => {
        const trimmed = username.trim().toLowerCase();
        if (!trimmed) {
            setMessage("Please enter your username.");
            return;
        }

        setLoading(true);
        setMessage("");

        const { data, error } = await supabase
            .from("users")
            .select("*")
            .eq("username", trimmed)
            .maybeSingle();

        setLoading(false);
        console.log(error, data);
        if (error || !data) {
            setMessage("Username not found. Please try again. If you are not sure about your username, ask head tutor.");
        } else {
            localStorage.setItem("shift_user", JSON.stringify(data));
            window.location.href = "/";
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") handleLogin();
    };

    return (
        <div className="flex flex-1 items-center justify-center bg-slate-950">
            <div className="bg-white p-8 rounded-2xl shadow-lg w-96">
                <h1 className="text-2xl text-red-500 font-bold mb-2 text-center">
                    Warrane Door Shifts
                </h1>
                <p className="text-sm text-slate-500 text-center mb-6">
                    Enter your username to continue
                </p>
                <label className="block text-base font-medium text-black mb-1">
                    Username
                </label>
                <input
                    type="text"
                    placeholder="e.g. justinbieber"
                    className="w-full p-2 mb-1 border rounded focus:outline-none focus:ring-2 focus:ring-black text-black placeholder:text-black-500"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    autoComplete="off"
                    autoCapitalize="none"
                />
                <p className="text-xs text-slate-400 mb-4">
                    First name + last name, no spaces (e.g. justinbieber)
                </p>
                <button
                    onClick={handleLogin}
                    disabled={loading}
                    className="w-full bg-black text-white p-2 rounded hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
                >
                    {loading ? "Checking..." : "Login"}
                </button>
                {message && (
                    <p className="mt-4 text-center text-sm text-red-500">{message}</p>
                )}
            </div>
        </div>
    );
}
