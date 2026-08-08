"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Star, Trash2 } from "lucide-react";

import { buttonStyles } from "@/components/ui/Button";
import {
  getUploadcareClientErrorMessage,
  getUploadcareSignedOptions,
} from "@/lib/uploads/uploadcare-client";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

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
const MAX_IMAGE_COUNT = 20;

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
    options: {
      publicKey: string;
      multiple: boolean;
      imagesOnly: boolean;
      secureSignature: string;
      secureExpire: string;
    },
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
  multiple?: boolean;
  imagesOnly?: boolean;
}) {
  const providerResponse = await fetch("/api/admin/uploads/images", {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  const providerPayload = (await providerResponse.json().catch(() => null)) as
    | { provider?: unknown; error?: string }
    | null;
  if (!providerResponse.ok) {
    throw new Error(providerPayload?.error ?? "Unable to authorize the upload.");
  }
  if (providerPayload?.provider === "bunny") {
    return openBunnyImagesDialog(input);
  }

  const signedOptions = await getUploadcareSignedOptions();
  await loadUploadcareScript();
  window.UPLOADCARE_PUBLIC_KEY = signedOptions.publicKey;

  return new Promise<string[]>((resolve, reject) => {
    const dialog = window.uploadcare?.openDialog(null, {
      ...signedOptions,
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

function selectBrowserImages(input: { multiple?: boolean; imagesOnly?: boolean }) {
  return new Promise<File[]>((resolve) => {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.multiple = input.multiple ?? true;
    picker.accept = input.imagesOnly === false ? "*/*" : "image/jpeg,image/png,image/webp,image/heic,image/heif";
    picker.addEventListener("change", () => resolve(Array.from(picker.files ?? [])), { once: true });
    picker.addEventListener("cancel", () => resolve([]), { once: true });
    picker.click();
  });
}

async function openBunnyImagesDialog(input: { multiple?: boolean; imagesOnly?: boolean }) {
  const files = await selectBrowserImages(input);
  if (files.length === 0) return [];

  const csrfToken = await ensureCsrfToken();
  if (!csrfToken) throw new Error("Unable to secure the upload. Refresh the page and try again.");
  const form = new FormData();
  form.set("csrfToken", csrfToken);
  for (const file of files) form.append("files", file, file.name);
  const response = await fetch("/api/admin/uploads/images", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    credentials: "include",
    body: form,
  });
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; items?: Array<{ url?: unknown }> }
    | null;
  if (!response.ok || !Array.isArray(payload?.items)) {
    throw new Error(payload?.error ?? "Unable to upload images.");
  }
  return payload.items
    .map((item) => (typeof item.url === "string" ? item.url : ""))
    .filter(Boolean);
}

export function mergeUploadcareImageUrls(
  currentUrls: readonly string[],
  uploadedUrls: readonly string[],
  maxCount = MAX_IMAGE_COUNT,
) {
  return Array.from(new Set([...currentUrls, ...uploadedUrls])).slice(0, maxCount);
}

export function moveUploadcareImage(
  urls: readonly string[],
  fromIndex: number,
  toIndex: number,
) {
  if (
    fromIndex < 0 ||
    fromIndex >= urls.length ||
    toIndex < 0 ||
    toIndex >= urls.length ||
    fromIndex === toIndex
  ) {
    return [...urls];
  }
  const next = [...urls];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function setPrimaryUploadcareImage(urls: readonly string[], targetIndex: number) {
  return moveUploadcareImage(urls, targetIndex, 0);
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
  const [message, setMessage] = useState<string | null>(null);
  const [failedPreviewUrls, setFailedPreviewUrls] = useState<string[]>([]);
  const lightboxRef = useRef<GlightboxInstance | null>(null);

  const urls = value ?? internal;
  const setUrls = onChange ?? ((nextUrls: string[]) => setInternal(nextUrls));
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
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const nextUrls = await openUploadcareImagesDialog({
        multiple: true,
        imagesOnly: true,
      });
      const mergedUrls = mergeUploadcareImageUrls(urls, nextUrls);
      setUrls(mergedUrls);
      setCurrentIndex(Math.max(0, mergedUrls.length - nextUrls.length));
      destroyLightbox();
      setMessage(
        nextUrls.length === 1
          ? "1 image uploaded and ready to save."
          : `${nextUrls.length} images uploaded and ready to save.`,
      );
      setLoading(false);
    } catch (err) {
      setError(getUploadcareClientErrorMessage(err));
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

  const moveUrl = (fromIndex: number, toIndex: number) => {
    setUrls(moveUploadcareImage(urls, fromIndex, toIndex));
    setCurrentIndex(toIndex);
    destroyLightbox();
    setMessage("Gallery order updated. Save changes to publish the new order.");
  };

  const setPrimaryUrl = (targetIndex: number) => {
    setUrls(setPrimaryUploadcareImage(urls, targetIndex));
    setCurrentIndex(0);
    destroyLightbox();
    setMessage("Primary image updated. Save changes to publish it.");
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
          {loading ? "Uploading..." : disabled ? "View mode" : "Upload Images"}
        </button>
      </div>

      {name ? (
        <input type="hidden" name={name} value={JSON.stringify(urls)} />
      ) : null}

      {message ? (
        <p className="mt-3 rounded-lg border border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] px-3 py-2 text-xs text-[var(--ccr-status-success-text)]">
          {message}
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-[var(--ccr-status-danger-border)] bg-[var(--ccr-status-danger-bg)] px-3 py-2 text-xs text-[var(--ccr-status-danger-text)]">
          {error}
        </p>
      ) : null}

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
                    className={`relative shrink-0 overflow-hidden rounded-md border ${
                      index === activeIndex
                        ? "border-[var(--ccr-accent)]"
                        : "border-[var(--ccr-border)]"
                    }`}
                  >
                    {index === 0 ? (
                      <span className="absolute left-1 top-1 z-10 rounded bg-[var(--ccr-accent)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-black">
                        Primary
                      </span>
                    ) : null}
                    {failedPreviewUrls.includes(url) ? (
                      <span className="flex h-14 w-20 items-center justify-center px-2 text-center text-[10px] text-[var(--ccr-muted)]">
                        Preview unavailable
                      </span>
                    ) : (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={`Vehicle thumbnail ${index + 1}`}
                          onError={() =>
                            setFailedPreviewUrls((current) =>
                              current.includes(url) ? current : [...current, url],
                            )
                          }
                          className="h-14 w-20 object-cover"
                        />
                      </>
                    )}
                  </button>
                ))}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {!disabled ? (
                  <>
                    <button
                      type="button"
                      onClick={() => moveUrl(activeIndex, activeIndex - 1)}
                      disabled={activeIndex === 0}
                      aria-label="Move image left"
                      title="Move image left"
                      className={buttonStyles({ variant: "secondary", size: "xs" })}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveUrl(activeIndex, activeIndex + 1)}
                      disabled={activeIndex >= urls.length - 1}
                      aria-label="Move image right"
                      title="Move image right"
                      className={buttonStyles({ variant: "secondary", size: "xs" })}
                    >
                      <ChevronRight size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPrimaryUrl(activeIndex)}
                      disabled={activeIndex === 0}
                      aria-label="Set as primary image"
                      title="Set as primary image"
                      className={buttonStyles({ variant: "secondary", size: "xs" })}
                    >
                      <Star size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeUrlAtIndex(activeIndex)}
                      aria-label="Remove image"
                      title="Remove image"
                      className={buttonStyles({ variant: "secondary", size: "xs" })}
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                ) : null}
                {actionSlot}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {urls.map((url, index) => (
              <div key={`${url}-${index}`} className="relative overflow-hidden rounded-lg border border-[var(--ccr-border)]">
                {index === 0 ? (
                  <span className="absolute left-2 top-2 z-10 rounded bg-[var(--ccr-accent)] px-2 py-1 text-[10px] font-bold uppercase text-black">
                    Primary
                  </span>
                ) : null}
                {failedPreviewUrls.includes(url) ? (
                  <div className="flex h-24 items-center justify-center bg-[var(--ccr-surface)] px-3 text-center text-xs text-[var(--ccr-muted)]">
                    Preview unavailable
                  </div>
                ) : (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt="Vehicle upload"
                      onError={() =>
                        setFailedPreviewUrls((current) =>
                          current.includes(url) ? current : [...current, url],
                        )
                      }
                      className="h-24 w-full object-cover"
                    />
                  </>
                )}
                {!disabled ? (
                  <div className="grid grid-cols-4 border-t border-[var(--ccr-border)]">
                    <button
                      type="button"
                      onClick={() => moveUrl(index, index - 1)}
                      disabled={index === 0}
                      aria-label={`Move image ${index + 1} left`}
                      title="Move image left"
                      className={buttonStyles({
                        variant: "secondary",
                        size: "xs",
                        className: "w-full rounded-none border-0",
                      })}
                    >
                      <ChevronLeft size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveUrl(index, index + 1)}
                      disabled={index >= urls.length - 1}
                      aria-label={`Move image ${index + 1} right`}
                      title="Move image right"
                      className={buttonStyles({
                        variant: "secondary",
                        size: "xs",
                        className: "w-full rounded-none border-0",
                      })}
                    >
                      <ChevronRight size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPrimaryUrl(index)}
                      disabled={index === 0}
                      aria-label={`Set image ${index + 1} as primary`}
                      title="Set as primary image"
                      className={buttonStyles({
                        variant: "secondary",
                        size: "xs",
                        className: "w-full rounded-none border-0",
                      })}
                    >
                      <Star size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeUrlAtIndex(index)}
                      aria-label={`Remove image ${index + 1}`}
                      title="Remove image"
                      className={buttonStyles({
                        variant: "secondary",
                        size: "xs",
                        className: "w-full rounded-none border-0",
                      })}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ) : null}
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
