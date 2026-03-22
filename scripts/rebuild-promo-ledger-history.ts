#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import { Pool } from "pg";

import {
  deriveReconstructedPromoLedgerState,
  type PromoLedgerTimestampSource,
} from "../src/lib/promos";

type QueryableClient = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>;
};

type CandidateBookingRow = {
  booking_id: string;
  booking_public_id: string | null;
  booking_status: string | null;
  booking_updated_at: string | null;
  customer_id: string | null;
  customer_email: string | null;
  pricing_json: unknown;
  first_paid_at: string | null;
  first_refunded_at: string | null;
  net_paid_to_date: number | null;
  cancelled_at: string | null;
  hinted_promo_code_id: string | null;
  hinted_discount_amount_cents: number | null;
};

type PromoCodeRow = {
  id: string;
  code: string;
};

type ReconstructedEventInsert = {
  promoCodeId: string;
  bookingId: string;
  customerId: string | null;
  customerEmail: string | null;
  discountAmountCents: number;
  eventType: "REDEEMED" | "REVERSED";
  eventAt: string;
  timestampSource: PromoLedgerTimestampSource;
};

type ReconstructedCurrentRow = {
  promoCodeId: string;
  bookingId: string;
  customerId: string | null;
  customerEmail: string | null;
  discountAmountCents: number;
};

type RebuildMismatch = {
  type:
    | "UNRESOLVED_PROMO_REFERENCE"
    | "EVENT_NET_MISMATCH"
    | "PROMO_COUNT_MISMATCH"
    | "PROMO_CUSTOMER_COUNT_MISMATCH";
  bookingId?: string;
  promoCodeId?: string;
  customerKey?: string;
  details: Record<string, unknown>;
};

type RebuildArtifact = {
  generatedAt: string;
  dryRun: boolean;
  candidateBookings: number;
  reconstructedEvents: number;
  reconstructedCurrentRedemptions: number;
  unresolvedBookings: Array<{
    bookingId: string;
    bookingPublicId: string | null;
    promoCodeId: string | null;
    promoCode: string | null;
    hintedPromoCodeId: string | null;
  }>;
  promoCounts: Array<{
    promoCodeId: string;
    currentCount: number;
    eventNetCount: number;
  }>;
  promoCustomerCounts: Array<{
    promoCodeId: string;
    customerKey: string;
    currentCount: number;
    eventNetCount: number;
  }>;
  mismatches: RebuildMismatch[];
};

const ARTIFACTS_DIR = path.join(process.cwd(), ".artifacts");
const ARTIFACT_PATH = path.join(ARTIFACTS_DIR, "promo-ledger-reconciliation.json");

function loadEnv() {
  dotenv.config({ path: path.join(process.cwd(), ".env.local") });
  dotenv.config({ path: path.join(process.cwd(), ".env") });
}

function normalizeDatabaseUrl(connectionString: string) {
  try {
    const url = new URL(connectionString);
    const params = url.searchParams;
    const libpqCompat = params.get("uselibpqcompat") === "true";

    if (libpqCompat) {
      if (!params.get("sslmode")) params.set("sslmode", "require");
      url.search = params.toString();
      return url.toString();
    }

    const sslmode = (params.get("sslmode") ?? "").toLowerCase();
    if (!sslmode) {
      params.set("sslmode", "verify-full");
    } else if (sslmode === "require" || sslmode === "prefer" || sslmode === "verify-ca") {
      params.set("sslmode", "verify-full");
    }

    url.search = params.toString();
    return url.toString();
  } catch {
    return connectionString;
  }
}

function normalizeNullableString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePromoCode(value: unknown) {
  return normalizeNullableString(value)?.replace(/\s+/g, "").toUpperCase() ?? null;
}

function toMoneyInt(value: unknown) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function ensureArtifactsDir() {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

function writeArtifact(artifact: RebuildArtifact) {
  ensureArtifactsDir();
  fs.writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact, null, 2));
}

function increment(map: Map<string, number>, key: string, delta: number) {
  map.set(key, (map.get(key) ?? 0) + delta);
}

function buildPromoCustomerKey(promoCodeId: string, customerId: string | null, customerEmail: string | null) {
  if (customerId) return `${promoCodeId}::customer:${customerId}`;
  return `${promoCodeId}::email:${(customerEmail ?? "").toLowerCase()}`;
}

