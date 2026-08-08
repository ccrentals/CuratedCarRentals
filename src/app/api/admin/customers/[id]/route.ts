import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { dbQuery, getDbPool } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { writeAuditLog } from "@/lib/audit";
import { isEmail, isNonEmptyString } from "@/lib/validators";
import { logError } from "@/lib/log";
import { normalizeLegalIdType } from "@/lib/customers/legalId";
import { synchronizeCustomerContact } from "@/lib/customers/customerContactSync";
import { normalizeCountryName, normalizeRegionForCountry } from "@/lib/jamaicaParishes";

type CustomerRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  first_name: string | null;
  last_name: string | null;
  street: string | null;
  street2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  birthday: string | null;
  drivers_license_number: string | null;
  drivers_license_expiration_date: string | null;
  is_blocked: boolean | null;
  blocked_at: string | null;
  blocked_by_user_id: string | null;
  blocked_reason: string | null;
  legal_id_type: string | null;
  legal_id_number: string | null;
  legal_id_expiration_date: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
  last_booked_at: string | null;
};

function trimOptional(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isMissingColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  const normalizedColumn = column.toLowerCase();
  const escapedColumn = normalizedColumn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const columnPattern = new RegExp(`\\b${escapedColumn}\\b`);
  return code === "42703" && message.includes("does not exist") && columnPattern.test(message);
}

function isAnyMissingColumn(error: unknown, columns: string[]) {
  return columns.some((column) => isMissingColumn(error, column));
}

function isUniqueDriversLicenseError(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  const detail = String((error as { detail?: unknown } | null)?.detail ?? "").toLowerCase();
  return (
    code === "23505" &&
    (message.includes("customers_drivers_license_number_lower_unique") ||
      message.includes("drivers_license_number") ||
      detail.includes("drivers_license_number"))
  );
}

