"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

import { LandingContentAddItemDialog } from "@/components/admin/LandingContentAddItemDialog";
import { buttonStyles } from "@/components/ui/Button";
import type { LandingContent } from "@/lib/landingContent";
import {
  MAX_LANDING_EDITOR_ITEMS,
  type LandingEditableValue as EditableValue,
} from "@/lib/landingContentEditor";
import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { openUploadcareImagesDialog } from "@/components/admin/UploadcareImagesInput";

type LandingContentManagerProps = {
  initialContent: LandingContent;
  defaultContent: LandingContent;
  updatedAt: string | null;
  updatedByEmail: string | null;
  source: "db" | "default";
};

type LandingContentPageKey = Exclude<keyof LandingContent, "global">;

type LandingContentPayload = {
  ok?: boolean;
  content?: LandingContent;
  updatedAt?: string | null;
  updatedByEmail?: string | null;
  source?: "db" | "default";
  message?: string;
  error?: string;
};

const PAGE_TABS: Array<{ key: LandingContentPageKey; label: string }> = [
  { key: "home", label: "Home" },
  { key: "fleet", label: "Fleet" },
  { key: "services", label: "Services" },
  { key: "touristDestinations", label: "Tourist Destinations" },
  { key: "driving", label: "Driving in Jamaica" },
  { key: "about", label: "About" },
  { key: "contact", label: "Contact" },
  { key: "rentalPolicies", label: "Rental Policies" },
];

const GLOBAL_TAB = { key: "global", label: "Global Header/Footer" } as const;

function labelize(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isRecord(value: EditableValue): value is { [key: string]: EditableValue } {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isImagePathKey(key: string) {
  const normalized = key.toLowerCase();
  return normalized === "src" || normalized === "imagesrc" || normalized === "avatar";
}

function getValueAtPath(root: EditableValue, path: Array<string | number>): EditableValue {
  let current = root;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === "number") {
      current = current[segment];
      continue;
    }
    if (isRecord(current) && typeof segment === "string") {
      current = current[segment];
      continue;
    }
    return null;
  }
  return current;
}

function setValueAtPath(
  root: EditableValue,
  path: Array<string | number>,
  value: EditableValue,
): EditableValue {
  if (path.length === 0) return value;
  const [head, ...tail] = path;

  if (Array.isArray(root)) {
    const next = [...root];
    if (typeof head === "number") {
      next[head] = setValueAtPath(next[head], tail, value);
    }
    return next;
  }

  if (isRecord(root)) {
    return {
      ...root,
      [head]: setValueAtPath(root[String(head)] ?? null, tail, value),
    };
  }

  return root;
}

function removeArrayItemAtPath(
  root: EditableValue,
  path: Array<string | number>,
  index: number,
): EditableValue {
  const value = getValueAtPath(root, path);
  if (!Array.isArray(value)) return root;
  return setValueAtPath(root, path, value.filter((_, itemIndex) => itemIndex !== index));
}

function appendArrayItemAtPath(
  root: EditableValue,
  path: Array<string | number>,
  item: EditableValue,
): EditableValue {
  const value = getValueAtPath(root, path);
  if (!Array.isArray(value)) return root;
  return setValueAtPath(root, path, [...value, item]);
}

