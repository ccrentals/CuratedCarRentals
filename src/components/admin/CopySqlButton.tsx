"use client";

import { useState } from "react";

export function CopySqlButton({ text }: { text: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
      setTimeout(() => setStatus("idle"), 1500);
    } catch {
      setStatus("failed");
      setTimeout(() => setStatus("idle"), 2000);
    }
  };

  const label =
    status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : "Copy SQL";

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-lg border border-amber-200 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 transition hover:bg-amber-50"
      aria-live="polite"
    >
      {label}
    </button>
  );
}
