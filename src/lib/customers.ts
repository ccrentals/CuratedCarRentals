import { dbQuery } from "@/lib/db";

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
};

type CustomerRow = {
  id: string;
};

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
  },
) {
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
  } catch (error) {
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
  },
) {
  try {
    const inserted = await db.query(
      "insert into customers (full_name, email, phone, address, notes, last_booked_at) values ($1, $2, $3, $4, $5, $6) returning id",
      [input.fullName, input.email, input.phone, input.address ?? null, input.notes ?? null, input.bookedAtIso],
    );
    return (inserted.rows[0] as CustomerRow).id;
  } catch (error) {
    if (isMissingColumn(error, "address") || isMissingColumn(error, "notes") || isMissingColumn(error, "last_booked_at")) {
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

  if (!fullName || !email || !phone) {
    throw new Error("fullName, email, and phone are required");
  }

  if (input.customerId) {
    const existing = await db.query("select id from customers where id = $1 limit 1", [input.customerId]);
    if (existing.rowCount > 0) {
      await updateExistingCustomer(db, input.customerId, {
        fullName,
        email,
        phone,
        address: input.address,
        notes: input.notes,
        bookedAtIso,
      });
      return { customerId: input.customerId, created: false };
    }
  }

  const matched = await db.query(
    "select id from customers where lower(email) = lower($1) or phone = $2 order by case when lower(email) = lower($1) then 0 else 1 end, case when phone = $2 then 0 else 1 end, created_at asc limit 1",
    [email, phone],
  );

  const existingId = (matched.rows[0] as CustomerRow | undefined)?.id;
  if (existingId) {
    await updateExistingCustomer(db, existingId, {
      fullName,
      email,
      phone,
      address: input.address,
      notes: input.notes,
      bookedAtIso,
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
  });
  return { customerId, created: true };
}

export function normalizeCustomerLookup(input: { email?: string; phone?: string }) {
  return {
    email: input.email ? normalizeEmail(input.email) : "",
    phone: input.phone ? normalizePhone(input.phone) : "",
  };
}
