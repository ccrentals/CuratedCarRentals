"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getVehicleDocumentDisplayLabel,
  type VehicleDocumentPreviewItem,
  VehicleDocumentPreviewModal,
} from "@/components/admin/VehicleDocumentPreviewModal";
import { DateTimeInline } from "@/components/shared/DateTimeInline";
import {
  type AdminSettings,
  type VehicleChecklistTemplateSetting,
} from "@/lib/adminSettings";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

const DEFAULT_FOLDERS = ["Paperwork", "Insurance", "Registration", "Other"];

type VehicleChecklistPanelProps = {
  vehicleId: string;
  folders?: string[];
  templates?: VehicleChecklistTemplateSetting[];
  initialChecklistItemId?: string;
};

type ChecklistItem = {
  id: string;
  label: string;
  folder: string;
  required: boolean;
  allowNotRequired: boolean;
  templateId: string | null;
  templateKey: string | null;
  templateExpiryRequired: boolean | null;
  templateExpiryWarningDays: number | null;
  uploadedDocumentDisplayLabel: string | null;
  expirationDate: string | null;
  uploadedDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
};

type ChecklistDocument = {
  id: string;
  folder: string;
  documentType: string | null;
  title: string;
  label: string | null;
  checklistItemId: string | null;
  checklistItemLabel: string | null;
  mimeType: string | null;
  canDownload: boolean;
};

type ChecklistStatusTone = "default" | "warning" | "danger" | "success";

type ChecklistStatusSummary = {
  needsAttention: boolean;
  missingFile: boolean;
  expirationNeeded: boolean;
  expired: boolean;
  expiringSoon: boolean;
  badges: Array<{ label: string; tone: ChecklistStatusTone }>;
};

