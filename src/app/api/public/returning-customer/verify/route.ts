import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit";
import { dbQuery } from "@/lib/db";

const VERIFY_RATE_LIMIT = 25;
const VERIFY_RATE_WINDOW_MINUTES = 15;

type CustomerRow = {
  id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  street2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  birthday: string | null;
  drivers_license_number: string | null;
};

type OtpAuditRow = {
  id: string;
  details_json: Record<string, unknown> | null;
};

function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim();
  return "unknown";
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeSessionKey(value: unknown) {
  return normalizeText(value).slice(0, 128);
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

function normalizeDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  return value;
}

function hashOtp(token: string, otpCode: string) {
  const secret =
    process.env.RETURNING_CUSTOMER_OTP_SECRET ||
    process.env.CSRF_SECRET ||
    process.env.ADMIN_SESSION_SECRET ||
    "ccr-returning-customer";
  return createHash("sha256").update(`${token}:${otpCode}:${secret}`).digest("hex");
}

function getEffectiveLastName(customer: CustomerRow) {
  const fromColumn = normalizeText(customer.last_name ?? "");
  if (fromColumn) return fromColumn;
  const fullName = normalizeText(customer.full_name ?? "");
  if (!fullName) return "";
  const parts = fullName.split(/\s+/);
  if (parts.length <= 1) return "";
  return parts.slice(1).join(" ");
}

async function hitRateLimit(ip: string, sessionKey: string) {
  const result = await dbQuery<{ count: number }>(
    "select count(*)::int as count from audit_logs where action in ('RETURNING_CUSTOMER_VERIFY_FAIL','RETURNING_CUSTOMER_VERIFY_SUCCESS','RETURNING_CUSTOMER_START') and created_at > now() - ($2::text || ' minutes')::interval and (coalesce(details_json->>'ip', '') = $1 or ($3 <> '' and coalesce(details_json->>'sessionKey', '') = $3))",
    [ip, String(VERIFY_RATE_WINDOW_MINUTES), sessionKey],
  );
  return Number(result.rows[0]?.count ?? 0) >= VERIFY_RATE_LIMIT;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const ip = getClientIp(request);
  const sessionKey = normalizeSessionKey(body?.sessionKey);
  const driversLicenseNumber = normalizeText(body?.driversLicenseNumber);
  const challengeToken = normalizeText(body?.challengeToken);
  const otpCode = normalizeText(body?.otpCode);
  const lastNameInput = normalizeText(body?.lastName).toLowerCase();
  const birthdayInput = normalizeDateOnly(normalizeText(body?.birthday));

  if (!driversLicenseNumber || driversLicenseNumber.length < 4) {
    return genericFailure();
  }

  if (await hitRateLimit(ip, sessionKey)) {
    await writeAuditLog({
      action: "RETURNING_CUSTOMER_RATE_LIMITED",
      entityType: "public_lookup",
      details: { ip, sessionKey, driversLicenseTail: driversLicenseNumber.slice(-4), stage: "verify" },
    });
    return NextResponse.json({ ok: false, error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const customerResult = await dbQuery<CustomerRow>(
    "select id, full_name, first_name, last_name, email, phone, street, street2, city, state, zip, country, birthday::text as birthday, drivers_license_number from customers where lower(coalesce(drivers_license_number, '')) = lower($1) limit 1",
    [driversLicenseNumber],
  );
  const customer = customerResult.rows[0] ?? null;

  if (!customer) {
    await writeAuditLog({
      action: "RETURNING_CUSTOMER_VERIFY_FAIL",
      entityType: "public_lookup",
      details: { ip, sessionKey, reason: "customer_not_found", driversLicenseTail: driversLicenseNumber.slice(-4) },
    });
    return genericFailure();
  }

  let verified = false;
  let verifiedBy: "OTP_EMAIL" | "MATCH_LAST_NAME_DOB" | null = null;

  if (challengeToken && otpCode) {
    const otpResult = await dbQuery<OtpAuditRow>(
      "select id, details_json from audit_logs where action = 'RETURNING_CUSTOMER_OTP_ISSUED' and entity_type = 'customer' and entity_id = $1 order by created_at desc limit 1",
      [customer.id],
    );
    const otpRecord = otpResult.rows[0] ?? null;
    const otpDetails = otpRecord?.details_json ?? {};
    const tokenMatches =
      typeof otpDetails.challengeToken === "string" &&
      otpDetails.challengeToken === challengeToken;
    const expiresAt =
      typeof otpDetails.expiresAt === "string" ? new Date(otpDetails.expiresAt) : null;
    const notExpired = Boolean(expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() > Date.now());
    const alreadyUsed = Boolean(otpDetails.used === true);
    const expectedHash =
      typeof otpDetails.otpHash === "string" ? otpDetails.otpHash : "";
    const providedHash = hashOtp(challengeToken, otpCode);

    if (tokenMatches && notExpired && !alreadyUsed && expectedHash === providedHash) {
      verified = true;
      verifiedBy = "OTP_EMAIL";
      if (otpRecord?.id) {
        await dbQuery(
          "update audit_logs set details_json = jsonb_set(coalesce(details_json, '{}'::jsonb), '{used}', 'true'::jsonb, true) where id = $1",
          [otpRecord.id],
        );
      }
    }
  }

  if (!verified && lastNameInput && birthdayInput) {
    const customerLastName = getEffectiveLastName(customer).toLowerCase();
    const customerBirthday = normalizeDateOnly(normalizeText(customer.birthday ?? ""));

    if (
      customerLastName &&
      customerBirthday &&
      customerLastName === lastNameInput &&
      customerBirthday === birthdayInput
    ) {
      verified = true;
      verifiedBy = "MATCH_LAST_NAME_DOB";
    }
  }

  if (!verified) {
    await writeAuditLog({
      action: "RETURNING_CUSTOMER_VERIFY_FAIL",
      entityType: "customer",
      entityId: customer.id,
      details: {
        ip,
        sessionKey,
        reason: "verification_failed",
        driversLicenseTail: driversLicenseNumber.slice(-4),
      },
    });
    return genericFailure();
  }

  await writeAuditLog({
    action: "RETURNING_CUSTOMER_VERIFY_SUCCESS",
    entityType: "customer",
    entityId: customer.id,
    details: {
      ip,
      sessionKey,
      method: verifiedBy,
      driversLicenseTail: driversLicenseNumber.slice(-4),
    },
  });

  return NextResponse.json({
    ok: true,
    customer: {
      customerId: customer.id,
      firstName: normalizeText(customer.first_name ?? "") || normalizeText(customer.full_name).split(/\s+/)[0] || null,
      lastName: normalizeText(customer.last_name ?? "") || getEffectiveLastName(customer) || null,
      emailAddress: normalizeText(customer.email ?? "") || null,
      phoneNumber: normalizeText(customer.phone ?? "") || null,
      street: normalizeText(customer.street ?? "") || null,
      street2: normalizeText(customer.street2 ?? "") || null,
      city: normalizeText(customer.city ?? "") || null,
      state: normalizeText(customer.state ?? "") || null,
      zip: normalizeText(customer.zip ?? "") || null,
      country: normalizeText(customer.country ?? "") || null,
      birthday: normalizeDateOnly(normalizeText(customer.birthday ?? "")) || null,
      driversLicenseNumber: normalizeText(customer.drivers_license_number ?? "") || null,
    },
  });
}

export async function GET() {
  return NextResponse.json({ ok: false, error: "Method not allowed" }, { status: 405 });
}
