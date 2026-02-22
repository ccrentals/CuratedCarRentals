"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ADMIN_ACCENT_RING_CLASS } from "@/components/admin/adminUiClasses";
import { UserMenu } from "@/components/admin/UserMenu";
import { useUnreadMessagesCount } from "@/lib/messages/useUnreadMessagesCount";

const SIDEBAR_STORAGE_KEY = "adminSidebarCollapsed";
const DRAWER_FOCUSABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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

type NavGroup = {
  id: string;
  label: string;
  itemHrefs: string[];
  defaultExpanded?: boolean;
};

type AdminNavLinksProps = {
  pathname: string;
  currentRole: string | undefined;
  unreadMessagesCount: number;
  collapsedState?: boolean;
  expandedItems: Record<string, boolean>;
  setExpandedItems: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  expandedGroups: Record<string, boolean>;
  setExpandedGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onNavigate?: () => void;
};

const ADMIN_HOVER_TEXT_CLASS = "hover:text-[var(--ccr-muted)]";

const DOCUMENTATION_CHILDREN: NavChild[] = [
  { label: "PRD / Specification", href: "/admin/documentation/prd" },
  { label: "Design", href: "/admin/documentation/design" },
  { label: "Technical", href: "/admin/documentation/technical" },
  { label: "Operations", href: "/admin/documentation/operations" },
  { label: "Legal & Compliance", href: "/admin/documentation/legal" },
  { label: "Project Management", href: "/admin/documentation/project-management" },
];

