"use client";

import { useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { useState } from "react";

import { ThemeToggle } from "@/components/site/ThemeToggle";
import { buttonStyles } from "@/components/ui/Button";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

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
  const props = {
    email,
    className,
    showEmail,
    showThemeLabel,
    compactSidebarLayout,
    showSignOut,
  };

  if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()) {
    return <ClerkUserMenu {...props} />;
  }

  return <UserMenuInner {...props} />;
}

function ClerkUserMenu(
  props: Required<
    Pick<UserMenuProps, "showEmail" | "showThemeLabel" | "compactSidebarLayout" | "showSignOut">
  > &
    UserMenuProps,
) {
  const { signOut } = useClerk();

  return (
    <UserMenuInner
      {...props}
      clerkSignOut={() => signOut({ redirectUrl: "/sign-in" })}
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
  clerkSignOut,
}: UserMenuProps & {
  clerkSignOut?: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const themeToggleId = compactSidebarLayout
    ? "admin-sidebar-theme-toggle"
    : showSignOut
      ? "admin-desktop-theme-toggle"
      : "admin-mobile-theme-toggle";

  async function handleSignOut() {
    if (loading) return;
    setLoading(true);
    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/admin/logout", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken ?? "" },
      });

      if (!response.ok) {
        throw new Error("Unable to clear the local admin session.");
      }

      if (clerkSignOut) {
        await clerkSignOut();
        return;
      }

      window.location.replace("/admin/login");
    } catch {
      setLoading(false);
    }
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
            className={buttonStyles({
              variant: "secondary",
              size: "xs",
              className: "shrink-0 whitespace-nowrap",
            })}
          >
            Profile
          </Link>
          <ThemeToggle
            className="min-w-0 flex-1 px-2 py-1 text-[11px]"
            controlId={themeToggleId}
            persistence="user"
            showLabel={showThemeLabel}
            compact
          />
        </div>
        {showSignOut ? (
          <button
            type="button"
            onClick={handleSignOut}
            disabled={loading}
            className={buttonStyles({
              variant: "primary",
              size: "xs",
              className: "w-full",
            })}
          >
            {loading ? "Signing out..." : "Sign out"}
          </button>
        ) : null}
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
        className={buttonStyles({
          variant: "secondary",
          size: "xs",
        })}
      >
        Profile
      </Link>
      <ThemeToggle
        className="px-2 py-1.5 text-[11px] sm:px-3 sm:text-xs"
        controlId={themeToggleId}
        persistence="user"
        showLabel={showThemeLabel}
      />
      {showSignOut ? (
        <button
          type="button"
          onClick={handleSignOut}
          disabled={loading}
          className={buttonStyles({
            variant: "primary",
            size: "xs",
          })}
        >
          {loading ? "Signing out..." : "Sign out"}
        </button>
      ) : null}
    </div>
  );
}
