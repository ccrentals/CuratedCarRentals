"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ensureCsrfToken } from "@/lib/security/csrf-client";

type DocumentationEditorProps = {
  initialContent: string;
  disabled?: boolean;
};

export function DocumentationEditor({ initialContent, disabled }: DocumentationEditorProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!content.trim()) {
      setError("Please enter documentation notes.");
      return;
    }

    setSaving(true);
    setMessage(null);
    setError(null);

    const csrfToken = await ensureCsrfToken();
    const response = await fetch("/api/admin/docs", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({ content }),
    });

    setSaving(false);

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.message ?? data.error ?? "Failed to update documentation.");
      return;
    }

    setMessage("Documentation updated.");
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
        className="rounded-xl border border-[var(--ccr-border)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
      >
        {open ? "Close editor" : "Edit notes"}
      </button>

      {open ? (
        <div className="mt-3">
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={8}
            className="w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            placeholder="Add or update documentation notes..."
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save notes"}
            </button>
            {message ? <p className="text-xs text-green-700">{message}</p> : null}
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
