"use client";

import { useState } from "react";
import bcryptjs from "bcryptjs";
import { supabase } from "@/lib/supabase";

export default function Login() {
    const [step, setStep] = useState<"username" | "password">("username");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [userData, setUserData] = useState<any>(null);
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);

    async function handleUsernameSubmit() {
        const trimmed = username.trim().toLowerCase();
        if (!trimmed) { setMessage("Please enter your username."); return; }
        setLoading(true);
        setMessage("");
        const { data, error } = await supabase
            .from("users")
            .select("*")
            .eq("username", trimmed)
            .maybeSingle();
        setLoading(false);
        if (error || !data) {
            setMessage("Username not found. If you're unsure, ask the head tutor.");
        } else if (data.password_hash) {
            setUserData(data);
            setStep("password");
        } else {
            localStorage.setItem("shift_user", JSON.stringify(data));
            window.location.href = "/";
        }
    }

    async function handlePasswordSubmit() {
        if (!password) { setMessage("Please enter your password."); return; }
        setLoading(true);
        setMessage("");
        const match = await bcryptjs.compare(password, userData.password_hash);
        setLoading(false);
        if (!match) {
            setMessage("Incorrect password. Please try again.");
        } else {
            localStorage.setItem("shift_user", JSON.stringify(userData));
            window.location.href = "/";
        }
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === "Enter") step === "username" ? handleUsernameSubmit() : handlePasswordSubmit();
    }

    function backToUsername() {
        setStep("username");
        setPassword("");
        setMessage("");
        setUserData(null);
    }

    return (
        <div className="flex flex-1 items-center justify-center bg-slate-950">
            <div className="bg-white p-8 rounded-2xl shadow-lg w-96">
                <h1 className="text-2xl text-red-500 font-bold mb-2 text-center">
                    Warrane Door Shifts
                </h1>
                <p className="text-sm text-slate-500 text-center mb-6">
                    {step === "username" ? "Enter your username to continue" : `Welcome back, ${userData?.first_name}`}
                </p>

                {step === "username" ? (
                    <>
                        <label className="block text-base font-medium text-black mb-1">Username</label>
                        <input
                            type="text"
                            placeholder="e.g. justinbieber"
                            className="w-full p-2 mb-1 border rounded focus:outline-none focus:ring-2 focus:ring-black text-black placeholder:text-slate-400"
                            value={username}
                            onChange={(e) => { setUsername(e.target.value); setMessage(""); }}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            autoComplete="off"
                            autoCapitalize="none"
                        />
                        <p className="text-xs text-slate-400 mb-4">
                            First name + last name, no spaces (e.g. justinbieber)
                        </p>
                        <button
                            onClick={handleUsernameSubmit}
                            disabled={loading}
                            className="w-full bg-black text-white p-2 rounded hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
                        >
                            {loading ? "Checking..." : "Continue"}
                        </button>
                    </>
                ) : (
                    <>
                        {/* User pill */}
                        <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 mb-4">
                            <div>
                                <p className="text-black text-sm font-semibold">{userData?.first_name} {userData?.last_name}</p>
                                <p className="text-slate-400 text-xs">{username}</p>
                            </div>
                            <button
                                onClick={backToUsername}
                                className="text-xs text-slate-400 hover:text-black cursor-pointer transition-colors"
                            >
                                Change
                            </button>
                        </div>
                        <label className="block text-base font-medium text-black mb-1">Password</label>
                        <input
                            type="password"
                            placeholder="Enter your password"
                            className="w-full p-2 mb-4 border rounded focus:outline-none focus:ring-2 focus:ring-black text-black"
                            value={password}
                            onChange={(e) => { setPassword(e.target.value); setMessage(""); }}
                            onKeyDown={handleKeyDown}
                            autoFocus
                        />
                        <button
                            onClick={handlePasswordSubmit}
                            disabled={loading}
                            className="w-full bg-black text-white p-2 rounded hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
                        >
                            {loading ? "Verifying..." : "Login"}
                        </button>
                    </>
                )}

                {message && (
                    <p className="mt-4 text-center text-sm text-red-500">{message}</p>
                )}
            </div>
        </div>
    );
}
