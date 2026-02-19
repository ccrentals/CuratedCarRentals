"use client";

import Link from "next/link";
import { useState } from "react";

import { ThemeToggle } from "@/components/site/ThemeToggle";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

export function UserMenu({ email, className }: { email: string; className?: string }) {
  const [loading, setLoading] = useState(false);
  const hoverTextClass = "transition hover:text-[var(--ccr-muted)]";

  async function handleSignOut() {
    if (loading) return;
    setLoading(true);
    const csrfToken = await ensureCsrfToken();
    await fetch("/api/admin/logout", {
      method: "POST",
      headers: {
        "x-csrf-token": csrfToken ?? "",
      },
    });
    window.location.href = "/admin/login";
  }

  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-2 sm:gap-3 ${className ?? ""}`}>
      <p className="w-full min-w-0 break-all text-xs font-semibold text-[var(--ccr-text)] sm:w-auto sm:max-w-[18rem] sm:truncate sm:break-normal sm:text-sm">
        {email}
      </p>
      <Link
        href="/admin/profile"
        className={`rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ccr-text)] ${hoverTextClass}`}
      >
        Profile
      </Link>
      <ThemeToggle className="py-1.5" persistence="user" />
      <button
        type="button"
        onClick={handleSignOut}
        disabled={loading}
        className={`rounded-lg bg-[var(--ccr-primary)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-70 ${hoverTextClass}`}
      >
        {loading ? "Signing out..." : "Sign out"}
      </button>
    </div>
  );
}
