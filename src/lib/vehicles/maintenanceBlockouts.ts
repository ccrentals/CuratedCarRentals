import { dbQuery } from "@/lib/db";

export type MaintenanceLinkedBlockout = {
  id: string;
  startAt: string;
  endAt: string;
  reason: string;
  notes: string | null;
  source: string;
};

export type UpsertMaintenanceBlockoutInput = {
  vehicleId: string;
  maintenanceRecordId: string;
  title: string;
  scheduledDate?: string | Date | null;
  serviceDate?: string | Date | null;
  startAt?: string | Date | null;
  endAt?: string | Date | null;
  reason?: string | null;
  notes?: string | null;
  createdByUserId?: string | null;
};

export type MaintenanceCompletionLike = {
  status?: unknown;
  completedDate?: unknown;
  completed_date?: unknown;
};

export type SyncMaintenanceBlockoutInput = UpsertMaintenanceBlockoutInput &
  MaintenanceCompletionLike & {
    ensureWhenOpen?: boolean;
  };

type BlockoutRow = {
  id: string;
  start_at: string;
  end_at: string;
  reason: string;
  notes: string | null;
  source: string;
};

type QueryRunner = <T>(text: string, values?: unknown[]) => Promise<{
  rows: T[];
  rowCount: number;
}>;

function normalizeText(value: unknown, maxLength = 255) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function parseIsoDateTime(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseDateOnlyAsUtcStart(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }
  const normalized = normalizeText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveWindow(input: UpsertMaintenanceBlockoutInput) {
  const explicitStart = parseIsoDateTime(input.startAt ?? null);
  const explicitEnd = parseIsoDateTime(input.endAt ?? null);

  if (explicitStart && explicitEnd && explicitEnd.getTime() > explicitStart.getTime()) {
    return {
      startAtIso: explicitStart.toISOString(),
      endAtIso: explicitEnd.toISOString(),
    };
  }

  const dayStart =
    parseDateOnlyAsUtcStart(input.scheduledDate ?? null) ??
    parseDateOnlyAsUtcStart(input.serviceDate ?? null);
  if (!dayStart) return null;

  const dayEnd = new Date(dayStart.getTime());
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  return {
    startAtIso: dayStart.toISOString(),
    endAtIso: dayEnd.toISOString(),
  };
}

export function isMaintenanceCompleted(value: MaintenanceCompletionLike) {
  const completedDate = normalizeText(
    String(value.completedDate ?? value.completed_date ?? ""),
    40,
  );
  if (completedDate.length > 0) return true;

  const status = normalizeText(String(value.status ?? ""), 40).toUpperCase();
  return status === "COMPLETED";
}

function mapRow(row: BlockoutRow): MaintenanceLinkedBlockout {
  return {
    id: row.id,
    startAt: row.start_at,
    endAt: row.end_at,
    reason: row.reason,
    notes: row.notes,
    source: row.source,
  };
}

export async function upsertMaintenanceBlockout(
  input: UpsertMaintenanceBlockoutInput,
  deps: { query?: QueryRunner } = {},
): Promise<MaintenanceLinkedBlockout | null> {
  const query = deps.query ?? dbQuery;
  const window = resolveWindow(input);
  if (!window) return null;

  const reason =
    normalizeText(input.reason, 140) || `Maintenance: ${normalizeText(input.title, 90) || "Service"}`;
  const notes = normalizeText(input.notes, 4000) || null;

  const existing = await query<BlockoutRow>(
    "select id, start_at, end_at, reason, notes, source from blockouts where linked_maintenance_id = $1::uuid and vehicle_id = $2::uuid limit 1",
    [input.maintenanceRecordId, input.vehicleId],
  );

  if (existing.rowCount > 0) {
    const updated = await query<BlockoutRow>(
      `update blockouts
       set vehicle_id = $2::uuid,
           start_at = $3::timestamptz,
           end_at = $4::timestamptz,
           reason = $5,
           notes = $6,
           source = 'MAINTENANCE',
           updated_at = now()
       where id = $1::uuid
       returning id, start_at, end_at, reason, notes, source`,
      [
        existing.rows[0].id,
        input.vehicleId,
        window.startAtIso,
        window.endAtIso,
        reason,
        notes,
      ],
    );

    return updated.rows[0] ? mapRow(updated.rows[0]) : null;
  }

  const created = await query<BlockoutRow>(
    `insert into blockouts (vehicle_id, start_at, end_at, reason, notes, created_by, linked_maintenance_id, source)
     values ($1::uuid, $2::timestamptz, $3::timestamptz, $4, $5, $6::uuid, $7::uuid, 'MAINTENANCE')
     returning id, start_at, end_at, reason, notes, source`,
    [
      input.vehicleId,
      window.startAtIso,
      window.endAtIso,
      reason,
      notes,
      input.createdByUserId ?? null,
      input.maintenanceRecordId,
    ],
  );

  return created.rows[0] ? mapRow(created.rows[0]) : null;
}

export async function removeMaintenanceBlockoutByRecordId(
  maintenanceRecordId: string,
  deps: { query?: QueryRunner; vehicleId?: string | null } = {},
): Promise<number> {
  const query = deps.query ?? dbQuery;
  const removed = await query<{ id: string }>(
    `delete from blockouts
     where linked_maintenance_id = $1::uuid
       and source = 'MAINTENANCE'
       and ($2::uuid is null or vehicle_id = $2::uuid)
     returning id`,
    [maintenanceRecordId, deps.vehicleId ?? null],
  );
  return removed.rowCount;
}

export async function syncMaintenanceBlockout(
  input: SyncMaintenanceBlockoutInput,
  deps: { query?: QueryRunner } = {},
): Promise<{ action: "removed" | "upserted" | "skipped"; blockout: MaintenanceLinkedBlockout | null }> {
  const completed = isMaintenanceCompleted(input);
  if (completed) {
    await removeMaintenanceBlockoutByRecordId(input.maintenanceRecordId, {
      query: deps.query,
      vehicleId: input.vehicleId,
    });
    return { action: "removed", blockout: null };
  }

  if (input.ensureWhenOpen === false) {
    return { action: "skipped", blockout: null };
  }

  const blockout = await upsertMaintenanceBlockout(input, deps);
  if (!blockout) {
    return { action: "skipped", blockout: null };
  }

  return { action: "upserted", blockout };
}
