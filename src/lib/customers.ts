import { dbQuery } from "@/lib/db";
import { normalizeLegalIdType } from "@/lib/customers/legalId";

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
};

type CustomerRow = {
  id: string;
};

type CustomerLookupRow = {
  id: string;
  is_blocked: boolean | null;
  blocked_reason: string | null;
  full_name?: string | null;
};

export class CustomerBlockedError extends Error {
  customerId: string;
  blockedReason: string | null;

  constructor(customerId: string, blockedReason: string | null = null) {
    super("Customer is blocked from booking");
    this.name = "CustomerBlockedError";
    this.customerId = customerId;
    this.blockedReason = blockedReason;
  }
}

function getQueryable(client?: Queryable): Queryable {
  if (client) return client;
  return { query: (text: string, params: unknown[] = []) => dbQuery(text, params) };
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizePhone(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeTimestamp(value?: string) {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function isMissingColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.includes(`"${column}"`) && message.includes("does not exist");
}

function isAnyMissingColumn(error: unknown, columns: string[]) {
  return columns.some((column) => isMissingColumn(error, column));
}

function normalizeBlocked(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "t" || normalized === "1";
  }
  if (typeof value === "number") return value === 1;
  return false;
}

function ensureNotBlocked(customer: { id: string; is_blocked: unknown; blocked_reason: string | null }) {
  if (!normalizeBlocked(customer.is_blocked)) return;
  throw new CustomerBlockedError(customer.id, customer.blocked_reason ?? null);
}

async function findCustomerById(db: Queryable, customerId: string) {
  try {
    const result = await db.query(
      "select id, coalesce(is_blocked, false) as is_blocked, blocked_reason, full_name from customers where id = $1 limit 1",
      [customerId],
    );
    return (result.rows[0] as CustomerLookupRow | undefined) ?? null;
  } catch (error) {
    if (!isAnyMissingColumn(error, ["is_blocked", "blocked_reason"])) {
      throw error;
    }
    const fallback = await db.query(
      "select id, false as is_blocked, null::text as blocked_reason, full_name from customers where id = $1 limit 1",
      [customerId],
    );
    return (fallback.rows[0] as CustomerLookupRow | undefined) ?? null;
  }
}

async function findMatchingCustomer(db: Queryable, email: string, phone: string) {
  try {
    const result = await db.query(
      "select id, coalesce(is_blocked, false) as is_blocked, blocked_reason, full_name from customers where lower(email) = lower($1) or phone = $2 order by case when lower(email) = lower($1) then 0 else 1 end, case when phone = $2 then 0 else 1 end, created_at asc limit 1",
      [email, phone],
    );
    return (result.rows[0] as CustomerLookupRow | undefined) ?? null;
  } catch (error) {
    if (!isAnyMissingColumn(error, ["is_blocked", "blocked_reason"])) {
      throw error;
    }
    const fallback = await db.query(
      "select id, false as is_blocked, null::text as blocked_reason, full_name from customers where lower(email) = lower($1) or phone = $2 order by case when lower(email) = lower($1) then 0 else 1 end, case when phone = $2 then 0 else 1 end, created_at asc limit 1",
      [email, phone],
    );
    return (fallback.rows[0] as CustomerLookupRow | undefined) ?? null;
  }
}

async function updateExistingCustomer(
  db: Queryable,
  customerId: string,
  input: {
    fullName: string;
    email: string;
    phone: string;
    address?: string | null;
    notes?: string | null;
    bookedAtIso: string;
    legalIdType?: string | null;
    legalIdNumber?: string | null;
    legalIdTypeProvided: boolean;
    legalIdNumberProvided: boolean;
  },
) {
  try {
    await db.query(
      "update customers set full_name = $2, email = $3, phone = $4, address = $5, notes = $6, last_booked_at = greatest(coalesce(last_booked_at, to_timestamp(0)), $7::timestamptz), legal_id_type = case when $8::boolean then $9 else legal_id_type end, legal_id_number = case when $10::boolean then $11 else legal_id_number end where id = $1",
      [
        customerId,
        input.fullName,
        input.email,
        input.phone,
        input.address ?? null,
        input.notes ?? null,
        input.bookedAtIso,
        input.legalIdTypeProvided,
        input.legalIdType ?? null,
        input.legalIdNumberProvided,
        input.legalIdNumber ?? null,
      ],
    );
    return;
  } catch (error) {
    if (isAnyMissingColumn(error, ["legal_id_type", "legal_id_number"])) {
      try {
        await db.query(
          "update customers set full_name = $2, email = $3, phone = $4, address = $5, notes = $6, last_booked_at = greatest(coalesce(last_booked_at, to_timestamp(0)), $7::timestamptz) where id = $1",
          [
            customerId,
            input.fullName,
            input.email,
            input.phone,
            input.address ?? null,
            input.notes ?? null,
            input.bookedAtIso,
          ],
        );
        return;
      } catch (legacyError) {
        error = legacyError;
      }
    }
    if (isMissingColumn(error, "address") || isMissingColumn(error, "notes")) {
      await db.query(
        "update customers set full_name = $2, email = $3, phone = $4 where id = $1",
        [customerId, input.fullName, input.email, input.phone],
      );
      return;
    }
    if (isMissingColumn(error, "last_booked_at")) {
      await db.query(
        "update customers set full_name = $2, email = $3, phone = $4, address = $5, notes = $6 where id = $1",
        [customerId, input.fullName, input.email, input.phone, input.address ?? null, input.notes ?? null],
      );
      return;
    }
    throw error;
  }
}

async function insertCustomer(
  db: Queryable,
  input: {
    fullName: string;
    email: string;
    phone: string;
    address?: string | null;
    notes?: string | null;
    bookedAtIso: string;
    legalIdType?: string | null;
    legalIdNumber?: string | null;
  },
) {
  try {
    const inserted = await db.query(
      "insert into customers (full_name, email, phone, address, notes, last_booked_at, legal_id_type, legal_id_number) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id",
      [
        input.fullName,
        input.email,
        input.phone,
        input.address ?? null,
        input.notes ?? null,
        input.bookedAtIso,
        input.legalIdType ?? null,
        input.legalIdNumber ?? null,
      ],
    );
    return (inserted.rows[0] as CustomerRow).id;
  } catch (error) {
    if (isAnyMissingColumn(error, ["legal_id_type", "legal_id_number"])) {
      try {
        const inserted = await db.query(
          "insert into customers (full_name, email, phone, address, notes, last_booked_at) values ($1, $2, $3, $4, $5, $6) returning id",
          [input.fullName, input.email, input.phone, input.address ?? null, input.notes ?? null, input.bookedAtIso],
        );
        return (inserted.rows[0] as CustomerRow).id;
      } catch (legacyError) {
        error = legacyError;
      }
    }
    if (
      isMissingColumn(error, "address") ||
      isMissingColumn(error, "notes") ||
      isMissingColumn(error, "last_booked_at")
    ) {
      const inserted = await db.query(
        "insert into customers (full_name, email, phone) values ($1, $2, $3) returning id",
        [input.fullName, input.email, input.phone],
      );
      return (inserted.rows[0] as CustomerRow).id;
    }
    throw error;
  }
}

export type UpsertCustomerForBookingInput = {
  fullName: string;
  email: string;
  phone: string;
  customerId?: string | null;
  address?: string | null;
  notes?: string | null;
  legalIdType?: string | null;
  legalIdNumber?: string | null;
  bookedAt?: string;
};

export type UpsertCustomerForBookingResult = {
  customerId: string;
  created: boolean;
};

export async function upsertCustomerForBooking(
  input: UpsertCustomerForBookingInput,
  options: { client?: Queryable } = {},
): Promise<UpsertCustomerForBookingResult> {
  const db = getQueryable(options.client);
  const fullName = input.fullName.trim();
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const bookedAtIso = normalizeTimestamp(input.bookedAt);
  const legalIdType = normalizeLegalIdType(input.legalIdType);
  const legalIdNumber =
    typeof input.legalIdNumber === "string" ? input.legalIdNumber.trim() : null;
  const legalIdTypeProvided =
    Object.prototype.hasOwnProperty.call(input, "legalIdType") && input.legalIdType !== undefined;
  const legalIdNumberProvided =
    Object.prototype.hasOwnProperty.call(input, "legalIdNumber") && input.legalIdNumber !== undefined;

  if (!fullName || !email || !phone) {
    throw new Error("fullName, email, and phone are required");
  }
  if (legalIdTypeProvided || legalIdNumberProvided) {
    if (!legalIdType) {
      throw new Error("valid legalIdType is required when legalIdNumber is provided");
    }
    if (!legalIdNumber) {
      throw new Error("legalIdNumber is required when legalIdType is provided");
    }
  }

  if (input.customerId) {
    const existing = await findCustomerById(db, input.customerId);
    if (existing) {
      ensureNotBlocked(existing);
      await updateExistingCustomer(db, input.customerId, {
        fullName,
        email,
        phone,
        address: input.address,
        notes: input.notes,
        bookedAtIso,
        legalIdType,
        legalIdNumber,
        legalIdTypeProvided,
        legalIdNumberProvided,
      });
      return { customerId: input.customerId, created: false };
    }
  }

  const matched = await findMatchingCustomer(db, email, phone);
  const existingId = matched?.id;
  if (existingId) {
    ensureNotBlocked({
      id: existingId,
      is_blocked: matched?.is_blocked ?? false,
      blocked_reason: matched?.blocked_reason ?? null,
    });
    const matchedFullName =
      typeof matched?.full_name === "string" ? matched.full_name.trim() : "";
    await updateExistingCustomer(db, existingId, {
      // Preserve an existing profile name when matching by email/phone so new bookings
      // cannot unexpectedly rename all historical bookings tied to this customer.
      fullName: matchedFullName || fullName,
      email,
      phone,
      address: input.address,
      notes: input.notes,
      bookedAtIso,
      legalIdType,
      legalIdNumber,
      legalIdTypeProvided,
      legalIdNumberProvided,
    });
    return { customerId: existingId, created: false };
  }

  const customerId = await insertCustomer(db, {
    fullName,
    email,
    phone,
    address: input.address,
    notes: input.notes,
    bookedAtIso,
    legalIdType,
    legalIdNumber,
  });
  return { customerId, created: true };
}

export function normalizeCustomerLookup(input: { email?: string; phone?: string }) {
  return {
    email: input.email ? normalizeEmail(input.email) : "",
    phone: input.phone ? normalizePhone(input.phone) : "",
  };
}
