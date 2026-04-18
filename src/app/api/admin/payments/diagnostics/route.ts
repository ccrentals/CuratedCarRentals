import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { requireAdminRole } from "@/lib/auth/adminGuards";
import { getWiPayRequestOrigin } from "@/lib/wipay";

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
  public_id: string;
  booking_id: string;
  booking_public_id: string | null;
  status: string;
  deposit_amount_cents: number;
  provider_ref: string | null;
  provider_transaction_id: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
};

export async function GET() {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;

  const originConfigured = Boolean(process.env.WIPAY_ORIGIN?.trim());
  const env = {
    WIPAY_ENV: process.env.WIPAY_ENV ?? "missing",
    WIPAY_FEE_STRUCTURE: process.env.WIPAY_FEE_STRUCTURE ?? "missing",
    WIPAY_ORIGIN: getWiPayRequestOrigin(),
    WIPAY_ORIGIN_SOURCE: originConfigured ? "env" : "default",
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
    "SITE_URL",
    "WIPAY_ACCOUNT_NUMBER",
    "WIPAY_API_KEY",
  ].filter((key) => {
    const value = process.env[key];
    return !value || !String(value).trim();
  });

  const recent = await dbQuery<RecentPayment>(
    "select p.id, p.public_id, p.booking_id, b.public_id as booking_public_id, p.status, p.deposit_amount_cents, p.provider_ref, p.provider_transaction_id, p.metadata_json, p.created_at from payments p join bookings b on b.id = p.booking_id where p.provider = 'WIPAY' order by p.created_at desc limit 5",
  );

  return NextResponse.json({
    ok: true,
    env,
    missing,
    recent: recent.rows,
  });
}
