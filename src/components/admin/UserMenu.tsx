"use client";

import Link from "next/link";
import { useState } from "react";

import { ThemeToggle } from "@/components/site/ThemeToggle";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

export function UserMenu({ email, role }: { email: string; role: string }) {
  const [loading, setLoading] = useState(false);

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
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm font-semibold text-[var(--ccr-text)]">{email}</p>
      <Link
        href="/admin/profile"
        className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ccr-text)]"
      >
        Profile
      </Link>
      <ThemeToggle className="py-1.5" />
      <button
        type="button"
        onClick={handleSignOut}
        disabled={loading}
        className="rounded-lg bg-[var(--ccr-primary)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-70"
      >
        {loading ? "Signing out..." : "Sign out"}
      </button>
    </div>
  );
}
