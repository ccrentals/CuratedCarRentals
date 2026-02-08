"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [toast, setToast] = useState<{ message: string; tone: "error" | "success" } | null>(null);
  const [loading, setLoading] = useState(false);

  function showToast(message: string, tone: "error" | "success" = "error") {
    setToast({ message, tone });
    window.setTimeout(() => {
      setToast((current) => (current?.message === message ? null : current));
    }, 3000);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setToast(null);
    setLoading(true);

    const csrfToken = await ensureCsrfToken();

    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json().catch(() => ({}));
    setLoading(false);

    if (!response.ok) {
      showToast(data?.error ?? "Login failed. Check your credentials.", "error");
      return;
    }

    showToast("Welcome back!", "success");
    router.push("/admin");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--ccr-bg)] px-6">
      {toast ? (
        <div
          className={`fixed right-6 top-6 z-50 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-lg backdrop-blur ${
            toast.tone === "success"
              ? "border-emerald-200 bg-emerald-50/90 text-emerald-900"
              : "border-rose-200 bg-rose-50/90 text-rose-900"
          }`}
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      ) : null}
      <div className="w-full max-w-md rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-[var(--ccr-text)]">Admin Login</h1>
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">
          Sign in to manage vehicles, bookings, and payments.
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm text-[var(--ccr-muted)]">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
              required
            />
          </label>
          <label className="block text-sm text-[var(--ccr-muted)]">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
              required
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--ccr-primary-soft)] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <Link
          href="/"
          className="mt-4 block w-full rounded-xl border border-[var(--ccr-border)] px-4 py-2 text-center text-sm font-semibold text-[var(--ccr-text)] hover:bg-[var(--ccr-surface-soft)]"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}
