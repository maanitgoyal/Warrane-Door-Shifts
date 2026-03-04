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
            sessionStorage.setItem("show_password_reminder", "1");
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
        <div className="flex flex-1 items-center justify-center">
            <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl w-96">
                <div className="text-center mb-6">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white text-xl font-bold mx-auto mb-4 shadow-lg shadow-indigo-500/20">
                        W
                    </div>
                    <h1 className="text-xl font-bold text-white">Warrane Door Shifts</h1>
                    <p className="text-sm text-slate-400 mt-1">
                        {step === "username" ? "Sign in to your account" : `Welcome back, ${userData?.first_name}`}
                    </p>
                </div>

                {step === "username" ? (
                    <>
                        <label className="block text-sm font-medium text-slate-300 mb-1.5">Username</label>
                        <input
                            type="text"
                            placeholder="e.g. justinbieber"
                            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/60 text-sm transition-colors mb-1"
                            value={username}
                            onChange={(e) => { setUsername(e.target.value); setMessage(""); }}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            autoComplete="off"
                            autoCapitalize="none"
                        />
                        <p className="text-xs text-slate-500 mb-5">
                            First name + last name, no spaces (e.g. justinbieber)
                        </p>
                        <button
                            onClick={handleUsernameSubmit}
                            disabled={loading}
                            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 rounded-xl font-semibold disabled:opacity-50 transition-colors cursor-pointer text-sm"
                        >
                            {loading ? "Checking..." : "Continue"}
                        </button>
                    </>
                ) : (
                    <>
                        <div className="flex items-center justify-between bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 mb-4">
                            <div>
                                <p className="text-white text-sm font-semibold">{userData?.first_name} {userData?.last_name}</p>
                                <p className="text-slate-400 text-xs">@{username}</p>
                            </div>
                            <button
                                onClick={backToUsername}
                                className="text-xs text-slate-400 hover:text-white cursor-pointer transition-colors"
                            >
                                Change
                            </button>
                        </div>
                        <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
                        <input
                            type="password"
                            placeholder="Enter your password"
                            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/60 text-sm transition-colors mb-5"
                            value={password}
                            onChange={(e) => { setPassword(e.target.value); setMessage(""); }}
                            onKeyDown={handleKeyDown}
                            autoFocus
                        />
                        <button
                            onClick={handlePasswordSubmit}
                            disabled={loading}
                            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 rounded-xl font-semibold disabled:opacity-50 transition-colors cursor-pointer text-sm"
                        >
                            {loading ? "Verifying..." : "Sign in"}
                        </button>
                    </>
                )}

                {message && (
                    <p className="mt-4 text-center text-sm text-red-400">{message}</p>
                )}
            </div>
        </div>
    );
}
