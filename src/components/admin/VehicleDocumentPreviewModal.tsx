"use client";

import { useEffect, useMemo, useState } from "react";

export type VehicleDocumentPreviewItem = {
  id: string;
  title: string;
  label?: string | null;
  documentType?: string | null;
  mimeType?: string | null;
  canDownload?: boolean;
  checklistItemLabel?: string | null;
};

type VehicleDocumentPreviewModalProps = {
  vehicleId: string;
  document: VehicleDocumentPreviewItem;
  onClose: () => void;
  modalTestId?: string;
  metaTestId?: string;
};

export function getVehicleDocumentDisplayLabel(
  item: Pick<VehicleDocumentPreviewItem, "label" | "title">,
) {
  const label = item.label?.trim();
  return label ? label : item.title;
}

export function VehicleDocumentPreviewModal({
  vehicleId,
  document,
  onClose,
  modalTestId = "vehicle-document-preview-modal",
  metaTestId = "vehicle-document-preview-meta",
}: VehicleDocumentPreviewModalProps) {
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [resolvedMimeType, setResolvedMimeType] = useState<string | null>(document.mimeType ?? null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    const loadPreview = async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      setPreviewBlobUrl(null);
      setResolvedMimeType(document.mimeType ?? null);

      try {
        const response = await fetch(
          `/api/admin/vehicles/${vehicleId}/documents/${document.id}/file?inline=1`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Unable to preview this file.");
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setPreviewBlobUrl(objectUrl);
          setResolvedMimeType(blob.type || document.mimeType || null);
          setPreviewLoading(false);
        }
      } catch (requestError) {
        if (!cancelled) {
          setPreviewError(
            requestError instanceof Error ? requestError.message : "Unable to preview this file.",
          );
          setPreviewLoading(false);
        }
      }
    };

    void loadPreview();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [document.id, document.mimeType, vehicleId]);

  const metaText = useMemo(() => {
    const parts = [
      document.documentType?.trim() || null,
      document.label?.trim() ? document.title : null,
      document.checklistItemLabel ? `Checklist: ${document.checklistItemLabel}` : null,
    ].filter((value): value is string => Boolean(value));

    return parts.length > 0 ? parts.join(" · ") : "Linked vehicle file";
  }, [document.checklistItemLabel, document.documentType, document.label, document.title]);

  return (
    <div
      data-testid={modalTestId}
      className="fixed inset-0 z-50 bg-black/70 p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--ccr-border)] px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--ccr-text)]">
              {getVehicleDocumentDisplayLabel(document)}
            </p>
            <p data-testid={metaTestId} className="truncate text-xs text-[var(--ccr-muted)]">
              {metaText}
            </p>
          </div>
          <div className="flex gap-2">
            {document.canDownload !== false ? (
              <a
                href={`/api/admin/vehicles/${vehicleId}/documents/${document.id}/download`}
                className="inline-flex min-h-9 items-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]"
              >
                Download
              </a>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="min-h-9 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]"
            >
              Close
            </button>
          </div>
        </div>

        <div className="h-full min-h-[420px] w-full overflow-auto bg-[var(--ccr-surface-soft)]">
          {previewLoading ? (
            <p className="px-4 py-4 text-sm text-[var(--ccr-muted)]">Loading preview...</p>
          ) : null}

          {!previewLoading && previewError ? (
            <div className="px-4 py-6 text-sm text-red-300">{previewError}</div>
          ) : null}

          {!previewLoading && !previewError && previewBlobUrl ? (
            resolvedMimeType?.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewBlobUrl}
                alt={document.title}
                className="max-h-[78vh] w-full object-contain"
              />
            ) : (
              <iframe
                title={`Preview ${document.title}`}
                src={previewBlobUrl}
                className="h-[78vh] w-full"
              />
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
