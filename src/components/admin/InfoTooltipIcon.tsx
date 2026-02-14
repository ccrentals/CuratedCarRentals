type InfoTooltipIconProps = {
  message: string;
  className?: string;
  variant?: "info" | "unpaid" | "due_on_pickup" | "overridden" | "refunded";
};

function iconForVariant(variant: NonNullable<InfoTooltipIconProps["variant"]>) {
  if (variant === "unpaid") {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3 2.6 19.2a1 1 0 0 0 .87 1.5h17.06a1 1 0 0 0 .87-1.5L12 3Z" />
        <path d="M12 8.5v5.25" />
        <circle cx="12" cy="16.9" r="0.9" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  if (variant === "due_on_pickup") {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="8.25" />
        <path d="M12 7.8v4.55l3.1 1.8" />
      </svg>
    );
  }

  if (variant === "overridden") {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="8.25" />
        <path d="M8 16 16 8" />
      </svg>
    );
  }

  if (variant === "refunded") {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 8H4v4" />
        <path d="M4 12a8 8 0 0 0 14.4 4.8" />
        <path d="M16 16h4v-4" />
        <path d="M20 12A8 8 0 0 0 5.6 7.2" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 10.2v5.3" />
      <circle cx="12" cy="7.2" r="0.85" fill="currentColor" stroke="none" />
    </svg>
  );
}

function toneClass(variant: NonNullable<InfoTooltipIconProps["variant"]>) {
  if (variant === "unpaid") return "text-amber-300";
  if (variant === "due_on_pickup") return "text-cyan-300";
  if (variant === "overridden") return "text-rose-300";
  if (variant === "refunded") return "text-emerald-300";
  return "text-[var(--ccr-muted)]";
}

export function InfoTooltipIcon({ message, className, variant = "info" }: InfoTooltipIconProps) {
  const tone = toneClass(variant);

  return (
    <span className={`group relative inline-flex ${className ?? ""}`.trim()}>
      <button
        type="button"
        aria-label={message}
        title={message}
        className={`inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] ${tone} transition hover:text-[var(--ccr-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ccr-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--ccr-surface)]`}
      >
        {iconForVariant(variant)}
      </button>
      <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden w-56 -translate-x-1/2 rounded-md border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-2 py-1 text-[11px] font-medium normal-case text-[var(--ccr-text)] shadow-lg group-hover:block group-focus-within:block">
        {message}
      </span>
    </span>
  );
}
