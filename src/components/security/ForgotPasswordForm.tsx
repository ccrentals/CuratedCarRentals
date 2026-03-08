"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSignIn } from "@clerk/nextjs";

import { mapClerkPasswordResetError } from "@/lib/security/clerkPasswordFlow";
import { syncLegacyPasswordWithClerkSession } from "@/lib/security/clerkPasswordSync";

type Step = "request" | "verify" | "success";

type ForgotPasswordFormProps = {
  redirectUrlComplete: string;
  returnToSignInHref: string;
};

export function ForgotPasswordForm({
  redirectUrlComplete,
  returnToSignInHref,
}: ForgotPasswordFormProps) {
  const { isLoaded, signIn, setActive } = useSignIn();
  const router = useRouter();

  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const disabled = loading || !isLoaded;

  async function requestResetCode() {
    if (!isLoaded || !signIn) {
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      await signIn.create({
        strategy: "reset_password_email_code",
        identifier: email.trim(),
      });
      setStep("verify");
      setMessage({
        tone: "success",
        text: "Reset code sent. Enter the code from your email and choose a new password.",
      });
    } catch (error) {
      setMessage({ tone: "error", text: mapClerkPasswordResetError(error) });
    } finally {
      setLoading(false);
    }
  }

  async function submitNewPassword() {
    if (!isLoaded || !signIn || !setActive) {
      return;
    }

    if (password !== confirmPassword) {
      setMessage({ tone: "error", text: "Passwords do not match." });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code: code.trim(),
        password,
      });

      if (result.status !== "complete" || !result.createdSessionId) {
        setMessage({
          tone: "error",
          text: "Password reset is not complete yet. Request a new code and try again.",
        });
        return;
      }

      await setActive({
        session: result.createdSessionId,
      });

      const legacySyncResult = await syncLegacyPasswordWithClerkSession({ password });
      if (!legacySyncResult.ok) {
        setStep("success");
        setMessage({
          tone: "error",
          text: legacySyncResult.message,
        });
        return;
      }

      setStep("success");
      setMessage({ tone: "success", text: "Password updated. Redirecting..." });
      router.replace(redirectUrlComplete);
    } catch (error) {
      setMessage({ tone: "error", text: mapClerkPasswordResetError(error) });
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await requestResetCode();
  }

  async function handleVerifySubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitNewPassword();
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
      <h1 className="text-2xl font-bold text-[var(--ccr-text)]">Reset your password</h1>
      <p className="mt-2 text-sm text-[var(--ccr-muted)]">
        Enter your account email to receive a one-time reset code.
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

      {step === "request" ? (
        <form className="mt-5 space-y-4" onSubmit={handleRequestSubmit}>
          <label className="block text-sm text-[var(--ccr-muted)]">
            Email address
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
              required
            />
          </label>
          <button
            type="submit"
            disabled={disabled}
            className="w-full rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--ccr-primary-soft)] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "Sending code..." : "Send reset code"}
          </button>
        </form>
      ) : null}

      {step === "verify" ? (
        <form className="mt-5 space-y-4" onSubmit={handleVerifySubmit}>
          <label className="block text-sm text-[var(--ccr-muted)]">
            Reset code
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
              required
            />
          </label>
          <label className="block text-sm text-[var(--ccr-muted)]">
            New password
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
              minLength={8}
              required
            />
          </label>
          <label className="block text-sm text-[var(--ccr-muted)]">
            Confirm password
            <input
              type="password"
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
            {loading ? "Updating password..." : "Reset password"}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={requestResetCode}
            className="w-full rounded-xl border border-[var(--ccr-border)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] hover:bg-[var(--ccr-surface-soft)] disabled:cursor-not-allowed disabled:opacity-70"
          >
            Resend code
          </button>
        </form>
      ) : null}

      {step === "success" ? (
        <p className="mt-5 text-sm text-[var(--ccr-muted)]">
          Password reset complete. If redirect does not happen, open{" "}
          <Link
            className="font-semibold text-[var(--ccr-accent-strong)] hover:underline"
            href={redirectUrlComplete}
          >
            the next step
          </Link>
          .
        </p>
      ) : null}

      <div className="mt-5 text-sm text-[var(--ccr-muted)]">
        Remembered your password?{" "}
        <Link
          className="font-semibold text-[var(--ccr-accent-strong)] hover:underline"
          href={returnToSignInHref}
        >
          Return to sign in
        </Link>
      </div>
    </div>
  );
}
