import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { writeAuditLog } from "@/lib/audit";
import { isEmail, isNonEmptyString } from "@/lib/validators";
import { logError } from "@/lib/log";
import { normalizeLegalIdType } from "@/lib/customers/legalId";

type CustomerRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  is_blocked: boolean | null;
  blocked_at: string | null;
  blocked_by_user_id: string | null;
  blocked_reason: string | null;
  legal_id_type: string | null;
  legal_id_number: string | null;
  legal_id_image_url: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
  last_booked_at: string | null;
};

function isAdminRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER";
}

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

function toCustomerRowWithNullLegalFields(row: Omit<CustomerRow, "legal_id_type" | "legal_id_number" | "legal_id_image_url">): CustomerRow {
  return {
    ...row,
    legal_id_type: null,
    legal_id_number: null,
    legal_id_image_url: null,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  let result;
  try {
    result = await dbQuery<CustomerRow>(
      "select id, full_name, email, phone, coalesce(is_blocked, false) as is_blocked, blocked_at, blocked_by_user_id, blocked_reason, legal_id_type, legal_id_number, legal_id_image_url, address, notes, created_at, last_booked_at from customers where id = $1 limit 1",
      [id],
    );
  } catch (error) {
    if (!isAnyMissingColumn(error, ["legal_id_type", "is_blocked", "blocked_at", "blocked_by_user_id", "blocked_reason"])) {
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
        | "legal_id_image_url"
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
            | "legal_id_type"
            | "legal_id_number"
            | "legal_id_image_url"
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

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  return NextResponse.json({ customer: result.rows[0] });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
  const legalIdType = normalizeLegalIdType(body?.legalIdType);
  const legalIdNumber = trimOptional(body?.legalIdNumber);
  const legalIdImageUrl = trimOptional(body?.legalIdImageUrl);

  if (!isNonEmptyString(fullName, 2)) {
    return NextResponse.json({ error: "Full name is required." }, { status: 400 });
  }
  if (!isEmail(email)) {
    return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
  }
  if (!isNonEmptyString(phone, 7)) {
    return NextResponse.json({ error: "Phone is required." }, { status: 400 });
  }
  if (legalIdType && !legalIdNumber) {
    return NextResponse.json({ error: "Legal ID number is required when type is selected." }, { status: 400 });
  }
  if (!legalIdType && legalIdNumber) {
    return NextResponse.json({ error: "Legal ID type is required when number is provided." }, { status: 400 });
  }
  if (legalIdImageUrl && !/^https?:\/\//i.test(legalIdImageUrl)) {
    return NextResponse.json({ error: "Legal ID image must be a valid URL." }, { status: 400 });
  }

  try {
    let current;
    try {
      current = await dbQuery<CustomerRow>(
        "select id, full_name, email, phone, coalesce(is_blocked, false) as is_blocked, blocked_at, blocked_by_user_id, blocked_reason, legal_id_type, legal_id_number, legal_id_image_url, address, notes, created_at, last_booked_at from customers where id = $1 limit 1",
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
          | "legal_id_image_url"
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
              | "legal_id_image_url"
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

    try {
      await dbQuery(
        "update customers set full_name = $2, email = $3, phone = $4, address = $5, notes = $6, legal_id_type = $7, legal_id_number = $8, legal_id_image_url = $9 where id = $1",
        [id, fullName, email, phone, address, notes, legalIdType, legalIdNumber, legalIdImageUrl],
      );
    } catch (error) {
      if (!isMissingColumn(error, "legal_id_type")) {
        throw error;
      }
      await dbQuery(
        "update customers set full_name = $2, email = $3, phone = $4, address = $5, notes = $6 where id = $1",
        [id, fullName, email, phone, address, notes],
      );
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
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("api.admin.customers.[id].PATCH", error, {
      userId: session.userId,
      customerId: id,
    });
    return NextResponse.json({ error: "Failed to update customer." }, { status: 500 });
  }
}
