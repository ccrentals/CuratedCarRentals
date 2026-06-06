"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { CalendarIcon, X } from "lucide-react";

import { SortableTh } from "@/components/admin/SortableTh";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { buttonStyles } from "@/components/ui/Button";
import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { fmtDateNoSeconds } from "@/lib/dateFormat";
import { ensureCsrfToken } from "@/lib/security/csrf-client";
import { getUploadcareSignedOptions } from "@/lib/uploads/uploadcare-client";

const WIDGET_SRC = "https://ucarecdn.com/libs/widget/3.x/uploadcare.full.min.js";

type VehicleMaintenancePanelProps = {
  vehicleId: string;
  initialRecordId?: string | null;
};

type DueState = "OVERDUE" | "DUE_SOON" | "UPCOMING" | "COMPLETED" | "CANCELLED";
type RecordStatus = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

type MaintenanceRecord = {
  id: string;
  publicId: string;
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
  estimatedCostCents: number | null;
  actualCostCents: number | null;
  reminderLeadDays: number | null;
  linkedExpenseId: string | null;
  linkedRepairOrderId: string | null;
  completedDate: string | null;
  currency: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  linkedBlockout: {
    id: string;
    startAt: string | null;
    endAt: string | null;
    reason: string | null;
    source: string | null;
  } | null;
  dueState: DueState;
};

type MaintenanceStatusHistoryEntry = {
  id: string;
  status: RecordStatus;
  previousStatus: RecordStatus | null;
  changedByUserId: string | null;
  changedBy: string;
  note: string | null;
  createdAt: string;
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
  canDownload?: boolean;
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

type MaintenancePaging = {
  limit: number;
  offset: number;
  total: number;
};

type MaintenanceOptions = {
  categories: string[];
  priorities: string[];
  defaultReminderLeadDays: number;
};

type UploadcareFileInfo = {
  cdnUrl?: string;
  uuid?: string;
  name?: string;
  originalFilename?: string;
  size?: number;
  mimeType?: string;
};

type PendingDocumentUpload = {
  maintenanceRecordId: string;
  reference: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
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
    options: {
      publicKey: string;
      multiple: boolean;
      imagesOnly: boolean;
      secureSignature: string;
      secureExpire: string;
    },
  ) => UploadcareDialog | null;
};

const DEFAULT_CATEGORY_OPTIONS = [
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
const DEFAULT_PRIORITY_OPTIONS = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

const STATUS_OPTIONS: RecordStatus[] = ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
const DUE_FILTERS = [
  { key: "ALL", label: "All" },
  { key: "OVERDUE", label: "Overdue" },
  { key: "DUE_SOON", label: "Due Soon" },
  { key: "UPCOMING", label: "Upcoming" },
  { key: "COMPLETED", label: "Completed" },
] as const;
const MOBILE_PAGE_MEDIA_QUERY = "(max-width: 767px)";
const DESKTOP_PAGE_SIZE = 10;
const MOBILE_PAGE_SIZE = 5;

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  SERVICE_INVOICE: "Service Invoice",
  REPAIR_ESTIMATE: "Repair Estimate",
  RECEIPT: "Receipt",
  PHOTO: "Photo",
  OTHER: "Other",
};

type DueFilter = (typeof DUE_FILTERS)[number]["key"];
type MaintenanceSort = "dueDate" | "createdAt" | "cost" | "title" | "status" | "category";
type SortDirection = "asc" | "desc";

function defaultSortDirection(column: MaintenanceSort): SortDirection {
  if (column === "cost") return "desc";
  return "asc";
}

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
  if (normalized === "COMPLETED") {
    return "border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] text-[var(--ccr-status-success-text)]";
  }
  if (normalized === "IN_PROGRESS") {
    return "border-[var(--ccr-status-info-border)] bg-[var(--ccr-status-info-bg)] text-[var(--ccr-status-info-text)]";
  }
  if (normalized === "CANCELLED") {
    return "border-[var(--ccr-status-danger-border)] bg-[var(--ccr-status-danger-bg)] text-[var(--ccr-status-danger-text)]";
  }
  return "border-[var(--ccr-status-warning-border)] bg-[var(--ccr-status-warning-bg)] text-[var(--ccr-status-warning-text)]";
}

function dueTone(state: DueState) {
  if (state === "OVERDUE") {
    return "border-[var(--ccr-status-danger-border)] bg-[var(--ccr-status-danger-bg)] text-[var(--ccr-status-danger-text)]";
  }
  if (state === "DUE_SOON") {
    return "border-[var(--ccr-status-warning-border)] bg-[var(--ccr-status-warning-bg)] text-[var(--ccr-status-warning-text)]";
  }
  if (state === "UPCOMING") {
    return "border-[var(--ccr-status-info-border)] bg-[var(--ccr-status-info-bg)] text-[var(--ccr-status-info-text)]";
  }
  if (state === "COMPLETED") {
    return "border-[var(--ccr-status-success-border)] bg-[var(--ccr-status-success-bg)] text-[var(--ccr-status-success-text)]";
  }
  return "border-[var(--ccr-status-neutral-border)] bg-[var(--ccr-status-neutral-bg)] text-[var(--ccr-status-neutral-text)]";
}

function dueLabel(state: DueState) {
  if (state === "DUE_SOON") return "Due Soon";
  if (state === "OVERDUE") return "Overdue";
  if (state === "UPCOMING") return "Upcoming";
  if (state === "COMPLETED") return "Completed";
  return "Cancelled";
}

function dueFilterToView(filter: DueFilter) {
  if (filter === "OVERDUE") return "overdue";
  if (filter === "DUE_SOON") return "dueSoon";
  if (filter === "UPCOMING") return "upcoming";
  if (filter === "COMPLETED") return "completed";
  return "all";
}

