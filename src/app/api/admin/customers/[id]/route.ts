import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { writeAuditLog } from "@/lib/audit";
import { isEmail, isNonEmptyString } from "@/lib/validators";
import { logError } from "@/lib/log";

type CustomerRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
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
  const result = await dbQuery<CustomerRow>(
    "select id, full_name, email, phone, address, notes, created_at, last_booked_at from customers where id = $1 limit 1",
    [id],
  );

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

  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const address = trimOptional(body?.address);
  const notes = trimOptional(body?.notes);

  if (!isNonEmptyString(fullName, 2)) {
    return NextResponse.json({ error: "Full name is required." }, { status: 400 });
  }
  if (!isEmail(email)) {
    return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
  }
  if (!isNonEmptyString(phone, 7)) {
    return NextResponse.json({ error: "Phone is required." }, { status: 400 });
  }

  try {
    const current = await dbQuery<CustomerRow>(
      "select id, full_name, email, phone, address, notes, created_at, last_booked_at from customers where id = $1 limit 1",
      [id],
    );
    if (current.rowCount === 0) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    await dbQuery(
      "update customers set full_name = $2, email = $3, phone = $4, address = $5, notes = $6 where id = $1",
      [id, fullName, email, phone, address, notes],
    );

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
