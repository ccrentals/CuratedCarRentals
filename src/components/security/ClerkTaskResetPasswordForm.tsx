"use client";

import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@clerk/nextjs";

import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { CLERK_RESET_PASSWORD_TASK_KEY } from "@/lib/security/clerkTasks";

type ClerkTaskResetPasswordFormProps = {
  redirectUrlComplete: string;
};

export function ClerkTaskResetPasswordForm({
  redirectUrlComplete,
}: ClerkTaskResetPasswordFormProps) {
  const router = useRouter();
  const { isLoaded, session } = useSession();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const disabled = loading || !isLoaded || !session;

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    if (!session) {
      router.replace("/sign-in");
      return;
    }

    if (session.currentTask?.key !== CLERK_RESET_PASSWORD_TASK_KEY) {
      router.replace(redirectUrlComplete);
    }
  }, [isLoaded, redirectUrlComplete, router, session]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    if (!isLoaded || !session) return;

    if (password.length < 8) {
      setMessage({ tone: "error", text: "Password must be at least 8 characters." });
      return;
    }
    if (password !== confirmPassword) {
      setMessage({ tone: "error", text: "Passwords do not match." });
      return;
    }

    setLoading(true);
    setMessage(null);
    const csrfToken = await ensureCsrfToken();

    const response = await fetch("/api/auth/password/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        password,
        confirmPassword,
        csrfToken,
        flow: "clerk_task_reset_password",
      }),
    });

    const data = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setLoading(false);
      setMessage({ tone: "error", text: data?.error ?? "Unable to update password." });
      return;
    }

    setMessage({ tone: "success", text: "Password updated. Redirecting..." });

    try {
      await session.reload();
    } catch {
      // Router refresh below is enough as a safe fallback.
    }

    router.refresh();
    router.replace(redirectUrlComplete);
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
      <h1 className="text-2xl font-bold text-[var(--ccr-text)]">Set a new password</h1>
      <p className="mt-2 text-sm text-[var(--ccr-muted)]">
        Your account needs a fresh password before you can continue.
      </p>

      {message ? (
        <p
          className={`mt-4 rounded-xl border px-3 py-2 text-sm ${
            message.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
          role="status"
          aria-live="polite"
        >
          {message.text}
        </p>
      ) : null}

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <label className="block text-sm text-[var(--ccr-muted)]">
          New password
          <div className="relative mt-1">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 pr-11 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
              minLength={8}
              required
            />
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-[var(--ccr-muted)] hover:bg-[var(--ccr-surface-soft)] hover:text-[var(--ccr-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ccr-accent)]"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </label>

        <label className="block text-sm text-[var(--ccr-muted)]">
          Confirm password
          <input
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
            minLength={8}
            required
          />
        </label>

        <button
          type="submit"
          disabled={disabled}
          className="w-full rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--ccr-primary-soft)] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? "Updating password..." : "Update password"}
        </button>
      </form>
    </div>
  );
}
