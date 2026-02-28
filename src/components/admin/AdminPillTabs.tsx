import Link from "next/link";

type AdminPillTabItem = {
  key: string;
  label: string;
  href: string;
};

type AdminPillTabsProps = {
  tabs: AdminPillTabItem[];
  activeKey: string;
  ariaLabel: string;
  navTestId?: string;
  tabTestIdPrefix?: string;
};

export function AdminPillTabs({
  tabs,
  activeKey,
  ariaLabel,
  navTestId = "admin-pill-tabs",
  tabTestIdPrefix = "admin-pill-tab",
}: AdminPillTabsProps) {
  return (
    <nav
      aria-label={ariaLabel}
      data-testid={navTestId}
      className="mt-4 overflow-x-auto rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-1"
    >
      <div className="flex min-w-max items-center gap-1">
        {tabs.map((tab) => {
          const active = activeKey === tab.key;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              data-testid={`${tabTestIdPrefix}-${tab.key}`}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-3 py-2 text-xs font-semibold whitespace-nowrap transition sm:min-h-0 ${
                active
                  ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)] shadow-sm ring-1 ring-[var(--ccr-accent)]/40"
                  : "border-transparent text-[var(--ccr-text)] hover:border-[var(--ccr-border)] hover:bg-[var(--ccr-surface-soft)]"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
