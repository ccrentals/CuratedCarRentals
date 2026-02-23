"use client";

import { type ReactNode, useMemo, useState } from "react";

type UploadcareImagesInputProps = {
  label?: string;
  helperText?: string;
  name?: string;
  value?: string[];
  onChange?: (urls: string[]) => void;
  displayMode?: "grid" | "carousel";
  disabled?: boolean;
  actionSlot?: ReactNode;
};

declare global {
  interface Window {
    uploadcare?: UploadcareApi;
    UPLOADCARE_PUBLIC_KEY?: string;
  }
}

const WIDGET_SRC = "https://ucarecdn.com/libs/widget/3.x/uploadcare.full.min.js";

type UploadcareFileInfo = {
  cdnUrl?: string;
};

type UploadcareSingleFile = {
  promise?: () => Promise<UploadcareFileInfo>;
  done?: (callback: (file: UploadcareFileInfo) => void) => void;
};

type UploadcareFileGroup = {
  files: () => UploadcareSingleFile[];
};

type UploadcareDialog = {
  done: (callback: (file: UploadcareSingleFile | UploadcareFileGroup) => void) => void;
  fail: (callback: (error: { message?: string }) => void) => void;
};

type UploadcareApi = {
  openDialog: (
    _file: null,
    options: { publicKey: string; multiple: boolean; imagesOnly: boolean },
  ) => UploadcareDialog | null;
};

function resolveWithDone<T>(entry: { done?: (callback: (value: T) => void) => void }) {
  return new Promise<T>((resolve) => {
    entry.done?.(resolve);
  });
}

function isUploadcareGroup(file: UploadcareSingleFile | UploadcareFileGroup): file is UploadcareFileGroup {
  return "files" in file && typeof file.files === "function";
}

function hasUploadcarePromise(
  file: UploadcareSingleFile | UploadcareFileGroup,
): file is UploadcareSingleFile & { promise: () => Promise<UploadcareFileInfo> } {
  return typeof (file as UploadcareSingleFile).promise === "function";
}

function hasUploadcareDone(
  file: UploadcareSingleFile | UploadcareFileGroup,
): file is UploadcareSingleFile & {
  done: (callback: (file: UploadcareFileInfo) => void) => void;
} {
  return typeof (file as UploadcareSingleFile).done === "function";
}

function loadUploadcareScript() {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.uploadcare) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${WIDGET_SRC}"]`);
  if (existing) {
    return new Promise<void>((resolve, reject) => {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Uploadcare failed to load")));
    });
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = WIDGET_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Uploadcare failed to load"));
    document.body.appendChild(script);
  });
}

async function resolveUploadcareUrls(file: UploadcareSingleFile | UploadcareFileGroup | null) {
  if (!file) return [];
  if (isUploadcareGroup(file)) {
    const files = file.files();
    const infos = await Promise.all(
      files.map((entry) =>
        typeof entry.promise === "function"
          ? entry.promise()
          : resolveWithDone<UploadcareFileInfo>(entry),
      ),
    );
    return infos
      .map((info) => info?.cdnUrl)
      .filter((url: string | undefined) => typeof url === "string");
  }

  if (hasUploadcarePromise(file)) {
    const info = await file.promise();
    return info?.cdnUrl ? [info.cdnUrl] : [];
  }

  if (hasUploadcareDone(file)) {
    const info = await resolveWithDone<UploadcareFileInfo>(file);
    return info?.cdnUrl ? [info.cdnUrl] : [];
  }

  return [];
}

