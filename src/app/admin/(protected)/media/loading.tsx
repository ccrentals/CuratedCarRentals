export default function AdminMediaLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-10">
      <div className="h-8 w-52 animate-pulse rounded bg-[var(--ccr-surface-soft)]" />
      <div className="mt-3 h-4 w-full max-w-xl animate-pulse rounded bg-[var(--ccr-surface-soft)]" />
      <div className="mt-8 h-14 animate-pulse rounded-xl bg-[var(--ccr-surface-soft)]" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="h-72 animate-pulse rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]"
          />
        ))}
      </div>
    </div>
  );
}
