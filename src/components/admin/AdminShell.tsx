"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { UserMenu } from "@/components/admin/UserMenu";

const SIDEBAR_STORAGE_KEY = "adminSidebarCollapsed";

type NavChild = {
  label: string;
  href: string;
};

type NavItem = {
  label: string;
  href: string;
  icon: (className: string) => ReactNode;
  children?: NavChild[];
};

type AdminNavLinksProps = {
  pathname: string;
  collapsedState?: boolean;
  expandedItems: Record<string, boolean>;
  setExpandedItems: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onNavigate?: () => void;
};

const DOCUMENTATION_CHILDREN: NavChild[] = [
  { label: "PRD / Specification", href: "/admin/documentation/prd" },
  { label: "Design", href: "/admin/documentation/design" },
  { label: "Technical", href: "/admin/documentation/technical" },
  { label: "Operations", href: "/admin/documentation/operations" },
  { label: "Legal & Compliance", href: "/admin/documentation/legal" },
  { label: "Project Management", href: "/admin/documentation/project-management" },
];

const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    href: "/admin",
    icon: (className: string) => (
      <svg
        viewBox="0 0 24 24"
        className={className}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </svg>
    ),
  },
  {
    label: "Bookings",
    href: "/admin/bookings",
    icon: (className: string) => (
      <svg
        viewBox="0 0 24 24"
        className={className}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M8 2v4M16 2v4M3 9h18" />
      </svg>
    ),
  },
  {
    label: "Payments",
    href: "/admin/payments",
    icon: (className: string) => (
      <svg
        viewBox="0 0 24 24"
        className={className}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 10h18" />
        <path d="M7 15h4" />
      </svg>
    ),
  },
  {
    label: "Calendar",
    href: "/admin/calendar",
    icon: (className: string) => (
      <svg
        viewBox="0 0 24 24"
        className={className}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M8 2v4M16 2v4M3 9h18" />
        <path d="M7 13h4M13 13h4M7 17h4M13 17h4" />
      </svg>
    ),
  },
  {
    label: "Vehicles",
    href: "/admin/vehicles",
    icon: (className: string) => (
      <svg
        viewBox="0 0 24 24"
        className={className}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 13l2-5a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 5" />
        <rect x="3" y="12" width="18" height="6" rx="2" />
        <circle cx="7" cy="18" r="2" />
        <circle cx="17" cy="18" r="2" />
      </svg>
    ),
  },
  {
    label: "Reports",
    href: "/admin/reports",
    icon: (className: string) => (
      <svg
        viewBox="0 0 24 24"
        className={className}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 19h16" />
        <rect x="6" y="10" width="3" height="7" rx="1" />
        <rect x="11" y="7" width="3" height="10" rx="1" />
        <rect x="16" y="4" width="3" height="13" rx="1" />
      </svg>
    ),
  },
  {
    label: "Cron",
    href: "/admin/cron",
    icon: (className: string) => (
      <svg
        viewBox="0 0 24 24"
        className={className}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v6l4 2" />
      </svg>
    ),
  },
  {
    label: "Health",
    href: "/admin/health",
    icon: (className: string) => (
      <svg
        viewBox="0 0 24 24"
        className={className}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 21s-7-4.4-9-9.5C1.6 8 3.7 5 7.2 5c1.9 0 3.2 1 3.8 2 0.6-1 1.9-2 3.8-2C18.3 5 20.4 8 21 11.5 19 16.6 12 21 12 21z" />
        <path d="M3.8 12h3l1.2-2.4L10 14l1.4-2h2.6l1.2-2.2L16.7 12h3.5" />
      </svg>
    ),
  },
  {
    label: "Documentation",
    href: "/admin/documentation",
    children: DOCUMENTATION_CHILDREN,
    icon: (className: string) => (
      <svg
        viewBox="0 0 24 24"
        className={className}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 4h9l3 3v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
        <path d="M15 4v4h4" />
        <path d="M8 11h8M8 15h8" />
      </svg>
    ),
  },
  {
    label: "Settings",
    href: "/admin/settings",
    icon: (className: string) => (
      <svg
        viewBox="0 0 24 24"
        className={className}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1 1 0 0 1 0 1.4l-1.3 1.3a1 1 0 0 1-1.4 0l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9v.2a1 1 0 0 1-1 1h-1.9a1 1 0 0 1-1-1v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a1 1 0 0 1-1.4 0L4.3 18a1 1 0 0 1 0-1.4l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6h-.2a1 1 0 0 1-1-1V12a1 1 0 0 1 1-1h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a1 1 0 0 1 0-1.4l1.3-1.3a1 1 0 0 1 1.4 0l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9v-.2a1 1 0 0 1 1-1h1.9a1 1 0 0 1 1 1v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1 1 0 0 1 1.4 0l1.3 1.3a1 1 0 0 1 0 1.4l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6h.2a1 1 0 0 1 1 1v1.9a1 1 0 0 1-1 1h-.2a1 1 0 0 0-.9.6z" />
      </svg>
    ),
  },
  {
    label: "Users",
    href: "/admin/users",
    icon: (className: string) => (
      <svg
        viewBox="0 0 24 24"
        className={className}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M16 21c0-3-2.7-5-6-5s-6 2-6 5" />
        <circle cx="10" cy="8" r="3.2" />
        <path d="M20 21c0-2.1-1.2-3.7-3-4.4" />
        <path d="M17 3.6a3.2 3.2 0 0 1 0 6.2" />
      </svg>
    ),
  },
  {
    label: "Profile",
    href: "/admin/profile",
    icon: (className: string) => (
      <svg
        viewBox="0 0 24 24"
        className={className}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="8" r="3.5" />
        <path d="M4 20c1.8-3.5 5-5.5 8-5.5s6.2 2 8 5.5" />
      </svg>
    ),
  },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/admin") {
    return pathname === "/admin";
  }
  return pathname.startsWith(href);
}