export function UploadcareImagesInput({
  label = "Vehicle Images",
  helperText = "Upload multiple photos. Drag order in the list to reorder later if needed.",
  name,
  value,
  onChange,
  displayMode = "grid",
  disabled = false,
  actionSlot = null,
}: UploadcareImagesInputProps) {
  const [internal, setInternal] = useState<string[]>(() => value ?? []);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urls = value ?? internal;
  const setUrls = onChange ?? ((nextUrls: string[]) => setInternal(nextUrls));
  const publicKey = process.env.NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY ?? "";

  const canUpload = useMemo(() => Boolean(publicKey), [publicKey]);

  const handleUpload = async () => {
    if (disabled) return;
    if (!canUpload) {
      setError("Uploadcare is not configured. Add NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await loadUploadcareScript();
      window.UPLOADCARE_PUBLIC_KEY = publicKey;
      const dialog = window.uploadcare?.openDialog(null, {
        publicKey,
        multiple: true,
        imagesOnly: true,
      });
      if (!dialog) {
        setError("Unable to open upload dialog.");
        setLoading(false);
        return;
      }
      dialog.done(async (file) => {
        const nextUrls = await resolveUploadcareUrls(file);
        setUrls(nextUrls);
        setCurrentIndex(0);
        setIsLightboxOpen(false);
        setLoading(false);
      });
      dialog.fail((err) => {
        setError(err?.message ?? "Upload cancelled.");
        setLoading(false);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setLoading(false);
    }
  };

  const removeUrlAtIndex = (targetIndex: number) => {
    const nextUrls = urls.filter((_, index) => index !== targetIndex);
    setUrls(nextUrls);
    if (nextUrls.length === 0) {
      setCurrentIndex(0);
      setIsLightboxOpen(false);
      return;
    }
    setCurrentIndex((index) => Math.min(index, nextUrls.length - 1));
  };

  const activeIndex = urls.length === 0 ? 0 : Math.min(currentIndex, urls.length - 1);
  const activeUrl = urls[activeIndex];
  const canNavigate = urls.length > 1;

  const goPrev = () => {
    setCurrentIndex((index) => {
      const safe = Math.min(index, urls.length - 1);
      return safe === 0 ? urls.length - 1 : safe - 1;
    });
  };

  const goNext = () => {
    setCurrentIndex((index) => {
      const safe = Math.min(index, urls.length - 1);
      return safe === urls.length - 1 ? 0 : safe + 1;
    });
  };

  return (
    <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--ccr-text)]">{label}</p>
          <p className="text-xs text-[var(--ccr-muted)]">{helperText}</p>
        </div>
        <button
          type="button"
          onClick={handleUpload}
          disabled={loading || disabled}
          className="min-h-10 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
        >
          {loading ? "Opening..." : disabled ? "View mode" : "Upload Images"}
        </button>
      </div>

      {name ? (
        <input type="hidden" name={name} value={JSON.stringify(urls)} />
      ) : null}

      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}

      {urls.length > 0 ? (
        displayMode === "carousel" ? (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-[var(--ccr-muted)]">
              Click a thumbnail to open the large carousel view.
            </p>
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 gap-2 overflow-x-auto pr-2">
                {urls.map((url, index) => (
                  <button
                    key={`${url}-${index}`}
                    type="button"
                    onClick={() => {
                      setCurrentIndex(index);
                      setIsLightboxOpen(true);
                    }}
                    aria-label={`Open image ${index + 1}`}
                    className={`shrink-0 overflow-hidden rounded-md border ${
                      index === activeIndex
                        ? "border-[var(--ccr-accent)]"
                        : "border-[var(--ccr-border)]"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Vehicle thumbnail ${index + 1}`} className="h-14 w-20 object-cover" />
                  </button>
                ))}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {!disabled ? (
                  <button
                    type="button"
                    onClick={() => removeUrlAtIndex(activeIndex)}
                    className="min-h-10 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ccr-text)] hover:bg-[var(--ccr-surface-soft)]"
                  >
                    Remove
                  </button>
                ) : null}
                {actionSlot}
              </div>
            </div>

            {isLightboxOpen ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
                <button
                  type="button"
                  aria-label="Close image viewer"
                  onClick={() => setIsLightboxOpen(false)}
                  className="absolute inset-0"
                />
                <div className="relative z-10 w-full max-w-5xl rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3 shadow-2xl">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-[var(--ccr-muted)]">
                      Image {activeIndex + 1} of {urls.length}
                    </p>
                    <div className="flex items-center gap-2">
                      {!disabled ? (
                        <button
                          type="button"
                          onClick={() => removeUrlAtIndex(activeIndex)}
                          className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--ccr-text)] hover:bg-[var(--ccr-surface)]"
                        >
                          Remove
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setIsLightboxOpen(false)}
                        className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--ccr-text)] hover:bg-[var(--ccr-surface)]"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                  <div className="relative overflow-hidden rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={activeUrl}
                      alt={`Vehicle upload ${activeIndex + 1}`}
                      className="h-[60vh] w-full object-contain"
                    />
                    {canNavigate ? (
                      <>
                        <button
                          type="button"
                          onClick={goPrev}
                          aria-label="Previous image"
                          className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full border border-[var(--ccr-border)] bg-black/45 px-3 py-1 text-sm font-bold text-white hover:bg-black/65"
                        >
                          ‹
                        </button>
                        <button
                          type="button"
                          onClick={goNext}
                          aria-label="Next image"
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-[var(--ccr-border)] bg-black/45 px-3 py-1 text-sm font-bold text-white hover:bg-black/65"
                        >
                          ›
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {urls.map((url, index) => (
              <div key={`${url}-${index}`} className="overflow-hidden rounded-lg border border-[var(--ccr-border)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="Vehicle upload" className="h-24 w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeUrlAtIndex(index)}
                  disabled={disabled}
                  className="w-full border-t border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-2 py-1 text-xs font-semibold text-[var(--ccr-text)] hover:bg-[var(--ccr-surface-soft)] disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )
      ) : (
        <p className="mt-3 text-xs text-[var(--ccr-muted)]">No images uploaded yet.</p>
      )}
    </div>
  );
}
