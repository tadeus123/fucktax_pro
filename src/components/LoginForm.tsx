"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        setError("no");
        return;
      }

      router.push(searchParams.get("from") || "/vat/q4-2025");
      router.refresh();
    } catch {
      setError("no");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xs">
      <div className="relative">
        <input
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          autoFocus
          placeholder="password"
          className="w-full border-b border-zinc-800 bg-transparent py-2.5 pr-14 text-[14px] text-white outline-none placeholder:text-zinc-700 focus:border-zinc-500"
        />
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          className="absolute right-0 top-1/2 -translate-y-1/2 text-[11px] text-zinc-600 transition hover:text-zinc-400"
          tabIndex={-1}
        >
          {showPassword ? "hide" : "show"}
        </button>
      </div>
      {error ? <p className="mt-3 text-[12px] text-zinc-600">{error}</p> : null}
      <button type="submit" disabled={loading || !password} className="sr-only">
        in
      </button>
    </form>
  );
}
