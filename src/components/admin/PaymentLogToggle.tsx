"use client";

import { useState } from "react";

export default function PaymentLogToggle({ log }: { log: string }) {
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  if (!log) {
    return <span className="text-xs text-[var(--ccr-muted)]">No log</span>;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(log);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1500);
    } catch {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 1500);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-2 py-1 text-xs font-semibold text-[var(--ccr-text)]"
        >
          {open ? "Hide log" : "View log"}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-2 py-1 text-xs font-semibold text-[var(--ccr-text)]"
        >
          {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy log"}
        </button>
      </div>
      {open ? (
        <pre className="max-h-48 w-full overflow-auto rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-2 text-[11px] text-[var(--ccr-muted)]">
          {log}
        </pre>
      ) : null}
    </div>
  );
}
