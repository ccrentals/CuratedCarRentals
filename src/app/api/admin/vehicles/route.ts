import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { isNonEmptyString, parseIntSafe, parseMoneyToCents } from "@/lib/validators";

const allowedStatuses = ["AVAILABLE", "RESERVED", "RENTED", "MAINTENANCE", "INACTIVE"];

function validateStatus(value: unknown) {
  return typeof value === "string" && allowedStatuses.includes(value);
}

export async function GET() {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await dbQuery(
    "select id, make, model, year, daily_rate_cents, deposit_cents, status, created_at from vehicles order by created_at desc",
  );
  return NextResponse.json({ vehicles: result.rows });
}

export async function POST(request: Request) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let body: Record<string, unknown> = {};

  if (contentType.includes("application/json")) {
    body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  } else if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    form.forEach((value, key) => {
      body[key] = value.toString();
    });
  }

  const make = body.make;
  const model = body.model;
  const year = parseIntSafe(body.year);
  const dailyRate =
    body.daily_rate_cents !== undefined
      ? parseIntSafe(body.daily_rate_cents)
      : parseMoneyToCents(body.daily_rate_jmd ?? body.daily_rate);
  const deposit =
    body.deposit_cents !== undefined
      ? parseIntSafe(body.deposit_cents)
      : parseMoneyToCents(body.deposit_jmd ?? body.deposit);
  const status = body.status ?? "AVAILABLE";

  const currentYear = new Date().getFullYear() + 1;

  if (!isNonEmptyString(make, 2) || !isNonEmptyString(model, 1)) {
    return NextResponse.json({ error: "Invalid make/model" }, { status: 400 });
  }
  if (!year || year < 1990 || year > currentYear) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  }
  if (!dailyRate || dailyRate <= 0) {
    return NextResponse.json({ error: "Invalid daily rate" }, { status: 400 });
  }
  if (deposit === null || deposit < 0) {
    return NextResponse.json({ error: "Invalid deposit" }, { status: 400 });
  }
  if (!validateStatus(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const result = await dbQuery(
    "insert into vehicles (make, model, year, daily_rate_cents, deposit_cents, status) values ($1, $2, $3, $4, $5, $6) returning id, make, model, year, daily_rate_cents, deposit_cents, status, created_at",
    [
      String(make).trim(),
      String(model).trim(),
      year,
      dailyRate,
      deposit,
      status,
    ],
  );

  return NextResponse.json({ vehicle: result.rows[0] }, { status: 201 });
}