const BOOKINGS_CHILDREN: NavChild[] = [
  { label: "Bookings", href: "/admin/bookings" },
  { label: "Quotes", href: "/admin/bookings/quotes" },
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
    children: BOOKINGS_CHILDREN,
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
    label: "Customers",
    href: "/admin/customers",
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
    label: "Messages",
    href: "/admin/messages",
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
        <path d="M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
        <path d="M3 8l9 6 9-6" />
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
    label: "Promo Codes",
    href: "/admin/promo-codes",
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
        <path d="M20.6 13.4L13.4 20.6a2 2 0 0 1-2.8 0L3.4 13.4a2 2 0 0 1 0-2.8l7.2-7.2a2 2 0 0 1 2.8 0l7.2 7.2a2 2 0 0 1 0 2.8z" />
        <circle cx="9" cy="9" r="1.5" />
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
    label: "Schedule",
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
    label: "Developer",
    href: "/admin/developer",
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
        <path d="M16 18l6-6-6-6" />
        <path d="M8 6l-6 6 6 6" />
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

const NAV_GROUPS: NavGroup[] = [
  {
    id: "operations",
    label: "Operations",
    itemHrefs: [
      "/admin",
      "/admin/bookings",
      "/admin/customers",
      "/admin/messages",
      "/admin/payments",
      "/admin/promo-codes",
      "/admin/calendar",
      "/admin/vehicles",
      "/admin/settings",
      "/admin/users",
      "/admin/profile",
    ],
    defaultExpanded: true,
  },
  {
    id: "monitoring",
    label: "Monitoring",
    itemHrefs: ["/admin/reports", "/admin/cron"],
    defaultExpanded: true,
  },
  {
    id: "administration",
    label: "Administration",
    itemHrefs: ["/admin/documentation", "/admin/developer", "/admin/health"],
    defaultExpanded: true,
  },
];

const NAV_ITEM_BY_HREF = new Map<string, NavItem>(NAV_ITEMS.map((item) => [item.href, item]));

function normalizeRole(role: string | undefined) {
  return String(role ?? "")
    .trim()
    .toUpperCase();
}

function isDeveloperRole(role: string | undefined) {
  return normalizeRole(role) === "DEVELOPER";
}

function isAdminRole(role: string | undefined) {
  const normalized = normalizeRole(role);
  return normalized === "ADMIN" || normalized === "DEVELOPER";
}

function getVisibleNavGroups(role: string | undefined) {
  if (isDeveloperRole(role)) {
    return NAV_GROUPS;
  }
  return NAV_GROUPS.filter((group) => group.id !== "administration");
}

function isActivePath(pathname: string, href: string) {
  if (href === "/admin") {
    return pathname === "/admin";
  }
  return pathname.startsWith(href);
}

function AdminNavLinks({
  pathname,
  currentRole,
  unreadMessagesCount,
  collapsedState,
  expandedItems,
  setExpandedItems,
  expandedGroups,
  setExpandedGroups,
  onNavigate,
}: AdminNavLinksProps) {
  const visibleGroups = getVisibleNavGroups(currentRole);
  const canSeeUsers = isAdminRole(currentRole);
  const visibleItemHrefs = new Set(visibleGroups.flatMap((group) => group.itemHrefs));
  if (!canSeeUsers) {
    visibleItemHrefs.delete("/admin/users");
  }
  const visibleItems = NAV_ITEMS.filter((item) => visibleItemHrefs.has(item.href));

  const renderItem = (item: NavItem) => {
    const active = isActivePath(pathname, item.href);
    const hasChildren = Boolean(item.children?.length) && !collapsedState;
    const isExpanded = hasChildren && Boolean(expandedItems[item.href]);
    const showChildren = hasChildren && isExpanded;
    const messageBadgeCount = item.href === "/admin/messages" ? unreadMessagesCount : 0;
    const badgeLabel = messageBadgeCount > 99 ? "99+" : String(messageBadgeCount);
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
                : `text-[var(--ccr-text)] hover:bg-[var(--ccr-surface-soft)] ${ADMIN_HOVER_TEXT_CLASS}`
            }`}
          >
            <span
              className={`relative flex h-9 w-9 items-center justify-center rounded-lg ${
                active
                  ? "bg-white/20 text-white"
                  : "bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)]"
              }`}
            >
              {item.icon(
                `h-5 w-5 ${active ? "text-white" : "text-[var(--ccr-text)]"}`,
              )}
              {messageBadgeCount > 0 ? (
                <span className="absolute -right-1 -top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full border border-[var(--ccr-surface)] bg-[var(--ccr-accent)] px-1 text-[9px] font-bold leading-none text-white">
                  {badgeLabel}
                </span>
              ) : null}
            </span>
            {collapsedState ? null : (
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{item.label}</span>
                {messageBadgeCount > 0 ? (
                  <span className="inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-[var(--ccr-accent)] px-1.5 text-[10px] font-bold leading-none text-white">
                    {badgeLabel}
                  </span>
                ) : null}
              </span>
            )}
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
              className={`rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-1.5 text-[var(--ccr-text)] transition hover:border-[var(--ccr-accent)] ${ADMIN_HOVER_TEXT_CLASS}`}
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
                      : `text-[var(--ccr-muted)] hover:bg-[var(--ccr-surface-soft)] ${ADMIN_HOVER_TEXT_CLASS}`
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
  };

  if (collapsedState) {
    return (
      <nav className="mt-6 flex flex-col items-center gap-1 text-sm font-semibold">
        {visibleItems.map(renderItem)}
      </nav>
    );
  }

  return (
    <nav className="mt-6 flex flex-col gap-2 text-sm font-semibold">
      {visibleGroups.map((group) => {
        const groupItems = group.itemHrefs
          .map((href) => NAV_ITEM_BY_HREF.get(href))
          .filter(
            (item): item is NavItem =>
              Boolean(item) && visibleItemHrefs.has((item as NavItem).href),
          );
        const groupExpanded = Boolean(expandedGroups[group.id]);
        return (
          <section key={group.id} className="rounded-xl border border-[var(--ccr-border)]/60 bg-[var(--ccr-surface-soft)]/40 p-2">
            <button
              type="button"
              onClick={() =>
                setExpandedGroups((current) => ({
                  ...current,
                  [group.id]: !current[group.id],
                }))
              }
              aria-label={`${groupExpanded ? "Collapse" : "Expand"} ${group.label}`}
              className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-[var(--ccr-muted)] transition hover:bg-[var(--ccr-surface-soft)] ${ADMIN_HOVER_TEXT_CLASS}`}
            >
              <span>{group.label}</span>
              <svg
                viewBox="0 0 20 20"
                className={`h-3.5 w-3.5 transition-transform ${groupExpanded ? "rotate-180" : ""}`}
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

            {groupExpanded ? (
              <div className="mt-1 flex flex-col gap-1">
                {groupItems.map(renderItem)}
              </div>
            ) : null}
          </section>
        );
      })}
    </nav>
  );
}