function AdminNavLinks({
  pathname,
  collapsedState,
  expandedItems,
  setExpandedItems,
  onNavigate,
}: AdminNavLinksProps) {
  return (
    <nav className={`mt-6 flex flex-col gap-1 text-sm font-semibold ${collapsedState ? "items-center" : ""}`}>
      {NAV_ITEMS.map((item) => {
        const active = isActivePath(pathname, item.href);
        const hasChildren = Boolean(item.children?.length) && !collapsedState;
        const isExpanded = hasChildren && Boolean(expandedItems[item.href]);
        const showChildren = hasChildren && isExpanded;
        return (
          <div key={item.href} className={`flex flex-col ${collapsedState ? "items-center" : ""}`}>
            <div className={`flex items-center gap-2 ${collapsedState ? "w-full justify-center" : "w-full"}`}>
              <Link
                href={item.href}
                onClick={onNavigate}
                title={item.label}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl py-2 transition ${
                  collapsedState ? "justify-center px-2" : "flex-1 px-3"
                } ${
                  active
                    ? "bg-[var(--ccr-primary)] text-white"
                    : "text-[var(--ccr-text)] hover:bg-[var(--ccr-surface-soft)]"
                }`}
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                    active
                      ? "bg-white/20 text-white"
                      : "bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)]"
                  }`}
                >
                  {item.icon(
                    `h-5 w-5 ${active ? "text-white" : "text-[var(--ccr-text)]"}`,
                  )}
                </span>
                {collapsedState ? null : <span>{item.label}</span>}
              </Link>
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() =>
                    setExpandedItems((current) => ({
                      ...current,
                      [item.href]: !current[item.href],
                    }))
                  }
                  aria-label={`${isExpanded ? "Collapse" : "Expand"} ${item.label}`}
                  className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-1.5 text-[var(--ccr-text)] transition hover:border-[var(--ccr-accent)]"
                >
                  <svg
                    viewBox="0 0 20 20"
                    className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 7l5 6 5-6" />
                  </svg>
                </button>
              ) : null}
            </div>

            {showChildren ? (
              <div className="mt-1 flex flex-col gap-1 pl-12">
                {item.children?.map((child) => {
                  const childActive = pathname.startsWith(child.href);
                  return (
                    <Link
                      key={child.href}
                      href={child.href}
                      onClick={onNavigate}
                      aria-current={childActive ? "page" : undefined}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                        childActive
                          ? "bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)]"
                          : "text-[var(--ccr-muted)] hover:bg-[var(--ccr-surface-soft)] hover:text-[var(--ccr-text)]"
                      }`}
                    >
                      {child.label}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

export function AdminShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: { email: string; role: string };
}) {
  const pathname = usePathname() ?? "/admin";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  });
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    NAV_ITEMS.forEach((item) => {
      if (item.children?.length) {
        initial[item.href] = pathname.startsWith(item.href);
      }
    });
    return initial;
  });

  useEffect(() => {
    if (!drawerOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", handleKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  const activeItem = useMemo(() => {
    return NAV_ITEMS.find((nav) => isActivePath(pathname, nav.href));
  }, [pathname]);

  const handleMenuToggle = () => {
    if (typeof window === "undefined") return;
    const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
    if (isDesktop) {
      setCollapsed((prev) => {
        const next = !prev;
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
        return next;
      });
      setDrawerOpen(false);
    } else {
      setDrawerOpen((prev) => !prev);
    }
  };

  const sidebarWidth = collapsed ? "lg:w-20" : "lg:w-64";
  const contentPadding = collapsed ? "lg:pl-20" : "lg:pl-64";
  const brandLabel = collapsed ? "CCR" : "Curated Admin";

  return (
    <div className="min-h-screen bg-[var(--ccr-bg)] text-[var(--ccr-text)]">
      <aside
        className={`hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:flex-col lg:border-r lg:border-[var(--ccr-border)] lg:bg-[var(--ccr-surface)] lg:px-4 lg:py-6 ${sidebarWidth}`}
      >
        <div className={`flex items-center gap-2 ${collapsed ? "justify-center" : ""}`}>
          <button
            type="button"
            onClick={handleMenuToggle}
            aria-label="Toggle admin sidebar"
            className="rounded-lg border border-[var(--ccr-border)] px-2 py-1 text-sm font-semibold text-[var(--ccr-text)]"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          {collapsed ? null : (
            <Link href="/admin" className="text-lg font-bold text-[var(--ccr-text)]">
              {brandLabel}
            </Link>
          )}
        </div>
        <AdminNavLinks
          pathname={pathname}
          collapsedState={collapsed}
          expandedItems={expandedItems}
          setExpandedItems={setExpandedItems}
        />
      </aside>

      <div
        className={`fixed inset-0 z-40 bg-black/40 transition lg:hidden ${
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setDrawerOpen(false)}
      />
      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-64 flex-col border-r border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-6 shadow-xl transition-transform lg:hidden ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between">
          <Link href="/admin" className="text-lg font-bold text-[var(--ccr-text)]">
            Curated Admin
          </Link>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close admin menu"
            className="rounded-lg border border-[var(--ccr-border)] px-2 py-1 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Close
          </button>
        </div>
        <AdminNavLinks
          pathname={pathname}
          expandedItems={expandedItems}
          setExpandedItems={setExpandedItems}
          onNavigate={() => setDrawerOpen(false)}
        />
      </aside>

      <div className={contentPadding}>
        <header className="sticky top-0 z-30 border-b border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
          <div className="mx-auto flex w-full max-w-none items-center justify-between gap-4 py-3 pl-2 pr-4 sm:pl-3 sm:pr-5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleMenuToggle}
                aria-label="Open admin menu"
                className="rounded-lg border border-[var(--ccr-border)] px-2 py-1 text-sm font-semibold text-[var(--ccr-text)] lg:hidden"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6h18M3 12h18M3 18h18" />
                </svg>
              </button>
              {activeItem ? (
                <div className="flex items-center gap-5 text-lg font-semibold text-[var(--ccr-text)]">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--ccr-surface-soft)] shadow-sm ring-2 ring-[var(--ccr-accent)] ring-offset-2 ring-offset-[var(--ccr-surface)]">
                    {activeItem.icon("h-5 w-5 text-[var(--ccr-accent)]")}
                  </span>
                  <span>{activeItem.label}</span>
                </div>
              ) : null}
            </div>
            <UserMenu email={user.email} role={(user.role ?? "Admin").toUpperCase()} />
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
