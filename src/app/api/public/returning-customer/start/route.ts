import { createHash, randomInt, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit";
import { dbQuery } from "@/lib/db";
import { logWarn } from "@/lib/log";
import {
  categorizeTurnstileFailure,
  extractTurnstileToken,
  getClientIpFromRequest,
  verifyTurnstileToken,
} from "@/lib/security/turnstile";

const LOOKUP_RATE_LIMIT = 20;
const LOOKUP_RATE_WINDOW_MINUTES = 15;

type CustomerLookupRow = {
  id: string;
  email: string | null;
  drivers_license_number: string | null;
};

function normalizeDriversLicense(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeSessionKey(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 128);
}

function genericFailure() {
  return NextResponse.json(
    {
      ok: false,
      error: "We couldn't verify your details.",
    },
    { status: 400 },
  );
}

function hashOtp(token: string, otpCode: string) {
  const secret =
    process.env.RETURNING_CUSTOMER_OTP_SECRET ||
    process.env.CSRF_SECRET ||
    process.env.ADMIN_SESSION_SECRET ||
    "ccr-returning-customer";
  return createHash("sha256").update(`${token}:${otpCode}:${secret}`).digest("hex");
}

async function hitRateLimit(ip: string, sessionKey: string) {
  const result = await dbQuery<{ count: number }>(
    "select count(*)::int as count from audit_logs where action in ('RETURNING_CUSTOMER_START','RETURNING_CUSTOMER_VERIFY_FAIL') and created_at > now() - ($2::text || ' minutes')::interval and (coalesce(details_json->>'ip', '') = $1 or ($3 <> '' and coalesce(details_json->>'sessionKey', '') = $3))",
    [ip, String(LOOKUP_RATE_WINDOW_MINUTES), sessionKey],
  );
  return Number(result.rows[0]?.count ?? 0) >= LOOKUP_RATE_LIMIT;
}

async function sendOtpEmail(to: string, otpCode: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) return false;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Your Curated Car Rentals verification code",
      html: `<p>Your one-time verification code is <strong>${otpCode}</strong>.</p><p>This code expires in 10 minutes.</p>`,
    }),
  });

  return response.ok;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const turnstileToken = extractTurnstileToken(body, request);
  const driversLicenseNumber = normalizeDriversLicense(body?.driversLicenseNumber);
  const sessionKey = normalizeSessionKey(body?.sessionKey);
  const ip = getClientIpFromRequest(request) ?? "unknown";

  const turnstileResult = await verifyTurnstileToken({
    token: turnstileToken,
    remoteIp: ip,
    expectedAction: "public_returning_customer",
  });

  if (!turnstileResult.ok) {
    const failureCategory = categorizeTurnstileFailure(turnstileResult.errorCodes);
    logWarn("api.public.returningCustomer.start.turnstile_failed", {
      route: "/api/public/returning-customer/start",
      failureCategory,
      status: turnstileResult.status,
      ip,
    });
    try {
      await writeAuditLog({
        action: "RETURNING_CUSTOMER_BLOCKED_TURNSTILE",
        entityType: "public_lookup",
        details: {
          ip,
          sessionKey,
          stage: "start",
          errorCodes: turnstileResult.errorCodes,
          failureCategory,
        },
      });
    } catch (error) {
      logWarn("api.public.returningCustomer.start.turnstile_audit_failed", {
        route: "/api/public/returning-customer/start",
        failureCategory,
        message: (error as Error | null)?.message ?? "unknown",
      });
    }
    return NextResponse.json({ ok: false, error: turnstileResult.userMessage }, { status: turnstileResult.status });
  }

  if (!driversLicenseNumber || driversLicenseNumber.length < 4) {
    return genericFailure();
  }

  if (await hitRateLimit(ip, sessionKey)) {
    await writeAuditLog({
      action: "RETURNING_CUSTOMER_RATE_LIMITED",
      entityType: "public_lookup",
      details: { ip, sessionKey, driversLicenseTail: driversLicenseNumber.slice(-4) },
    });
    return NextResponse.json({ ok: false, error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const customerResult = await dbQuery<CustomerLookupRow>(
    "select id, email, drivers_license_number from customers where lower(coalesce(drivers_license_number, '')) = lower($1) limit 1",
    [driversLicenseNumber],
  );

  const customer = customerResult.rows[0] ?? null;
  const challengeToken = randomUUID();

  if (customer?.id && customer.email?.trim()) {
    const otpCode = String(randomInt(100000, 999999));
    const otpHash = hashOtp(challengeToken, otpCode);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const emailSent = await sendOtpEmail(customer.email.trim(), otpCode).catch(() => false);

    if (emailSent) {
      await writeAuditLog({
        action: "RETURNING_CUSTOMER_OTP_ISSUED",
        entityType: "customer",
        entityId: customer.id,
        details: {
          ip,
          sessionKey,
          challengeToken,
          otpHash,
          expiresAt,
          used: false,
        },
      });
    }
  }

  await writeAuditLog({
    action: "RETURNING_CUSTOMER_START",
    entityType: "public_lookup",
    details: {
      ip,
      sessionKey,
      matchedCustomer: Boolean(customer?.id),
      driversLicenseTail: driversLicenseNumber.slice(-4),
    },
  });

  return NextResponse.json({
    ok: true,
    next: "VERIFY",
    challengeToken,
  });
}

export async function GET() {
  return NextResponse.json({ ok: false, error: "Method not allowed" }, { status: 405 });
}