async function ensurePromoLedgerTable(client: QueryableClient) {
  const result = await client.query(
    "select to_regclass('public.promo_redemption_events') is not null as exists",
  );
  const existsValue = result.rows[0]?.exists;
  const exists =
    existsValue === true ||
    existsValue === "t" ||
    existsValue === "true" ||
    existsValue === 1;

  if (!exists) {
    throw new Error(
      "Required table public.promo_redemption_events is missing. Run `npm run migrate` and `npm run check:promo-ledger-schema` first.",
    );
  }
}

async function fetchPromoCodes(client: QueryableClient) {
  const result = await client.query(
    "select id, code from promo_codes order by created_at asc, id asc",
  );

  const validPromoIds = new Set<string>();
  const promoCodeByLower = new Map<string, string>();

  for (const row of result.rows as PromoCodeRow[]) {
    validPromoIds.add(String(row.id));
    promoCodeByLower.set(String(row.code).trim().toLowerCase(), String(row.id));
  }

  return { validPromoIds, promoCodeByLower };
}

async function fetchCandidateBookings(client: QueryableClient) {
  const result = await client.query(
    `with hinted as (
       select
         booking_id,
         (array_agg(promo_code_id order by source_rank desc, created_at desc nulls last))[1] as hinted_promo_code_id,
         max(discount_amount_cents)::int as hinted_discount_amount_cents
       from (
         select booking_id, promo_code_id, discount_amount_cents, created_at, 1 as source_rank
         from promo_redemptions
         union all
         select booking_id, promo_code_id, discount_amount_cents, created_at, 2 as source_rank
         from promo_redemption_events
       ) hinted_rows
       group by booking_id
     ),
     payment_summary as (
       select
         booking_id,
         min(created_at) filter (where deleted_at is null and status = 'DEPOSIT_PAID') as first_paid_at,
         min(created_at) filter (where deleted_at is null and status = 'REFUNDED') as first_refunded_at,
         coalesce(
           sum(deposit_amount_cents) filter (where deleted_at is null and status in ('DEPOSIT_PAID', 'REFUNDED')),
           0
         )::int as net_paid_to_date
       from payments
       group by booking_id
     ),
     cancellations as (
       select entity_id as booking_id, min(created_at) as cancelled_at
       from audit_logs
       where entity_type = 'booking'
         and action = 'BOOKING_CANCELLED'
         and entity_id is not null
       group by entity_id
     )
     select
       b.id as booking_id,
       b.public_id as booking_public_id,
       b.status as booking_status,
       b.updated_at as booking_updated_at,
       b.customer_id,
       c.email as customer_email,
       b.pricing_json,
       payment_summary.first_paid_at,
       payment_summary.first_refunded_at,
       payment_summary.net_paid_to_date,
       cancellations.cancelled_at,
       hinted.hinted_promo_code_id,
       hinted.hinted_discount_amount_cents
     from bookings b
     join customers c on c.id = b.customer_id
     left join payment_summary on payment_summary.booking_id = b.id
     left join cancellations on cancellations.booking_id = b.id
     left join hinted on hinted.booking_id = b.id
     where coalesce(b.pricing_json->>'promo_code_id', '') <> ''
        or coalesce(b.pricing_json->>'promo_code', '') <> ''
        or hinted.hinted_promo_code_id is not null
     order by b.created_at asc, b.id asc`,
  );

  return result.rows as CandidateBookingRow[];
}

function resolvePromoIdentity(
  row: CandidateBookingRow,
  lookup: { validPromoIds: Set<string>; promoCodeByLower: Map<string, string> },
) {
  const pricing = asRecord(row.pricing_json);
  const explicitPromoCodeId = normalizeNullableString(pricing.promo_code_id);
  const promoCode = normalizePromoCode(pricing.promo_code);
  const hintedPromoCodeId = normalizeNullableString(row.hinted_promo_code_id);

  if (explicitPromoCodeId && lookup.validPromoIds.has(explicitPromoCodeId)) {
    return { promoCodeId: explicitPromoCodeId, promoCode, hintedPromoCodeId };
  }

  if (promoCode) {
    const matchedId = lookup.promoCodeByLower.get(promoCode.toLowerCase());
    if (matchedId) {
      return { promoCodeId: matchedId, promoCode, hintedPromoCodeId };
    }
  }

  if (hintedPromoCodeId && lookup.validPromoIds.has(hintedPromoCodeId)) {
    return { promoCodeId: hintedPromoCodeId, promoCode, hintedPromoCodeId };
  }

  return { promoCodeId: null, promoCode, hintedPromoCodeId };
}

