"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";

export default function AdminSetPasswordPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "error" | "success" } | null>(null);

  function buildBootstrapHref() {
    const query = new URLSearchParams();
    query.set("redirect", "/admin/set-password");
    return `/api/admin/session/bootstrap?${query.toString()}`;
  }

  function showToast(message: string, tone: "error" | "success" = "error") {
    setToast({ message, tone });
    window.setTimeout(() => {
      setToast((current) => (current?.message === message ? null : current));
    }, 3000);
  }

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const response = await fetch("/api/admin/me", { cache: "no-store" });
      if (!response.ok) {
        window.location.replace(buildBootstrapHref());
        return;
      }
      if (!cancelled) setBootLoading(false);
    }

    boot().catch(() => {
      window.location.replace(buildBootstrapHref());
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setToast(null);

    if (password !== confirmPassword) {
      showToast("Passwords do not match", "error");
      return;
    }

    setLoading(true);
    const csrfToken = await ensureCsrfToken();

    const response = await fetch("/api/admin/set-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({ password, confirmPassword }),
    });

    const data = await response.json().catch(() => ({}));
    setLoading(false);

    if (!response.ok) {
      showToast(data?.error ?? "Unable to update password.", "error");
      return;
    }

    showToast("Password updated.", "success");
    router.replace("/admin");
  }

  if (bootLoading) {
    return <div className="min-h-screen bg-[var(--ccr-bg)]" />;
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
        <h1 className="text-2xl font-bold text-[var(--ccr-text)]">Set a new password</h1>
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">
          You must set a permanent password before using the admin portal.
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm text-[var(--ccr-muted)]">
            New password
            <div className="relative mt-1">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 pr-11 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
                required
                minLength={8}
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-[var(--ccr-muted)] hover:bg-[var(--ccr-surface-soft)] hover:text-[var(--ccr-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ccr-accent)]"
              >
                {showPassword ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    <path
                      d="M10.58 10.58a2 2 0 0 0 2.84 2.84"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M16.68 16.68A8.94 8.94 0 0 1 12 18c-5 0-9-6-9-6a17.67 17.67 0 0 1 3.05-3.73m3.1-2A8.94 8.94 0 0 1 12 6c5 0 9 6 9 6a17.45 17.45 0 0 1-3.2 3.85"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M3 3l18 18"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    <path
                      d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            </div>
          </label>

          <label className="block text-sm text-[var(--ccr-muted)]">
            Confirm password
            <input
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
              required
              minLength={8}
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--ccr-primary-soft)] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "Saving..." : "Save Password"}
          </button>
        </form>

        <Link
          href="/api/admin/logout"
          className="mt-4 block w-full rounded-xl border border-[var(--ccr-border)] px-4 py-2 text-center text-sm font-semibold text-[var(--ccr-text)] hover:bg-[var(--ccr-surface-soft)]"
        >
          Sign out
        </Link>
      </div>
    </div>
  );
}
