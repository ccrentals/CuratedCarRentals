"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buttonStyles } from "@/components/ui/Button";

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

type GlightboxInstance = {
  destroy: () => void;
  openAt: (index: number) => void;
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

export function loadUploadcareScript() {
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

export async function resolveUploadcareUrls(file: UploadcareSingleFile | UploadcareFileGroup | null) {
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

export async function openUploadcareImagesDialog(input: {
  publicKey: string;
  multiple?: boolean;
  imagesOnly?: boolean;
}) {
  const publicKey = input.publicKey.trim();
  if (!publicKey) {
    throw new Error("Uploadcare is not configured. Add NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY.");
  }

  await loadUploadcareScript();
  window.UPLOADCARE_PUBLIC_KEY = publicKey;

  return new Promise<string[]>((resolve, reject) => {
    const dialog = window.uploadcare?.openDialog(null, {
      publicKey,
      multiple: input.multiple ?? true,
      imagesOnly: input.imagesOnly ?? true,
    });

    if (!dialog) {
      reject(new Error("Unable to open upload dialog."));
      return;
    }

    dialog.done(async (file) => {
      try {
        const urls = await resolveUploadcareUrls(file);
        resolve(urls);
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Upload failed."));
      }
    });
    dialog.fail((error) => {
      reject(new Error(error?.message ?? "Upload cancelled."));
    });
  });
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lightboxRef = useRef<GlightboxInstance | null>(null);

  const urls = value ?? internal;
  const setUrls = onChange ?? ((nextUrls: string[]) => setInternal(nextUrls));
  const publicKey = process.env.NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY ?? "";

  const canUpload = useMemo(() => Boolean(publicKey), [publicKey]);

  const destroyLightbox = useCallback(() => {
    if (!lightboxRef.current) return;
    lightboxRef.current.destroy();
    lightboxRef.current = null;
  }, []);

  useEffect(
    () => () => {
      destroyLightbox();
    },
    [destroyLightbox],
  );

  const openLightbox = useCallback(
    async (startIndex: number) => {
      if (urls.length < 1) return;
      const boundedIndex = Math.max(0, Math.min(urls.length - 1, Math.trunc(startIndex)));
      const elements = urls.map((href, index) => ({
        href,
        type: "image" as const,
        title: label,
        description: `${index + 1} of ${urls.length}`,
      }));

      try {
        const glightboxModule = await import("glightbox");
        const createGlightbox = ((glightboxModule as unknown as { default?: unknown }).default ??
          glightboxModule) as unknown as (options: Record<string, unknown>) => GlightboxInstance;

        destroyLightbox();
        const instance = createGlightbox({
          elements,
          loop: urls.length > 1,
          touchNavigation: true,
          keyboardNavigation: true,
          closeOnOutsideClick: true,
          closeButton: true,
          openEffect: "slide",
          closeEffect: "fade",
          slideEffect: "slide",
          moreLength: 0,
          draggable: true,
          zoomable: true,
          skin: "clean",
        });
        lightboxRef.current = instance;
        instance.openAt(boundedIndex);
      } catch {
        setError("Unable to open image gallery. Please try again.");
      }
    },
    [destroyLightbox, label, urls],
  );

  const handleUpload = async () => {
    if (disabled) return;
    if (!canUpload) {
      setError("Uploadcare is not configured. Add NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextUrls = await openUploadcareImagesDialog({
        publicKey,
        multiple: true,
        imagesOnly: true,
      });
      setUrls(nextUrls);
      setCurrentIndex(0);
      destroyLightbox();
      setLoading(false);
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
      destroyLightbox();
      return;
    }
    setCurrentIndex((index) => Math.min(index, nextUrls.length - 1));
  };

  const activeIndex = urls.length === 0 ? 0 : Math.min(currentIndex, urls.length - 1);

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
          className={buttonStyles({ variant: "secondary", size: "sm" })}
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
                      void openLightbox(index);
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
                    className={buttonStyles({ variant: "secondary", size: "sm" })}
                  >
                    Remove
                  </button>
                ) : null}
                {actionSlot}
              </div>
            </div>
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
                  className={buttonStyles({
                    variant: "secondary",
                    size: "xs",
                    className: "w-full rounded-none border-x-0 border-b-0 border-t",
                  })}
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
