"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { TableDateTime } from "@/components/shared/TableDateTime";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

const DEFAULT_FOLDERS = ["Paperwork", "Insurance", "Registration", "Other"] as const;
const CUSTOM_DOCUMENT_TYPE_VALUE = "__custom__";
const WIDGET_SRC = "https://ucarecdn.com/libs/widget/3.x/uploadcare.full.min.js";

type VehicleFilesPanelProps = {
  vehicleId: string;
  folders?: string[];
  documentTypes?: string[];
  initialFolder?: string;
  initialDocumentId?: string;
};

type VehicleDocument = {
  id: string;
  folder: string;
  documentType: string;
  label: string | null;
  checklistItemId: string | null;
  checklistItemLabel: string | null;
  linkedTo: string;
  title: string;
  storageProvider: string;
  mimeType: string | null;
  sizeBytes: number | null;
  canDownload: boolean;
  createdAt: string;
};

type ChecklistItemOption = {
  id: string;
  label: string;
  folder: string;
  required: boolean;
  uploadedDocumentId: string | null;
  uploadedDocumentDisplayLabel: string | null;
};

type UploadcareFileInfo = {
  cdnUrl?: string;
  uuid?: string;
  name?: string;
  originalFilename?: string;
  size?: number;
  mimeType?: string;
};

type UploadcareSingleFile = {
  promise?: () => Promise<UploadcareFileInfo>;
  done?: (callback: (file: UploadcareFileInfo) => void) => void;
};

type UploadcareFileGroup = {
  files?: () => UploadcareSingleFile[];
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

type PendingUpload = {
  reference: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
};

async function loadUploadcareScript() {
  if (typeof window === "undefined") return;
  const uploadWindow = window as Window & { uploadcare?: UploadcareApi; UPLOADCARE_PUBLIC_KEY?: string };
  if (uploadWindow.uploadcare) return;

  const existing = document.querySelector<HTMLScriptElement>(`script[src="${WIDGET_SRC}"]`);
  if (existing) {
    await new Promise<void>((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Uploadcare failed to load")), { once: true });
    });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = WIDGET_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Uploadcare failed to load"));
    document.body.appendChild(script);
  });
}