function FieldShell({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block min-w-0 text-sm font-medium text-[var(--ccr-text)] ${className}`}>
      <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ccr-muted)]">
        {label}
      </span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

function LandingFieldEditor({
  fieldKey,
  value,
  path,
  onChange,
  onUploadImage,
  onAddArrayItem,
  onRemoveArrayItem,
}: {
  fieldKey: string;
  value: EditableValue;
  path: Array<string | number>;
  onChange: (path: Array<string | number>, value: EditableValue) => void;
  onUploadImage: (path: Array<string | number>) => void;
  onAddArrayItem: (path: Array<string | number>) => void;
  onRemoveArrayItem: (path: Array<string | number>, index: number) => void;
}) {
  if (typeof value === "string") {
    const multiline = value.length > 80 || /description|paragraph|quote|note|intro|support/i.test(fieldKey);
    const isImage = isImagePathKey(fieldKey);
    return (
      <FieldShell label={labelize(fieldKey)}>
        {isImage && value ? (
          <div className="mb-3 overflow-hidden rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)]">
            <div className="relative h-40">
              <Image
                src={value}
                alt=""
                fill
                sizes="360px"
                className="object-cover"
                unoptimized={!value.startsWith("/")}
              />
            </div>
          </div>
        ) : null}
        {multiline ? (
          <textarea
            value={value}
            rows={4}
            onChange={(event) => onChange(path, event.target.value)}
            className="w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] transition focus:ring-2"
          />
        ) : (
          <input
            value={value}
            onChange={(event) => onChange(path, event.target.value)}
            className="w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] transition focus:ring-2"
          />
        )}
        {isImage ? (
          <button
            type="button"
            onClick={() => onUploadImage(path)}
            className="mt-2 rounded-full border border-[var(--ccr-border)] px-3 py-1.5 text-xs font-semibold text-[var(--ccr-text)] transition hover:bg-[var(--ccr-surface-soft)]"
          >
            Upload image
          </button>
        ) : null}
      </FieldShell>
    );
  }

  if (typeof value === "number") {
    return (
      <FieldShell label={labelize(fieldKey)}>
        <input
          type="number"
          value={value}
          onChange={(event) => onChange(path, Number(event.target.value))}
          className="w-full rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-sm text-[var(--ccr-text)] outline-none ring-[var(--ccr-accent)] transition focus:ring-2"
        />
      </FieldShell>
    );
  }

  if (Array.isArray(value)) {
    return (
      <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)]/45 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-[var(--ccr-text)]">{labelize(fieldKey)}</h4>
          <button
            type="button"
            onClick={() => onAddArrayItem(path)}
            disabled={value.length >= MAX_LANDING_EDITOR_ITEMS}
            aria-haspopup="dialog"
            data-testid={`landing-add-item-${path.map(String).join("-")}`}
            className="rounded-full border border-[var(--ccr-border)] px-3 py-1.5 text-xs font-semibold text-[var(--ccr-text)] transition hover:bg-[var(--ccr-surface)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {value.length >= MAX_LANDING_EDITOR_ITEMS ? "Item limit reached" : "Add item"}
          </button>
        </div>
        <div className="mt-4 space-y-4">
          {value.map((item, index) => (
            <div
              key={`${fieldKey}-${index}`}
              className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ccr-muted)]">
                  Item {index + 1}
                </p>
                <button
                  type="button"
                  onClick={() => onRemoveArrayItem(path, index)}
                  className="rounded-full border border-rose-300/40 px-3 py-1.5 text-xs font-semibold text-rose-500 transition hover:bg-rose-500/10"
                >
                  Remove
                </button>
              </div>
              <LandingFieldEditor
                fieldKey={`${fieldKey} ${index + 1}`}
                value={item}
                path={[...path, index]}
                onChange={onChange}
                onUploadImage={onUploadImage}
                onAddArrayItem={onAddArrayItem}
                onRemoveArrayItem={onRemoveArrayItem}
              />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (isRecord(value)) {
    return (
      <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
        <h4 className="text-sm font-semibold text-[var(--ccr-text)]">{labelize(fieldKey)}</h4>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {Object.entries(value).map(([key, nested]) => (
            <LandingFieldEditor
              key={key}
              fieldKey={key}
              value={nested}
              path={[...path, key]}
              onChange={onChange}
              onUploadImage={onUploadImage}
              onAddArrayItem={onAddArrayItem}
              onRemoveArrayItem={onRemoveArrayItem}
            />
          ))}
        </div>
      </section>
    );
  }

  return null;
}

export function LandingContentManager({
  initialContent,
  defaultContent,
  updatedAt,
  updatedByEmail,
  source,
}: LandingContentManagerProps) {
  const [content, setContent] = useState<LandingContent>(initialContent);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(updatedAt);
  const [lastUpdatedByEmail, setLastUpdatedByEmail] = useState<string | null>(updatedByEmail);
  const [contentSource, setContentSource] = useState(source);
  const [activeTab, setActiveTab] = useState<(typeof GLOBAL_TAB)["key"] | LandingContentPageKey>(
    "home",
  );
  const [saving, setSaving] = useState(false);
  const [uploadingPath, setUploadingPath] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(initialContent));
  const [addItemPath, setAddItemPath] = useState<Array<string | number> | null>(null);

  const dirty = useMemo(() => JSON.stringify(content) !== savedSnapshot, [content, savedSnapshot]);
  const activeContent = content[activeTab as keyof LandingContent] as EditableValue;
  const addItemCollection = addItemPath
    ? getValueAtPath(content as EditableValue, addItemPath)
    : null;
  const addItemDefaults = addItemPath
    ? getValueAtPath(defaultContent as EditableValue, addItemPath)
    : null;
  const addItemTemplate: EditableValue | null = addItemPath
    ? Array.isArray(addItemDefaults)
      ? (addItemDefaults[0] ?? "")
      : Array.isArray(addItemCollection)
        ? (addItemCollection[0] ?? "")
        : ""
    : null;

  function handleChange(path: Array<string | number>, value: EditableValue) {
    setContent((current) => setValueAtPath(current as EditableValue, path, value) as LandingContent);
    setMessage(null);
    setError(null);
  }

  function handleAddArrayItem(path: Array<string | number>) {
    setAddItemPath(path);
    setMessage(null);
    setError(null);
  }

  function handleConfirmAddItem(item: EditableValue) {
    if (!addItemPath) return;
    const label = String(addItemPath[addItemPath.length - 1] ?? "item");
    setContent((current) =>
      appendArrayItemAtPath(current as EditableValue, addItemPath, item) as LandingContent,
    );
    setMessage(`${labelize(label)} item added. Save landing content to publish it.`);
    setError(null);
  }

  function handleRemoveArrayItem(path: Array<string | number>, index: number) {
    setContent((current) =>
      removeArrayItemAtPath(current as EditableValue, path, index) as LandingContent,
    );
    setMessage(null);
    setError(null);
  }

  async function handleUploadImage(path: Array<string | number>) {
    const key = path.join(".");
    setUploadingPath(key);
    setError(null);
    try {
      const urls = await openUploadcareImagesDialog({
        multiple: false,
        imagesOnly: true,
        purpose: "landing-content",
      });
      const [url] = urls;
      if (url) {
        handleChange(path, url);
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload image.");
    } finally {
      setUploadingPath(null);
    }
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/admin/landing-content", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          content,
          baseUpdatedAt: lastUpdatedAt,
          csrfToken,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as LandingContentPayload;
      if (!response.ok || !payload.content) {
        if (payload.content) {
          setContent(payload.content);
          setSavedSnapshot(JSON.stringify(payload.content));
          setLastUpdatedAt(payload.updatedAt ?? null);
          setLastUpdatedByEmail(payload.updatedByEmail ?? null);
        }
        throw new Error(payload.message ?? payload.error ?? "Unable to save landing content.");
      }
      setContent(payload.content);
      setSavedSnapshot(JSON.stringify(payload.content));
      setLastUpdatedAt(payload.updatedAt ?? null);
      setLastUpdatedByEmail(payload.updatedByEmail ?? null);
      setContentSource(payload.source ?? "db");
      setMessage("Landing content saved. Customer-facing pages will use the updated content.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save landing content.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 shadow-[0_18px_56px_rgba(15,23,42,0.06)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Landing Content
          </p>
          <h2 className="mt-1 text-2xl font-bold text-[var(--ccr-text)]">
            Customer-facing pages
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ccr-muted)]">
            Edit the copy and images shown on public pages. Saved values are stored separately from
            operational settings and fall back to the code-managed defaults when a field is missing.
          </p>
        </div>
        <div className="text-right text-xs text-[var(--ccr-muted)]">
          <p>Source: {contentSource === "db" ? "Saved content" : "Default content"}</p>
          <p>
            Last saved:{" "}
            {lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleString() : "Not saved yet"}
          </p>
          {lastUpdatedByEmail ? <p>By: {lastUpdatedByEmail}</p> : null}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Landing content page tabs">
          {[GLOBAL_TAB, ...PAGE_TABS].map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${
                activeTab === tab.key
                  ? "border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)]"
                  : "border-[var(--ccr-border)] text-[var(--ccr-muted)] hover:text-[var(--ccr-text)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className={buttonStyles({
            variant: "primary",
            size: "md",
            className: "rounded-full disabled:cursor-not-allowed disabled:opacity-55",
          })}
        >
          {saving ? "Saving..." : dirty ? "Save landing content" : "Saved"}
        </button>
      </div>

      {message ? (
        <div className="mt-4 rounded-xl border border-emerald-400/35 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-200">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="mt-4 rounded-xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </div>
      ) : null}
      {uploadingPath ? (
        <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3 text-sm text-[var(--ccr-muted)]">
          Uploading image for {uploadingPath}...
        </div>
      ) : null}

      <div className="mt-6 space-y-5">
        {isRecord(activeContent)
          ? Object.entries(activeContent).map(([key, value]) => (
              <LandingFieldEditor
                key={key}
                fieldKey={key}
                value={value}
                path={[activeTab, key]}
                onChange={handleChange}
                onUploadImage={handleUploadImage}
                onAddArrayItem={handleAddArrayItem}
                onRemoveArrayItem={handleRemoveArrayItem}
              />
            ))
          : null}
      </div>

      {addItemPath && Array.isArray(addItemCollection) && addItemTemplate !== null ? (
        <LandingContentAddItemDialog
          open
          collectionPath={addItemPath}
          template={addItemTemplate}
          existingItems={addItemCollection}
          onClose={() => setAddItemPath(null)}
          onAdd={handleConfirmAddItem}
        />
      ) : null}
    </section>
  );
}