function buildArtifactFromReconstruction(input: {
  dryRun: boolean;
  candidateBookings: CandidateBookingRow[];
  unresolvedBookings: RebuildArtifact["unresolvedBookings"];
  events: ReconstructedEventInsert[];
  currentRows: ReconstructedCurrentRow[];
}) {
  const promoEventNet = new Map<string, number>();
  const promoCurrent = new Map<string, number>();
  const promoCustomerEventNet = new Map<string, number>();
  const promoCustomerCurrent = new Map<string, number>();
  const mismatches: RebuildMismatch[] = [];

  for (const row of input.currentRows) {
    increment(promoCurrent, row.promoCodeId, 1);
    increment(
      promoCustomerCurrent,
      buildPromoCustomerKey(row.promoCodeId, row.customerId, row.customerEmail),
      1,
    );
  }

  for (const event of input.events) {
    increment(promoEventNet, event.promoCodeId, event.eventType === "REDEEMED" ? 1 : -1);
    increment(
      promoCustomerEventNet,
      buildPromoCustomerKey(event.promoCodeId, event.customerId, event.customerEmail),
      event.eventType === "REDEEMED" ? 1 : -1,
    );
  }

  for (const unresolved of input.unresolvedBookings) {
    mismatches.push({
      type: "UNRESOLVED_PROMO_REFERENCE",
      bookingId: unresolved.bookingId,
      details: unresolved,
    });
  }

  const promoCounts = Array.from(new Set([...promoCurrent.keys(), ...promoEventNet.keys()]))
    .sort((left, right) => left.localeCompare(right))
    .map((promoCodeId) => ({
      promoCodeId,
      currentCount: promoCurrent.get(promoCodeId) ?? 0,
      eventNetCount: Math.max(0, promoEventNet.get(promoCodeId) ?? 0),
    }));

  for (const row of promoCounts) {
    if (row.currentCount !== row.eventNetCount) {
      mismatches.push({
        type: "PROMO_COUNT_MISMATCH",
        promoCodeId: row.promoCodeId,
        details: row,
      });
    }
  }

  const promoCustomerCounts = Array.from(
    new Set([...promoCustomerCurrent.keys(), ...promoCustomerEventNet.keys()]),
  )
    .sort((left, right) => left.localeCompare(right))
    .map((key) => ({
      promoCodeId: key.split("::", 1)[0] ?? "",
      customerKey: key,
      currentCount: promoCustomerCurrent.get(key) ?? 0,
      eventNetCount: Math.max(0, promoCustomerEventNet.get(key) ?? 0),
    }));

  for (const row of promoCustomerCounts) {
    if (row.currentCount !== row.eventNetCount) {
      mismatches.push({
        type: "PROMO_CUSTOMER_COUNT_MISMATCH",
        promoCodeId: row.promoCodeId,
        customerKey: row.customerKey,
        details: row,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    dryRun: input.dryRun,
    candidateBookings: input.candidateBookings.length,
    reconstructedEvents: input.events.length,
    reconstructedCurrentRedemptions: input.currentRows.length,
    unresolvedBookings: input.unresolvedBookings,
    promoCounts,
    promoCustomerCounts,
    mismatches,
  };
}

async function readDatabaseReconciliation(client: QueryableClient) {
  const promoCounts = await client.query(
    `with event_counts as (
       select
         promo_code_id,
         greatest(
           0,
           coalesce(sum(case when event_type = 'REDEEMED' then 1 else -1 end), 0)
         )::int as event_net_count
       from promo_redemption_events
       group by promo_code_id
     ),
     current_counts as (
       select promo_code_id, count(*)::int as current_count
       from promo_redemptions
       group by promo_code_id
     )
     select
       coalesce(event_counts.promo_code_id, current_counts.promo_code_id) as promo_code_id,
       coalesce(current_counts.current_count, 0)::int as current_count,
       coalesce(event_counts.event_net_count, 0)::int as event_net_count
     from event_counts
     full outer join current_counts on current_counts.promo_code_id = event_counts.promo_code_id`,
  );

  const promoCustomerCounts = await client.query(
    `with event_counts as (
       select
         promo_code_id,
         coalesce(customer_id::text, 'email:' || lower(coalesce(customer_email, ''))) as customer_key,
         greatest(
           0,
           coalesce(sum(case when event_type = 'REDEEMED' then 1 else -1 end), 0)
         )::int as event_net_count
       from promo_redemption_events
       group by promo_code_id, coalesce(customer_id::text, 'email:' || lower(coalesce(customer_email, '')))
     ),
     current_counts as (
       select
         promo_code_id,
         coalesce(customer_id::text, 'email:' || lower(coalesce(customer_email, ''))) as customer_key,
         count(*)::int as current_count
       from promo_redemptions
       group by promo_code_id, coalesce(customer_id::text, 'email:' || lower(coalesce(customer_email, '')))
     )
     select
       coalesce(event_counts.promo_code_id, current_counts.promo_code_id) as promo_code_id,
       coalesce(event_counts.customer_key, current_counts.customer_key) as customer_key,
       coalesce(current_counts.current_count, 0)::int as current_count,
       coalesce(event_counts.event_net_count, 0)::int as event_net_count
     from event_counts
     full outer join current_counts
       on current_counts.promo_code_id = event_counts.promo_code_id
      and current_counts.customer_key = event_counts.customer_key`,
  );

  const mismatches: RebuildMismatch[] = [];

  for (const row of promoCounts.rows) {
    const currentCount = Number(row.current_count ?? 0);
    const eventNetCount = Number(row.event_net_count ?? 0);
    if (currentCount !== eventNetCount) {
      mismatches.push({
        type: "EVENT_NET_MISMATCH",
        promoCodeId: normalizeNullableString(row.promo_code_id) ?? undefined,
        details: {
          promoCodeId: row.promo_code_id,
          currentCount,
          eventNetCount,
        },
      });
    }
  }

  for (const row of promoCustomerCounts.rows) {
    const currentCount = Number(row.current_count ?? 0);
    const eventNetCount = Number(row.event_net_count ?? 0);
    if (currentCount !== eventNetCount) {
      mismatches.push({
        type: "PROMO_CUSTOMER_COUNT_MISMATCH",
        promoCodeId: normalizeNullableString(row.promo_code_id) ?? undefined,
        customerKey: normalizeNullableString(row.customer_key) ?? undefined,
        details: {
          promoCodeId: row.promo_code_id,
          customerKey: row.customer_key,
          currentCount,
          eventNetCount,
        },
      });
    }
  }

  return mismatches;
}

async function clearPromoLedger(client: QueryableClient) {
  await client.query("delete from promo_redemptions");
  await client.query("delete from promo_redemption_events");
}

async function insertReconstructedRows(
  client: QueryableClient,
  events: ReconstructedEventInsert[],
  currentRows: ReconstructedCurrentRow[],
) {
  for (const row of events) {
    await client.query(
      `insert into promo_redemption_events (
         promo_code_id,
         booking_id,
         customer_id,
         customer_email,
         discount_amount_cents,
         event_type,
         event_at,
         metadata_json
       )
       values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::timestamptz, $8::jsonb)`,
      [
        row.promoCodeId,
        row.bookingId,
        row.customerId,
        row.customerEmail,
        row.discountAmountCents,
        row.eventType,
        row.eventAt,
        JSON.stringify({
          reconstructed: true,
          source: "legacy_reconstruction",
          timestampSource: row.timestampSource,
        }),
      ],
    );
  }

  for (const row of currentRows) {
    await client.query(
      `insert into promo_redemptions (
         promo_code_id,
         booking_id,
         customer_id,
         customer_email,
         discount_amount_cents
       )
       values ($1::uuid, $2::uuid, $3::uuid, $4, $5)`,
      [
        row.promoCodeId,
        row.bookingId,
        row.customerId,
        row.customerEmail,
        row.discountAmountCents,
      ],
    );
  }
}

async function rebuildPromoLedger(client: QueryableClient, dryRun: boolean) {
  await ensurePromoLedgerTable(client);
  const lookup = await fetchPromoCodes(client);
  const candidateBookings = await fetchCandidateBookings(client);

  const unresolvedBookings: RebuildArtifact["unresolvedBookings"] = [];
  const reconstructedEvents: ReconstructedEventInsert[] = [];
  const reconstructedCurrentRows: ReconstructedCurrentRow[] = [];

  for (const row of candidateBookings) {
    const pricing = asRecord(row.pricing_json);
    const resolved = resolvePromoIdentity(row, lookup);

    if (!resolved.promoCodeId) {
      unresolvedBookings.push({
        bookingId: row.booking_id,
        bookingPublicId: row.booking_public_id,
        promoCodeId: normalizeNullableString(pricing.promo_code_id),
        promoCode: normalizePromoCode(pricing.promo_code),
        hintedPromoCodeId: resolved.hintedPromoCodeId,
      });
      continue;
    }

    const discountAmountCents = Math.max(
      toMoneyInt(pricing.promo_discount_cents),
      toMoneyInt(row.hinted_discount_amount_cents),
    );

    const reconstructed = deriveReconstructedPromoLedgerState({
      promoCodeId: resolved.promoCodeId,
      bookingId: row.booking_id,
      bookingStatus: row.booking_status,
      customerId: row.customer_id,
      customerEmail: row.customer_email,
      discountAmountCents,
      netPaidToDate: Number(row.net_paid_to_date ?? 0),
      redeemedAt: normalizeNullableString(row.first_paid_at),
      refundedAt: normalizeNullableString(row.first_refunded_at),
      cancelledAt: normalizeNullableString(row.cancelled_at),
      updatedAt: normalizeNullableString(row.booking_updated_at),
    });

    for (const event of reconstructed.events) {
      reconstructedEvents.push({
        promoCodeId: resolved.promoCodeId,
        bookingId: row.booking_id,
        customerId: normalizeNullableString(row.customer_id),
        customerEmail: normalizeNullableString(row.customer_email)?.toLowerCase() ?? null,
        discountAmountCents,
        eventType: event.eventType,
        eventAt: event.eventAt,
        timestampSource: event.metadata.timestampSource,
      });
    }

    if (reconstructed.currentRedemption) {
      reconstructedCurrentRows.push(reconstructed.currentRedemption);
    }
  }

  const artifact = buildArtifactFromReconstruction({
    dryRun,
    candidateBookings,
    unresolvedBookings,
    events: reconstructedEvents,
    currentRows: reconstructedCurrentRows,
  });

  if (!dryRun) {
    await clearPromoLedger(client);
    await insertReconstructedRows(client, reconstructedEvents, reconstructedCurrentRows);
    const databaseMismatches = await readDatabaseReconciliation(client);
    artifact.mismatches.push(...databaseMismatches);
  }

  return artifact;
}

async function main() {
  loadEnv();

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const dryRun = !process.argv.slice(2).includes("--apply");
  const pool = new Pool({ connectionString: normalizeDatabaseUrl(rawUrl), max: 1 });
  const client = (await pool.connect()) as QueryableClient & { release: () => void };

  try {
    await client.query("begin");

    const artifact = await rebuildPromoLedger(client, dryRun);
    writeArtifact(artifact);

    if (artifact.mismatches.length > 0) {
      throw new Error(
        `Promo ledger reconstruction found ${artifact.mismatches.length} mismatch(es). See ${ARTIFACT_PATH}.`,
      );
    }

    if (dryRun) {
      await client.query("rollback");
      console.log(
        `Promo ledger reconstruction dry run passed: ${artifact.reconstructedEvents} events, ${artifact.reconstructedCurrentRedemptions} current redemptions. Artifact: ${ARTIFACT_PATH}`,
      );
    } else {
      await client.query("commit");
      console.log(
        `Promo ledger reconstruction applied: ${artifact.reconstructedEvents} events, ${artifact.reconstructedCurrentRedemptions} current redemptions. Artifact: ${ARTIFACT_PATH}`,
      );
    }
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Promo ledger reconstruction failed: ${message}`);
  process.exit(1);
});
