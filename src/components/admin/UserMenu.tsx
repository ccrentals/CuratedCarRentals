"use client";

import Link from "next/link";
import { useState } from "react";

import { ThemeToggle } from "@/components/site/ThemeToggle";

type UserMenuProps = {
  email: string;
  className?: string;
  showEmail?: boolean;
  showThemeLabel?: boolean;
  compactSidebarLayout?: boolean;
  showSignOut?: boolean;
};

export function UserMenu({
  email,
  className,
  showEmail = true,
  showThemeLabel = true,
  compactSidebarLayout = false,
  showSignOut = true,
}: UserMenuProps) {
  return (
    <UserMenuInner
      email={email}
      className={className}
      showEmail={showEmail}
      showThemeLabel={showThemeLabel}
      compactSidebarLayout={compactSidebarLayout}
      showSignOut={showSignOut}
    />
  );
}

function UserMenuInner({
  email,
  className,
  showEmail,
  showThemeLabel,
  compactSidebarLayout,
  showSignOut,
}: UserMenuProps & {
}) {
  const [loading, setLoading] = useState(false);
  const hoverTextClass = "transition hover:text-[var(--ccr-muted)]";

  function handleSignOut() {
    if (loading) return;
    setLoading(true);
    const fallbackLogoutUrl = "/api/admin/logout?redirect=%2Fsign-in%3Fredirect%3D%2Fadmin";
    window.location.assign(fallbackLogoutUrl);
  }

  if (compactSidebarLayout) {
    return (
      <div className={`flex min-w-0 flex-col gap-2 ${className ?? ""}`}>
        {showEmail ? (
          <p className="w-full min-w-0 break-all text-xs font-semibold text-[var(--ccr-text)] sm:w-auto sm:max-w-[18rem] sm:truncate sm:break-normal sm:text-sm">
            {email}
          </p>
        ) : null}
        <div className="flex min-w-0 flex-nowrap items-center gap-1.5">
          <Link
            href="/admin/profile"
            className={`shrink-0 whitespace-nowrap rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-2 py-1 text-[11px] font-semibold text-[var(--ccr-text)] ${hoverTextClass}`}
          >
            Profile
          </Link>
          <ThemeToggle
            className="min-w-0 flex-1 px-2 py-1 text-[11px]"
            persistence="user"
            showLabel={showThemeLabel}
          />
          {showSignOut ? (
            <button
              type="button"
              onClick={handleSignOut}
              disabled={loading}
              className={`shrink-0 whitespace-nowrap rounded-lg bg-[var(--ccr-primary)] px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-70 ${hoverTextClass}`}
            >
              {loading ? "Signing out..." : "Sign out"}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex min-w-0 flex-nowrap items-center gap-1.5 sm:gap-3 ${className ?? ""}`}>
      {showEmail ? (
        <p className="w-full min-w-0 break-all text-xs font-semibold text-[var(--ccr-text)] sm:w-auto sm:max-w-[18rem] sm:truncate sm:break-normal sm:text-sm">
          {email}
        </p>
      ) : null}
      <Link
        href="/admin/profile"
        className={`rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-2 py-1.5 text-[11px] font-semibold text-[var(--ccr-text)] sm:px-3 sm:text-xs ${hoverTextClass}`}
      >
        Profile
      </Link>
      <ThemeToggle
        className="px-2 py-1.5 text-[11px] sm:px-3 sm:text-xs"
        persistence="user"
        showLabel={showThemeLabel}
      />
      {showSignOut ? (
        <button
          type="button"
          onClick={handleSignOut}
          disabled={loading}
          className={`rounded-lg bg-[var(--ccr-primary)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-70 ${hoverTextClass}`}
        >
          {loading ? "Signing out..." : "Sign out"}
        </button>
      ) : null}
    </div>
  );
}
