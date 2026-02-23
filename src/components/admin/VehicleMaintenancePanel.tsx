"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { ensureCsrfToken } from "@/lib/security/csrf-client";

const WIDGET_SRC = "https://ucarecdn.com/libs/widget/3.x/uploadcare.full.min.js";

type VehicleMaintenancePanelProps = {
  vehicleId: string;
  initialRecordId?: string | null;
};

type DueState = "OVERDUE" | "DUE_SOON" | "UPCOMING" | "COMPLETED" | "CANCELLED";
type RecordStatus = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

type MaintenanceRecord = {
  id: string;
  vehicleId: string;
  status: RecordStatus;
  category: string;
  title: string;
  description: string | null;
  vendorName: string | null;
  vendorContact: string | null;
  referenceNumber: string | null;
  serviceDate: string | null;
  scheduledDate: string | null;
  odometerKm: number | null;
  nextDueDate: string | null;
  nextDueOdometerKm: number | null;
  laborCostCents: number | null;
  partsCostCents: number | null;
  taxCostCents: number | null;
  totalCostCents: number;
  currency: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  dueState: DueState;
};

type VehicleDocument = {
  id: string;
  maintenanceRecordId: string | null;
  linkedTo: string;
  documentType: string;
  label: string | null;
  title: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  archivedAt: string | null;
};

