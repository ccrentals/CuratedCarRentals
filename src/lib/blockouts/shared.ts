import { dbQuery } from "@/lib/db";

export type BlockoutListRow = {
  id: string;
  vehicle_id: string;
  start_at: string;
  end_at: string;
  reason: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  vehicle_make: string;
  vehicle_model: string;
};

export type BlockoutCreateRow = {
  id: string;
  vehicle_id: string;
  start_at: string;
  end_at: string;
  reason: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type BlockoutQueryRunner = <T>(
  text: string,
  values?: unknown[],
) => Promise<{ rows: T[]; rowCount: number }>;

type ListBlockoutsInput = {
  rangeStartIso?: string | null;
  rangeEndIso?: string | null;
  vehicleId?: string | null;
  limit?: number | null;
};

type ListBlockoutsDeps = {
  query: BlockoutQueryRunner;
};

type CreateBlockoutInput = {
  vehicleId: string;
  startAtIso: string;
  endAtIso: string;
  reason: string;
  notes: string | null;
  createdByUserId: string | null;
};

const DEFAULT_DEPS: ListBlockoutsDeps = {
  query: dbQuery,
};

export async function listBlockouts(
  input: ListBlockoutsInput,
  deps: ListBlockoutsDeps = DEFAULT_DEPS,
) {
  const hasRangeStart = typeof input.rangeStartIso === "string" && input.rangeStartIso.trim().length > 0;
  const hasRangeEnd = typeof input.rangeEndIso === "string" && input.rangeEndIso.trim().length > 0;
  if (hasRangeStart !== hasRangeEnd) {
    throw new Error("INVALID_RANGE");
  }

  const hasVehicle = typeof input.vehicleId === "string" && input.vehicleId.trim().length > 0;
  if (!hasRangeStart && !hasRangeEnd && !hasVehicle) {
    throw new Error("MISSING_FILTERS");
  }

  const values: unknown[] = [];
  const whereClauses: string[] = [];

  if (hasRangeStart && hasRangeEnd) {
    values.push(String(input.rangeStartIso).trim());
    values.push(String(input.rangeEndIso).trim());
    whereClauses.push("b.start_at < $2");
    whereClauses.push("b.end_at > $1");
  }

  if (hasVehicle) {
    values.push(String(input.vehicleId).trim());
    whereClauses.push(`b.vehicle_id = $${values.length}`);
  }

  const whereSql = whereClauses.length > 0 ? `where ${whereClauses.join(" and ")}` : "";
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit) && input.limit > 0
      ? Math.floor(input.limit)
      : null;
  const limitSql = limit ? `limit ${limit}` : "";

  const result = await deps.query<BlockoutListRow>(
    "select b.id, b.vehicle_id, b.start_at, b.end_at, b.reason, b.notes, b.created_at, b.updated_at, v.make as vehicle_make, v.model as vehicle_model from blockouts b join vehicles v on v.id = b.vehicle_id " +
      whereSql +
      " order by b.start_at asc " +
      limitSql,
    values,
  );

  return result.rows;
}

export async function createBlockout(
  input: CreateBlockoutInput,
  deps: ListBlockoutsDeps = DEFAULT_DEPS,
) {
  const result = await deps.query<BlockoutCreateRow>(
    "insert into blockouts (vehicle_id, start_at, end_at, reason, notes, created_by) values ($1::uuid, $2::timestamptz, $3::timestamptz, $4, $5, $6::uuid) returning id, vehicle_id, start_at, end_at, reason, notes, created_by, created_at, updated_at",
    [input.vehicleId, input.startAtIso, input.endAtIso, input.reason, input.notes, input.createdByUserId],
  );
  return result.rows[0] ?? null;
}
