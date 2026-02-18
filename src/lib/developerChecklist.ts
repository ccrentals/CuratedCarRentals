export type ChecklistPriority = "P0" | "P1" | "P2" | "P3";
export type ChecklistStatus = "NOT_TESTED" | "PASS" | "FAIL";

export type ChecklistDefinition = {
  id: string;
  title: string;
  priority: ChecklistPriority;
  description: string;
};

export type ChecklistEntry = {
  id: string;
  status: ChecklistStatus;
  notes: string;
  updatedAt: string | null;
};

export type DeveloperChecklistDocument = {
  items: ChecklistEntry[];
  generalNotes: string;
};

export const DEVELOPER_CHECKLIST_DEFINITIONS: ChecklistDefinition[] = [
  {
    id: "payment-atomicity",
    priority: "P0",
    title: "Payment action atomicity",
    description: "Deposit and balance actions must write one payment row and one matching booking state update.",
  },
  {
    id: "status-sync",
    priority: "P0",
    title: "Status and totals synchronization",
    description: "Top status, Charges Summary, and Payments table must always show the same state.",
  },
  {
    id: "date-control-visibility",
    priority: "P0",
    title: "Date control visibility across themes",
    description: "Booking edit date controls must stay visible and usable in every theme.",
  },
  {
    id: "summary-math",
    priority: "P0",
    title: "Charges Summary math",
    description: "Total, paid-to-date, deposit due, and balance due must reconcile for every action path.",
  },
  {
    id: "action-guards",
    priority: "P1",
    title: "Action guard clarity",
    description: "Blocked actions must show clear reasons and no partial writes.",
  },
  {
    id: "button-state-logic",
    priority: "P1",
    title: "Button enable/disable logic",
    description: "Buttons must reflect true booking/payment state after each mutation.",
  },
  {
    id: "refund-indicators",
    priority: "P1",
    title: "Refund indicators consistency",
    description: "Refund toast and badge should appear only when refundRequired is true.",
  },
  {
    id: "manual-payment-metadata",
    priority: "P1",
    title: "Manual payment metadata persistence",
    description: "Reference and note entered for payments should persist and remain visible.",
  },
  {
    id: "authorization-enforcement",
    priority: "P1",
    title: "Authorization enforcement",
    description: "Restricted mutations must return proper unauthorized/forbidden responses.",
  },
  {
    id: "override-readability",
    priority: "P2",
    title: "Override readability",
    description: "Override markers should prefer readable actor names over raw IDs.",
  },
  {
    id: "ui-feedback-consistency",
    priority: "P2",
    title: "UI feedback consistency",
    description: "Success/warning/error feedback should follow one pattern and theme styling.",
  },
  {
    id: "timeline-traceability",
    priority: "P2",
    title: "Event traceability",
    description: "Booking updates should be auditable without cross-page ambiguity.",
  },
];

const VALID_STATUSES: ChecklistStatus[] = ["NOT_TESTED", "PASS", "FAIL"];

export function normalizeChecklistStatus(value: unknown): ChecklistStatus {
  if (typeof value !== "string") return "NOT_TESTED";
  const normalized = value.trim().toUpperCase();
  return VALID_STATUSES.includes(normalized as ChecklistStatus)
    ? (normalized as ChecklistStatus)
    : "NOT_TESTED";
}

export function normalizeDeveloperChecklistDocument(raw: unknown): DeveloperChecklistDocument {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const sourceItems = Array.isArray(source.items) ? source.items : [];
  const byId = new Map<string, Record<string, unknown>>();

  for (const entry of sourceItems) {
    if (typeof entry !== "object" || entry === null) continue;
    const value = entry as Record<string, unknown>;
    const id = typeof value.id === "string" ? value.id.trim() : "";
    if (!id) continue;
    byId.set(id, value);
  }

  const items: ChecklistEntry[] = DEVELOPER_CHECKLIST_DEFINITIONS.map((definition) => {
    const saved = byId.get(definition.id);
    const notes = typeof saved?.notes === "string" ? saved.notes : "";
    const updatedAt = typeof saved?.updatedAt === "string" && saved.updatedAt.trim()
      ? saved.updatedAt
      : null;

    return {
      id: definition.id,
      status: normalizeChecklistStatus(saved?.status),
      notes,
      updatedAt,
    };
  });

  return {
    items,
    generalNotes: typeof source.generalNotes === "string" ? source.generalNotes : "",
  };
}

export function mergeChecklistEntries(rawEntries: unknown): ChecklistEntry[] {
  if (!Array.isArray(rawEntries)) {
    return normalizeDeveloperChecklistDocument({}).items;
  }

  const nowIso = new Date().toISOString();
  const byId = new Map<string, Record<string, unknown>>();

  for (const entry of rawEntries) {
    if (typeof entry !== "object" || entry === null) continue;
    const value = entry as Record<string, unknown>;
    const id = typeof value.id === "string" ? value.id.trim() : "";
    if (!id) continue;
    byId.set(id, value);
  }

  return DEVELOPER_CHECKLIST_DEFINITIONS.map((definition) => {
    const saved = byId.get(definition.id);
    const notes = typeof saved?.notes === "string" ? saved.notes : "";
    const status = normalizeChecklistStatus(saved?.status);
    const updatedAt =
      typeof saved?.updatedAt === "string" && saved.updatedAt.trim()
        ? saved.updatedAt
        : nowIso;

    return {
      id: definition.id,
      notes,
      status,
      updatedAt,
    };
  });
}