type MaintenanceSummary = {
  totalMaintenanceCostCents: number;
  lastServiceDate: string | null;
  nextDueDate: string | null;
  overdueCount: number;
  openScheduledCount: number;
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

const CATEGORY_OPTIONS = [
  "SERVICE",
  "REPAIR",
  "INSPECTION",
  "REGISTRATION",
  "INSURANCE",
  "TIRE",
  "BRAKE",
  "BATTERY",
  "OTHER",
] as const;

const STATUS_OPTIONS: RecordStatus[] = ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
const DUE_FILTERS = [
  { key: "ALL", label: "All" },
  { key: "OVERDUE", label: "Overdue" },
  { key: "DUE_SOON", label: "Due Soon" },
  { key: "UPCOMING", label: "Upcoming" },
  { key: "COMPLETED", label: "Completed" },
] as const;

type DueFilter = (typeof DUE_FILTERS)[number]["key"];

function normalizeText(value: string) {
  return value.trim();
}

function formatStatus(value: string) {
  const normalized = value.trim().toUpperCase();
  if (normalized === "IN_PROGRESS") return "In Progress";
  if (normalized === "SCHEDULED") return "Scheduled";
  if (normalized === "COMPLETED") return "Completed";
  if (normalized === "CANCELLED") return "Cancelled";
  return normalized || "Unknown";
}

function statusTone(status: string) {
  const normalized = status.trim().toUpperCase();
  if (normalized === "COMPLETED") return "border-emerald-300/45 bg-emerald-500/15 text-emerald-100";
  if (normalized === "IN_PROGRESS") return "border-cyan-300/45 bg-cyan-500/15 text-cyan-100";
  if (normalized === "CANCELLED") return "border-rose-300/45 bg-rose-500/15 text-rose-100";
  return "border-amber-300/45 bg-amber-500/15 text-amber-100";
}

function dueTone(state: DueState) {
  if (state === "OVERDUE") return "border-rose-300/45 bg-rose-500/15 text-rose-100";
  if (state === "DUE_SOON") return "border-amber-300/45 bg-amber-500/15 text-amber-100";
  if (state === "UPCOMING") return "border-sky-300/45 bg-sky-500/15 text-sky-100";
  if (state === "COMPLETED") return "border-emerald-300/45 bg-emerald-500/15 text-emerald-100";
  return "border-slate-300/45 bg-slate-500/15 text-slate-100";
}

function dueLabel(state: DueState) {
  if (state === "DUE_SOON") return "Due Soon";
  if (state === "OVERDUE") return "Overdue";
  if (state === "UPCOMING") return "Upcoming";
  if (state === "COMPLETED") return "Completed";
  return "Cancelled";
}

function formatCurrency(cents: number | null) {
  if (cents === null || !Number.isFinite(cents)) return "N/A";
  return new Intl.NumberFormat("en-JM", { style: "currency", currency: "JMD" }).format(cents / 100);
}

function formatBytes(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 1) return "Unknown size";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round((value / 1024) * 10) / 10} KB`;
  return `${Math.round((value / (1024 * 1024)) * 10) / 10} MB`;
}

function computeTotal(labor: string, parts: string, tax: string) {
  const laborValue = Number(labor || 0);
  const partsValue = Number(parts || 0);
  const taxValue = Number(tax || 0);
  const safe = [laborValue, partsValue, taxValue].map((value) =>
    Number.isFinite(value) && value > 0 ? Math.round(value) : 0,
  );
  return safe[0] + safe[1] + safe[2];
}

async function loadUploadcareScript() {
  if (typeof window === "undefined") return;
  const uploadWindow = window as Window & { uploadcare?: UploadcareApi; UPLOADCARE_PUBLIC_KEY?: string };
  if (uploadWindow.uploadcare) return;

  const existing = document.querySelector<HTMLScriptElement>(`script[src="${WIDGET_SRC}"]`);
  if (existing) {
    await new Promise<void>((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Uploadcare failed to load")), {
        once: true,
      });
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

function defaultFormState() {
  return {
    status: "SCHEDULED" as RecordStatus,
    category: "SERVICE",
    title: "",
    description: "",
    vendorName: "",
    vendorContact: "",
    referenceNumber: "",
    serviceDate: "",
    scheduledDate: "",
    odometerKm: "",
    nextDueDate: "",
    nextDueOdometerKm: "",
    laborCostCents: "",
    partsCostCents: "",
    taxCostCents: "",
    priority: "NORMAL",
  };
}

export function VehicleMaintenancePanel({ vehicleId, initialRecordId }: VehicleMaintenancePanelProps) {
  const publicKey = process.env.NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY ?? "";

  const [items, setItems] = useState<MaintenanceRecord[]>([]);
  const [summary, setSummary] = useState<MaintenanceSummary | null>(null);
  const [docs, setDocs] = useState<VehicleDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [activeDueFilter, setActiveDueFilter] = useState<DueFilter>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(initialRecordId ?? null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [documentType, setDocumentType] = useState("SERVICE_INVOICE");
  const [documentLabel, setDocumentLabel] = useState("");
  const [form, setForm] = useState(defaultFormState);

  const selectedRecord = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  const filteredItems = useMemo(() => {
    if (activeDueFilter === "ALL") return items;
    if (activeDueFilter === "COMPLETED") {
      return items.filter((item) => item.status === "COMPLETED" || item.dueState === "COMPLETED");
    }
    return items.filter((item) => item.dueState === activeDueFilter);
  }, [activeDueFilter, items]);

  const selectedDocs = useMemo(
    () => docs.filter((doc) => doc.maintenanceRecordId === selectedRecord?.id && doc.archivedAt === null),
    [docs, selectedRecord?.id],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const dueQuery = activeDueFilter === "ALL" ? "" : `?dueState=${activeDueFilter}`;
      const [maintenanceResponse, docsResponse] = await Promise.all([
        fetch(`/api/admin/vehicles/${vehicleId}/maintenance${dueQuery}`, { cache: "no-store" }),
        fetch(`/api/admin/vehicles/${vehicleId}/documents?includeArchived=1`, { cache: "no-store" }),
      ]);

      const maintenancePayload = (await maintenanceResponse.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        items?: MaintenanceRecord[];
        summary?: MaintenanceSummary;
      };

      const docsPayload = (await docsResponse.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        items?: VehicleDocument[];
      };

      if (!maintenanceResponse.ok || !maintenancePayload.ok) {
        throw new Error(maintenancePayload.error ?? "Unable to load maintenance records.");
      }
      if (!docsResponse.ok || !docsPayload.ok) {
        throw new Error(docsPayload.error ?? "Unable to load maintenance documents.");
      }

      const maintenanceItems = Array.isArray(maintenancePayload.items) ? maintenancePayload.items : [];
      setItems(maintenanceItems);
      setSummary(maintenancePayload.summary ?? null);
      setDocs(Array.isArray(docsPayload.items) ? docsPayload.items : []);

      if (maintenanceItems.length < 1) {
        setSelectedId(null);
        return;
      }

      if (selectedId) {
        const stillExists = maintenanceItems.some((item) => item.id === selectedId);
        if (stillExists) return;
      }

      const targetFromQuery = initialRecordId
        ? maintenanceItems.find((item) => item.id === initialRecordId)?.id ?? null
        : null;
      setSelectedId(targetFromQuery ?? maintenanceItems[0].id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load maintenance data.");
      setItems([]);
      setSummary(null);
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [activeDueFilter, initialRecordId, selectedId, vehicleId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function resetForm() {
    setForm(defaultFormState());
    setEditingId(null);
  }

  function startEdit(item: MaintenanceRecord) {
    setEditingId(item.id);
    setForm({
      status: item.status,
      category: item.category,
      title: item.title,
      description: item.description ?? "",
      vendorName: item.vendorName ?? "",
      vendorContact: item.vendorContact ?? "",
      referenceNumber: item.referenceNumber ?? "",
      serviceDate: item.serviceDate ?? "",
      scheduledDate: item.scheduledDate ?? "",
      odometerKm: item.odometerKm !== null ? String(item.odometerKm) : "",
      nextDueDate: item.nextDueDate ?? "",
      nextDueOdometerKm: item.nextDueOdometerKm !== null ? String(item.nextDueOdometerKm) : "",
      laborCostCents: item.laborCostCents !== null ? String(item.laborCostCents) : "",
      partsCostCents: item.partsCostCents !== null ? String(item.partsCostCents) : "",
      taxCostCents: item.taxCostCents !== null ? String(item.taxCostCents) : "",
      priority: item.priority || "NORMAL",
    });
  }

  async function saveRecord() {
    if (saving) return;

    const title = normalizeText(form.title);
    if (!title) {
      setError("Title is required.");
      return;
    }
    if (!form.scheduledDate && !form.serviceDate) {
      setError("Provide a scheduled date or service date.");
      return;
    }

    const total = computeTotal(form.laborCostCents, form.partsCostCents, form.taxCostCents);

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const csrfToken = await ensureCsrfToken();
      const payload = {
        status: form.status,
        category: form.category,
        title,
        description: normalizeText(form.description) || null,
        vendorName: normalizeText(form.vendorName) || null,
        vendorContact: normalizeText(form.vendorContact) || null,
        referenceNumber: normalizeText(form.referenceNumber) || null,
        scheduledDate: form.scheduledDate || null,
        serviceDate: form.serviceDate || null,
        odometerKm: form.odometerKm ? Number(form.odometerKm) : null,
        nextDueDate: form.nextDueDate || null,
        nextDueOdometerKm: form.nextDueOdometerKm ? Number(form.nextDueOdometerKm) : null,
        laborCostCents: form.laborCostCents ? Number(form.laborCostCents) : null,
        partsCostCents: form.partsCostCents ? Number(form.partsCostCents) : null,
        taxCostCents: form.taxCostCents ? Number(form.taxCostCents) : null,
        totalCostCents: total,
        priority: form.priority,
        csrfToken,
      };

      const targetUrl = editingId
        ? `/api/admin/vehicles/${vehicleId}/maintenance/${editingId}`
        : `/api/admin/vehicles/${vehicleId}/maintenance`;

      const response = await fetch(targetUrl, {
        method: editingId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify(payload),
      });

      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        item?: { id?: string };
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "Unable to save maintenance record.");
      }

      setMessage(editingId ? "Maintenance record updated." : "Maintenance record created.");
      const nextId = result.item?.id ?? null;
      resetForm();
      await loadData();
      if (nextId) setSelectedId(nextId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to save maintenance record.");
    } finally {
      setSaving(false);
    }
  }

  async function updateRecordStatus(recordId: string, status: RecordStatus) {
    if (saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`/api/admin/vehicles/${vehicleId}/maintenance/${recordId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          status,
          serviceDate: status === "COMPLETED" ? new Date().toISOString().slice(0, 10) : undefined,
          csrfToken,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "Unable to update status.");
      }

      setMessage(`Record marked ${formatStatus(status)}.`);
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to update status.");
    } finally {
      setSaving(false);
    }
  }

  async function archiveRecord(recordId: string) {
    if (saving) return;
    const confirmed = window.confirm("Archive this maintenance record?");
    if (!confirmed) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`/api/admin/vehicles/${vehicleId}/maintenance/${recordId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({ csrfToken }),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "Unable to archive record.");
      }
      setMessage("Maintenance record archived.");
      await loadData();
      if (selectedId === recordId) {
        setSelectedId(null);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to archive record.");
    } finally {
      setSaving(false);
    }
  }

  async function archiveDocument(docId: string) {
    const csrfToken = await ensureCsrfToken();
    const response = await fetch(`/api/admin/vehicles/${vehicleId}/documents/${docId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify({ archived: true, csrfToken }),
    });

    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) {
      setError(result.error ?? "Unable to archive document.");
      return;
    }

    setMessage("Document archived.");
    await loadData();
  }

  async function uploadDocument(record: MaintenanceRecord) {
    if (!publicKey) {
      setError("Uploadcare is not configured.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

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
      if (!dialog) throw new Error("Unable to open upload dialog.");

      const fileInfo = await new Promise<UploadcareFileInfo>((resolve, reject) => {
        dialog.done(async (file) => {
          try {
            const single =
              typeof (file as UploadcareFileGroup).files === "function"
                ? (file as UploadcareFileGroup).files?.()?.[0]
                : (file as UploadcareSingleFile);
            if (!single) {
              reject(new Error("Upload returned no file."));
              return;
            }
            const info =
              typeof single.promise === "function"
                ? await single.promise()
                : await new Promise<UploadcareFileInfo>((done) => single.done?.(done));
            resolve(info);
          } catch (error) {
            reject(error);
          }
        });
        dialog.fail((dialogError) => reject(new Error(dialogError?.message ?? "Upload cancelled.")));
      });

      const reference = String(fileInfo.uuid ?? fileInfo.cdnUrl ?? "").trim();
      if (!reference) {
        throw new Error("Upload returned an invalid file reference.");
      }

      const csrfToken = await ensureCsrfToken();
      const fileName =
        normalizeText(String(fileInfo.originalFilename ?? fileInfo.name ?? "Maintenance document")) ||
        "Maintenance document";

      const response = await fetch(`/api/admin/vehicles/${vehicleId}/documents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken ?? "",
        },
        body: JSON.stringify({
          folder: "Maintenance",
          maintenanceRecordId: record.id,
          documentType,
          title: fileName,
          label: normalizeText(documentLabel) || null,
          storageProvider: "UPLOADCARE_FILE_ID",
          storageKey: reference,
          mimeType: typeof fileInfo.mimeType === "string" ? fileInfo.mimeType : null,
          sizeBytes:
            typeof fileInfo.size === "number" && Number.isFinite(fileInfo.size)
              ? Math.round(fileInfo.size)
              : null,
          tags: ["maintenance"],
          csrfToken,
        }),
      });

      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "Unable to save uploaded document.");
      }

      setMessage("Maintenance document uploaded.");
      setDocumentLabel("");
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to upload document.");
    } finally {
      setSaving(false);
    }
  }

  const totalPreview = useMemo(
    () => computeTotal(form.laborCostCents, form.partsCostCents, form.taxCostCents),
    [form.laborCostCents, form.partsCostCents, form.taxCostCents],
  );

  return (
    <section
      data-testid="vehicle-maintenance-panel"
      className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--ccr-text)]">Maintenance</h2>
          <p className="text-xs text-[var(--ccr-muted)]">
            Track completed service, upcoming maintenance, and maintenance-related documents.
          </p>
        </div>
      </div>

      {error ? <p className="mt-3 text-xs font-semibold text-red-300">{error}</p> : null}
      {message ? <p className="mt-3 text-xs font-semibold text-emerald-200">{message}</p> : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3">
          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Total Cost</p>
          <p className="mt-1 text-lg font-semibold text-[var(--ccr-text)]">
            {formatCurrency(summary?.totalMaintenanceCostCents ?? 0)}
          </p>
        </article>
        <article className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3">
          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Open / Scheduled</p>
          <p className="mt-1 text-lg font-semibold text-[var(--ccr-text)]">{summary?.openScheduledCount ?? 0}</p>
        </article>
        <article className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3">
          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Overdue</p>
          <p className="mt-1 text-lg font-semibold text-[var(--ccr-text)]">{summary?.overdueCount ?? 0}</p>
        </article>
        <article className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3">
          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Next Due</p>
          <p className="mt-1 text-sm font-semibold text-[var(--ccr-text)]">{summary?.nextDueDate ?? "Not set"}</p>
        </article>
      </div>

      <div className="mt-4 grid w-full grid-cols-2 gap-2 sm:flex sm:min-w-0 sm:flex-1 sm:flex-nowrap sm:items-center sm:overflow-x-auto sm:px-2 sm:py-1 sm:scroll-pl-2 sm:scroll-pr-2">
        {DUE_FILTERS.map((filter) => {
          const active = filter.key === activeDueFilter;
          return (
            <button
              key={filter.key}
              type="button"
              onClick={() => setActiveDueFilter(filter.key)}
              className={`min-h-11 rounded-full border px-3 py-1.5 text-[11px] font-semibold leading-none transition sm:min-h-0 sm:px-4 sm:text-xs ${
                active
                  ? "border-[var(--ccr-primary)] bg-[var(--ccr-primary)] text-white ring-1 ring-[var(--ccr-accent)]"
                  : "border-[var(--ccr-border)] bg-transparent text-[var(--ccr-text)] hover:border-[var(--ccr-primary)]"
              }`}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-text)]">Maintenance Records</h3>
            <button
              type="button"
              onClick={resetForm}
              className="min-h-10 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
            >
              Add Maintenance
            </button>
          </div>

          {loading ? <p className="mt-3 text-sm text-[var(--ccr-muted)]">Loading records...</p> : null}
          {!loading && filteredItems.length < 1 ? (
            <div className="mt-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-5">
              <p className="text-sm font-semibold text-[var(--ccr-text)]">No maintenance records found.</p>
              <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                Add a scheduled service or completed record to start tracking upkeep.
              </p>
            </div>
          ) : null}

          {!loading && filteredItems.length > 0 ? (
            <>
              <div className="mt-3 divide-y divide-[var(--ccr-border)] md:hidden">
                {filteredItems.map((item) => (
                  <article
                    key={`mobile-${item.id}`}
                    className="space-y-2 py-3"
                    onClick={() => setSelectedId(item.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(item.id);
                      }
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-[var(--ccr-text)] break-words">{item.title}</p>
                        <p className="text-xs text-[var(--ccr-muted)]">{item.category}</p>
                      </div>
                      <span className={`inline-flex min-h-7 items-center rounded-full border px-3 py-1 text-xs font-semibold ${dueTone(item.dueState)}`}>
                        {dueLabel(item.dueState)}
                      </span>
                    </div>
                    <dl className="grid grid-cols-2 gap-2 text-xs text-[var(--ccr-muted)]">
                      <div>
                        <dt>Status</dt>
                        <dd className="text-sm text-[var(--ccr-text)]">{formatStatus(item.status)}</dd>
                      </div>
                      <div>
                        <dt>Total</dt>
                        <dd className="text-sm font-semibold text-[var(--ccr-text)]">{formatCurrency(item.totalCostCents)}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt>Due / Service Date</dt>
                        <dd className="text-sm text-[var(--ccr-text)]">
                          {item.nextDueDate ?? item.scheduledDate ?? item.serviceDate ?? "Not set"}
                        </dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>

              <div className="mt-3 hidden overflow-x-auto md:block">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                    <tr>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2">Title</th>
                      <th className="px-3 py-2">Due / Service Date</th>
                      <th className="px-3 py-2">Total Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item) => (
                      <tr
                        key={item.id}
                        className={`cursor-pointer border-b border-[var(--ccr-border)] last:border-b-0 ${
                          selectedId === item.id ? "bg-[var(--ccr-surface)]" : ""
                        }`}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            <span className={`inline-flex min-h-7 items-center rounded-full border px-2 py-1 text-[11px] font-semibold ${statusTone(item.status)}`}>
                              {formatStatus(item.status)}
                            </span>
                            <span className={`inline-flex min-h-7 items-center rounded-full border px-2 py-1 text-[11px] font-semibold ${dueTone(item.dueState)}`}>
                              {dueLabel(item.dueState)}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-[var(--ccr-text)]">{item.category}</td>
                        <td className="px-3 py-2 text-[var(--ccr-text)]">{item.title}</td>
                        <td className="px-3 py-2 text-[var(--ccr-text)]">
                          {item.nextDueDate ?? item.scheduledDate ?? item.serviceDate ?? "Not set"}
                        </td>
                        <td className="px-3 py-2 font-semibold text-[var(--ccr-text)]">{formatCurrency(item.totalCostCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </section>

        <section className="space-y-4">
          <section className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-text)]">
              {editingId ? "Edit Maintenance" : "Add Maintenance"}
            </h3>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Status
                <select
                  value={form.status}
                  onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as RecordStatus }))}
                  className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {formatStatus(option)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Category
                <select
                  value={form.category}
                  onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                >
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] sm:col-span-2">
                Title
                <input
                  type="text"
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>

              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Scheduled Date
                <input
                  type="date"
                  value={form.scheduledDate}
                  onChange={(event) => setForm((current) => ({ ...current, scheduledDate: event.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>

              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Service Date
                <input
                  type="date"
                  value={form.serviceDate}
                  onChange={(event) => setForm((current) => ({ ...current, serviceDate: event.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>

              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Odometer (km)
                <input
                  type="number"
                  min={0}
                  value={form.odometerKm}
                  onChange={(event) => setForm((current) => ({ ...current, odometerKm: event.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>

              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Priority
                <select
                  value={form.priority}
                  onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                >
                  <option value="LOW">LOW</option>
                  <option value="NORMAL">NORMAL</option>
                  <option value="HIGH">HIGH</option>
                  <option value="URGENT">URGENT</option>
                </select>
              </label>

              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Next Due Date
                <input
                  type="date"
                  value={form.nextDueDate}
                  onChange={(event) => setForm((current) => ({ ...current, nextDueDate: event.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>

              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Next Due Odometer (km)
                <input
                  type="number"
                  min={0}
                  value={form.nextDueOdometerKm}
                  onChange={(event) => setForm((current) => ({ ...current, nextDueOdometerKm: event.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>

              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Labor (cents)
                <input
                  type="number"
                  min={0}
                  value={form.laborCostCents}
                  onChange={(event) => setForm((current) => ({ ...current, laborCostCents: event.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>

              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Parts (cents)
                <input
                  type="number"
                  min={0}
                  value={form.partsCostCents}
                  onChange={(event) => setForm((current) => ({ ...current, partsCostCents: event.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>

              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Tax (cents)
                <input
                  type="number"
                  min={0}
                  value={form.taxCostCents}
                  onChange={(event) => setForm((current) => ({ ...current, taxCostCents: event.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>

              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Vendor
                <input
                  type="text"
                  value={form.vendorName}
                  onChange={(event) => setForm((current) => ({ ...current, vendorName: event.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>

              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Vendor Contact
                <input
                  type="text"
                  value={form.vendorContact}
                  onChange={(event) => setForm((current) => ({ ...current, vendorContact: event.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>

              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] sm:col-span-2">
                Reference Number
                <input
                  type="text"
                  value={form.referenceNumber}
                  onChange={(event) => setForm((current) => ({ ...current, referenceNumber: event.target.value }))}
                  className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>

              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] sm:col-span-2">
                Description
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                />
              </label>
            </div>

            <p className="mt-3 text-xs font-semibold text-[var(--ccr-muted)]">
              Total preview: <span className="text-[var(--ccr-text)]">{formatCurrency(totalPreview)}</span>
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void saveRecord()}
                disabled={saving}
                className="min-h-11 rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                {saving ? "Saving..." : editingId ? "Save changes" : "Add maintenance"}
              </button>
              {editingId ? (
                <button
                  type="button"
                  onClick={resetForm}
                  className="min-h-11 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                >
                  Cancel edit
                </button>
              ) : null}
            </div>
          </section>

          {selectedRecord ? (
            <section className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-text)]">Record Details</h3>
                  <p className="mt-1 text-sm font-semibold text-[var(--ccr-text)]">{selectedRecord.title}</p>
                  <p className="text-xs text-[var(--ccr-muted)]">
                    {selectedRecord.category} · Updated <DateTimeInline value={selectedRecord.updatedAt} />
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <span className={`inline-flex min-h-7 items-center rounded-full border px-2 py-1 text-[11px] font-semibold ${statusTone(selectedRecord.status)}`}>
                    {formatStatus(selectedRecord.status)}
                  </span>
                  <span className={`inline-flex min-h-7 items-center rounded-full border px-2 py-1 text-[11px] font-semibold ${dueTone(selectedRecord.dueState)}`}>
                    {dueLabel(selectedRecord.dueState)}
                  </span>
                </div>
              </div>

              <dl className="mt-3 grid gap-2 text-xs text-[var(--ccr-muted)] sm:grid-cols-2">
                <div>
                  <dt>Due / Service Date</dt>
                  <dd className="text-sm text-[var(--ccr-text)]">
                    {selectedRecord.nextDueDate ?? selectedRecord.scheduledDate ?? selectedRecord.serviceDate ?? "Not set"}
                  </dd>
                </div>
                <div>
                  <dt>Total Cost</dt>
                  <dd className="text-sm font-semibold text-[var(--ccr-text)]">{formatCurrency(selectedRecord.totalCostCents)}</dd>
                </div>
                <div>
                  <dt>Odometer</dt>
                  <dd className="text-sm text-[var(--ccr-text)]">
                    {selectedRecord.odometerKm !== null ? `${selectedRecord.odometerKm.toLocaleString()} km` : "N/A"}
                  </dd>
                </div>
                <div>
                  <dt>Reference</dt>
                  <dd className="text-sm text-[var(--ccr-text)] break-all">{selectedRecord.referenceNumber ?? "N/A"}</dd>
                </div>
              </dl>

              {selectedRecord.description ? (
                <p className="mt-3 text-sm text-[var(--ccr-text)]">{selectedRecord.description}</p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(selectedRecord)}
                  className="min-h-10 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                >
                  Edit
                </button>
                {selectedRecord.status !== "COMPLETED" ? (
                  <button
                    type="button"
                    onClick={() => void updateRecordStatus(selectedRecord.id, "COMPLETED")}
                    className="min-h-10 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                  >
                    Mark Completed
                  </button>
                ) : null}
                {selectedRecord.status !== "CANCELLED" ? (
                  <button
                    type="button"
                    onClick={() => void updateRecordStatus(selectedRecord.id, "CANCELLED")}
                    className="min-h-10 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                  >
                    Cancel
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void archiveRecord(selectedRecord.id)}
                  className="min-h-10 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
                >
                  Archive
                </button>
              </div>

              <div className="mt-4 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                    Document Type
                    <select
                      value={documentType}
                      onChange={(event) => setDocumentType(event.target.value)}
                      className="mt-1 min-h-10 rounded-lg border border-[var(--ccr-border)] bg-transparent px-2 py-1 text-xs text-[var(--ccr-text)]"
                    >
                      <option value="SERVICE_INVOICE">Service Invoice</option>
                      <option value="REPAIR_ESTIMATE">Repair Estimate</option>
                      <option value="RECEIPT">Receipt</option>
                      <option value="PHOTO">Photo</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </label>

                  <label className="flex-1 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                    Label
                    <input
                      type="text"
                      value={documentLabel}
                      onChange={(event) => setDocumentLabel(event.target.value)}
                      className="mt-1 min-h-10 w-full rounded-lg border border-[var(--ccr-border)] bg-transparent px-2 py-1 text-xs text-[var(--ccr-text)]"
                      placeholder="Invoice #, receipt note"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => void uploadDocument(selectedRecord)}
                    disabled={saving}
                    className="min-h-10 rounded-lg bg-[var(--ccr-primary)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    Upload Document
                  </button>
                </div>

                <div className="mt-3 space-y-2">
                  {selectedDocs.length < 1 ? (
                    <p className="text-xs text-[var(--ccr-muted)]">No documents linked to this maintenance record.</p>
                  ) : (
                    selectedDocs.map((doc) => (
                      <article key={doc.id} className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-[var(--ccr-text)] break-words">{doc.label || doc.title}</p>
                            <p className="text-xs text-[var(--ccr-muted)]">
                              {doc.documentType} · {doc.mimeType || "Unknown type"} · {formatBytes(doc.sizeBytes)}
                            </p>
                            <p className="text-xs text-[var(--ccr-muted)]">
                              Uploaded <DateTimeInline value={doc.createdAt} />
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <a
                              href={`/api/admin/vehicles/${vehicleId}/documents/${doc.id}/download`}
                              className="min-h-9 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
                            >
                              View
                            </a>
                            <button
                              type="button"
                              onClick={() => void archiveDocument(doc.id)}
                              className="min-h-9 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
                            >
                              Archive
                            </button>
                          </div>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </div>
            </section>
          ) : null}
        </section>
      </div>
    </section>
  );
}
