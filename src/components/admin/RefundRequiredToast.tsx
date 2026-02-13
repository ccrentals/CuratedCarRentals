"use client";

import { useEffect, useState } from "react";

export function RefundRequiredToast({ refundRequired }: { refundRequired: boolean }) {
  const [open, setOpen] = useState(refundRequired);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setOpen(false), 9000);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed right-4 top-4 z-50 w-full max-w-sm">
      <div className="rounded-2xl border border-amber-400/40 bg-amber-500/15 p-4 shadow-2xl backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-amber-100">Refund required</p>
            <p className="mt-1 text-xs text-amber-100/80">
              Refund required for this booking. Review payments and issue refund.
            </p>
          </div>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => setOpen(false)}
            className="rounded-lg border border-amber-400/30 bg-transparent px-2 py-1 text-xs font-semibold text-amber-100 hover:border-amber-300/60"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
