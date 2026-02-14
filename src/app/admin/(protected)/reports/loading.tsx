export default function AdminReportsLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="h-4 w-16 animate-pulse rounded bg-[var(--ccr-surface-soft)]" />
      <div className="mt-3 h-10 w-56 animate-pulse rounded bg-[var(--ccr-surface-soft)]" />

      <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_1.5fr_auto_auto]">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={`report-loading-filter-${index}`}
              className="h-10 animate-pulse rounded-xl bg-[var(--ccr-surface-soft)]"
            />
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={`report-loading-summary-${index}`}
            className="h-24 animate-pulse rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]"
          />
        ))}
      </div>

      <div className="mt-6 space-y-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={`report-loading-card-${index}`}
            className="h-56 animate-pulse rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]"
          />
        ))}
      </div>
    </div>
  );
}
