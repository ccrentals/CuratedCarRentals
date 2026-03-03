export default function AdminLoading() {
  return (
    <div className="min-h-[100svh] w-full bg-[var(--ccr-bg)] text-[var(--ccr-text)]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-10">
        <div className="flex items-center gap-3">
          <span
            className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--ccr-border)] border-t-[var(--ccr-accent)]"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold text-[var(--ccr-muted)]">Loading admin…</p>
        </div>

        <div className="h-4 w-24 animate-pulse rounded bg-[var(--ccr-surface-soft)]" />
        <div className="h-10 w-56 animate-pulse rounded-xl bg-[var(--ccr-surface-soft)]" />

        <div className="mt-2 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={`admin-loading-filter-${index}`}
                className="h-11 animate-pulse rounded-xl bg-[var(--ccr-surface-soft)]"
              />
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={`admin-loading-card-${index}`}
              className="h-40 animate-pulse rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
