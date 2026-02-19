"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function Login() {
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");

    const handleLogin = async () => {
        const { error } = await supabase.auth.signInWithOtp({email});
        if (error) {
            setMessage(error.message);
        } else {
            setMessage("Check your email for login link");
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen">
            <div className="bg-white p-8 rounded-2xl shadow-lg w-96">
                <h1 className="text-2xl font-bold mb-6 text-center">
                    Warrane Door Shifts
                </h1>
                <input
                    type="email"
                    placeholder="Enter your email"
                    className="w-full p-2 mb-4 border rounded"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                />
                <button
                    onClick={handleLogin}
                    className="w-full bg-black text-white p-2 rounded"
                >
                    Login
                </button>
                {message && (
                    <p className="mt-4 text-center text-sm">{message}</p>
                )}
            </div>
        </div>
    )
}