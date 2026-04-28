"use client";

import { Eye, EyeOff } from "lucide-react";
import { useSignUp } from "@clerk/nextjs";
import { useMemo, useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";

type ClerkInvitationSignUpFormProps = {
  invitationTicket: string;
  redirectUrlComplete: string;
};

function buildBootstrapHref(redirectUrlComplete: string) {
  const query = new URLSearchParams();
  query.set("redirect", redirectUrlComplete);
  return `/api/admin/session/bootstrap?${query.toString()}`;
}

function extractClerkErrorMessage(error: unknown) {
  const issues = (error as { errors?: Array<{ longMessage?: string; message?: string }> } | null)?.errors;
  const first = issues?.[0];
  if (first?.longMessage?.trim()) return first.longMessage.trim();
  if (first?.message?.trim()) return first.message.trim();
  return "Unable to complete account setup right now.";
}

export function ClerkInvitationSignUpForm({
  invitationTicket,
  redirectUrlComplete,
}: ClerkInvitationSignUpFormProps) {
  const { isLoaded, signUp, setActive } = useSignUp();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const bootstrapHref = useMemo(() => buildBootstrapHref(redirectUrlComplete), [redirectUrlComplete]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !isLoaded || !signUp) {
      return;
    }
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

    try {
      const result = await signUp.create({
        strategy: "ticket",
        ticket: invitationTicket,
        password,
        ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
        ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
      });

      if (result.status !== "complete" || !result.createdSessionId) {
        setLoading(false);
        setMessage({ tone: "error", text: "Clerk did not finish the invitation flow." });
        return;
      }

      await setActive?.({ session: result.createdSessionId });

      const csrfToken = await ensureCsrfToken();
      const syncResponse = await fetch("/api/public/auth/sync-legacy-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          password,
          csrfToken,
        }),
      });

      const syncData = (await syncResponse.json().catch(() => null)) as
        | { error?: string; message?: string; ok?: boolean }
        | null;

      if (!syncResponse.ok) {
        setLoading(false);
        setMessage({
          tone: "error",
          text: syncData?.error ?? "Password was created in Clerk, but legacy sync failed.",
        });
        return;
      }

      if (syncData?.message?.includes("No eligible local user found")) {
        setLoading(false);
        setMessage({
          tone: "error",
          text: "Clerk account created, but the local admin record could not be linked.",
        });
        return;
      }

      setMessage({ tone: "success", text: "Account setup complete. Redirecting..." });
      window.location.assign(bootstrapHref);
    } catch (error) {
      setLoading(false);
      setMessage({ tone: "error", text: extractClerkErrorMessage(error) });
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
      <h1 className="text-2xl font-bold text-[var(--ccr-text)]">Accept your invitation</h1>
      <p className="mt-2 text-sm text-[var(--ccr-muted)]">
        Create your password to activate admin access.
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
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-[var(--ccr-muted)]">
            First name
            <input
              type="text"
              autoComplete="given-name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
            />
          </label>
          <label className="block text-sm text-[var(--ccr-muted)]">
            Last name
            <input
              type="text"
              autoComplete="family-name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
            />
          </label>
        </div>

        <label className="block text-sm text-[var(--ccr-muted)]">
          New password
          <div className="relative mt-1">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 pr-11 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
            />
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-[var(--ccr-muted)] hover:bg-[var(--ccr-surface-soft)] hover:text-[var(--ccr-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ccr-accent)]"
            >
              {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </label>

        <label className="block text-sm text-[var(--ccr-muted)]">
          Confirm password
          <input
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            minLength={8}
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
          />
        </label>

        <button
          type="submit"
          disabled={loading || !isLoaded}
          className="w-full rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--ccr-primary-soft)] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? "Finishing setup..." : "Create password"}
        </button>
      </form>
    </div>
  );
}
