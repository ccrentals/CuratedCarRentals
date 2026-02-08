"use client";

import { useEffect, useMemo, useState } from "react";

type UploadcareImagesInputProps = {
  label?: string;
  helperText?: string;
  name?: string;
  value?: string[];
  onChange?: (urls: string[]) => void;
};

declare global {
  interface Window {
    uploadcare?: any;
    UPLOADCARE_PUBLIC_KEY?: string;
  }
}

const WIDGET_SRC = "https://ucarecdn.com/libs/widget/3.x/uploadcare.full.min.js";

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

async function resolveUploadcareUrls(file: any) {
  if (!file) return [];
  if (typeof file.files === "function") {
    const files = file.files();
    const infos = await Promise.all(
      files.map((entry: any) =>
        typeof entry.promise === "function"
          ? entry.promise()
          : new Promise((resolve) => entry.done(resolve)),
      ),
    );
    return infos
      .map((info: any) => info?.cdnUrl)
      .filter((url: string | undefined) => typeof url === "string");
  }

  if (typeof file.promise === "function") {
    const info = await file.promise();
    return info?.cdnUrl ? [info.cdnUrl] : [];
  }

  if (typeof file.done === "function") {
    const info = await new Promise((resolve) => file.done(resolve));
    return (info as any)?.cdnUrl ? [(info as any).cdnUrl] : [];
  }

  return [];
}

export function UploadcareImagesInput({
  label = "Vehicle Images",
  helperText = "Upload multiple photos. Drag order in the list to reorder later if needed.",
  name,
  value,
  onChange,
}: UploadcareImagesInputProps) {
  const [internal, setInternal] = useState<string[]>(value ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urls = value ?? internal;
  const setUrls = onChange ?? setInternal;
  const publicKey = process.env.NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY ?? "";

  useEffect(() => {
    if (value) setInternal(value);
  }, [value]);

  const canUpload = useMemo(() => Boolean(publicKey), [publicKey]);

  const handleUpload = async () => {
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
      dialog.done(async (file: any) => {
        const nextUrls = await resolveUploadcareUrls(file);
        setUrls(nextUrls);
        setLoading(false);
      });
      dialog.fail((err: any) => {
        setError(err?.message ?? "Upload cancelled.");
        setLoading(false);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setLoading(false);
    }
  };

  const removeUrl = (target: string) => {
    setUrls(urls.filter((url) => url !== target));
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
          disabled={loading}
          className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
        >
          {loading ? "Opening..." : "Upload Images"}
        </button>
      </div>

      {name ? (
        <input type="hidden" name={name} value={JSON.stringify(urls)} />
      ) : null}

      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}

      {urls.length > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {urls.map((url) => (
            <div key={url} className="overflow-hidden rounded-lg border border-[var(--ccr-border)]">
              <img src={url} alt="Vehicle upload" className="h-24 w-full object-cover" />
              <button
                type="button"
                onClick={() => removeUrl(url)}
                className="w-full border-t border-[var(--ccr-border)] bg-white px-2 py-1 text-xs font-semibold text-[var(--ccr-text)] hover:bg-[var(--ccr-surface)]"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-[var(--ccr-muted)]">No images uploaded yet.</p>
      )}
    </div>
  );
}
