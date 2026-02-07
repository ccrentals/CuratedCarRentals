"use client";

import Link from "next/link";
import { useState } from "react";

export function UserMenu({ email, role }: { email: string; role: string }) {
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    if (loading) return;
    setLoading(true);
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/admin/login";
  }

  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <p className="text-sm font-semibold text-[var(--ccr-text)]">{email}</p>
        <span className="rounded-full bg-[var(--ccr-surface-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--ccr-muted)]">
          {role}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/admin/profile"
          className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ccr-text)]"
        >
          Profile
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={loading}
          className="rounded-lg bg-[var(--ccr-primary)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-70"
        >
          {loading ? "Signing out..." : "Sign out"}
        </button>
      </div>
    </div>
  );
}
