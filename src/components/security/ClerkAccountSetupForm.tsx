"use client";

import Link from "next/link";
import { useState } from "react";

type SetupTone = "success" | "error" | "info";

type SetupState = {
  tone: SetupTone;
  text: string;
};

type SetupResponse = {
  ok?: boolean;
  message?: string;
};

export function ClerkAccountSetupForm() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [state, setState] = useState<SetupState | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setState(null);

    try {
      const response = await fetch("/api/public/auth/clerk-account-setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = (await response.json().catch(() => null)) as SetupResponse | null;
      const message =
        data?.message ??
        (response.ok
          ? "Setup complete. Return to sign in and continue with your preferred SSO provider."
          : "Unable to prepare account setup right now. Try again shortly.");

      setState({
        tone: response.ok ? "success" : "error",
        text: message,
      });
    } catch {
      setState({
        tone: "error",
        text: "Unable to prepare account setup right now. Try again shortly.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
      <h1 className="text-2xl font-bold text-[var(--ccr-text)]">Complete account setup</h1>
      <p className="mt-2 text-sm text-[var(--ccr-muted)]">
        Use your admin account email. We&apos;ll prepare your Clerk profile for SSO without requiring phone
        onboarding.
      </p>

      {state ? (
        <p
          className={`mt-4 rounded-xl border px-3 py-2 text-sm ${
            state.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : state.tone === "error"
                ? "border-rose-200 bg-rose-50 text-rose-900"
                : "border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)]"
          }`}
          role="status"
          aria-live="polite"
        >
          {state.text}
        </p>
      ) : null}

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <label className="block text-sm text-[var(--ccr-muted)]">
          Account email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
            placeholder="admin@curatedcarrentals.com"
            required
          />
        </label>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--ccr-primary-soft)] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Preparing account..." : "Prepare Clerk sign-in"}
        </button>
      </form>

      <p className="mt-5 text-sm text-[var(--ccr-muted)]">
        Ready to continue?{" "}
        <Link href="/admin/auth" className="font-semibold text-[var(--ccr-accent-strong)] hover:underline">
          Return to admin sign in
        </Link>
        .
      </p>
      <p className="mt-2 text-sm text-[var(--ccr-muted)]">
        Need immediate access?{" "}
        <Link href="/admin/login" className="font-semibold text-[var(--ccr-accent-strong)] hover:underline">
          Use legacy admin login
        </Link>
        .
      </p>
    </div>
  );
}