function formatCurrency(cents: number | null) {
  if (cents === null || !Number.isFinite(cents)) return "N/A";
  return new Intl.NumberFormat("en-JM", { style: "currency", currency: "JMD" }).format(cents / 100);
}

function formatServiceDateTime(value: string | null) {
  if (!value) return "Not set";
  const raw = String(value).trim();
  if (!raw) return "Not set";

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return fmtDateNoSeconds(raw);
}

function dueServiceDateLabel(record: MaintenanceRecord) {
  return formatServiceDateTime(record.nextDueDate ?? record.scheduledDate ?? record.serviceDate);
}

function formatDocumentTypeLabel(value: string) {
  const normalized = normalizeText(value).toUpperCase();
  if (!normalized) return "Other";
  if (DOCUMENT_TYPE_LABELS[normalized]) return DOCUMENT_TYPE_LABELS[normalized];
  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizeDocumentDisplayTitle(value: string | null | undefined) {
  const normalized = normalizeText(String(value ?? ""));
  if (!normalized) return "";
  if (/^seed invoice$/i.test(normalized)) return "Invoice";
  if (/^e2e seed invoice\b/i.test(normalized)) return "Invoice";
  return normalized;
}

function formatDocumentTitle(doc: VehicleDocument) {
  const label = normalizeDocumentDisplayTitle(doc.label);
  if (label) return label;
  const title = normalizeDocumentDisplayTitle(doc.title);
  if (title) return title;
  return formatDocumentTypeLabel(doc.documentType);
}

function statusHistoryNote(note: string | null) {
  const normalized = String(note ?? "").trim();
  if (!normalized) return "";
  if (/^seeded for\s+/i.test(normalized)) return "";
  return normalized;
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
    linkedExpenseId: "",
    linkedRepairOrderId: "",
    serviceDate: "",
    scheduledDate: "",
    odometerKm: "",
    nextDueDate: "",
    nextDueOdometerKm: "",
    laborCostCents: "",
    partsCostCents: "",
    taxCostCents: "",
    estimatedCostCents: "",
    actualCostCents: "",
    reminderLeadDays: "7",
    createBlockout: false,
    blockoutStartAt: "",
    blockoutEndAt: "",
    blockoutReason: "",
    blockoutNotes: "",
    priority: "NORMAL",
  };
}

