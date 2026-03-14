"use client";

import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ForcePasswordChangeGateProps = {
  required: boolean;
  expiresAt?: string | null;
  children: ReactNode;
};

function formatExpiry(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export function ForcePasswordChangeGate({
  required,
  expiresAt,
  children,
}: ForcePasswordChangeGateProps) {
  const isOpen = required;

  return (
    <>
      <div className={isOpen ? "pointer-events-none select-none" : ""} aria-hidden={isOpen || undefined}>
        {children}
      </div>

      {required ? <ForcePasswordChangeDialog expiresAt={expiresAt} /> : null}
    </>
  );
}

type ForcePasswordChangeDialogProps = {
  expiresAt?: string | null;
};

function ForcePasswordChangeDialog({ expiresAt }: ForcePasswordChangeDialogProps) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const expiresLabel = useMemo(() => formatExpiry(expiresAt), [expiresAt]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

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
      }),
    });

    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    setLoading(false);

    if (!response.ok) {
      setMessage({ tone: "error", text: data?.error ?? "Unable to update password." });
      return;
    }

    setMessage({ tone: "success", text: "Password updated. Redirecting..." });
    window.setTimeout(() => {
      setDone(true);
      router.refresh();
    }, 700);
  }

  return (
    <Dialog open={!done}>
      <DialogContent
        data-testid="force-password-dialog"
        className="[&>button]:hidden"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Set a new password</DialogTitle>
          <DialogDescription>
            You&apos;re using a temporary password. Please set a permanent password to continue.
          </DialogDescription>
        </DialogHeader>

        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
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
                data-testid="force-password-new"
                className="w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 pr-11 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
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
              minLength={8}
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              data-testid="force-password-confirm"
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] focus:ring-2"
            />
          </label>

          {expiresLabel ? (
            <p className="text-xs text-[var(--ccr-muted)]">Temporary password expires: {expiresLabel}</p>
          ) : null}

          {message ? (
            <p
              className={`rounded-xl border px-3 py-2 text-sm ${
                message.tone === "success"
                  ? "border-emerald-300/70 bg-emerald-100/15 text-emerald-300"
                  : "border-rose-300/70 bg-rose-100/15 text-rose-300"
              }`}
              role="status"
              aria-live="polite"
            >
              {message.text}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            data-testid="force-password-submit"
            className="w-full rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--ccr-primary-soft)] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "Updating..." : "Update password"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
