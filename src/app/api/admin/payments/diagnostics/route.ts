import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth/session";

function maskValue(value: string | undefined, visible = 4) {
  if (!value) return "missing";
  if (value.length <= visible) return value;
  return `${"*".repeat(Math.max(0, value.length - visible))}${value.slice(-visible)}`;
}

function isDigitsOnly(value: string) {
  return /^\d+$/.test(value);
}

type RecentPayment = {
  id: string;
  booking_id: string;
  status: string;
  deposit_amount_cents: number;
  provider_ref: string | null;
  provider_transaction_id: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
};

export async function GET() {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const env = {
    WIPAY_ENV: process.env.WIPAY_ENV ?? "missing",
    WIPAY_FEE_STRUCTURE: process.env.WIPAY_FEE_STRUCTURE ?? "missing",
    WIPAY_ORIGIN: process.env.WIPAY_ORIGIN ?? "missing",
    SITE_URL: process.env.SITE_URL ?? "missing",
    WIPAY_ACCOUNT_NUMBER: maskValue(process.env.WIPAY_ACCOUNT_NUMBER?.trim()),
    WIPAY_API_KEY: process.env.WIPAY_API_KEY ? "set" : "missing",
    ACCOUNT_NUMBER_VALID:
      process.env.WIPAY_ACCOUNT_NUMBER &&
      isDigitsOnly(process.env.WIPAY_ACCOUNT_NUMBER.trim())
        ? "yes"
        : "no",
  };

  const missing = [
    "WIPAY_ENV",
    "WIPAY_FEE_STRUCTURE",
    "WIPAY_ORIGIN",
    "SITE_URL",
    "WIPAY_ACCOUNT_NUMBER",
    "WIPAY_API_KEY",
  ].filter((key) => {
    const value = process.env[key];
    return !value || !String(value).trim();
  });

  const recent = await dbQuery<RecentPayment>(
    "select id, booking_id, status, deposit_amount_cents, provider_ref, provider_transaction_id, metadata_json, created_at from payments where provider = 'WIPAY' order by created_at desc limit 5",
  );

  return NextResponse.json({
    ok: true,
    env,
    missing,
    recent: recent.rows,
  });
}