function normalizeFolders(input: string[] | undefined) {
  const cleaned = (input ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
  return cleaned.length > 0 ? cleaned : [...DEFAULT_FOLDERS];
}

function normalizeTemplates(
  input: VehicleChecklistTemplateSetting[] | undefined,
  folders: string[],
) {
  return (input ?? [])
    .map((template) => {
      const label = template.label.trim();
      if (!label) return null;
      return {
        ...template,
        label,
        folder: folders.includes(template.folder) ? template.folder : folders[0] ?? "Unsorted",
      };
    })
    .filter((template): template is VehicleChecklistTemplateSetting => Boolean(template))
    .slice(0, 40);
}

function getTemplateKey(label: string, folder: string) {
  return `${folder.trim().toLowerCase()}::${label.trim().toLowerCase()}`;
}

function buildPersistedTemplate(item: ChecklistItem): VehicleChecklistTemplateSetting | null {
  if (!item.templateId && !item.templateKey) return null;
  return {
    key: item.templateKey?.trim() || item.templateId || "persisted-template",
    label: item.label,
    folder: item.folder,
    required: item.required,
    allowNotRequired: item.allowNotRequired,
    expiryRequired: Boolean(item.templateExpiryRequired),
    expiryWarningDays: item.templateExpiryWarningDays ?? null,
    isActive: true,
  };
}

function resolveItemTemplate(
  item: ChecklistItem,
  templateKeyMap: Map<string, VehicleChecklistTemplateSetting>,
  templateLabelMap: Map<string, VehicleChecklistTemplateSetting>,
) {
  const normalizedTemplateKey = item.templateKey?.trim().toLowerCase() ?? "";
  if (normalizedTemplateKey) {
    return templateKeyMap.get(normalizedTemplateKey) ?? buildPersistedTemplate(item);
  }
  if (item.templateId) {
    return buildPersistedTemplate(item);
  }
  return templateLabelMap.get(getTemplateKey(item.label, item.folder)) ?? null;
}

function resolveRepairableTemplate(
  item: ChecklistItem,
  templateLabelMap: Map<string, VehicleChecklistTemplateSetting>,
) {
  if (item.templateId || item.templateKey) return null;
  return templateLabelMap.get(getTemplateKey(item.label, item.folder)) ?? null;
}

function parseDateOnly(value: string | null) {
  if (!value) return null;
  const normalized = value.trim().slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function formatExpirationDisplay(value: string | null) {
  const parsed = parseDateOnly(value);
  if (!parsed) return value ?? "Not set";
  return parsed.toISOString().slice(0, 10);
}

function diffDaysFromToday(dateString: string | null) {
  const parsed = parseDateOnly(dateString);
  if (!parsed) return null;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.floor((parsed.getTime() - todayUtc) / 86_400_000);
}

function getChecklistStatusSummary(
  item: ChecklistItem,
  template: VehicleChecklistTemplateSetting | null,
): ChecklistStatusSummary {
  const missingFile = item.required && !item.uploadedDocumentId;
  const expirationNeeded = Boolean(template?.expiryRequired) && !item.expirationDate;
  const expirationDiff = diffDaysFromToday(item.expirationDate);
  const expired = expirationDiff !== null && expirationDiff < 0;
  const expiringSoon =
    expirationDiff !== null &&
    !expired &&
    template?.expiryWarningDays !== null &&
    template?.expiryWarningDays !== undefined &&
    expirationDiff <= template.expiryWarningDays;
  const needsAttention = missingFile || expirationNeeded || expired || expiringSoon;

  const badges: ChecklistStatusSummary["badges"] = [];
  if (missingFile) {
    badges.push({ label: "Missing file", tone: "danger" });
  }
  if (expirationNeeded) {
    badges.push({ label: "Expiration needed", tone: "warning" });
  }
  if (expired) {
    badges.push({ label: "Expired", tone: "danger" });
  } else if (expiringSoon && expirationDiff !== null) {
    badges.push({ label: `Expiring in ${expirationDiff}d`, tone: "warning" });
  }
  if (!needsAttention) {
    badges.push({
      label: item.required ? "Ready" : "Optional",
      tone: item.required ? "success" : "default",
    });
  }

  return {
    needsAttention,
    missingFile,
    expirationNeeded,
    expired,
    expiringSoon,
    badges,
  };
}

function getStatusBadgeClass(tone: ChecklistStatusTone) {
  switch (tone) {
    case "danger":
      return "border-rose-300/50 bg-rose-500/15 text-rose-200";
    case "warning":
      return "border-amber-300/50 bg-amber-500/15 text-[var(--ccr-required-text)]";
    case "success":
      return "border-[var(--ccr-accent)] bg-[color-mix(in_srgb,var(--ccr-accent)_12%,var(--ccr-surface))] text-[var(--ccr-accent-strong)]";
    default:
      return "border-[var(--ccr-border)] bg-[var(--ccr-surface)] text-[var(--ccr-text)]";
  }
}

function normalizeTemplateWarningDaysInput(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(3650, Math.max(0, Math.floor(parsed)));
}

function buildChecklistTemplateKey(value: string | null | undefined, fallbackLabel: string, index: number) {
  const candidate = String(value ?? "").trim().toLowerCase();
  const fallback = String(fallbackLabel ?? "").trim().toLowerCase();
  const source = candidate || fallback;
  const slug = source
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  if (slug) return slug;
  return `template-${index + 1}`;
}

export function VehicleChecklistPanel({
  vehicleId,
  folders: configuredFolders,
  templates: configuredTemplates,
  initialChecklistItemId,
}: VehicleChecklistPanelProps) {
  const folders = useMemo(() => normalizeFolders(configuredFolders), [configuredFolders]);
  const normalizedTemplates = useMemo(
    () => normalizeTemplates(configuredTemplates, folders),
    [configuredTemplates, folders],
  );
  const [templateSettings, setTemplateSettings] = useState<VehicleChecklistTemplateSetting[]>(
    normalizedTemplates,
  );
  useEffect(() => {
    setTemplateSettings(normalizedTemplates);
  }, [normalizedTemplates]);
  const activeTemplates = useMemo(
    () => templateSettings.filter((template) => template.isActive),
    [templateSettings],
  );
  const templateMap = useMemo(() => {
    return new Map(activeTemplates.map((template) => [getTemplateKey(template.label, template.folder), template]));
  }, [activeTemplates]);
  const templateKeyMap = useMemo(() => {
    return new Map(activeTemplates.map((template) => [template.key.trim().toLowerCase(), template]));
  }, [activeTemplates]);

  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [documents, setDocuments] = useState<ChecklistDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attachmentSavingItemId, setAttachmentSavingItemId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editFolder, setEditFolder] = useState("");
  const [editRequired, setEditRequired] = useState(false);
  const [editExpirationDate, setEditExpirationDate] = useState("");
  const [editTemplateKey, setEditTemplateKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(
    initialChecklistItemId?.trim() || null,
  );
  const [previewItem, setPreviewItem] = useState<VehicleDocumentPreviewItem | null>(null);
  const [initialScrollHandled, setInitialScrollHandled] = useState(false);
  const [initialUrlFocusHandled, setInitialUrlFocusHandled] = useState(false);
  const [rowAttachmentSelections, setRowAttachmentSelections] = useState<Record<string, string>>({});
  const [rowAttachmentSearches, setRowAttachmentSearches] = useState<Record<string, string>>({});
  const [rowAttachmentIncludeLinked, setRowAttachmentIncludeLinked] = useState<Record<string, boolean>>(
    {},
  );
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});

  const [label, setLabel] = useState("");
  const [folder, setFolder] = useState(folders[0] ?? "Unsorted");
  const [required, setRequired] = useState(false);
  const [expirationDate, setExpirationDate] = useState("");
  const [addToTemplate, setAddToTemplate] = useState(false);
  const [addTemplateAllowNotRequired, setAddTemplateAllowNotRequired] = useState(true);
  const [addTemplateExpiryRequired, setAddTemplateExpiryRequired] = useState(false);
  const [addTemplateExpiryWarningDays, setAddTemplateExpiryWarningDays] = useState("30");
  const [editSaveToTemplate, setEditSaveToTemplate] = useState(false);
  const [editTemplateAllowNotRequired, setEditTemplateAllowNotRequired] = useState(true);
  const [editTemplateExpiryRequired, setEditTemplateExpiryRequired] = useState(false);
  const [editTemplateExpiryWarningDays, setEditTemplateExpiryWarningDays] = useState("30");

  const loadDocuments = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/vehicles/${vehicleId}/documents`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        items?: Array<{
          id: string;
          folder: string;
          documentType: string;
          title: string;
          label: string | null;
          checklistItemId: string | null;
          checklistItemLabel: string | null;
          mimeType: string | null;
          canDownload: boolean;
        }>;
      };

      if (!response.ok || !payload.ok) {
        setDocuments([]);
        return;
      }

      setDocuments(
        (payload.items ?? []).map((item) => ({
          id: item.id,
          folder: item.folder,
          documentType: item.documentType ?? null,
          title: item.title,
          label: item.label ?? null,
          checklistItemId: item.checklistItemId ?? null,
          checklistItemLabel: item.checklistItemLabel ?? null,
          mimeType: item.mimeType ?? null,
          canDownload: Boolean(item.canDownload),
        })),
      );
    } catch {
      setDocuments([]);
    }
  }, [vehicleId]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/vehicles/${vehicleId}/checklist`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        items?: Array<{
          id: string;
          label: string;
          folder: string;
          required: boolean;
          allowNotRequired: boolean;
          templateId: string | null;
          templateKey: string | null;
          templateExpiryRequired: boolean | null;
          templateExpiryWarningDays: number | null;
          uploadedDocumentDisplayLabel: string | null;
          expirationDate: string | null;
          uploadedDocumentId: string | null;
          createdAt: string;
          updatedAt: string;
        }>;
      };

      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Unable to load checklist.");
        setItems([]);
        return;
      }

      setItems(
        (payload.items ?? []).map((item) => ({
          id: item.id,
          label: item.label,
          folder: item.folder,
          required: Boolean(item.required),
          allowNotRequired: Boolean(item.allowNotRequired),
          templateId: item.templateId ?? null,
          templateKey: item.templateKey ?? null,
          templateExpiryRequired: item.templateExpiryRequired ?? null,
          templateExpiryWarningDays: item.templateExpiryWarningDays ?? null,
          uploadedDocumentDisplayLabel: item.uploadedDocumentDisplayLabel ?? null,
          expirationDate: item.expirationDate ?? null,
          uploadedDocumentId: item.uploadedDocumentId ?? null,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
      );
    } catch {
      setError("Unable to load checklist.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    void Promise.all([loadItems(), loadDocuments()]);
  }, [loadDocuments, loadItems]);

  useEffect(() => {
    setHighlightedItemId(initialChecklistItemId?.trim() || null);
    setInitialScrollHandled(false);
    setInitialUrlFocusHandled(false);
  }, [initialChecklistItemId]);

  useEffect(() => {
    if (!folders.includes(folder)) {
      setFolder(folders[0] ?? "Unsorted");
    }
  }, [folder, folders]);

  async function upsertChecklistTemplate(
    input: Omit<VehicleChecklistTemplateSetting, "key"> & { key?: string | null },
  ) {
    const csrfToken = await ensureCsrfToken();
    const settingsResponse = await fetch("/api/admin/settings", {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });
    const settingsPayload = (await settingsResponse.json().catch(() => ({}))) as {
      settings?: AdminSettings;
      error?: string;
    };
    if (!settingsResponse.ok) {
      throw new Error(settingsPayload.error ?? "Unable to load settings for checklist template update.");
    }
    const currentSettings = settingsPayload.settings;
    if (!currentSettings) {
      throw new Error("Unable to load settings for checklist template update.");
    }
    const normalizedKey =
      input.key?.trim() ||
      buildChecklistTemplateKey("", input.label, currentSettings.vehicleChecklistTemplates.length);
    const existingTemplate =
      currentSettings.vehicleChecklistTemplates.find((template) => template.key === normalizedKey) ?? null;
    const nextTemplate: VehicleChecklistTemplateSetting = {
      key: normalizedKey,
      label: input.label.trim().slice(0, 160),
      folder: folders.includes(input.folder) ? input.folder : folders[0] ?? "Unsorted",
      required: input.required,
      allowNotRequired: input.allowNotRequired,
      expiryRequired: input.expiryRequired,
      expiryWarningDays: input.expiryRequired ? input.expiryWarningDays : null,
      isActive: existingTemplate?.isActive ?? input.isActive,
    };
    const nextTemplates = existingTemplate
      ? currentSettings.vehicleChecklistTemplates.map((template) =>
          template.key === normalizedKey ? { ...template, ...nextTemplate } : template,
        )
      : [...currentSettings.vehicleChecklistTemplates, nextTemplate];

    const patchResponse = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        settings: {
          ...currentSettings,
          vehicleChecklistTemplates: nextTemplates,
        },
        csrfToken,
      }),
    });
    const patchPayload = (await patchResponse.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      settings?: AdminSettings;
    };
    if (!patchResponse.ok || !patchPayload.ok) {
      throw new Error(patchPayload.error ?? "Unable to save checklist template.");
    }

    const nextSettings = patchPayload.settings;
    if (!nextSettings) {
      throw new Error("Checklist template saved but updated settings were not returned.");
    }
    setTemplateSettings(nextSettings.vehicleChecklistTemplates);
    return nextSettings.vehicleChecklistTemplates.find((template) => template.key === normalizedKey) ?? nextTemplate;
  }

  const highlightedItem = useMemo(
    () => items.find((item) => item.id === highlightedItemId) ?? null,
    [highlightedItemId, items],
  );
  const itemTemplateMap = useMemo(() => {
    const next = new Map<string, VehicleChecklistTemplateSetting | null>();
    for (const item of items) {
      next.set(item.id, resolveItemTemplate(item, templateKeyMap, templateMap));
    }
    return next;
  }, [items, templateKeyMap, templateMap]);
  const repairableTemplateMatches = useMemo(() => {
    return items
      .map((item) => ({
        item,
        template: resolveRepairableTemplate(item, templateMap),
      }))
      .filter(
        (
          match,
        ): match is {
          item: ChecklistItem;
          template: VehicleChecklistTemplateSetting;
        } => Boolean(match.template),
      );
  }, [items, templateMap]);
  const itemStatusMap = useMemo(() => {
    const next = new Map<string, ChecklistStatusSummary>();
    for (const item of items) {
      const template = itemTemplateMap.get(item.id) ?? null;
      next.set(item.id, getChecklistStatusSummary(item, template));
    }
    return next;
  }, [itemTemplateMap, items]);
  const checklistSummary = useMemo(() => {
    let attentionCount = 0;
    let missingFileCount = 0;
    let expirationCount = 0;
    let readyCount = 0;

    for (const item of items) {
      const status = itemStatusMap.get(item.id);
      if (!status) continue;
      if (status.needsAttention) {
        attentionCount += 1;
      } else {
        readyCount += 1;
      }
      if (status.missingFile) missingFileCount += 1;
      if (status.expirationNeeded || status.expired || status.expiringSoon) expirationCount += 1;
    }

    return {
      totalCount: items.length,
      attentionCount,
      missingFileCount,
      expirationCount,
      readyCount,
    };
  }, [itemStatusMap, items]);
  const documentsById = useMemo(() => {
    return new Map(documents.map((document) => [document.id, document]));
  }, [documents]);

  useEffect(() => {
    const nextSelections: Record<string, string> = {};
    for (const item of items) {
      nextSelections[item.id] = item.uploadedDocumentId ?? "";
    }
    setRowAttachmentSelections(nextSelections);
  }, [items]);

  useEffect(() => {
    if (!highlightedItemId || initialScrollHandled || loading) return;
    const matchedItem = itemRefs.current[highlightedItemId];
    if (matchedItem) {
      matchedItem.scrollIntoView({ block: "center", behavior: "smooth" });
      setInitialScrollHandled(true);
      return;
    }
    if (!loading) {
      setInitialScrollHandled(true);
    }
  }, [highlightedItemId, initialScrollHandled, loading, items]);

  useEffect(() => {
    const shouldClearUrl =
      typeof window !== "undefined" &&
      initialChecklistItemId &&
      highlightedItemId === initialChecklistItemId &&
      initialScrollHandled &&
      !initialUrlFocusHandled;
    if (!shouldClearUrl) return;

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("checklistItemId");
    window.history.replaceState(window.history.state, "", nextUrl.toString());
    setInitialUrlFocusHandled(true);
  }, [
    highlightedItemId,
    initialChecklistItemId,
    initialScrollHandled,
    initialUrlFocusHandled,
  ]);

  async function createItem(
    inputLabel: string,
    inputFolder: string,
    inputRequired: boolean,
    inputAllowNotRequired: boolean,
    inputExpirationDate: string | null,
    inputTemplateKey: string | null,
  ) {
    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/vehicles/${vehicleId}/checklist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({
        label: inputLabel,
        folder: inputFolder,
        required: inputRequired,
        allowNotRequired: inputAllowNotRequired,
        expirationDate: inputExpirationDate,
        templateKey: inputTemplateKey,
        csrfToken,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? "Unable to save checklist item.");
    }
  }

  async function handleCreate() {
    const normalizedLabel = label.trim();
    if (!normalizedLabel) {
      setError("Checklist label is required.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      let nextTemplateKey = templateMap.get(getTemplateKey(normalizedLabel, folder))?.key ?? null;
      if (addToTemplate) {
        const savedTemplate = await upsertChecklistTemplate({
          key: nextTemplateKey,
          label: normalizedLabel,
          folder,
          required,
          allowNotRequired: addTemplateAllowNotRequired,
          expiryRequired: addTemplateExpiryRequired,
          expiryWarningDays: normalizeTemplateWarningDaysInput(addTemplateExpiryWarningDays),
          isActive: true,
        });
        nextTemplateKey = savedTemplate.key;
      }
      await createItem(
        normalizedLabel,
        folder,
        required,
        true,
        expirationDate || null,
        nextTemplateKey,
      );
      setLabel("");
      setRequired(false);
      setExpirationDate("");
      setAddToTemplate(false);
      setAddTemplateAllowNotRequired(true);
      setAddTemplateExpiryRequired(false);
      setAddTemplateExpiryWarningDays("30");
      setMessage(addToTemplate ? "Checklist item added and template saved." : "Checklist item added.");
      await loadItems();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to save checklist item.");
    } finally {
      setSaving(false);
    }
  }

  async function handleApplyTemplate() {
    if (activeTemplates.length < 1) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      for (const template of activeTemplates) {
        await createItem(
          template.label,
          template.folder,
          template.required,
          template.allowNotRequired,
          null,
          template.key,
        );
      }
      const expiryRequiredCount = activeTemplates.filter((template) => template.expiryRequired).length;
      setMessage(
        expiryRequiredCount > 0
          ? `Template checklist items added. ${expiryRequiredCount} item(s) still need expiration dates.`
          : "Template checklist items added.",
      );
      await loadItems();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to apply template items.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRepairTemplateLinks() {
    if (repairableTemplateMatches.length < 1 || saving) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const csrfToken = await ensureCsrfToken();
      for (const match of repairableTemplateMatches) {
        const response = await fetch(`/api/admin/vehicles/${vehicleId}/checklist/${match.item.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrfToken ?? "",
          },
          body: JSON.stringify({
            templateKey: match.template.key,
            csrfToken,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? "Unable to repair checklist template links.");
        }
      }
      setMessage(
        repairableTemplateMatches.length === 1
          ? "1 template link repaired."
          : `${repairableTemplateMatches.length} template links repaired.`,
      );
      await loadItems();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to repair checklist template links.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(itemId: string) {
    const confirmed = window.confirm("Delete this checklist item?");
    if (!confirmed) return;

    setError(null);
    setMessage(null);

    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/vehicles/${vehicleId}/checklist/${itemId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({ csrfToken }),
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      setError(payload.error ?? "Unable to delete checklist item.");
      return;
    }

    setMessage("Checklist item deleted.");
    await Promise.all([loadItems(), loadDocuments()]);
  }

  function openPreviewForItem(item: ChecklistItem) {
    if (!item.uploadedDocumentId) return;
    const document = documentsById.get(item.uploadedDocumentId);
    setPreviewItem(
      document
        ? {
            id: document.id,
            title: document.title,
            label: document.label,
            documentType: document.documentType,
            mimeType: document.mimeType,
            canDownload: document.canDownload,
            checklistItemLabel: item.label,
          }
        : {
            id: item.uploadedDocumentId,
            title: item.uploadedDocumentDisplayLabel ?? `${item.label} attachment`,
            label: item.uploadedDocumentDisplayLabel ?? null,
            checklistItemLabel: item.label,
            canDownload: true,
          },
    );
  }

  async function updateChecklistAttachment(item: ChecklistItem, nextDocumentId: string) {
    const selectedDocumentId = nextDocumentId.trim();
    const currentDocumentId = item.uploadedDocumentId ?? "";
    if (selectedDocumentId === currentDocumentId) return;
    if (attachmentSavingItemId) return;

    setAttachmentSavingItemId(item.id);
    setError(null);
    setMessage(null);

    try {
      const csrfToken = await ensureCsrfToken();
      if (currentDocumentId && !selectedDocumentId) {
        const response = await fetch(`/api/admin/vehicles/${vehicleId}/documents/${currentDocumentId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrfToken ?? "",
          },
          body: JSON.stringify({
            checklistItemId: null,
            csrfToken,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? "Unable to clear checklist attachment.");
        }
        setMessage("Checklist attachment cleared.");
      } else if (selectedDocumentId) {
        const response = await fetch(`/api/admin/vehicles/${vehicleId}/documents/${selectedDocumentId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrfToken ?? "",
          },
          body: JSON.stringify({
            checklistItemId: item.id,
            csrfToken,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? "Unable to update checklist attachment.");
        }
        setMessage(currentDocumentId ? "Checklist attachment updated." : "Checklist attachment added.");
      }

      await Promise.all([loadItems(), loadDocuments()]);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to update checklist attachment.",
      );
    } finally {
      setAttachmentSavingItemId(null);
    }
  }

  function clearHighlight() {
    setHighlightedItemId(null);
  }

  function startEditing(item: ChecklistItem) {
    const linkedTemplate = itemTemplateMap.get(item.id) ?? null;
    setEditingItemId(item.id);
    setEditLabel(item.label);
    setEditFolder(item.folder);
    setEditRequired(item.required);
    setEditExpirationDate(item.expirationDate ?? "");
    setEditTemplateKey(
      item.templateKey ??
        (templateMap.get(getTemplateKey(item.label, item.folder))?.key ?? ""),
    );
    setEditSaveToTemplate(false);
    setEditTemplateAllowNotRequired(linkedTemplate?.allowNotRequired ?? item.allowNotRequired);
    setEditTemplateExpiryRequired(
      linkedTemplate?.expiryRequired ?? Boolean(item.templateExpiryRequired),
    );
    setEditTemplateExpiryWarningDays(
      String(linkedTemplate?.expiryWarningDays ?? item.templateExpiryWarningDays ?? 30),
    );
    setError(null);
    setMessage(null);
  }

  function cancelEditing() {
    setEditingItemId(null);
    setEditLabel("");
    setEditFolder("");
    setEditRequired(false);
    setEditExpirationDate("");
    setEditTemplateKey("");
    setEditSaveToTemplate(false);
    setEditTemplateAllowNotRequired(true);
    setEditTemplateExpiryRequired(false);
    setEditTemplateExpiryWarningDays("30");
  }

  function applySelectedTemplateDefaults() {
    const normalizedTemplateKey = editTemplateKey.trim().toLowerCase();
    if (!normalizedTemplateKey) return;
    const template = templateKeyMap.get(normalizedTemplateKey);
    if (!template) return;
    setEditLabel(template.label);
    setEditFolder(template.folder);
    setEditRequired(template.required);
    setEditTemplateAllowNotRequired(template.allowNotRequired);
    setEditTemplateExpiryRequired(template.expiryRequired);
    setEditTemplateExpiryWarningDays(String(template.expiryWarningDays ?? 30));
  }

  async function saveItemEdits(item: ChecklistItem) {
    if (!editingItemId || editingItemId !== item.id || saving) return;

    const normalizedLabel = editLabel.trim();
    if (!normalizedLabel) {
      setError("Checklist label is required.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      let nextTemplateKey = editTemplateKey || null;
      if (editSaveToTemplate) {
        const savedTemplate = await upsertChecklistTemplate({
          key: nextTemplateKey,
          label: normalizedLabel,
          folder: editFolder || item.folder,
          required: item.allowNotRequired ? editRequired : true,
          allowNotRequired: editTemplateAllowNotRequired,
          expiryRequired: editTemplateExpiryRequired,
          expiryWarningDays: normalizeTemplateWarningDaysInput(editTemplateExpiryWarningDays),
          isActive: true,
        });
        nextTemplateKey = savedTemplate.key;
      }
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`/api/admin/vehicles/${vehicleId}/checklist/${item.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          label: normalizedLabel,
          folder: editFolder || item.folder,
          required: item.allowNotRequired ? editRequired : true,
          expirationDate: editExpirationDate || null,
          templateKey: nextTemplateKey,
          csrfToken,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Unable to update checklist item.");
      }

      setMessage(editSaveToTemplate ? "Checklist item updated and template saved." : "Checklist item updated.");
      cancelEditing();
      await Promise.all([loadItems(), loadDocuments()]);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to update checklist item.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Checklist</h2>
          <p className="text-xs text-[var(--ccr-muted)]">Track required vehicle paperwork and renewals.</p>
        </div>
        {activeTemplates.length > 0 ? (
          <button
            type="button"
            onClick={() => void handleApplyTemplate()}
            disabled={saving}
            className="min-h-11 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
          >
            {saving ? "Applying..." : "Apply template"}
          </button>
        ) : null}
      </div>

      {templateSettings.length > 0 ? (
        <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[var(--ccr-text)]">Template coverage</p>
              <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                Apply uses each template&apos;s own folder, required flag, and optional override
                rule.
              </p>
            </div>
            <p className="text-xs text-[var(--ccr-muted)]">
              Active templates:{" "}
              <span className="font-semibold text-[var(--ccr-text)]">{activeTemplates.length}</span>
            </p>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {templateSettings.map((template) => (
              <article
                key={template.key}
                className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-[var(--ccr-text)]">{template.label}</p>
                    <p className="text-xs text-[var(--ccr-muted)]">Folder: {template.folder}</p>
                  </div>
                  {!template.isActive ? (
                    <span className="rounded-full border border-[var(--ccr-border)] px-2 py-1 text-[11px] font-semibold text-[var(--ccr-muted)]">
                      Inactive
                    </span>
                  ) : null}
                </div>

                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-full border border-[var(--ccr-border)] px-2 py-1 text-[var(--ccr-text)]">
                    {template.required ? "Required" : "Optional"}
                  </span>
                  <span className="rounded-full border border-[var(--ccr-border)] px-2 py-1 text-[var(--ccr-text)]">
                    {template.allowNotRequired ? "Can be marked optional" : "Must stay required"}
                  </span>
                  {template.expiryRequired ? (
                    <span className="rounded-full border border-amber-300/50 bg-amber-500/15 px-2 py-1 text-[var(--ccr-required-text)]">
                      Expiry required
                    </span>
                  ) : null}
                  {template.expiryWarningDays !== null ? (
                    <span className="rounded-full border border-[var(--ccr-border)] px-2 py-1 text-[var(--ccr-text)]">
                      Warn {template.expiryWarningDays}d
                    </span>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Label
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              placeholder="Insurance Certificate"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Folder
            <select
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              {folders.map((folderOption) => (
                <option key={folderOption} value={folderOption}>
                  {folderOption}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Expiration Date
            <input
              type="date"
              value={expirationDate}
              onChange={(event) => setExpirationDate(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] md:pt-6">
            <input
              type="checkbox"
              checked={required}
              onChange={(event) => setRequired(event.target.checked)}
              className="h-4 w-4 rounded border border-[var(--ccr-border)] bg-transparent accent-[var(--ccr-accent)]"
            />
            Required item
          </label>
        </div>

        <div className="mt-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3">
          <label className="inline-flex min-h-11 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            <input
              type="checkbox"
              data-testid="vehicle-checklist-add-template-toggle"
              checked={addToTemplate}
              onChange={(event) => setAddToTemplate(event.target.checked)}
              className="h-4 w-4 rounded border border-[var(--ccr-border)] bg-transparent accent-[var(--ccr-accent)]"
            />
            Add to template
          </label>
          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
            When enabled, saving here also updates Admin Settings so future template applies stay in sync.
          </p>
          {addToTemplate ? (
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--ccr-border)] px-3 py-3 text-xs text-[var(--ccr-text)]">
                <input
                  type="checkbox"
                  data-testid="vehicle-checklist-add-template-allow-optional"
                  checked={addTemplateAllowNotRequired}
                  onChange={(event) => setAddTemplateAllowNotRequired(event.target.checked)}
                  className="h-4 w-4 rounded border border-[var(--ccr-border)] bg-transparent accent-[var(--ccr-accent)]"
                />
                Can be marked optional later
              </label>
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--ccr-border)] px-3 py-3 text-xs text-[var(--ccr-text)]">
                <input
                  type="checkbox"
                  data-testid="vehicle-checklist-add-template-expiry-required"
                  checked={addTemplateExpiryRequired}
                  onChange={(event) => setAddTemplateExpiryRequired(event.target.checked)}
                  className="h-4 w-4 rounded border border-[var(--ccr-border)] bg-transparent accent-[var(--ccr-accent)]"
                />
                Expiration required in template
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Expiry warning days
                <input
                  type="number"
                  data-testid="vehicle-checklist-add-template-warning-days"
                  min={0}
                  max={3650}
                  value={addTemplateExpiryWarningDays}
                  disabled={!addTemplateExpiryRequired}
                  onChange={(event) => setAddTemplateExpiryWarningDays(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] disabled:opacity-60"
                  placeholder="30"
                />
              </label>
            </div>
          ) : null}
        </div>

        <div className="mt-3">
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={saving}
            className="min-h-11 rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving..." : "Add checklist item"}
          </button>
        </div>
      </div>

      {error ? <p className="mt-3 text-xs font-semibold text-red-300">{error}</p> : null}
      {message ? (
        <div
          data-testid="vehicle-checklist-message"
          className="mt-3 rounded-xl border border-[var(--ccr-accent)] bg-[color-mix(in_srgb,var(--ccr-accent)_10%,var(--ccr-surface-soft))] px-4 py-3 text-xs font-semibold text-[var(--ccr-accent-strong)]"
        >
          {message}
        </div>
      ) : null}
      {repairableTemplateMatches.length > 0 ? (
        <div
          data-testid="vehicle-checklist-template-repair-banner"
          className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--ccr-accent)] bg-[color-mix(in_srgb,var(--ccr-accent)_10%,var(--ccr-surface-soft))] px-4 py-3"
        >
          <div>
            <p className="text-sm font-semibold text-[var(--ccr-text)]">Template links can be repaired</p>
            <p className="text-xs text-[var(--ccr-muted)]">
              {repairableTemplateMatches.length === 1
                ? "1 checklist item still matches an active template and can be linked automatically."
                : `${repairableTemplateMatches.length} checklist items still match active templates and can be linked automatically.`}
            </p>
          </div>
          <button
            type="button"
            data-testid="vehicle-checklist-template-repair-action"
            onClick={() => void handleRepairTemplateLinks()}
            disabled={saving}
            className="min-h-9 rounded-lg border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-3 py-1 text-xs font-semibold text-[var(--ccr-accent-strong)] disabled:opacity-60"
          >
            {saving ? "Repairing..." : "Repair template links"}
          </button>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div
          data-testid="vehicle-checklist-summary"
          className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
        >
          <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Total items
            </p>
            <p className="mt-1 text-2xl font-bold text-[var(--ccr-text)]">{checklistSummary.totalCount}</p>
          </div>
          <div className="rounded-xl border border-amber-300/50 bg-amber-500/10 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-required-text)]">
              Needs attention
            </p>
            <p className="mt-1 text-2xl font-bold text-[var(--ccr-text)]">{checklistSummary.attentionCount}</p>
          </div>
          <div className="rounded-xl border border-rose-300/40 bg-rose-500/10 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-200">
              Missing files
            </p>
            <p className="mt-1 text-2xl font-bold text-[var(--ccr-text)]">{checklistSummary.missingFileCount}</p>
          </div>
          <div className="rounded-xl border border-amber-300/50 bg-amber-500/10 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-required-text)]">
              Expiry issues
            </p>
            <p className="mt-1 text-2xl font-bold text-[var(--ccr-text)]">{checklistSummary.expirationCount}</p>
          </div>
          <div className="rounded-xl border border-[var(--ccr-accent)] bg-[color-mix(in_srgb,var(--ccr-accent)_10%,var(--ccr-surface-soft))] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-accent-strong)]">
              Ready
            </p>
            <p className="mt-1 text-2xl font-bold text-[var(--ccr-text)]">{checklistSummary.readyCount}</p>
          </div>
        </div>
      ) : null}
      {highlightedItem ? (
        <div
          data-testid="vehicle-checklist-focus-banner"
          className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--ccr-accent)] bg-[color-mix(in_srgb,var(--ccr-accent)_10%,var(--ccr-surface-soft))] px-4 py-3"
        >
          <div>
            <p className="text-sm font-semibold text-[var(--ccr-text)]">Focused from Files</p>
            <p className="text-xs text-[var(--ccr-muted)]">
              {highlightedItem.label} is highlighted in this checklist.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {highlightedItem.uploadedDocumentId ? (
              <button
                type="button"
                data-testid="vehicle-checklist-preview-highlighted-file"
                onClick={() =>
                  openPreviewForItem(highlightedItem)
                }
                className="min-h-9 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]"
              >
                Preview linked file
              </button>
            ) : null}
            {highlightedItem.uploadedDocumentId ? (
              <Link
                data-testid="vehicle-checklist-view-file"
                href={`/admin/vehicles/${vehicleId}?tab=files&folder=${encodeURIComponent(highlightedItem.folder)}&documentId=${encodeURIComponent(highlightedItem.uploadedDocumentId)}`}
                className="inline-flex min-h-9 items-center rounded-lg border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-3 py-1 text-xs font-semibold text-[var(--ccr-accent-strong)]"
              >
                View linked file
              </Link>
            ) : null}
            <button
              type="button"
              data-testid="vehicle-checklist-clear-highlight"
              onClick={clearHighlight}
              className="min-h-9 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]"
            >
              Clear highlight
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {loading ? <p className="text-sm text-[var(--ccr-muted)]">Loading checklist...</p> : null}
        {!loading && items.length < 1 ? (
          <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-5">
            <p className="text-sm font-semibold text-[var(--ccr-text)]">No checklist items yet.</p>
            <p className="mt-1 text-xs text-[var(--ccr-muted)]">
              Add required paperwork and expiration checkpoints for this vehicle.
            </p>
          </div>
        ) : null}

        {items.map((item) => {
          const isHighlighted = highlightedItemId === item.id;
          const isEditing = editingItemId === item.id;
          const linkedTemplate = itemTemplateMap.get(item.id) ?? null;
          const itemStatus = itemStatusMap.get(item.id) ?? {
            needsAttention: false,
            missingFile: false,
            expirationNeeded: false,
            expired: false,
            expiringSoon: false,
            badges: [],
          };
          const folderDocuments = documents.filter((document) => document.folder === item.folder);
          const selectedAttachmentId = rowAttachmentSelections[item.id] ?? "";
          const attachmentSearch = rowAttachmentSearches[item.id] ?? "";
          const includeLinkedFiles = rowAttachmentIncludeLinked[item.id] ?? false;
          const normalizedAttachmentSearch = attachmentSearch.trim().toLowerCase();
          const availableDocuments = folderDocuments.filter(
            (document) => !document.checklistItemId || document.checklistItemId === item.id,
          );
          const hiddenLinkedDocuments = folderDocuments.filter(
            (document) => document.checklistItemId && document.checklistItemId !== item.id,
          );
          const filteredFolderDocuments = folderDocuments.filter((document) => {
            if (
              !includeLinkedFiles &&
              document.checklistItemId &&
              document.checklistItemId !== item.id
            ) {
              return false;
            }

            if (!normalizedAttachmentSearch) return true;

            const haystack = [
              getVehicleDocumentDisplayLabel(document),
              document.title,
              document.documentType ?? "",
              document.checklistItemLabel ?? "",
            ]
              .join(" ")
              .toLowerCase();
            return haystack.includes(normalizedAttachmentSearch);
          });
          const selectedAttachmentDocument =
            selectedAttachmentId && documentsById.get(selectedAttachmentId)
              ? documentsById.get(selectedAttachmentId)
              : null;
          const attachmentOptions =
            selectedAttachmentDocument &&
            selectedAttachmentDocument.folder === item.folder &&
            !filteredFolderDocuments.some((document) => document.id === selectedAttachmentDocument.id)
              ? [selectedAttachmentDocument, ...filteredFolderDocuments]
              : filteredFolderDocuments;
          return (
            <article
              key={item.id}
              ref={(node) => {
                itemRefs.current[item.id] = node;
              }}
              data-testid={`vehicle-checklist-item-${item.id}`}
              data-highlighted={isHighlighted ? "true" : "false"}
              className={`relative rounded-xl border p-4 pr-4 transition-colors md:pr-44 xl:pr-60 ${
                isHighlighted
                  ? "border-[var(--ccr-accent)] bg-[color-mix(in_srgb,var(--ccr-accent)_10%,var(--ccr-surface-soft))] shadow-[0_0_0_1px_var(--ccr-accent)]"
                  : itemStatus.needsAttention
                    ? "border-amber-300/50 bg-[color-mix(in_srgb,rgba(245,158,11,0.12)_55%,var(--ccr-surface-soft))]"
                  : "border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)]"
              }`}
            >
              <div className="max-w-full xl:max-w-[calc(100%-15rem)]">
                <div className="flex flex-wrap items-start gap-2">
                  <div>
                    <p className="font-semibold text-[var(--ccr-text)] break-words">{item.label}</p>
                    {isHighlighted ? (
                      <span className="mt-1 inline-flex rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-2 py-1 text-[11px] font-semibold text-[var(--ccr-accent-strong)]">
                        Focused from Files
                      </span>
                    ) : null}
                    <p className="text-xs text-[var(--ccr-muted)]">Folder: {item.folder}</p>
                    {item.templateId || item.templateKey ? (
                      <p className="text-xs text-[var(--ccr-muted)]">
                        Template linked: {linkedTemplate?.label ?? item.templateKey ?? "Unknown template"}
                      </p>
                    ) : null}
                  </div>
                </div>

                {itemStatus.badges.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2" data-testid={`vehicle-checklist-status-${item.id}`}>
                    {itemStatus.badges.map((badge) => (
                      <span
                        key={`${item.id}-${badge.label}`}
                        className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${getStatusBadgeClass(badge.tone)}`}
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="mt-2 text-xs text-[var(--ccr-muted)]">
                <p>Created: <DateTimeInline value={item.createdAt} /></p>
                <p>
                  Expiration: {item.expirationDate ? formatExpirationDisplay(item.expirationDate) : "Not set"}
                  {item.uploadedDocumentId ? " · Document attached" : ""}
                </p>
                {isEditing ? (
                  <div className="mt-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                        Label
                        <input
                          data-testid={`vehicle-checklist-edit-label-${item.id}`}
                          value={editLabel}
                          onChange={(event) => setEditLabel(event.target.value)}
                          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-xs text-[var(--ccr-text)]"
                        />
                      </label>
                      <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                        Folder
                        <select
                          data-testid={`vehicle-checklist-edit-folder-${item.id}`}
                          value={editFolder}
                          onChange={(event) => setEditFolder(event.target.value)}
                          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-xs text-[var(--ccr-text)]"
                        >
                          {folders.map((folderOption) => (
                            <option key={folderOption} value={folderOption}>
                              {folderOption}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                        Expiration date
                        <input
                          data-testid={`vehicle-checklist-edit-expiration-${item.id}`}
                          type="date"
                          value={editExpirationDate}
                          onChange={(event) => setEditExpirationDate(event.target.value)}
                          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-xs text-[var(--ccr-text)]"
                        />
                      </label>
                      <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                        Template
                        <select
                          data-testid={`vehicle-checklist-edit-template-${item.id}`}
                          value={editTemplateKey}
                          onChange={(event) => setEditTemplateKey(event.target.value)}
                          className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-xs text-[var(--ccr-text)]"
                        >
                          <option value="">No linked template</option>
                          {editTemplateKey &&
                          !activeTemplates.some((template) => template.key === editTemplateKey) ? (
                            <option value={editTemplateKey}>
                              Current linked template
                            </option>
                          ) : null}
                          {activeTemplates.map((template) => (
                            <option key={template.key} value={template.key}>
                              {template.label} · {template.folder}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="mt-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3">
                      <label className="inline-flex min-h-9 items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                        <input
                          data-testid={`vehicle-checklist-edit-save-template-${item.id}`}
                          type="checkbox"
                          checked={editSaveToTemplate}
                          onChange={(event) => setEditSaveToTemplate(event.target.checked)}
                          className="h-4 w-4 rounded border border-[var(--ccr-border)] bg-transparent accent-[var(--ccr-accent)]"
                        />
                        {editTemplateKey ? "Update template from this item" : "Add this item to template"}
                      </label>
                      <p className="mt-1 text-[11px] text-[var(--ccr-muted)]">
                        When enabled, saving here also updates Admin Settings so future template applies stay in sync.
                      </p>
                      {editSaveToTemplate ? (
                        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          <label className="flex min-h-9 items-center gap-2 rounded-xl border border-[var(--ccr-border)] px-3 py-3 text-[11px] text-[var(--ccr-text)]">
                            <input
                              type="checkbox"
                              checked={editTemplateAllowNotRequired}
                              onChange={(event) => setEditTemplateAllowNotRequired(event.target.checked)}
                              className="h-4 w-4 rounded border border-[var(--ccr-border)] bg-transparent accent-[var(--ccr-accent)]"
                            />
                            Can be marked optional later
                          </label>
                          <label className="flex min-h-9 items-center gap-2 rounded-xl border border-[var(--ccr-border)] px-3 py-3 text-[11px] text-[var(--ccr-text)]">
                            <input
                              type="checkbox"
                              checked={editTemplateExpiryRequired}
                              onChange={(event) => setEditTemplateExpiryRequired(event.target.checked)}
                              className="h-4 w-4 rounded border border-[var(--ccr-border)] bg-transparent accent-[var(--ccr-accent)]"
                            />
                            Expiration required in template
                          </label>
                          <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                            Expiry warning days
                            <input
                              type="number"
                              min={0}
                              max={3650}
                              value={editTemplateExpiryWarningDays}
                              disabled={!editTemplateExpiryRequired}
                              onChange={(event) => setEditTemplateExpiryWarningDays(event.target.value)}
                              className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs text-[var(--ccr-text)] disabled:opacity-60"
                              placeholder="30"
                            />
                          </label>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      {editTemplateKey ? (
                        <button
                          type="button"
                          data-testid={`vehicle-checklist-edit-apply-template-${item.id}`}
                          onClick={applySelectedTemplateDefaults}
                          disabled={saving}
                          className="min-h-9 rounded-lg border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--ccr-accent-strong)] disabled:opacity-60"
                        >
                          Use template defaults
                        </button>
                      ) : null}
                      {item.allowNotRequired ? (
                        <label className="inline-flex min-h-9 items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                          <input
                            data-testid={`vehicle-checklist-edit-required-${item.id}`}
                            type="checkbox"
                            checked={editRequired}
                            onChange={(event) => setEditRequired(event.target.checked)}
                            className="h-4 w-4 rounded border border-[var(--ccr-border)] bg-transparent accent-[var(--ccr-accent)]"
                          />
                          Required item
                        </label>
                      ) : (
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                          This item must remain required.
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          data-testid={`vehicle-checklist-edit-save-${item.id}`}
                          onClick={() => void saveItemEdits(item)}
                          disabled={saving}
                          className="min-h-9 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--ccr-text)] disabled:opacity-60"
                        >
                          {saving ? "Saving..." : "Save details"}
                        </button>
                        <button
                          type="button"
                          data-testid={`vehicle-checklist-edit-cancel-${item.id}`}
                          onClick={cancelEditing}
                          disabled={saving}
                          className="min-h-9 rounded-lg border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--ccr-accent-strong)] disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
                {item.uploadedDocumentId ? (
                  <div className="space-y-2">
                    <p>Attached file: {item.uploadedDocumentDisplayLabel ?? "Linked vehicle file"}</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        data-testid="vehicle-checklist-preview-file"
                        onClick={() =>
                          openPreviewForItem(item)
                        }
                        className="inline-flex min-h-9 items-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1 text-[11px] font-semibold text-[var(--ccr-text)]"
                      >
                        Preview file
                      </button>
                      <a
                        data-testid="vehicle-checklist-download-file"
                        href={`/api/admin/vehicles/${vehicleId}/documents/${item.uploadedDocumentId}/download`}
                        className="inline-flex min-h-9 items-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1 text-[11px] font-semibold text-[var(--ccr-text)]"
                      >
                        Download file
                      </a>
                      <Link
                        data-testid="vehicle-checklist-manage-file"
                        href={`/admin/vehicles/${vehicleId}?tab=files&folder=${encodeURIComponent(item.folder)}&documentId=${encodeURIComponent(item.uploadedDocumentId)}`}
                        className="inline-flex min-h-9 items-center rounded-lg border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-3 py-1 text-[11px] font-semibold text-[var(--ccr-accent-strong)]"
                      >
                        Manage in Files
                      </Link>
                      <Link
                        data-testid="vehicle-checklist-replace-file"
                        href={`/admin/vehicles/${vehicleId}?tab=files&folder=${encodeURIComponent(item.folder)}&attachChecklistItemId=${encodeURIComponent(item.id)}`}
                        className="inline-flex min-h-9 items-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1 text-[11px] font-semibold text-[var(--ccr-text)]"
                      >
                        Replace in Files
                      </Link>
                    </div>
                  </div>
                ) : null}
                {!item.uploadedDocumentId ? (
                  <div className="mt-2">
                    <Link
                      data-testid="vehicle-checklist-add-file"
                      href={`/admin/vehicles/${vehicleId}?tab=files&folder=${encodeURIComponent(item.folder)}&attachChecklistItemId=${encodeURIComponent(item.id)}`}
                      className="inline-flex min-h-9 items-center rounded-lg border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-3 py-1 text-[11px] font-semibold text-[var(--ccr-accent-strong)]"
                    >
                      Add file in Files
                    </Link>
                  </div>
                ) : null}
                <div className="mt-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3">
                  <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                      Search files
                      <input
                        data-testid={`vehicle-checklist-attachment-search-${item.id}`}
                        value={attachmentSearch}
                        onChange={(event) =>
                          setRowAttachmentSearches((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                        placeholder="Search label, title, or type"
                        className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-xs text-[var(--ccr-text)]"
                      />
                    </label>
                    <label className="inline-flex min-h-9 items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                      <input
                        data-testid={`vehicle-checklist-attachment-include-linked-${item.id}`}
                        type="checkbox"
                        checked={includeLinkedFiles}
                        onChange={(event) =>
                          setRowAttachmentIncludeLinked((current) => ({
                            ...current,
                            [item.id]: event.target.checked,
                          }))
                        }
                        className="h-4 w-4 rounded border border-[var(--ccr-border)] bg-transparent accent-[var(--ccr-accent)]"
                      />
                      Show files linked elsewhere
                    </label>
                  </div>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                    Attachment
                    <select
                      data-testid={`vehicle-checklist-attachment-select-${item.id}`}
                      value={selectedAttachmentId}
                      onChange={(event) =>
                        setRowAttachmentSelections((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))
                      }
                      className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-2 text-xs text-[var(--ccr-text)]"
                    >
                      <option value="">No attachment</option>
                      {attachmentOptions.map((document) => (
                        <option key={document.id} value={document.id}>
                          {getVehicleDocumentDisplayLabel(document)}
                          {document.documentType ? ` · ${document.documentType}` : ""}
                          {document.checklistItemLabel && document.checklistItemLabel !== item.label
                            ? ` · currently on ${document.checklistItemLabel}`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      data-testid={`vehicle-checklist-attachment-save-${item.id}`}
                      onClick={() => void updateChecklistAttachment(item, selectedAttachmentId)}
                      disabled={
                        attachmentSavingItemId === item.id ||
                        selectedAttachmentId === (item.uploadedDocumentId ?? "")
                      }
                      className="min-h-9 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--ccr-text)] disabled:opacity-60"
                    >
                      {attachmentSavingItemId === item.id
                        ? "Saving..."
                        : item.uploadedDocumentId
                          ? "Save attachment"
                          : "Attach file"}
                    </button>
                    {item.uploadedDocumentId ? (
                      <button
                        type="button"
                        data-testid={`vehicle-checklist-attachment-clear-${item.id}`}
                        onClick={() => void updateChecklistAttachment(item, "")}
                        disabled={attachmentSavingItemId === item.id}
                        className="min-h-9 rounded-lg border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--ccr-accent-strong)] disabled:opacity-60"
                      >
                        Unlink file
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-2 text-[11px] text-[var(--ccr-muted)]">
                    {folderDocuments.length > 0
                      ? `${attachmentOptions.length} file(s) shown in ${item.folder}. ${availableDocuments.length} available by default.${hiddenLinkedDocuments.length > 0 ? ` ${hiddenLinkedDocuments.length} linked elsewhere hidden until enabled.` : ""}`
                      : "No saved files exist in this folder yet."}
                  </p>
                </div>
                  {item.required && !item.allowNotRequired ? (
                    <p>This item should remain required.</p>
                  ) : null}
                </div>
              </div>

              <div className="absolute right-4 top-4 flex max-w-[12rem] flex-wrap justify-end gap-2">
                {item.required ? (
                  <span className="rounded-full border border-amber-300/50 bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-[var(--ccr-required-text)]">
                    Required
                  </span>
                ) : null}
                <button
                  type="button"
                  data-testid={`vehicle-checklist-edit-toggle-${item.id}`}
                  onClick={() => (isEditing ? cancelEditing() : startEditing(item))}
                  className="rounded-full border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1 text-[11px] font-semibold text-[var(--ccr-text)]"
                >
                  {isEditing ? "Cancel" : "Edit"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(item.id)}
                  className="rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-3 py-1 text-[11px] font-semibold text-[var(--ccr-accent-strong)]"
                >
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {previewItem ? (
        <VehicleDocumentPreviewModal
          vehicleId={vehicleId}
          document={previewItem}
          onClose={() => setPreviewItem(null)}
          modalTestId="vehicle-checklist-preview-modal"
          metaTestId="vehicle-checklist-preview-meta"
        />
      ) : null}
    </section>
  );
}