export function AdminShell({
  children,
  user,
  unreadMessagesCount,
}: {
  children: React.ReactNode;
  user: { email: string; role: string };
  unreadMessagesCount: number;
}) {
  const pathname = usePathname() ?? "/admin";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [logoGlowOn, setLogoGlowOn] = useState(false);
  const [mobileCompactHeader, setMobileCompactHeader] = useState(false);
  const mobileHeaderRef = useRef<HTMLElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const mainContentRef = useRef<HTMLDivElement | null>(null);
  const drawerTriggerRef = useRef<HTMLElement | null>(null);
  const previousFocusedElementRef = useRef<HTMLElement | null>(null);
  const mobileCompactThresholdRef = useRef(72);
  const {
    count: liveUnreadMessagesCount,
    refresh: refreshUnreadMessagesCount,
  } = useUnreadMessagesCount(unreadMessagesCount);
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
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    getVisibleNavGroups(user.role).forEach((group) => {
      const hasActiveRoute = group.itemHrefs.some((href) => isActivePath(pathname, href));
      initial[group.id] = hasActiveRoute || Boolean(group.defaultExpanded);
    });
    return initial;
  });

  useEffect(() => {
    if (!pathname.startsWith("/admin/messages")) return;
    void refreshUnreadMessagesCount();
  }, [pathname, refreshUnreadMessagesCount]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setLogoGlowOn(false);
      return;
    }
    setLogoGlowOn(true);
    const timer = window.setTimeout(() => {
      setLogoGlowOn(false);
    }, 1650);
    return () => {
      window.clearTimeout(timer);
    };
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const drawer = drawerRef.current;
    if (!drawer) return;

    const getFocusableElements = () =>
      Array.from(drawer.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE_SELECTOR)).filter(
        (element) =>
          !element.hasAttribute("disabled") &&
          element.getAttribute("aria-hidden") !== "true" &&
          (element.getClientRects().length > 0 || element === document.activeElement),
      );

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDrawerOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        drawer.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const activeElement =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;

      if (event.shiftKey) {
        if (!activeElement || activeElement === first || !drawer.contains(activeElement)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (!activeElement || activeElement === last || !drawer.contains(activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      const focusTarget = event.target as Node | null;
      if (focusTarget && drawer.contains(focusTarget)) return;
      const focusableElements = getFocusableElements();
      const nextTarget = focusableElements[0] ?? drawer;
      nextTarget.focus();
    };

    previousFocusedElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    window.addEventListener("keydown", handleKey);
    document.addEventListener("focusin", handleFocusIn);

    const focusTimer = window.requestAnimationFrame(() => {
      const focusableElements = getFocusableElements();
      const nextTarget = focusableElements[0] ?? drawer;
      nextTarget.focus();
    });

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const background = mainContentRef.current;
    const previousAriaHidden = background?.getAttribute("aria-hidden") ?? null;
    const supportsInert = Boolean(background && "inert" in background);
    const previousInert = supportsInert
      ? Boolean((background as HTMLElement & { inert?: boolean }).inert)
      : false;

    if (background) {
      background.setAttribute("aria-hidden", "true");
      if (supportsInert) {
        (background as HTMLElement & { inert?: boolean }).inert = true;
      }
    }

    return () => {
      window.cancelAnimationFrame(focusTimer);
      window.removeEventListener("keydown", handleKey);
      document.removeEventListener("focusin", handleFocusIn);
      document.body.style.overflow = previous;

      if (background) {
        if (previousAriaHidden === null) {
          background.removeAttribute("aria-hidden");
        } else {
          background.setAttribute("aria-hidden", previousAriaHidden);
        }
        if (supportsInert) {
          (background as HTMLElement & { inert?: boolean }).inert = previousInert;
        }
      }

      const restoreTarget = drawerTriggerRef.current ?? previousFocusedElementRef.current;
      if (restoreTarget) {
        window.requestAnimationFrame(() => restoreTarget.focus());
      }
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mobileMediaQuery = window.matchMedia("(max-width: 767px)");
    let rafId = 0;

    const recomputeThreshold = () => {
      const measuredHeight = mobileHeaderRef.current?.getBoundingClientRect().height ?? 0;
      mobileCompactThresholdRef.current = Math.max(16, Math.round(measuredHeight - 12));
    };

    const updateCompactHeader = () => {
      if (!mobileMediaQuery.matches) {
        setMobileCompactHeader((current) => (current ? false : current));
        return;
      }
      const next = window.scrollY > mobileCompactThresholdRef.current;
      setMobileCompactHeader((current) => (current === next ? current : next));
    };

    const scheduleUpdate = () => {
      if (rafId !== 0) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        updateCompactHeader();
      });
    };

    const handleViewportChange = () => {
      recomputeThreshold();
      scheduleUpdate();
    };

    recomputeThreshold();
    scheduleUpdate();

    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", handleViewportChange);
    mobileMediaQuery.addEventListener("change", handleViewportChange);

    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", handleViewportChange);
      mobileMediaQuery.removeEventListener("change", handleViewportChange);
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

  const activeItem = useMemo(() => {
    return NAV_ITEMS.find((nav) => isActivePath(pathname, nav.href));
  }, [pathname]);
  const logoGlowClass = logoGlowOn ? "ccr-icon-glow-pulse" : "";

  const handleMenuToggle = (trigger?: HTMLElement | null) => {
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
      setDrawerOpen((prev) => {
        const next = !prev;
        if (next) {
          drawerTriggerRef.current = trigger ?? drawerTriggerRef.current;
        }
        return next;
      });
    }
  };

  // Keep desktop collapse smooth while preserving mobile off-canvas behavior.
  const sidebarWidth = collapsed ? "lg:w-20" : "lg:w-64";
  const brandLabel = collapsed ? "CCR" : "Curated Admin";

  return (
    <div className="min-h-screen bg-[var(--ccr-bg)] text-[var(--ccr-text)] lg:flex">
      <aside
        data-admin-sidebar
        className={`hidden overflow-hidden lg:flex lg:flex-col lg:border-r lg:border-[var(--ccr-border)] lg:bg-[var(--ccr-surface)] lg:px-4 lg:py-6 lg:transition-[width] lg:duration-300 lg:ease-in-out ${sidebarWidth}`}
      >
        <div className={`flex items-center gap-2 ${collapsed ? "justify-center" : ""}`}>
          <button
            type="button"
            onClick={(event) =>
              handleMenuToggle(event.currentTarget as HTMLElement)
            }
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
          currentRole={user.role}
          unreadMessagesCount={liveUnreadMessagesCount}
          collapsedState={collapsed}
          expandedItems={expandedItems}
          setExpandedItems={setExpandedItems}
          expandedGroups={expandedGroups}
          setExpandedGroups={setExpandedGroups}
        />
      </aside>

      <div
        className={`fixed inset-0 z-40 bg-black/40 transition lg:hidden ${
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setDrawerOpen(false)}
      />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Admin navigation"
        aria-hidden={!drawerOpen}
        tabIndex={drawerOpen ? -1 : undefined}
        data-admin-drawer
        className={`fixed left-0 top-0 z-50 flex h-dvh w-64 flex-col border-r border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 pt-6 shadow-xl transition-transform lg:hidden ${
          drawerOpen
            ? "translate-x-0"
            : "pointer-events-none invisible -translate-x-full"
        }`}
      >
        <div className="shrink-0 flex items-center justify-between">
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
        <div
          data-admin-drawer-scroll
          tabIndex={0}
          aria-label="Admin sidebar navigation"
          className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 scrollbar-hidden"
        >
          <div className="flex min-h-full flex-col">
            <AdminNavLinks
              pathname={pathname}
              currentRole={user.role}
              unreadMessagesCount={liveUnreadMessagesCount}
              expandedItems={expandedItems}
              setExpandedItems={setExpandedItems}
              expandedGroups={expandedGroups}
              setExpandedGroups={setExpandedGroups}
              onNavigate={() => setDrawerOpen(false)}
            />
            <footer
              data-admin-drawer-account
              className="mt-auto border-t border-[var(--ccr-border)] pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            >
              <UserMenu
                email={user.email}
                showEmail={false}
                showThemeLabel={false}
                compactSidebarLayout
                className="w-full"
              />
            </footer>
          </div>
        </div>
      </aside>

      <div ref={mainContentRef} className="min-w-0 flex-1">
        <header
          ref={mobileHeaderRef}
          data-admin-full-header
          className={`border-b border-[var(--ccr-border)] bg-[var(--ccr-surface)] md:sticky md:top-0 md:z-30 ${
            mobileCompactHeader ? "hidden md:block" : ""
          }`}
        >
          <div className="mx-auto flex w-full max-w-none items-center justify-between gap-1.5 py-3 pl-2 pr-3 sm:gap-2 sm:pr-5 sm:pl-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button
                type="button"
                onClick={(event) =>
                  handleMenuToggle(event.currentTarget as HTMLElement)
                }
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
                <div className="flex min-w-0 items-center gap-2 text-base font-semibold text-[var(--ccr-text)] sm:gap-4 sm:text-lg">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ccr-surface-soft)] shadow-sm sm:h-9 sm:w-9 ${ADMIN_ACCENT_RING_CLASS} ${logoGlowClass}`}
                  >
                    {activeItem.icon("h-4 w-4 text-[var(--ccr-accent)] sm:h-5 sm:w-5")}
                  </span>
                  <span className="truncate">{activeItem.label}</span>
                </div>
              ) : null}
            </div>
            <div className="md:hidden">
              <UserMenu
                email={user.email}
                showEmail={false}
                showThemeLabel={false}
                showSignOut={false}
                className="w-auto shrink-0 justify-end"
              />
            </div>
            <div className="hidden md:block">
              <UserMenu
                email={user.email}
                showEmail={false}
                showThemeLabel={false}
                className="w-auto shrink-0 justify-end"
              />
            </div>
          </div>
        </header>
        <div
          data-admin-compact-header
          className={`sticky top-0 z-30 border-b border-[var(--ccr-border)] bg-[var(--ccr-surface)] md:hidden ${
            mobileCompactHeader ? "block" : "hidden"
          }`}
        >
          <div className="mx-auto flex w-full max-w-none items-center gap-3 py-2 pl-2 pr-4 sm:pl-3 sm:pr-5">
            {activeItem ? (
              <div className="flex min-w-0 items-center gap-3 text-base font-semibold text-[var(--ccr-text)]">
                <button
                  type="button"
                  onClick={(event) =>
                    handleMenuToggle(event.currentTarget as HTMLElement)
                  }
                  aria-label="Open admin menu"
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ccr-surface-soft)] shadow-sm ${ADMIN_ACCENT_RING_CLASS} ${logoGlowClass}`}
                >
                  {activeItem.icon("h-4 w-4 text-[var(--ccr-accent)]")}
                </button>
                <span className="truncate">{activeItem.label}</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={(event) =>
                  handleMenuToggle(event.currentTarget as HTMLElement)
                }
                aria-label="Open admin menu"
                className="rounded-lg border border-[var(--ccr-border)] px-2 py-1 text-sm font-semibold text-[var(--ccr-text)]"
              >
                Menu
              </button>
            )}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
