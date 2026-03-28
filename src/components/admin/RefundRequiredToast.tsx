"use client";

import { useEffect, useState } from "react";
import { refundRequiredStyles } from "@/lib/refundRequiredStyles";

export function RefundRequiredToast({ refundRequired }: { refundRequired: boolean }) {
  const [open, setOpen] = useState(refundRequired);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setOpen(false), 9000);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  return (
    <div data-testid="booking-refund-required-toast" className="fixed right-4 top-4 z-50 w-full max-w-sm">
      <div className={refundRequiredStyles.toastCard}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={refundRequiredStyles.toastTitle}>Refund required</p>
            <p className={refundRequiredStyles.toastDescription}>
              Refund required for this booking. Review payments and issue refund.
            </p>
          </div>
          <button
            type="button"
            data-testid="booking-refund-required-dismiss"
            aria-label="Dismiss notification"
            onClick={() => setOpen(false)}
            className={refundRequiredStyles.toastCloseButton}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
