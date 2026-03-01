"use client";

import { useEffect, useMemo, useState } from "react";

type QuoteTemplatePreviewFrameProps = {
  quoteId: string;
  title: string;
  className?: string;
};

export function QuoteTemplatePreviewFrame({ quoteId, title, className }: QuoteTemplatePreviewFrameProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    async function loadPreview() {
      setLoading(true);
      setError(null);
      setBlobUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });

      try {
        const response = await fetch(`/api/admin/quotes/${quoteId}/pdf`, {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || "Unable to load quote preview.");
        }
        const pdfBlob = await response.blob();
        objectUrl = URL.createObjectURL(pdfBlob);
        if (!active) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setBlobUrl(objectUrl);
      } catch (requestError) {
        const message =
          requestError instanceof Error ? requestError.message : "Unable to load quote preview.";
        if (active) setError(message);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadPreview();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [quoteId]);

  const containerClassName = useMemo(
    () =>
      className ||
      "mt-4 h-[980px] w-full rounded-2xl border border-[var(--ccr-border)] bg-white",
    [className],
  );

  if (loading) {
    return (
      <div className="mt-4 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-5 text-sm text-[var(--ccr-muted)]">
        Loading quote preview...
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
        {error}
      </div>
    );
  }

  if (!blobUrl) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-5 text-sm text-[var(--ccr-muted)]">
        No quote preview available yet.
      </div>
    );
  }

  return <iframe title={title} src={blobUrl} className={containerClassName} />;
}
