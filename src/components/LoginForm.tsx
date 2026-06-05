"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
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
    <form onSubmit={handleSubmit} className="w-48">
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        required
        autoFocus
        className="w-full border-b border-zinc-800 bg-transparent py-2 text-center text-sm text-white outline-none focus:border-zinc-500"
      />
      {error ? <p className="mt-2 text-center text-xs text-zinc-600">{error}</p> : null}
      <button type="submit" disabled={loading || !password} className="sr-only">
        in
      </button>
    </form>
  );
}
