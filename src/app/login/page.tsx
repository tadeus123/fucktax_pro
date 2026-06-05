import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-500">
            fucktax
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Pro</h1>
          <p className="mt-2 text-sm text-zinc-500">Sign in to manage your German tax filings</p>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-xl shadow-black/40">
          <Suspense fallback={<div className="h-32 animate-pulse rounded-lg bg-zinc-800" />}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
