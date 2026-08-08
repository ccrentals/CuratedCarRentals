"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import { openUploadcareImagesDialog } from "@/components/admin/UploadcareImagesInput";
import { buttonStyles } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createEmptyLandingItem,
  getLandingAddItemConfig,
  isLandingEditableRecord,
  isSafeLandingImageSource,
  labelizeLandingField,
  LANDING_SOCIAL_ICON_OPTIONS,
  orderLandingItemFields,
  validateLandingItem,
  type LandingEditableValue,
} from "@/lib/landingContentEditor";

type LandingContentAddItemDialogProps = {
  open: boolean;
  collectionPath: Array<string | number>;
  template: LandingEditableValue;
  existingItems: LandingEditableValue[];
  onClose: () => void;
  onAdd: (item: LandingEditableValue) => void;
};

function setDraftValue(
  root: LandingEditableValue,
  path: string[],
  value: LandingEditableValue,
): LandingEditableValue {
  if (path.length === 0) return value;
  if (!isLandingEditableRecord(root)) return root;
  const [head, ...tail] = path;
  return {
    ...root,
    [head]: setDraftValue(root[head] ?? null, tail, value),
  };
}

function isLongTextField(fieldName: string) {
  return /answer|description|paragraph|quote|text|tip/i.test(fieldName);
}

function fieldHelp(fieldName: string, collectionKey: string) {
  if (fieldName === "id") return "Unique lowercase URL ID, for example airport-pickup.";
  if (fieldName === "href" && collectionKey === "global.phones") {
    return "Use a telephone link such as tel:+18763797163.";
  }
  if (fieldName === "href" && collectionKey === "global.whatsapps") {
    return "Use a WhatsApp link such as https://wa.me/18763797163.";
  }
  if (fieldName === "href") return "Use an internal path such as /fleet or a full HTTPS URL.";
  if (["src", "imageSrc", "avatar"].includes(fieldName)) {
    return "Upload an image to the connected media library.";
  }
  return null;
}

export function LandingContentAddItemDialog({
  open,
  collectionPath,
  template,
  existingItems,
  onClose,
  onAdd,
}: LandingContentAddItemDialogProps) {
  const [draft, setDraft] = useState<LandingEditableValue>(() =>
    createEmptyLandingItem(template),
  );
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const collectionKey = collectionPath.map(String).join(".");
  const config = getLandingAddItemConfig(collectionPath);
  const errors = useMemo(
    () => validateLandingItem(draft, existingItems, config.itemLabel),
    [config.itemLabel, draft, existingItems],
  );

  useEffect(() => {
    if (!open) return;
    setDraft(createEmptyLandingItem(template));
    setAttemptedSubmit(false);
    setUploadingField(null);
    setUploadError(null);
  }, [collectionKey, open, template]);

  function updateDraft(path: string[], value: LandingEditableValue) {
    setDraft((current) => setDraftValue(current, path, value));
    setUploadError(null);
  }

  async function uploadImage(fieldName: string, path: string[]) {
    setUploadingField(fieldName);
    setUploadError(null);
    try {
      const [url] = await openUploadcareImagesDialog({
        multiple: false,
        imagesOnly: true,
        purpose: "landing-content",
      });
      if (url) updateDraft(path, url);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Unable to upload this image.");
    } finally {
      setUploadingField(null);
    }
  }

  function submit() {
    if (Object.keys(errors).length > 0) {
      setAttemptedSubmit(true);
      return;
    }
    onAdd(draft);
    onClose();
  }

  function renderStringField(fieldName: string, value: string, path: string[]) {
    const errorKey = path.length > 0 ? path.join(".") : "value";
    const error = attemptedSubmit ? errors[errorKey] : null;
    const imageField = ["src", "imageSrc", "avatar"].includes(fieldName);
    const multiline = config.multiline || isLongTextField(fieldName);
    const inputId = `landing-add-${collectionKey.replaceAll(".", "-")}-${errorKey.replaceAll(".", "-")}`;
    const help = fieldHelp(fieldName, collectionKey);

    return (
      <label
        key={errorKey}
        htmlFor={inputId}
        className={`block min-w-0 text-sm font-medium text-[var(--ccr-text)] ${
          multiline || imageField ? "sm:col-span-2" : ""
        }`}
      >
        <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ccr-muted)]">
          {path.length > 0 ? labelizeLandingField(fieldName) : config.itemLabel}
        </span>
        {imageField && value && isSafeLandingImageSource(value) ? (
          <span className="relative mt-2 block h-36 overflow-hidden rounded-lg border border-[var(--ccr-border)]">
            <Image src={value} alt="" fill sizes="480px" className="object-cover" unoptimized={!value.startsWith("/")} />
          </span>
        ) : null}
        {fieldName === "icon" ? (
          <select
            id={inputId}
            value={value}
            onChange={(event) => updateDraft(path, event.target.value)}
            className="mt-2 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2.5 text-sm text-[var(--ccr-text)] outline-none focus:ring-2 focus:ring-[var(--ccr-accent)]"
          >
            {LANDING_SOCIAL_ICON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        ) : multiline ? (
          <textarea
            id={inputId}
            value={value}
            rows={4}
            maxLength={20_000}
            required
            onChange={(event) => updateDraft(path, event.target.value)}
            className="mt-2 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2.5 text-sm text-[var(--ccr-text)] outline-none focus:ring-2 focus:ring-[var(--ccr-accent)]"
          />
        ) : (
          <input
            id={inputId}
            value={value}
            maxLength={20_000}
            required
            onChange={(event) => updateDraft(path, event.target.value)}
            className="mt-2 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2.5 text-sm text-[var(--ccr-text)] outline-none focus:ring-2 focus:ring-[var(--ccr-accent)]"
          />
        )}
        {help ? <span className="mt-1.5 block text-xs leading-5 text-[var(--ccr-muted)]">{help}</span> : null}
        {imageField ? (
          <button
            type="button"
            disabled={uploadingField !== null}
            onClick={() => void uploadImage(fieldName, path)}
            className="mt-2 rounded-lg border border-[var(--ccr-border)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-55"
          >
            {uploadingField === fieldName ? "Opening uploader..." : "Upload image"}
          </button>
        ) : null}
        {error ? <span className="mt-1.5 block text-xs font-medium text-rose-600 dark:text-rose-300">{error}</span> : null}
      </label>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-w-2xl" data-testid="landing-add-item-dialog">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {typeof draft === "string"
            ? renderStringField(config.itemLabel, draft, [])
            : isLandingEditableRecord(draft)
              ? orderLandingItemFields(draft, config.fieldOrder).map(([fieldName, value]) =>
                  typeof value === "string"
                    ? renderStringField(fieldName, value, [fieldName])
                    : null,
                )
              : null}
        </div>

        {attemptedSubmit && Object.keys(errors).length > 0 ? (
          <p className="mt-4 rounded-lg border border-rose-400/35 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200">
            Complete the highlighted fields before adding this item.
          </p>
        ) : null}
        {uploadError ? (
          <p className="mt-4 rounded-lg border border-rose-400/35 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200">
            {uploadError}
          </p>
        ) : null}

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className={buttonStyles({ variant: "secondary", size: "md" })}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={uploadingField !== null}
            data-testid="landing-add-item-confirm"
            className={buttonStyles({ variant: "primary", size: "md" })}
          >
            Add item
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