function toCustomerRowWithNullLegalFields(
  row: Omit<CustomerRow, "legal_id_type" | "legal_id_number" | "legal_id_expiration_date">,
): CustomerRow {
  return {
    ...row,
    legal_id_type: null,
    legal_id_number: null,
    legal_id_expiration_date: null,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireOperationsAccess();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  let result;
  try {
    result = await dbQuery<CustomerRow>(
      "select id, full_name, email, phone, first_name, last_name, street, street2, city, state, country, birthday::text as birthday, drivers_license_number, drivers_license_expiration_date::text as drivers_license_expiration_date, coalesce(is_blocked, false) as is_blocked, blocked_at, blocked_by_user_id, blocked_reason, legal_id_type, legal_id_number, legal_id_expiration_date::text as legal_id_expiration_date, address, notes, created_at, last_booked_at from customers where id = $1 limit 1",
      [id],
    );
  } catch (error) {
    if (
      !isAnyMissingColumn(error, [
        "legal_id_type",
        "is_blocked",
        "blocked_at",
        "blocked_by_user_id",
        "blocked_reason",
        "first_name",
        "last_name",
        "street",
        "street2",
        "city",
        "state",
        "country",
        "birthday",
        "drivers_license_number",
        "drivers_license_expiration_date",
        "legal_id_expiration_date",
      ])
    ) {
      throw error;
    }
    const legacyResult = await dbQuery<
      Omit<
        CustomerRow,
        | "is_blocked"
        | "blocked_at"
        | "blocked_by_user_id"
        | "blocked_reason"
        | "legal_id_type"
        | "legal_id_number"
        | "legal_id_expiration_date"
        | "drivers_license_expiration_date"
      >
    >(
      "select id, full_name, email, phone, address, notes, created_at, last_booked_at from customers where id = $1 limit 1",
      [id],
    );
    result = {
      ...legacyResult,
      rows: legacyResult.rows.map(
        (
          row: Omit<
            CustomerRow,
            | "is_blocked"
            | "blocked_at"
            | "blocked_by_user_id"
            | "blocked_reason"
            | "first_name"
            | "last_name"
            | "street"
            | "street2"
            | "city"
            | "state"
            | "country"
            | "birthday"
            | "drivers_license_number"
            | "drivers_license_expiration_date"
            | "legal_id_type"
            | "legal_id_number"
            | "legal_id_expiration_date"
          >,
        ) =>
        toCustomerRowWithNullLegalFields({
          ...row,
          first_name: null,
          last_name: null,
          street: null,
          street2: null,
          city: null,
          state: null,
          country: null,
          birthday: null,
          drivers_license_number: null,
          drivers_license_expiration_date: null,
          is_blocked: false,
          blocked_at: null,
          blocked_by_user_id: null,
          blocked_reason: null,
        }),
      ),
    };
  }

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  return NextResponse.json({ customer: result.rows[0] });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireOperationsAccess();
  if (!auth.ok) return auth.response;
  const session = auth.session;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const setBlocked = body?.setBlocked;
  if (typeof setBlocked === "boolean") {
    const blockReason = trimOptional(body?.blockReason);
    try {
      const current = await dbQuery<{ id: string }>(
        "select id from customers where id = $1 limit 1",
        [id],
      );
      if (current.rowCount === 0) {
        return NextResponse.json({ error: "Customer not found" }, { status: 404 });
      }

      try {
        await dbQuery(
          "update customers set is_blocked = $2, blocked_at = case when $2 then now() else null end, blocked_by_user_id = case when $2 then $3 else null end, blocked_reason = case when $2 then $4 else null end where id = $1",
          [id, setBlocked, session.userId, blockReason],
        );
      } catch (error) {
        if (!isAnyMissingColumn(error, ["is_blocked", "blocked_at", "blocked_by_user_id", "blocked_reason"])) {
          throw error;
        }
        return NextResponse.json(
          {
            error:
              "Customer blocking requires the latest schema. Apply migration 007_customers_blocking.sql.",
          },
          { status: 409 },
        );
      }

      await writeAuditLog({
        userId: session.userId,
        action: setBlocked ? "CUSTOMER_BLOCKED" : "CUSTOMER_UNBLOCKED",
        entityType: "customer",
        entityId: id,
        details: {
          blocked: setBlocked,
          reason: blockReason,
        },
      });

      return NextResponse.json({ ok: true, blocked: setBlocked });
    } catch (error) {
      logError("api.admin.customers.[id].PATCH.block", error, {
        userId: session.userId,
        customerId: id,
      });
      return NextResponse.json({ error: "Failed to update customer block status." }, { status: 500 });
    }
  }

  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const address = trimOptional(body?.address);
  const notes = trimOptional(body?.notes);
  const firstName = trimOptional(body?.firstName);
  const lastName = trimOptional(body?.lastName);
  const street = trimOptional(body?.street);
  const street2 = trimOptional(body?.street2);
  const city = trimOptional(body?.city);
  const regionInput =
    typeof body?.parish === "string"
      ? body.parish.trim()
      : typeof body?.state === "string"
        ? body.state.trim()
        : null;
  const country = normalizeCountryName(body?.country) ?? "Jamaica";
  const state = normalizeRegionForCountry(regionInput, country);
  const birthdayRaw = trimOptional(body?.birthday);
  const birthday = birthdayRaw && /^\d{4}-\d{2}-\d{2}$/.test(birthdayRaw) ? birthdayRaw : null;
  const driversLicenseNumber = trimOptional(body?.driversLicenseNumber);
  const driversLicenseExpirationDateRaw = trimOptional(body?.driversLicenseExpirationDate);
  const driversLicenseExpirationDate =
    driversLicenseExpirationDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(driversLicenseExpirationDateRaw)
      ? driversLicenseExpirationDateRaw
      : null;
  const legalIdType = normalizeLegalIdType(body?.legalIdType);
  const legalIdNumber = trimOptional(body?.legalIdNumber);
  const legalIdExpirationDateRaw = trimOptional(body?.legalIdExpirationDate);
  const legalIdExpirationDate =
    legalIdExpirationDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(legalIdExpirationDateRaw)
      ? legalIdExpirationDateRaw
      : null;

  if (!isNonEmptyString(fullName, 2)) {
    return NextResponse.json({ error: "Full name is required." }, { status: 400 });
  }
  if (!isEmail(email)) {
    return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
  }
  if (!isNonEmptyString(phone, 7)) {
    return NextResponse.json({ error: "Phone is required." }, { status: 400 });
  }
  if (birthdayRaw && !birthday) {
    return NextResponse.json({ error: "Birthday must be YYYY-MM-DD." }, { status: 400 });
  }
  if (driversLicenseExpirationDateRaw && !driversLicenseExpirationDate) {
    return NextResponse.json({ error: "Driver's license expiration date must be YYYY-MM-DD." }, { status: 400 });
  }
  if (legalIdExpirationDateRaw && !legalIdExpirationDate) {
    return NextResponse.json({ error: "Legal ID expiration date must be YYYY-MM-DD." }, { status: 400 });
  }
  if (legalIdType && !legalIdNumber) {
    return NextResponse.json({ error: "Legal ID number is required when type is selected." }, { status: 400 });
  }
  if (!legalIdType && legalIdNumber) {
    return NextResponse.json({ error: "Legal ID type is required when number is provided." }, { status: 400 });
  }
  try {
    let current;
    try {
      current = await dbQuery<CustomerRow>(
        "select id, full_name, email, phone, coalesce(is_blocked, false) as is_blocked, blocked_at, blocked_by_user_id, blocked_reason, legal_id_type, legal_id_number, address, notes, created_at, last_booked_at from customers where id = $1 limit 1",
        [id],
      );
    } catch (error) {
      if (
        !isAnyMissingColumn(error, [
          "legal_id_type",
          "is_blocked",
          "blocked_at",
          "blocked_by_user_id",
          "blocked_reason",
        ])
      ) {
        throw error;
      }
      const legacyCurrent = await dbQuery<
        Omit<
          CustomerRow,
          | "is_blocked"
          | "blocked_at"
          | "blocked_by_user_id"
          | "blocked_reason"
          | "legal_id_type"
          | "legal_id_number"
        >
      >(
        "select id, full_name, email, phone, address, notes, created_at, last_booked_at from customers where id = $1 limit 1",
        [id],
      );
      current = {
        ...legacyCurrent,
        rows: legacyCurrent.rows.map(
          (
            row: Omit<
              CustomerRow,
              | "is_blocked"
              | "blocked_at"
              | "blocked_by_user_id"
              | "blocked_reason"
              | "legal_id_type"
              | "legal_id_number"
            >,
          ) =>
          toCustomerRowWithNullLegalFields({
            ...row,
            is_blocked: false,
            blocked_at: null,
            blocked_by_user_id: null,
            blocked_reason: null,
          }),
        ),
      };
    }
    if (current.rowCount === 0) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const pool = getDbPool();
    const client = await pool.connect();
    let synchronizedBookingCount = 0;
    try {
      await client.query("begin");

      const syncResult = await synchronizeCustomerContact(client, id, {
        fullName,
        email,
        phone,
      });
      synchronizedBookingCount = syncResult.synchronizedBookingCount;

      await client.query(
        "update customers set address = $2, notes = $3 where id = $1",
        [id, address, notes],
      );

      await client.query("savepoint customer_legal_fields");
      try {
        await client.query(
          "update customers set legal_id_type = $2, legal_id_number = $3, legal_id_expiration_date = $4::date where id = $1",
          [id, legalIdType, legalIdNumber, legalIdExpirationDate],
        );
        await client.query("release savepoint customer_legal_fields");
      } catch (error) {
        await client.query("rollback to savepoint customer_legal_fields");
        await client.query("release savepoint customer_legal_fields");
        if (!isAnyMissingColumn(error, ["legal_id_type", "legal_id_number", "legal_id_expiration_date"])) {
          throw error;
        }
      }

      await client.query("savepoint customer_extended_fields");
      try {
        await client.query(
          "update customers set first_name = $2, last_name = $3, street = $4, street2 = $5, city = $6, state = $7, zip = $8, country = $9, birthday = $10::date, drivers_license_number = $11, drivers_license_expiration_date = $12::date where id = $1",
          [
            id,
            firstName,
            lastName,
            street,
            street2,
            city,
            state,
            null,
            country || null,
            birthday,
            driversLicenseNumber,
            driversLicenseExpirationDate,
          ],
        );
        await client.query("release savepoint customer_extended_fields");
      } catch (error) {
        await client.query("rollback to savepoint customer_extended_fields");
        await client.query("release savepoint customer_extended_fields");
        if (
          !isAnyMissingColumn(error, [
            "first_name",
            "last_name",
            "street",
            "street2",
            "city",
            "state",
            "zip",
            "country",
            "birthday",
            "drivers_license_number",
            "drivers_license_expiration_date",
          ])
        ) {
          throw error;
        }
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    await writeAuditLog({
      userId: session.userId,
      action: "CUSTOMER_UPDATED",
      entityType: "customer",
      entityId: id,
      details: {
        previous_full_name: current.rows[0].full_name,
        previous_email: current.rows[0].email,
        previous_phone: current.rows[0].phone,
        next_full_name: fullName,
        next_email: email,
        next_phone: phone,
        synchronized_booking_count: synchronizedBookingCount,
      },
    });

    return NextResponse.json({ ok: true, synchronizedBookingCount });
  } catch (error) {
    if (isUniqueDriversLicenseError(error)) {
      return NextResponse.json(
        { error: "Driver's license number is already assigned to another customer." },
        { status: 409 },
      );
    }
    logError("api.admin.customers.[id].PATCH", error, {
      userId: session.userId,
      customerId: id,
    });
    return NextResponse.json({ error: "Failed to update customer." }, { status: 500 });
  }
}