function normalizeBytes(value: number | null) {
  if (!value || value < 1) return "Unknown size";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round((value / 1024) * 10) / 10} KB`;
  return `${Math.round((value / (1024 * 1024)) * 10) / 10} MB`;
}

function normalizeFolders(input: string[] | undefined) {
  const next = (input ?? [])
    .map((folder) => folder.trim())
    .filter(Boolean)
    .slice(0, 20);
  if (next.length > 0) return next;
  return [...DEFAULT_FOLDERS];
}

function normalizeDocumentTypes(input: string[] | undefined) {
  const next = (input ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 40);
  if (next.length > 0) return next;
  return ["General", "Registration", "Insurance", "Service Invoice", "Receipt", "Photo", "Other"];
}

function getDocumentDisplayLabel(item: Pick<VehicleDocument, "label" | "title">) {
  const label = item.label?.trim();
  return label ? label : item.title;
}

export function VehicleFilesPanel({
  vehicleId,
  folders: configuredFolders,
  documentTypes: configuredDocumentTypes,
  initialFolder,
  initialDocumentId,
}: VehicleFilesPanelProps) {
  const publicKey = process.env.NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY ?? "";
  const folders = useMemo(() => normalizeFolders(configuredFolders), [configuredFolders]);
  const documentTypes = useMemo(
    () => normalizeDocumentTypes(configuredDocumentTypes),
    [configuredDocumentTypes],
  );
  const normalizedInitialFolder = useMemo(() => {
    const candidate = initialFolder?.trim() ?? "";
    return folders.includes(candidate) ? candidate : folders[0];
  }, [folders, initialFolder]);

  const [activeFolder, setActiveFolder] = useState<string>(normalizedInitialFolder);
  const [items, setItems] = useState<VehicleDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checklistItems, setChecklistItems] = useState<ChecklistItemOption[]>([]);
  const [checklistError, setChecklistError] = useState<string | null>(null);

  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [documentType, setDocumentType] = useState(documentTypes[0] ?? "General");
  const [label, setLabel] = useState("");
  const [title, setTitle] = useState("");
  const [selectedChecklistItemId, setSelectedChecklistItemId] = useState("");
  const [rowChecklistSelections, setRowChecklistSelections] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [linkSavingDocId, setLinkSavingDocId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<VehicleDocument | null>(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [initialPreviewHandled, setInitialPreviewHandled] = useState(false);
  const [initialScrollHandled, setInitialScrollHandled] = useState(false);
  const [highlightedDocumentId, setHighlightedDocumentId] = useState<string | null>(
    initialDocumentId?.trim() || null,
  );
  const rowRefs = useRef<Record<string, HTMLElement | null>>({});

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setDocumentsLoaded(false);
    setError(null);

    try {
      const params = new URLSearchParams({ folder: activeFolder });
      const response = await fetch(`/api/admin/vehicles/${vehicleId}/documents?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        items?: Array<{
          id: string;
          folder: string;
          documentType: string;
          label: string | null;
          checklistItemId: string | null;
          checklistItemLabel: string | null;
          linkedTo: string;
          title: string;
          storageProvider: string;
          mimeType: string | null;
          sizeBytes: number | null;
          canDownload: boolean;
          createdAt: string;
        }>;
      };

      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Unable to load files.");
        setItems([]);
        return;
      }

      const nextItems = Array.isArray(payload.items)
        ? payload.items.map((entry) => ({
            id: entry.id,
            folder: entry.folder,
            documentType: entry.documentType,
            label: entry.label,
            checklistItemId: entry.checklistItemId ?? null,
            checklistItemLabel: entry.checklistItemLabel ?? null,
            linkedTo: entry.linkedTo,
            title: entry.title,
            storageProvider: entry.storageProvider,
            mimeType: entry.mimeType,
            sizeBytes: entry.sizeBytes,
            canDownload: Boolean(entry.canDownload),
            createdAt: entry.createdAt,
          }))
        : [];

      setItems(nextItems);
    } catch {
      setError("Unable to load files.");
      setItems([]);
    } finally {
      setLoading(false);
      setDocumentsLoaded(true);
    }
  }, [activeFolder, vehicleId]);

  const loadChecklistItems = useCallback(async () => {
    setChecklistError(null);

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
          uploadedDocumentId: string | null;
          uploadedDocumentDisplayLabel: string | null;
        }>;
      };

      if (!response.ok || !payload.ok) {
        setChecklistError(payload.error ?? "Unable to load checklist items for file linking.");
        setChecklistItems([]);
        return;
      }

      setChecklistItems(
        (payload.items ?? []).map((item) => ({
          id: item.id,
          label: item.label,
          folder: item.folder,
          required: Boolean(item.required),
          uploadedDocumentId: item.uploadedDocumentId ?? null,
          uploadedDocumentDisplayLabel: item.uploadedDocumentDisplayLabel ?? null,
        })),
      );
    } catch {
      setChecklistError("Unable to load checklist items for file linking.");
      setChecklistItems([]);
    }
  }, [vehicleId]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    void loadChecklistItems();
  }, [loadChecklistItems]);

  useEffect(() => {
    if (!documentType.trim()) {
      setDocumentType(documentTypes[0] ?? "General");
    }
  }, [documentType, documentTypes]);

  useEffect(() => {
    if (normalizedInitialFolder) {
      setActiveFolder(normalizedInitialFolder);
    }
  }, [normalizedInitialFolder]);

  useEffect(() => {
    setInitialPreviewHandled(false);
    setInitialScrollHandled(false);
    setHighlightedDocumentId(initialDocumentId?.trim() || null);
  }, [initialDocumentId]);

  const isCustomDocumentType = !documentTypes.includes(documentType);
  const selectedDocumentTypeValue = isCustomDocumentType ? CUSTOM_DOCUMENT_TYPE_VALUE : documentType;
  const availableChecklistItems = useMemo(
    () => checklistItems.filter((item) => item.folder === activeFolder),
    [activeFolder, checklistItems],
  );
  const selectedChecklistItem = useMemo(
    () => availableChecklistItems.find((item) => item.id === selectedChecklistItemId) ?? null,
    [availableChecklistItems, selectedChecklistItemId],
  );

  useEffect(() => {
    if (
      selectedChecklistItemId &&
      !availableChecklistItems.some((item) => item.id === selectedChecklistItemId)
    ) {
      setSelectedChecklistItemId("");
    }
  }, [availableChecklistItems, selectedChecklistItemId]);

  useEffect(() => {
    const nextSelections: Record<string, string> = {};
    for (const item of items) {
      nextSelections[item.id] = item.checklistItemId ?? "";
    }
    setRowChecklistSelections(nextSelections);
  }, [items]);

  useEffect(() => {
    if (!initialDocumentId || initialPreviewHandled || !documentsLoaded) return;
    const matchedItem = items.find((item) => item.id === initialDocumentId);
    if (matchedItem) {
      setPreviewItem(matchedItem);
      setInitialPreviewHandled(true);
      return;
    }
    setInitialPreviewHandled(true);
  }, [documentsLoaded, initialDocumentId, initialPreviewHandled, items]);

  useEffect(() => {
    if (!highlightedDocumentId || initialScrollHandled || !documentsLoaded) return;
    const matchedRow = rowRefs.current[highlightedDocumentId];
    if (matchedRow) {
      matchedRow.scrollIntoView({ block: "center", behavior: "smooth" });
      setInitialScrollHandled(true);
      return;
    }
    setInitialScrollHandled(true);
  }, [documentsLoaded, highlightedDocumentId, initialScrollHandled]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    const loadPreview = async () => {
      if (!previewItem) {
        setPreviewBlobUrl(null);
        setPreviewLoading(false);
        setPreviewError(null);
        return;
      }

      setPreviewLoading(true);
      setPreviewError(null);
      setPreviewBlobUrl(null);

      try {
        const response = await fetch(
          `/api/admin/vehicles/${vehicleId}/documents/${previewItem.id}/file?inline=1`,
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
  }, [previewItem, vehicleId]);

  const chooseFile = async () => {
    setError(null);
    setMessage(null);

    if (!publicKey) {
      setError("Uploadcare is not configured.");
      return;
    }

    try {
      await loadUploadcareScript();
      const uploadWindow = window as Window & {
        uploadcare?: UploadcareApi;
        UPLOADCARE_PUBLIC_KEY?: string;
      };

      uploadWindow.UPLOADCARE_PUBLIC_KEY = publicKey;
      const dialog = uploadWindow.uploadcare?.openDialog(null, {
        publicKey,
        multiple: false,
        imagesOnly: false,
      });

      if (!dialog) {
        setError("Unable to open upload dialog.");
        return;
      }

      dialog.done(async (file) => {
        const singleFile = typeof (file as UploadcareFileGroup).files === "function"
          ? (file as UploadcareFileGroup).files?.()?.[0]
          : (file as UploadcareSingleFile);
        if (!singleFile) {
          setError("Upload returned no file.");
          return;
        }
        const info =
          typeof singleFile.promise === "function"
            ? await singleFile.promise()
            : await new Promise<UploadcareFileInfo>((resolve) => singleFile.done?.(resolve));

        const reference = String(info?.cdnUrl ?? info?.uuid ?? "").trim();
        if (!reference) {
          setError("Upload returned an invalid file reference.");
          return;
        }

        const fileName = String(info?.originalFilename ?? info?.name ?? "Document").trim() || "Document";
        setPendingUpload({
          reference,
          fileName,
          mimeType: typeof info?.mimeType === "string" ? info.mimeType : null,
          sizeBytes: typeof info?.size === "number" && Number.isFinite(info.size) ? Math.round(info.size) : null,
        });
        setTitle(fileName);
      });

      dialog.fail((requestError) => {
        setError(requestError?.message ?? "Upload cancelled.");
      });
    } catch {
      setError("Unable to open upload dialog.");
    }
  };

  const saveUpload = async () => {
    if (!pendingUpload) return;
    if (saving) return;

    const normalizedType = documentType.trim();
    const normalizedLabel = label.trim();
    const normalizedTitle = title.trim();
    if (!normalizedType || !normalizedTitle) {
      setError("Document type and title are required.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`/api/admin/vehicles/${vehicleId}/documents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          folder: activeFolder,
          checklistItemId: selectedChecklistItemId || null,
          documentType: normalizedType,
          label: normalizedLabel || null,
          title: normalizedTitle,
          storageProvider: "UPLOADCARE_FILE_ID",
          storageKey: pendingUpload.reference,
          mimeType: pendingUpload.mimeType,
          sizeBytes: pendingUpload.sizeBytes,
          tags: [],
          csrfToken,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Unable to save file.");
        return;
      }

      setPendingUpload(null);
      setLabel("");
      setTitle("");
      setSelectedChecklistItemId("");
      setDocumentType(documentTypes[0] ?? "General");
      setMessage("File added.");
      await Promise.all([loadDocuments(), loadChecklistItems()]);
    } catch {
      setError("Unable to save file.");
    } finally {
      setSaving(false);
    }
  };

  const archiveDocument = async (docId: string) => {
    const confirmed = window.confirm("Archive this file?");
    if (!confirmed) return;

    setError(null);
    setMessage(null);
    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/vehicles/${vehicleId}/documents/${docId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({ archived: true, csrfToken }),
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      setError(payload.error ?? "Unable to archive file.");
      return;
    }

    setMessage("File archived.");
    await Promise.all([loadDocuments(), loadChecklistItems()]);
  };

  const updateDocumentChecklistLink = async (docId: string, checklistItemId: string) => {
    if (linkSavingDocId) return;

    setLinkSavingDocId(docId);
    setError(null);
    setMessage(null);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`/api/admin/vehicles/${vehicleId}/documents/${docId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          checklistItemId: checklistItemId || null,
          csrfToken,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Unable to update file link.");
        return;
      }

      setMessage(checklistItemId ? "File link updated." : "File unlinked from checklist.");
      await Promise.all([loadDocuments(), loadChecklistItems()]);
    } catch {
      setError("Unable to update file link.");
    } finally {
      setLinkSavingDocId(null);
    }
  };

  const closePreview = () => {
    const shouldClearDeepLink =
      typeof window !== "undefined" &&
      initialDocumentId &&
      previewItem?.id === initialDocumentId;
    setPreviewItem(null);
    if (!shouldClearDeepLink) return;

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("documentId");
    window.history.replaceState(window.history.state, "", nextUrl.toString());
  };

  return (
    <section
      data-testid="vehicle-files-panel"
      className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Files</h2>
          <p className="text-xs text-[var(--ccr-muted)]">Store per-vehicle documents by folder.</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
          Folder
          <select
            data-testid="vehicle-files-folder-select"
            value={activeFolder}
            onChange={(event) => setActiveFolder(event.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
          >
            {folders.map((folder) => (
              <option key={folder} value={folder}>
                {folder}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Document type
            <select
              value={selectedDocumentTypeValue}
              onChange={(event) =>
                setDocumentType(
                  event.target.value === CUSTOM_DOCUMENT_TYPE_VALUE
                    ? ""
                    : event.target.value,
                )
              }
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              {documentTypes.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={CUSTOM_DOCUMENT_TYPE_VALUE}>Custom type</option>
            </select>
          </label>
          {isCustomDocumentType ? (
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Custom document type
              <input
                value={documentType}
                onChange={(event) => setDocumentType(event.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                placeholder="Roadside contract"
              />
            </label>
          ) : null}
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Label
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              placeholder="Insurance 2026"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              placeholder="Insurance 2026"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Link checklist item
            <select
              data-testid="vehicle-files-checklist-link"
              value={selectedChecklistItemId}
              onChange={(event) => setSelectedChecklistItemId(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)] disabled:opacity-60"
              disabled={availableChecklistItems.length < 1}
            >
              <option value="">No checklist link</option>
              {availableChecklistItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.required ? " (required)" : ""}
                  {item.uploadedDocumentId ? " · replaces current attachment" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-2 grid gap-1 text-xs text-[var(--ccr-muted)]">
          <p>Label is shown in the file list. Leave it blank to fall back to the title.</p>
          <p>Title stores the file title and defaults to the uploaded filename.</p>
          <p>Linking a file marks that checklist item as attached. Archiving the file clears the link.</p>
          {availableChecklistItems.length < 1 ? (
            <p>No checklist items exist in this folder yet.</p>
          ) : null}
          {selectedChecklistItem?.uploadedDocumentId ? (
            <p>
              Saving will replace the current attachment for {selectedChecklistItem.label}.
            </p>
          ) : null}
        </div>

        <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap sm:items-center">
          <button
            type="button"
            onClick={() => void chooseFile()}
            data-testid="vehicle-files-upload-button"
            className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Upload file
          </button>
          <button
            type="button"
            onClick={() => void saveUpload()}
            disabled={!pendingUpload || saving}
            className="min-h-11 rounded-lg border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save file"}
          </button>
          <p className="text-xs text-[var(--ccr-muted)] break-all">
            {pendingUpload
              ? `Selected: ${pendingUpload.fileName} (${normalizeBytes(pendingUpload.sizeBytes)})`
              : "Select a file before saving."}
          </p>
        </div>
      </div>

      {error ? <p className="mt-3 text-xs font-semibold text-red-300">{error}</p> : null}
      {checklistError ? <p className="mt-3 text-xs font-semibold text-red-300">{checklistError}</p> : null}
      {message ? <p className="mt-3 text-xs font-semibold text-emerald-200">{message}</p> : null}

      <div className="mt-4 space-y-3">
        {loading ? <p className="text-sm text-[var(--ccr-muted)]">Loading files...</p> : null}
        {!loading && items.length < 1 ? (
          <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-4 py-5">
            <p className="text-sm font-semibold text-[var(--ccr-text)]">No files in this folder.</p>
            <p className="mt-1 text-xs text-[var(--ccr-muted)]">
              Upload a file and save it to this folder to start building the document trail.
            </p>
          </div>
        ) : null}
        {!loading && items.length > 0 ? (
          <>
            <div className="space-y-3 md:hidden">
              {items.map((item) => {
                const isHighlighted = highlightedDocumentId === item.id;
                return (
                  <article
                    key={item.id}
                    ref={(node) => {
                      rowRefs.current[item.id] = node;
                    }}
                    data-testid="vehicle-file-card"
                    data-highlighted={isHighlighted ? "true" : "false"}
                    className={`rounded-xl border p-4 transition-colors ${
                      isHighlighted
                        ? "border-[var(--ccr-accent)] bg-[color-mix(in_srgb,var(--ccr-accent)_10%,var(--ccr-surface-soft))] shadow-[0_0_0_1px_var(--ccr-accent)]"
                        : "border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)]"
                    }`}
                  >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-[var(--ccr-text)] break-words">
                        {getDocumentDisplayLabel(item)}
                      </p>
                      {item.label ? (
                        <p className="text-xs text-[var(--ccr-muted)] break-words">{item.title}</p>
                      ) : null}
                      <p className="text-xs text-[var(--ccr-muted)]">{item.documentType}</p>
                    </div>
                    <span className="rounded-full border border-[var(--ccr-border)] px-2 py-1 text-[11px] font-semibold text-[var(--ccr-muted)]">
                      {item.folder}
                    </span>
                  </div>

                  <div className="mt-2 text-xs text-[var(--ccr-muted)] break-words">
                    <p>Linked to: {item.linkedTo}</p>
                    {item.checklistItemLabel ? <p>Checklist: {item.checklistItemLabel}</p> : null}
                    <p>Uploaded: <DateTimeInline value={item.createdAt} /></p>
                    <p>{item.mimeType || "Unknown type"} · {normalizeBytes(item.sizeBytes)}</p>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.canDownload ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setPreviewItem(item)}
                          className="inline-flex min-h-10 items-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                        >
                          View
                        </button>
                        <a
                          href={`/api/admin/vehicles/${vehicleId}/documents/${item.id}/download`}
                          className="inline-flex min-h-10 items-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                        >
                          Download
                        </a>
                      </>
                    ) : (
                      <span className="inline-flex min-h-10 items-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-muted)]">
                        Unavailable
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void archiveDocument(item.id)}
                      className="min-h-10 rounded-lg border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-accent-strong)]"
                    >
                      Archive
                    </button>
                  </div>

                  <div className="mt-3 grid gap-2">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                      Checklist link
                      <select
                        data-testid="vehicle-file-link-select"
                        value={rowChecklistSelections[item.id] ?? ""}
                        onChange={(event) =>
                          setRowChecklistSelections((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                        className="mt-1 w-full rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs text-[var(--ccr-text)]"
                      >
                        <option value="">No checklist link</option>
                        {availableChecklistItems.map((checklistItem) => (
                          <option key={checklistItem.id} value={checklistItem.id}>
                            {checklistItem.label}
                            {checklistItem.required ? " (required)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      data-testid="vehicle-file-link-save"
                      onClick={() =>
                        void updateDocumentChecklistLink(item.id, rowChecklistSelections[item.id] ?? "")
                      }
                      disabled={
                        linkSavingDocId === item.id ||
                        (rowChecklistSelections[item.id] ?? "") === (item.checklistItemId ?? "")
                      }
                      className="min-h-10 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
                    >
                      {linkSavingDocId === item.id ? "Saving link..." : "Save link"}
                    </button>
                  </div>
                  </article>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                  <tr>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Label</th>
                    <th className="px-3 py-2">Linked To</th>
                    <th className="px-3 py-2">Checklist</th>
                    <th className="px-3 py-2">Uploaded</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const isHighlighted = highlightedDocumentId === item.id;
                    return (
                      <tr
                        key={`desktop-${item.id}`}
                        ref={(node) => {
                          rowRefs.current[item.id] = node;
                        }}
                        data-testid={`vehicle-file-row-${item.id}`}
                        data-highlighted={isHighlighted ? "true" : "false"}
                        className={`border-b last:border-b-0 ${
                          isHighlighted
                            ? "border-[var(--ccr-accent)] bg-[color-mix(in_srgb,var(--ccr-accent)_8%,transparent)]"
                            : "border-[var(--ccr-border)]"
                        }`}
                      >
                      <td className="px-3 py-2 text-[var(--ccr-text)]">{item.documentType}</td>
                      <td className="px-3 py-2 text-[var(--ccr-text)] break-words">
                        <div className="space-y-1">
                          <p>{getDocumentDisplayLabel(item)}</p>
                          {item.label ? (
                            <p className="text-xs text-[var(--ccr-muted)]">{item.title}</p>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[var(--ccr-muted)] break-words">{item.linkedTo}</td>
                      <td className="px-3 py-2 text-[var(--ccr-muted)] break-words">
                        {item.checklistItemLabel ? item.checklistItemLabel : "Not linked"}
                      </td>
                      <td className="px-3 py-2 text-[var(--ccr-muted)]">
                        <TableDateTime value={item.createdAt} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          {item.canDownload ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setPreviewItem(item)}
                                className="inline-flex min-h-9 items-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]"
                              >
                                View
                              </button>
                              <a
                                href={`/api/admin/vehicles/${vehicleId}/documents/${item.id}/download`}
                                className="inline-flex min-h-9 items-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]"
                              >
                                Download
                              </a>
                            </>
                          ) : (
                            <span className="inline-flex min-h-9 items-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1 text-xs font-semibold text-[var(--ccr-muted)]">
                              Unavailable
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => void archiveDocument(item.id)}
                            className="min-h-9 rounded-lg border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-3 py-1 text-xs font-semibold text-[var(--ccr-accent-strong)]"
                          >
                            Archive
                          </button>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <select
                            data-testid="vehicle-file-link-select"
                            value={rowChecklistSelections[item.id] ?? ""}
                            onChange={(event) =>
                              setRowChecklistSelections((current) => ({
                                ...current,
                                [item.id]: event.target.value,
                              }))
                            }
                            className="min-h-9 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1 text-xs text-[var(--ccr-text)]"
                          >
                            <option value="">No checklist link</option>
                            {availableChecklistItems.map((checklistItem) => (
                              <option key={checklistItem.id} value={checklistItem.id}>
                                {checklistItem.label}
                                {checklistItem.required ? " (required)" : ""}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            data-testid="vehicle-file-link-save"
                            onClick={() =>
                              void updateDocumentChecklistLink(item.id, rowChecklistSelections[item.id] ?? "")
                            }
                            disabled={
                              linkSavingDocId === item.id ||
                              (rowChecklistSelections[item.id] ?? "") === (item.checklistItemId ?? "")
                            }
                            className="min-h-9 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)] disabled:opacity-60"
                          >
                            {linkSavingDocId === item.id ? "Saving link..." : "Save link"}
                          </button>
                        </div>
                      </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>

      {previewItem ? (
        <div
          data-testid="vehicle-file-preview-modal"
          className="fixed inset-0 z-50 bg-black/70 p-3 sm:p-6"
          onClick={closePreview}
        >
          <div
            className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--ccr-border)] px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--ccr-text)]">
                  {getDocumentDisplayLabel(previewItem)}
                </p>
                <p
                  data-testid="vehicle-file-preview-meta"
                  className="truncate text-xs text-[var(--ccr-muted)]"
                >
                  {previewItem.documentType}
                  {previewItem.label ? ` · ${previewItem.title}` : ""}
                  {previewItem.checklistItemLabel ? ` · Checklist: ${previewItem.checklistItemLabel}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                {previewItem.canDownload ? (
                  <a
                    href={`/api/admin/vehicles/${vehicleId}/documents/${previewItem.id}/download`}
                    className="inline-flex min-h-9 items-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]"
                  >
                    Download
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={closePreview}
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
                <div className="px-4 py-6 text-sm text-red-300">
                  {previewError}
                </div>
              ) : null}

              {!previewLoading && !previewError && previewBlobUrl ? (
                previewItem.mimeType?.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewBlobUrl}
                    alt={previewItem.title}
                    className="max-h-[78vh] w-full object-contain"
                  />
                ) : (
                  <iframe
                    title={`Preview ${previewItem.title}`}
                    src={previewBlobUrl}
                    className="h-[78vh] w-full"
                  />
                )
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
