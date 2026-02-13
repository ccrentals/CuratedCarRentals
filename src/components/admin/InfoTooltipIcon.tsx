type InfoTooltipIconProps = {
  message: string;
  className?: string;
};

export function InfoTooltipIcon({ message, className }: InfoTooltipIconProps) {
  return (
    <span className={`group relative inline-flex ${className ?? ""}`.trim()}>
      <button
        type="button"
        aria-label={message}
        title={message}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-amber-300/70 bg-amber-500/20 text-amber-100 shadow-[0_0_0_1px_rgba(245,158,11,0.18)_inset]"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="8.25" />
          <path d="M10 16V8h3.3a2.2 2.2 0 0 1 0 4.4H10" />
          <path d="M6 18L18 6" />
        </svg>
      </button>
      <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden w-52 -translate-x-1/2 rounded-md border border-amber-300/40 bg-[var(--ccr-surface)] px-2 py-1 text-[11px] font-medium normal-case text-amber-100 shadow-lg group-hover:block group-focus-within:block">
        {message}
      </span>
    </span>
  );
}
