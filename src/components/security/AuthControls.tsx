"use client";

import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { cn } from "@/lib/utils";

type AuthControlsProps = {
  variant: "desktop" | "mobile";
  className?: string;
};

const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim());

export function AuthControls({ variant, className }: AuthControlsProps) {
  const [signingOut, setSigningOut] = useState(false);

  if (!CLERK_ENABLED) {
    return null;
  }

  const isMobile = variant === "mobile";
  const linkClass = isMobile
    ? "inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--ccr-border)] bg-white/10 px-3 py-2 text-xs font-semibold text-[var(--ccr-on-primary-muted)] transition hover:bg-white/15 hover:text-[var(--ccr-on-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ccr-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ccr-primary)]"
    : "inline-flex items-center gap-2 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-muted)] hover:bg-[var(--ccr-surface-soft)]";

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    const csrfToken = await ensureCsrfToken();
    const response = await fetch("/api/admin/logout", {
      method: "POST",
      headers: { "x-csrf-token": csrfToken ?? "" },
    });

    if (!response.ok) {
      setSigningOut(false);
      return;
    }

    window.location.assign("/");
  }

  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <SignedOut>
        <Link href="/sign-in" className={linkClass}>
          Sign In
        </Link>
        <Link href="/sign-up" className={linkClass}>
          Sign Up
        </Link>
      </SignedOut>
      <SignedIn>
        <div
          className={cn(
            "inline-flex items-center gap-2",
            isMobile ? "text-[var(--ccr-on-primary-muted)]" : "text-[var(--ccr-muted)]",
          )}
        >
          <Link href="/admin" className={linkClass}>
            Dashboard
          </Link>
          <button type="button" onClick={handleSignOut} disabled={signingOut} className={linkClass}>
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </SignedIn>
    </div>
  );
}
