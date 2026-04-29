"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { TurnstileWidget } from "@/components/security/TurnstileWidget";

type SetupTone = "success" | "error" | "info";

type SetupState = {
  tone: SetupTone;
  text: string;
};

type SetupResponse = {
  ok?: boolean;
  message?: string;
  redirectTo?: string;
  warning?: string;
};

type ClerkAccountSetupFormProps = {
  redirectUrlComplete?: string;
};

function buildSignInHref(redirectUrlComplete?: string) {
  const query = new URLSearchParams();
  query.set("redirect", redirectUrlComplete?.trim() || "/admin");
  return `/sign-in?${query.toString()}`;
}

export function ClerkAccountSetupForm({ redirectUrlComplete }: ClerkAccountSetupFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [state, setState] = useState<SetupState | null>(null);
  const signInHref = useMemo(() => buildSignInHref(redirectUrlComplete), [redirectUrlComplete]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    if (!turnstileToken) {
      setState({
        tone: "error",
        text: "Please complete the security check before completing account setup.",
      });
      return;
    }
    if (password.trim().length < 8) {
      setState({
        tone: "error",
        text: "Password must be at least 8 characters.",
      });
      return;
    }
    if (password !== confirmPassword) {
      setState({
        tone: "error",
        text: "Passwords do not match.",
      });
      return;
    }

    setIsSubmitting(true);
    setState(null);

    try {
      const response = await fetch("/api/public/auth/clerk-account-setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          confirmPassword,
          turnstileToken,
        }),
      });

      const data = (await response.json().catch(() => null)) as SetupResponse | null;
      const message =
        data?.message ??
        (response.ok
          ? "Account setup complete. Redirecting to sign in..."
          : "Unable to complete account setup right now. Try again shortly.");

      setState({
        tone: response.ok ? "success" : "error",
        text: data?.warning ? `${message} ${data.warning}` : message,
      });
      if (response.ok) {
        window.location.assign(data?.redirectTo?.trim() || signInHref);
        return;
      } else {
        setTurnstileToken(null);
        setTurnstileResetKey((value) => value + 1);
      }
    } catch {
      setState({
        tone: "error",
        text: "Unable to prepare account setup right now. Try again shortly.",
      });
      setTurnstileToken(null);
      setTurnstileResetKey((value) => value + 1);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
      <h1 className="text-2xl font-bold text-[var(--ccr-text)]">Complete account setup</h1>
      <p className="mt-2 text-sm text-[var(--ccr-muted)]">
        Use the email address created for you by an administrator and choose your password. We&apos;ll
        link or create the Clerk profile and store the local password hash at the same time.
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
        <TurnstileWidget
          action="public_clerk_account_setup"
          onTokenChange={setTurnstileToken}
          resetKey={turnstileResetKey}
        />

        <button
          type="submit"
          disabled={isSubmitting || !turnstileToken}
          className="w-full rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--ccr-primary-soft)] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Completing setup..." : "Complete account setup"}
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