export function VehicleMaintenancePanel({ vehicleId, initialRecordId }: VehicleMaintenancePanelProps) {

  const [items, setItems] = useState<MaintenanceRecord[]>([]);
  const [summary, setSummary] = useState<MaintenanceSummary | null>(null);
  const [options, setOptions] = useState<MaintenanceOptions>({
    categories: [...DEFAULT_CATEGORY_OPTIONS],
    priorities: [...DEFAULT_PRIORITY_OPTIONS],
    defaultReminderLeadDays: 7,
  });
  const [docs, setDocs] = useState<VehicleDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [activeDueFilter, setActiveDueFilter] = useState<DueFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<MaintenanceSort>("dueDate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [pageSize, setPageSize] = useState(DESKTOP_PAGE_SIZE);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(initialRecordId ?? null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormDrawerOpen, setIsFormDrawerOpen] = useState(false);
  const [documentType, setDocumentType] = useState("SERVICE_INVOICE");
  const [documentLabel, setDocumentLabel] = useState("");
  const [pendingDocumentUpload, setPendingDocumentUpload] = useState<PendingDocumentUpload | null>(null);
  const [form, setForm] = useState(defaultFormState);
  const detailSectionRef = useRef<HTMLElement | null>(null);
  const scheduledDateInputRef = useRef<HTMLInputElement | null>(null);
  const serviceDateInputRef = useRef<HTMLInputElement | null>(null);
  const nextDueDateInputRef = useRef<HTMLInputElement | null>(null);
  const shouldScrollToDetailRef = useRef(false);
  const tableSortState = useMemo(() => ({ sortBy, sortDir: sortDirection }), [sortBy, sortDirection]);

  const handleTableSortChange = useCallback((nextSortBy: MaintenanceSort, nextSortDirection: SortDirection) => {
    setSortBy(nextSortBy);
    setSortDirection(nextSortDirection);
    setOffset(0);
  }, []);

  const selectedRecord = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  const selectedDocs = useMemo(
    () => docs.filter((doc) => doc.maintenanceRecordId === selectedRecord?.id && doc.archivedAt === null),
    [docs, selectedRecord?.id],
  );
  const hasPendingDocumentForSelection = pendingDocumentUpload?.maintenanceRecordId === selectedRecord?.id;
  const [statusHistory, setStatusHistory] = useState<MaintenanceStatusHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const hasPrevPage = offset > 0;
  const hasNextPage = offset + items.length < total;
  const pageStart = total > 0 ? offset + 1 : 0;
  const pageEnd = total > 0 ? offset + items.length : 0;
  const maintenanceExportHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("view", dueFilterToView(activeDueFilter));
    params.set("sort", sortBy);
    params.set("dir", sortDirection);
    if (searchQuery.trim()) {
      params.set("q", searchQuery.trim());
    }
    return `/api/admin/vehicles/${vehicleId}/maintenance/export?${params.toString()}`;
  }, [activeDueFilter, searchQuery, sortBy, sortDirection, vehicleId]);

  const selectRecordFromList = useCallback((recordId: string) => {
    shouldScrollToDetailRef.current = true;
    setSelectedId(recordId);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("view", dueFilterToView(activeDueFilter));
      params.set("sort", sortBy);
      params.set("dir", sortDirection);
      params.set("limit", String(pageSize));
      params.set("offset", String(offset));
      if (searchQuery.trim()) {
        params.set("q", searchQuery.trim());
      }

      const [maintenanceResponse, docsResponse] = await Promise.all([
        fetch(`/api/admin/vehicles/${vehicleId}/maintenance?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/admin/vehicles/${vehicleId}/documents?includeArchived=1`, { cache: "no-store" }),
      ]);

      const maintenancePayload = (await maintenanceResponse.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        rows?: MaintenanceRecord[];
        items?: MaintenanceRecord[];
        paging?: MaintenancePaging;
        summary?: MaintenanceSummary;
        options?: MaintenanceOptions;
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

      const maintenanceItems = Array.isArray(maintenancePayload.rows)
        ? maintenancePayload.rows
        : Array.isArray(maintenancePayload.items)
          ? maintenancePayload.items
          : [];
      const categories = Array.isArray(maintenancePayload.options?.categories)
        ? maintenancePayload.options?.categories.filter((entry) => typeof entry === "string" && entry.trim())
        : [];
      const priorities = Array.isArray(maintenancePayload.options?.priorities)
        ? maintenancePayload.options?.priorities.filter((entry) => typeof entry === "string" && entry.trim())
        : [];
      setItems(maintenanceItems);
      setTotal(Number(maintenancePayload.paging?.total ?? maintenanceItems.length));
      setSummary(maintenancePayload.summary ?? null);
      setOptions({
        categories: categories.length > 0 ? categories : [...DEFAULT_CATEGORY_OPTIONS],
        priorities: priorities.length > 0 ? priorities : [...DEFAULT_PRIORITY_OPTIONS],
        defaultReminderLeadDays:
          typeof maintenancePayload.options?.defaultReminderLeadDays === "number" &&
          Number.isFinite(maintenancePayload.options?.defaultReminderLeadDays)
            ? Math.max(0, Math.round(maintenancePayload.options?.defaultReminderLeadDays))
            : 7,
      });
      setDocs(Array.isArray(docsPayload.items) ? docsPayload.items : []);

      if (maintenanceItems.length < 1) {
        setSelectedId(null);
        return;
      }

      if (selectedId) {
        const stillExists = maintenanceItems.some((item) => item.id === selectedId);
        if (stillExists) return;
        setSelectedId(null);
        return;
      }

      const targetFromQuery = initialRecordId
        ? maintenanceItems.find((item) => item.id === initialRecordId)?.id ?? null
        : null;
      if (targetFromQuery) {
        setSelectedId(targetFromQuery);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load maintenance data.");
      setItems([]);
      setTotal(0);
      setSummary(null);
      setOptions({
        categories: [...DEFAULT_CATEGORY_OPTIONS],
        priorities: [...DEFAULT_PRIORITY_OPTIONS],
        defaultReminderLeadDays: 7,
      });
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [
    activeDueFilter,
    initialRecordId,
    offset,
    pageSize,
    searchQuery,
    selectedId,
    sortBy,
    sortDirection,
    vehicleId,
  ]);

  const loadStatusHistory = useCallback(
    async (recordId: string) => {
      setHistoryLoading(true);
      try {
        const response = await fetch(`/api/admin/vehicles/${vehicleId}/maintenance/${recordId}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          statusHistory?: MaintenanceStatusHistoryEntry[];
        };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? "Unable to load status history.");
        }
        setStatusHistory(Array.isArray(payload.statusHistory) ? payload.statusHistory : []);
      } catch (requestError) {
        setStatusHistory([]);
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load status history.",
        );
      } finally {
        setHistoryLoading(false);
      }
    },
    [vehicleId],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia(MOBILE_PAGE_MEDIA_QUERY);
    const applyPageSize = (isMobile: boolean) => {
      setPageSize(isMobile ? MOBILE_PAGE_SIZE : DESKTOP_PAGE_SIZE);
    };

    applyPageSize(mediaQuery.matches);

    const onChange = (event: MediaQueryListEvent) => {
      applyPageSize(event.matches);
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", onChange);
      return () => mediaQuery.removeEventListener("change", onChange);
    }

    mediaQuery.addListener(onChange);
    return () => mediaQuery.removeListener(onChange);
  }, []);

  useEffect(() => {
    setOffset(0);
  }, [pageSize]);

  useEffect(() => {
    if (!selectedRecord?.id) {
      setStatusHistory([]);
      setHistoryLoading(false);
      return;
    }
    void loadStatusHistory(selectedRecord.id);
  }, [loadStatusHistory, selectedRecord?.id, selectedRecord?.updatedAt]);

  useEffect(() => {
    setPendingDocumentUpload(null);
  }, [selectedRecord?.id]);

  useEffect(() => {
    if (!selectedRecord?.id || !shouldScrollToDetailRef.current) return;
    shouldScrollToDetailRef.current = false;
    detailSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [selectedRecord?.id]);

  useEffect(() => {
    setForm((current) => {
      if (current.reminderLeadDays) return current;
      return {
        ...current,
        reminderLeadDays: String(options.defaultReminderLeadDays),
      };
    });
  }, [options.defaultReminderLeadDays]);

  useEffect(() => {
    setForm((current) => {
      const nextCategory = options.categories.includes(current.category)
        ? current.category
        : (options.categories[0] ?? "SERVICE");
      const nextPriority = options.priorities.includes(current.priority)
        ? current.priority
        : (options.priorities[0] ?? "NORMAL");
      if (nextCategory === current.category && nextPriority === current.priority) {
        return current;
      }
      return {
        ...current,
        category: nextCategory,
        priority: nextPriority,
      };
    });
  }, [options.categories, options.priorities]);

  function resetForm() {
    setForm(() => ({
      ...defaultFormState(),
      category: options.categories[0] ?? "SERVICE",
      priority: options.priorities[0] ?? "NORMAL",
      reminderLeadDays: String(options.defaultReminderLeadDays),
    }));
    setEditingId(null);
  }

  function openCreateDrawer() {
    resetForm();
    setIsFormDrawerOpen(true);
  }

  function openNativeDatePicker(ref: RefObject<HTMLInputElement | null>) {
    const input = ref.current;
    if (!input) return;

    const pickerInput = input as HTMLInputElement & { showPicker?: () => void };
    if (typeof pickerInput.showPicker === "function") {
      try {
        pickerInput.showPicker();
        return;
      } catch {
        // Fall through for browsers that block showPicker.
      }
    }

    input.focus();
    input.click();
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
    linkedExpenseId: item.linkedExpenseId ?? "",
    linkedRepairOrderId: item.linkedRepairOrderId ?? "",
    serviceDate: item.serviceDate ?? "",
      scheduledDate: item.scheduledDate ?? "",
      odometerKm: item.odometerKm !== null ? String(item.odometerKm) : "",
      nextDueDate: item.nextDueDate ?? "",
      nextDueOdometerKm: item.nextDueOdometerKm !== null ? String(item.nextDueOdometerKm) : "",
      laborCostCents: item.laborCostCents !== null ? String(item.laborCostCents) : "",
      partsCostCents: item.partsCostCents !== null ? String(item.partsCostCents) : "",
      taxCostCents: item.taxCostCents !== null ? String(item.taxCostCents) : "",
      estimatedCostCents: item.estimatedCostCents !== null ? String(item.estimatedCostCents) : "",
      actualCostCents: item.actualCostCents !== null ? String(item.actualCostCents) : "",
      reminderLeadDays:
        item.reminderLeadDays !== null
          ? String(item.reminderLeadDays)
          : String(options.defaultReminderLeadDays),
      createBlockout: Boolean(item.linkedBlockout),
      blockoutStartAt: item.linkedBlockout?.startAt ? item.linkedBlockout.startAt.slice(0, 16) : "",
      blockoutEndAt: item.linkedBlockout?.endAt ? item.linkedBlockout.endAt.slice(0, 16) : "",
      blockoutReason: item.linkedBlockout?.reason ?? "",
      blockoutNotes: "",
      priority: item.priority || "NORMAL",
    });
    setIsFormDrawerOpen(true);
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
        linkedExpenseId: normalizeText(form.linkedExpenseId) || null,
        linkedRepairOrderId: normalizeText(form.linkedRepairOrderId) || null,
        scheduledDate: form.scheduledDate || null,
        serviceDate: form.serviceDate || null,
        odometerKm: form.odometerKm ? Number(form.odometerKm) : null,
        nextDueDate: form.nextDueDate || null,
        nextDueOdometerKm: form.nextDueOdometerKm ? Number(form.nextDueOdometerKm) : null,
        laborCostCents: form.laborCostCents ? Number(form.laborCostCents) : null,
        partsCostCents: form.partsCostCents ? Number(form.partsCostCents) : null,
        taxCostCents: form.taxCostCents ? Number(form.taxCostCents) : null,
        estimatedCostCents: form.estimatedCostCents ? Number(form.estimatedCostCents) : null,
        actualCostCents: form.actualCostCents ? Number(form.actualCostCents) : null,
        reminderLeadDays: form.reminderLeadDays ? Number(form.reminderLeadDays) : null,
        totalCostCents: total,
        priority: form.priority,
        createBlockout: form.createBlockout,
        blockoutStartAt: form.blockoutStartAt || null,
        blockoutEndAt: form.blockoutEndAt || null,
        blockoutReason: normalizeText(form.blockoutReason) || null,
        blockoutNotes: normalizeText(form.blockoutNotes) || null,
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
      setIsFormDrawerOpen(false);
      await loadData();
      if (nextId) setSelectedId(nextId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to save maintenance record.");
    } finally {
      setSaving(false);
    }
  }

  async function updateRecordStatus(
    recordId: string,
    status: RecordStatus,
    options?: { completedDate?: string | null; createBlockout?: boolean },
  ) {
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
          serviceDate:
            status === "COMPLETED"
              ? new Date().toISOString().slice(0, 10)
              : undefined,
          completedDate: options?.completedDate,
          createBlockout: options?.createBlockout,
          csrfToken,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "Unable to update status.");
      }

      if (status === "COMPLETED") {
        setMessage("Record marked Completed.");
      } else if (status === "SCHEDULED" && options?.completedDate === null) {
        setMessage("Record reopened.");
      } else {
        setMessage(`Record marked ${formatStatus(status)}.`);
      }
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

  async function removeLinkedBlockout(recordId: string) {
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
          removeBlockout: true,
          csrfToken,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "Unable to remove linked blockout.");
      }
      setMessage("Linked maintenance blockout removed.");
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to remove linked blockout.");
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
    if (saving) return;

    if (pendingDocumentUpload?.maintenanceRecordId === record.id) {
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
            folder: "Maintenance",
            maintenanceRecordId: record.id,
            documentType,
            title: pendingDocumentUpload.fileName,
            label: normalizeText(documentLabel) || null,
            storageProvider: "UPLOADCARE_FILE_ID",
            storageKey: pendingDocumentUpload.reference,
            mimeType: pendingDocumentUpload.mimeType,
            sizeBytes: pendingDocumentUpload.sizeBytes,
            tags: ["maintenance"],
            csrfToken,
          }),
        });

        const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!response.ok || !result.ok) {
          throw new Error(result.error ?? "Unable to save uploaded document.");
        }

        setMessage("Maintenance document saved.");
        setPendingDocumentUpload(null);
        setDocumentLabel("");
        await loadData();
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Unable to save uploaded document.");
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const signedOptions = await getUploadcareSignedOptions();
      await loadUploadcareScript();
      const uploadWindow = window as Window & {
        uploadcare?: UploadcareApi;
        UPLOADCARE_PUBLIC_KEY?: string;
      };
      uploadWindow.UPLOADCARE_PUBLIC_KEY = signedOptions.publicKey;

      const dialog = uploadWindow.uploadcare?.openDialog(null, {
        ...signedOptions,
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

      const reference = String(fileInfo.cdnUrl ?? fileInfo.uuid ?? "").trim();
      if (!reference) {
        throw new Error("Upload returned an invalid file reference.");
      }

      const fileName =
        normalizeText(String(fileInfo.originalFilename ?? fileInfo.name ?? "Maintenance document")) ||
        "Maintenance document";
      const sizeBytes =
        typeof fileInfo.size === "number" && Number.isFinite(fileInfo.size)
          ? Math.round(fileInfo.size)
          : null;

      setPendingDocumentUpload({
        maintenanceRecordId: record.id,
        reference,
        fileName,
        mimeType: typeof fileInfo.mimeType === "string" ? fileInfo.mimeType : null,
        sizeBytes,
      });
      setMessage(`Document ready to save: ${fileName}`);
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
    <Drawer open={isFormDrawerOpen} onOpenChange={setIsFormDrawerOpen} direction="right">
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

      {error ? <p className="mt-3 text-xs font-semibold text-[var(--ccr-status-danger-text)]">{error}</p> : null}
      {message ? <p className="mt-3 text-xs font-semibold text-[var(--ccr-status-success-text)]">{message}</p> : null}

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
              onClick={() => {
                setActiveDueFilter(filter.key);
                setOffset(0);
              }}
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

      <div className="mt-4 grid gap-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        <label className="grid gap-1 text-xs text-[var(--ccr-muted)]">
          Search (title, category, status, record ID)
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.currentTarget.value);
              setOffset(0);
            }}
            placeholder="Search maintenance records or ME ID"
            data-testid="maintenance-search"
            className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]"
          />
        </label>

        <label className="grid gap-1 text-xs text-[var(--ccr-muted)]">
          Sort
          <select
            value={sortBy}
            onChange={(event) => {
              const nextSortBy = event.currentTarget.value as MaintenanceSort;
              setSortBy(nextSortBy);
              setSortDirection((current) => {
                if (sortBy === nextSortBy) return current;
                return defaultSortDirection(nextSortBy);
              });
              setOffset(0);
            }}
            data-testid="maintenance-sort"
            className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]"
          >
            <option value="dueDate">Due Date</option>
            <option value="createdAt">Created</option>
            <option value="cost">Cost</option>
            <option value="title">Title</option>
            <option value="status">Status</option>
            <option value="category">Category</option>
          </select>
        </label>

        <label className="grid gap-1 text-xs text-[var(--ccr-muted)]">
          Direction
          <select
            value={sortDirection}
            onChange={(event) => {
              setSortDirection(event.currentTarget.value as SortDirection);
              setOffset(0);
            }}
            className="min-h-11 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 text-sm text-[var(--ccr-text)]"
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>

        <div className="grid gap-1 text-xs text-[var(--ccr-muted)]">
          <span>&nbsp;</span>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setSortBy("dueDate");
              setSortDirection("asc");
              setOffset(0);
            }}
            className={buttonStyles({ variant: "secondary", size: "md", className: "rounded-lg" })}
          >
            Reset
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-6">
        <section
          data-testid="maintenance-list"
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-text)]">Maintenance Records</h3>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={maintenanceExportHref}
                className={buttonStyles({ variant: "secondary", size: "sm", className: "rounded-lg" })}
              >
                Export CSV
              </a>
              <DrawerTrigger asChild>
                <button
                  type="button"
                  onClick={openCreateDrawer}
                  data-testid="maintenance-add"
                  className={buttonStyles({ variant: "secondary", size: "sm", className: "rounded-lg" })}
                >
                  Add Maintenance
                </button>
              </DrawerTrigger>
            </div>
          </div>

          {loading ? <p className="mt-3 text-sm text-[var(--ccr-muted)]">Loading records...</p> : null}
          {!loading && items.length < 1 ? (
            <div className="mt-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-5">
              <p className="text-sm font-semibold text-[var(--ccr-text)]">No maintenance records found.</p>
              <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                Add a scheduled service or completed record to start tracking upkeep.
              </p>
            </div>
          ) : null}

          {!loading && items.length > 0 ? (
            <>
              <div className="mt-3 divide-y divide-[var(--ccr-border)] md:hidden">
                {items.map((item) => (
                  <article
                    key={`mobile-${item.id}`}
                    data-testid="maintenance-record-row"
                    data-record-id={item.id}
                    className="space-y-2 py-3"
                    onClick={() => selectRecordFromList(item.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectRecordFromList(item.id);
                      }
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-[var(--ccr-text)] break-words">{item.title}</p>
                        <p
                          data-testid="maintenance-record-public-id"
                          className="font-mono text-[11px] text-[var(--ccr-muted)]"
                        >
                          {item.publicId}
                        </p>
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
                        <dd className="text-sm text-[var(--ccr-text)]">{dueServiceDateLabel(item)}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>

              <div className="mt-3 hidden overflow-x-auto md:block">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                    <tr>
                      <SortableTh
                        label="Title"
                        columnKey="title"
                        sort={tableSortState}
                        className="px-3 py-2"
                        onChange={(next) =>
                          handleTableSortChange(
                            (next.sortBy as MaintenanceSort | undefined) ?? "title",
                            (next.sortDir ?? "asc") as SortDirection,
                          )
                        }
                      />
                      <SortableTh
                        label="Status"
                        columnKey="status"
                        sort={tableSortState}
                        className="px-3 py-2"
                        onChange={(next) =>
                          handleTableSortChange(
                            (next.sortBy as MaintenanceSort | undefined) ?? "status",
                            (next.sortDir ?? "asc") as SortDirection,
                          )
                        }
                      />
                      <SortableTh
                        label="Category"
                        columnKey="category"
                        sort={tableSortState}
                        className="px-3 py-2"
                        onChange={(next) =>
                          handleTableSortChange(
                            (next.sortBy as MaintenanceSort | undefined) ?? "category",
                            (next.sortDir ?? "asc") as SortDirection,
                          )
                        }
                      />
                      <SortableTh
                        label="Due / Service Date"
                        columnKey="dueDate"
                        sort={tableSortState}
                        className="px-3 py-2"
                        onChange={(next) =>
                          handleTableSortChange(
                            (next.sortBy as MaintenanceSort | undefined) ?? "dueDate",
                            (next.sortDir ?? "asc") as SortDirection,
                          )
                        }
                      />
                      <SortableTh
                        label="Total Cost"
                        columnKey="cost"
                        sort={tableSortState}
                        className="px-3 py-2"
                        defaultDirection="desc"
                        onChange={(next) =>
                          handleTableSortChange(
                            (next.sortBy as MaintenanceSort | undefined) ?? "cost",
                            (next.sortDir ?? "desc") as SortDirection,
                          )
                        }
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr
                        key={item.id}
                        data-testid="maintenance-record-row"
                        data-record-id={item.id}
                        className={`cursor-pointer border-b border-[var(--ccr-border)] last:border-b-0 ${
                          selectedId === item.id ? "bg-[var(--ccr-surface)]" : ""
                        }`}
                        onClick={() => selectRecordFromList(item.id)}
                      >
                        <td className="px-3 py-2 text-[var(--ccr-text)]">
                          <p className="font-semibold">{item.title}</p>
                          <p
                            data-testid="maintenance-record-public-id"
                            className="font-mono text-[11px] text-[var(--ccr-muted)]"
                          >
                            {item.publicId}
                          </p>
                        </td>
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
                        <td className="px-3 py-2 text-[var(--ccr-text)]">{dueServiceDateLabel(item)}</td>
                        <td className="px-3 py-2 font-semibold text-[var(--ccr-text)]">{formatCurrency(item.totalCostCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          <div
            data-testid="maintenance-pagination"
            className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ccr-border)] pt-3 text-xs text-[var(--ccr-muted)]"
          >
            <p>
              Showing {pageStart}-{pageEnd} of {total}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-2 py-1 text-xs text-[var(--ccr-text)]">
                Page size: {pageSize}
              </span>
              <button
                type="button"
                onClick={() => setOffset((current) => Math.max(0, current - pageSize))}
                disabled={!hasPrevPage}
                data-testid="maintenance-page-prev"
                className="min-h-9 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-1 font-semibold text-[var(--ccr-text)] disabled:opacity-50"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => setOffset((current) => current + pageSize)}
                disabled={!hasNextPage}
                data-testid="maintenance-page-next"
                className="min-h-9 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-3 py-1 font-semibold text-[var(--ccr-text)] disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </section>

        {selectedRecord ? (
            <section
              ref={detailSectionRef}
              data-testid="maintenance-detail"
              className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-text)]">Record Details</h3>
                  <p className="mt-1 text-sm font-semibold text-[var(--ccr-text)]">{selectedRecord.title}</p>
                  <p
                    data-testid="maintenance-detail-public-id"
                    className="mt-1 font-mono text-[11px] text-[var(--ccr-muted)]"
                  >
                    {selectedRecord.publicId}
                  </p>
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
                <div className="sm:col-span-2">
                  <dt>Record ID</dt>
                  <dd
                    data-testid="maintenance-detail-record-id"
                    className="font-mono text-[11px] text-[var(--ccr-muted)] break-all"
                  >
                    {selectedRecord.publicId}
                  </dd>
                </div>
                <div>
                  <dt>Due / Service Date</dt>
                  <dd className="text-sm text-[var(--ccr-text)]">{dueServiceDateLabel(selectedRecord)}</dd>
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
                <div>
                  <dt>Linked Expense ID</dt>
                  <dd
                    data-testid="maintenance-detail-linked-expense"
                    className="text-sm text-[var(--ccr-text)] break-all"
                  >
                    {selectedRecord.linkedExpenseId ?? "N/A"}
                  </dd>
                </div>
                <div>
                  <dt>Linked Repair Order ID</dt>
                  <dd
                    data-testid="maintenance-detail-linked-repair-order"
                    className="text-sm text-[var(--ccr-text)] break-all"
                  >
                    {selectedRecord.linkedRepairOrderId ?? "N/A"}
                  </dd>
                </div>
              </dl>

              {selectedRecord.description ? (
                <p className="mt-3 text-sm text-[var(--ccr-text)]">{selectedRecord.description}</p>
              ) : null}

              <section
                data-testid="maintenance-status-history"
                className="mt-3 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3"
              >
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                  Status History
                </h4>

                {historyLoading ? (
                  <p className="mt-2 text-xs text-[var(--ccr-muted)]">Loading status history...</p>
                ) : null}

                {!historyLoading && statusHistory.length < 1 ? (
                  <p className="mt-2 text-xs text-[var(--ccr-muted)]">
                    No status changes recorded yet.
                  </p>
                ) : null}

                {!historyLoading && statusHistory.length > 0 ? (
                  <ol className="mt-2 space-y-2">
                    {statusHistory.map((entry) => {
                      const note = statusHistoryNote(entry.note);
                      return (
                        <li
                          key={entry.id}
                          data-testid="maintenance-history-row"
                          className="rounded-md border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] px-2 py-2"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex min-h-7 items-center rounded-full border px-2 py-1 text-[11px] font-semibold ${statusTone(entry.status)}`}
                            >
                              {formatStatus(entry.status)}
                            </span>
                            <span className="text-xs text-[var(--ccr-muted)]">
                              <DateTimeInline value={entry.createdAt} />
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                            Changed by{" "}
                            <span className="font-semibold text-[var(--ccr-text)]">
                              {entry.changedBy || "system"}
                            </span>
                          </p>
                          {note ? <p className="mt-1 text-xs text-[var(--ccr-muted)]">{note}</p> : null}
                        </li>
                      );
                    })}
                  </ol>
                ) : null}
              </section>

              {selectedRecord.linkedBlockout ? (
                <div
                  data-testid="maintenance-linked-blockout"
                  className="mt-3 rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                    Linked Blockout
                  </p>
                  <dl className="mt-2 grid gap-2 text-xs text-[var(--ccr-muted)] sm:grid-cols-2">
                    <div>
                      <dt>Start</dt>
                      <dd className="text-sm text-[var(--ccr-text)]">
                        {selectedRecord.linkedBlockout.startAt ? (
                          <DateTimeInline value={selectedRecord.linkedBlockout.startAt} />
                        ) : (
                          "Not set"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>End</dt>
                      <dd className="text-sm text-[var(--ccr-text)]">
                        {selectedRecord.linkedBlockout.endAt ? (
                          <DateTimeInline value={selectedRecord.linkedBlockout.endAt} />
                        ) : (
                          "Not set"
                        )}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt>Reason</dt>
                      <dd className="text-sm text-[var(--ccr-text)]">
                        {selectedRecord.linkedBlockout.reason ?? "Maintenance window"}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => void removeLinkedBlockout(selectedRecord.id)}
                      className={buttonStyles({
                        variant: "secondary",
                        size: "sm",
                        className: "rounded-lg bg-[var(--ccr-surface-soft)]",
                      })}
                    >
                      Remove linked blockout
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(selectedRecord)}
                  data-testid="maintenance-edit"
                  className={buttonStyles({ variant: "secondary", size: "sm", className: "rounded-lg" })}
                >
                  Edit
                </button>
                {selectedRecord.status !== "COMPLETED" ? (
                  <button
                    type="button"
                    onClick={() => void updateRecordStatus(selectedRecord.id, "COMPLETED")}
                    data-testid="maintenance-mark-complete"
                    className={buttonStyles({ variant: "secondary", size: "sm", className: "rounded-lg" })}
                  >
                    Mark Completed
                  </button>
                ) : null}
                {selectedRecord.status === "COMPLETED" || selectedRecord.status === "CANCELLED" ? (
                  <button
                    type="button"
                    onClick={() =>
                      void updateRecordStatus(selectedRecord.id, "SCHEDULED", {
                        completedDate: null,
                        createBlockout: true,
                      })
                    }
                    data-testid="maintenance-reopen"
                    className={buttonStyles({ variant: "secondary", size: "sm", className: "rounded-lg" })}
                  >
                    Reopen
                  </button>
                ) : null}
                {selectedRecord.status !== "CANCELLED" ? (
                  <button
                    type="button"
                    onClick={() => void updateRecordStatus(selectedRecord.id, "CANCELLED")}
                    className={buttonStyles({ variant: "secondary", size: "sm", className: "rounded-lg" })}
                  >
                    Cancel
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void archiveRecord(selectedRecord.id)}
                  className={buttonStyles({
                    variant: "secondary",
                    size: "sm",
                    className: "rounded-lg border-[var(--ccr-accent)] text-[var(--ccr-accent-strong)]",
                  })}
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
                    className={buttonStyles({
                      variant: "primary",
                      size: "sm",
                    })}
                  >
                    {saving ? "Saving..." : hasPendingDocumentForSelection ? "Save now" : "Upload Document"}
                  </button>
                </div>

                {hasPendingDocumentForSelection ? (
                  <p className="mt-2 text-xs text-[var(--ccr-muted)]">
                    Ready to save: {pendingDocumentUpload?.fileName ?? "Selected document"}
                  </p>
                ) : null}

                <div className="mt-3 space-y-2">
                  {selectedDocs.length < 1 ? (
                    <p className="text-xs text-[var(--ccr-muted)]">No documents linked to this maintenance record.</p>
                  ) : (
                    selectedDocs.map((doc) => (
                      <article key={doc.id} className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-[var(--ccr-text)] break-words">{formatDocumentTitle(doc)}</p>
                            <p className="text-xs text-[var(--ccr-muted)]">
                              {formatDocumentTypeLabel(doc.documentType)} · {doc.mimeType || "Unknown type"} · {formatBytes(doc.sizeBytes)}
                            </p>
                            <p className="text-xs text-[var(--ccr-muted)]">
                              Uploaded <DateTimeInline value={doc.createdAt} />
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {doc.canDownload ? (
                              <a
                                href={`/api/admin/vehicles/${vehicleId}/documents/${doc.id}/download`}
                                className={buttonStyles({ variant: "secondary", size: "xs", className: "rounded-lg" })}
                              >
                                View
                              </a>
                            ) : (
                              <span className="inline-flex min-h-9 items-center rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-muted)]">
                                Unavailable
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => void archiveDocument(doc.id)}
                              className={buttonStyles({
                                variant: "secondary",
                                size: "xs",
                                className: "rounded-lg border-[var(--ccr-accent)] text-[var(--ccr-accent-strong)]",
                              })}
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
      </div>
      </section>
      <DrawerContent
        data-testid="maintenance-form-drawer"
        className="h-[100dvh] w-full p-0 sm:max-w-2xl"
      >
        <DrawerHeader className="border-b border-[var(--ccr-border)] px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DrawerTitle>{editingId ? "Edit Maintenance" : "Add Maintenance"}</DrawerTitle>
              <DrawerDescription>
                Create or update maintenance records for this vehicle.
              </DrawerDescription>
            </div>
            <DrawerClose asChild>
              <button
                type="button"
                aria-label="Close add maintenance drawer"
                className={buttonStyles({
                  variant: "secondary",
                  size: "sm",
                  className: "min-w-10 rounded-lg px-0",
                })}
              >
                <X className="h-4 w-4" />
              </button>
            </DrawerClose>
          </div>
        </DrawerHeader>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2">
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
                {options.categories.map((option) => (
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
                data-testid="maintenance-form-title"
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              />
            </label>

            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Scheduled Date
              <div className="relative mt-1">
                <input
                  ref={scheduledDateInputRef}
                  type="date"
                  value={form.scheduledDate}
                  onChange={(event) => setForm((current) => ({ ...current, scheduledDate: event.target.value }))}
                  data-testid="maintenance-form-scheduled-date"
                  className="promo-date-time-input min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 pr-10 text-sm text-[var(--ccr-text)]"
                />
                <button
                  type="button"
                  onClick={() => openNativeDatePicker(scheduledDateInputRef)}
                  className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-md p-1 text-[var(--ccr-muted)] opacity-80 transition hover:opacity-100"
                  aria-label="Open scheduled date calendar"
                  title="Open calendar"
                >
                  <CalendarIcon className="h-4 w-4" />
                </button>
              </div>
            </label>

            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Service Date
              <div className="relative mt-1">
                <input
                  ref={serviceDateInputRef}
                  type="date"
                  value={form.serviceDate}
                  onChange={(event) => setForm((current) => ({ ...current, serviceDate: event.target.value }))}
                  data-testid="maintenance-form-service-date"
                  className="promo-date-time-input min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 pr-10 text-sm text-[var(--ccr-text)]"
                />
                <button
                  type="button"
                  onClick={() => openNativeDatePicker(serviceDateInputRef)}
                  className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-md p-1 text-[var(--ccr-muted)] opacity-80 transition hover:opacity-100"
                  aria-label="Open service date calendar"
                  title="Open calendar"
                >
                  <CalendarIcon className="h-4 w-4" />
                </button>
              </div>
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
                {options.priorities.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Next Due Date
              <div className="relative mt-1">
                <input
                  ref={nextDueDateInputRef}
                  type="date"
                  value={form.nextDueDate}
                  onChange={(event) => setForm((current) => ({ ...current, nextDueDate: event.target.value }))}
                  className="promo-date-time-input min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 pr-10 text-sm text-[var(--ccr-text)]"
                />
                <button
                  type="button"
                  onClick={() => openNativeDatePicker(nextDueDateInputRef)}
                  className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-md p-1 text-[var(--ccr-muted)] opacity-80 transition hover:opacity-100"
                  aria-label="Open next due date calendar"
                  title="Open calendar"
                >
                  <CalendarIcon className="h-4 w-4" />
                </button>
              </div>
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
              Estimated Cost (cents)
              <input
                type="number"
                min={0}
                value={form.estimatedCostCents}
                onChange={(event) => setForm((current) => ({ ...current, estimatedCostCents: event.target.value }))}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              />
            </label>

            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Actual Cost (cents)
              <input
                type="number"
                min={0}
                value={form.actualCostCents}
                onChange={(event) => setForm((current) => ({ ...current, actualCostCents: event.target.value }))}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              />
            </label>

            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
              Reminder Lead Days
              <input
                type="number"
                min={0}
                value={form.reminderLeadDays}
                onChange={(event) => setForm((current) => ({ ...current, reminderLeadDays: event.target.value }))}
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

            <div className="sm:col-span-2 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                Reference Links
              </p>
              <p className="mt-1 text-[11px] text-[var(--ccr-muted)]">
                Optional internal reference for reconciliation/reporting.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                  Linked Expense ID
                  <input
                    type="text"
                    value={form.linkedExpenseId}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, linkedExpenseId: event.target.value }))
                    }
                    data-testid="maintenance-form-linked-expense"
                    placeholder="UUID"
                    className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </label>

                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                  Linked Repair Order ID
                  <input
                    type="text"
                    value={form.linkedRepairOrderId}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, linkedRepairOrderId: event.target.value }))
                    }
                    data-testid="maintenance-form-linked-repair-order"
                    placeholder="UUID"
                    className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </label>
              </div>
            </div>

            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] sm:col-span-2">
              Description
              <textarea
                rows={3}
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
              />
            </label>

            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] sm:col-span-2">
              <input
                type="checkbox"
                checked={form.createBlockout}
                onChange={(event) => setForm((current) => ({ ...current, createBlockout: event.target.checked }))}
                data-testid="maintenance-form-create-blockout"
                className="h-4 w-4 rounded border border-[var(--ccr-border)] bg-transparent"
              />
              Create / update linked blockout for this maintenance
            </label>

            {form.createBlockout ? (
              <>
                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                  Blockout Start
                  <input
                    type="datetime-local"
                    value={form.blockoutStartAt}
                    onChange={(event) => setForm((current) => ({ ...current, blockoutStartAt: event.target.value }))}
                    className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </label>

                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                  Blockout End
                  <input
                    type="datetime-local"
                    value={form.blockoutEndAt}
                    onChange={(event) => setForm((current) => ({ ...current, blockoutEndAt: event.target.value }))}
                    className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </label>

                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] sm:col-span-2">
                  Blockout Reason
                  <input
                    type="text"
                    value={form.blockoutReason}
                    onChange={(event) => setForm((current) => ({ ...current, blockoutReason: event.target.value }))}
                    data-testid="maintenance-form-blockout-reason"
                    placeholder="Maintenance window"
                    className="mt-1 min-h-11 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </label>

                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)] sm:col-span-2">
                  Blockout Notes
                  <textarea
                    rows={2}
                    value={form.blockoutNotes}
                    onChange={(event) => setForm((current) => ({ ...current, blockoutNotes: event.target.value }))}
                    className="mt-1 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
                  />
                </label>
              </>
            ) : null}
          </div>

          <p className="mt-3 text-xs font-semibold text-[var(--ccr-muted)]">
            Total preview: <span className="text-[var(--ccr-text)]">{formatCurrency(totalPreview)}</span>
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void saveRecord()}
              disabled={saving}
              data-testid="maintenance-save"
              className={buttonStyles({ variant: "primary", size: "md" })}
            >
              {saving ? "Saving..." : editingId ? "Save changes" : "Add maintenance"}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={resetForm}
                className={buttonStyles({ variant: "secondary", size: "md" })}
              >
                Cancel edit
              </button>
            ) : null}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
