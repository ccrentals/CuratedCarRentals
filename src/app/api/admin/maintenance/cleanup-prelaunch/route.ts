import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import { getDbPool } from "@/lib/db";
import { logError } from "@/lib/log";

const CUTOFF_ISO = "2026-06-01T00:00:00.000Z";
const CONFIRMATION = "remove-prelaunch-before-2026-05-31-1900-jamaica";

type CleanupPreview = {
  cutoff: {
    jamaica: string;
    utc: string;
  };
  counts: Record<string, number>;
  bookingsBeforeCutoff: Array<Record<string, unknown>>;
  bookingsKept: Array<Record<string, unknown>>;
  quotesBeforeCutoff: Array<Record<string, unknown>>;
  blockoutsBeforeCutoff: Array<Record<string, unknown>>;
  ricardoBookings: Array<Record<string, unknown>>;
};

function countFromRow(row: unknown) {
  const value = (row as { count?: unknown } | undefined)?.count;
  return Number(value ?? 0);
}

function omitInternalId(row: Record<string, unknown>) {
  const next = { ...row };
  delete next.id;
  return next;
}

async function getPreview(client: Pick<ReturnType<typeof getDbPool>, "query">): Promise<CleanupPreview> {
  const cutoff = new Date(CUTOFF_ISO);
  const cutoffParam = cutoff.toISOString();

  const bookingsBefore = await client.query(
    `select b.id, b.public_id, b.created_at, c.full_name, c.email, v.make || ' ' || v.model as vehicle, b.status
     from bookings b
     join customers c on c.id = b.customer_id
     join vehicles v on v.id = b.vehicle_id
     where b.created_at < $1::timestamptz
     order by b.created_at asc`,
    [cutoffParam],
  );
  const bookingsKept = await client.query(
    `select b.id, b.public_id, b.created_at, c.full_name, c.email, v.make || ' ' || v.model as vehicle, b.status
     from bookings b
     join customers c on c.id = b.customer_id
     join vehicles v on v.id = b.vehicle_id
     where b.created_at >= $1::timestamptz
     order by b.created_at asc`,
    [cutoffParam],
  );
  const quotesBefore = await client.query(
    `select id, public_id, created_at, customer_full_name, customer_email, vehicle_label, status
     from quotes
     where created_at < $1::timestamptz
     order by created_at asc`,
    [cutoffParam],
  );
  const blockoutsBefore = await client.query(
    `select bo.id, bo.created_at, bo.start_at, bo.end_at, bo.reason, v.make || ' ' || v.model as vehicle
     from blockouts bo
     join vehicles v on v.id = bo.vehicle_id
     where bo.created_at < $1::timestamptz
     order by bo.created_at asc`,
    [cutoffParam],
  );
  const ricardoBookings = await client.query(
    `select b.public_id, b.created_at, c.full_name, c.email, v.make || ' ' || v.model as vehicle, b.status
     from bookings b
     join customers c on c.id = b.customer_id
     join vehicles v on v.id = b.vehicle_id
     where lower(c.email) = lower($1)
     order by b.created_at desc`,
    ["ricardobarlock31@gmail.com"],
  );

  const bookingIds = bookingsBefore.rows.map((row: { id: string }) => row.id);
  const quoteIds = quotesBefore.rows.map((row: { id: string }) => row.id);
  const paymentRows =
    bookingIds.length > 0
      ? await client.query("select id from payments where booking_id = any($1::uuid[])", [bookingIds])
      : { rows: [] };
  const paymentIds = paymentRows.rows.map((row: { id: string }) => row.id);

  const [
    payments,
    invoiceDocuments,
    privateFiles,
    inspections,
    inspectionImages,
    promoRedemptions,
    promoRedemptionEvents,
    quoteEvents,
    quoteEmails,
    emailDispatches,
    notificationLogs,
  ] = await Promise.all([
    bookingIds.length > 0
      ? client.query("select count(*)::int as count from payments where booking_id = any($1::uuid[])", [bookingIds])
      : { rows: [{ count: 0 }] },
    bookingIds.length > 0
      ? client.query("select count(*)::int as count from booking_invoice_documents where booking_id = any($1::uuid[])", [bookingIds])
      : { rows: [{ count: 0 }] },
    bookingIds.length > 0
      ? client.query("select count(*)::int as count from booking_private_files where booking_id = any($1::uuid[])", [bookingIds])
      : { rows: [{ count: 0 }] },
    bookingIds.length > 0
      ? client.query("select count(*)::int as count from booking_vehicle_inspections where booking_id = any($1::uuid[])", [bookingIds])
      : { rows: [{ count: 0 }] },
    bookingIds.length > 0
      ? client.query("select count(*)::int as count from booking_vehicle_inspection_images where booking_id = any($1::uuid[])", [bookingIds])
      : { rows: [{ count: 0 }] },
    bookingIds.length > 0
      ? client.query("select count(*)::int as count from promo_redemptions where booking_id = any($1::uuid[])", [bookingIds])
      : { rows: [{ count: 0 }] },
    bookingIds.length > 0
      ? client.query("select count(*)::int as count from promo_redemption_events where booking_id = any($1::uuid[])", [bookingIds])
      : { rows: [{ count: 0 }] },
    quoteIds.length > 0
      ? client.query("select count(*)::int as count from quote_events where quote_id = any($1::uuid[])", [quoteIds])
      : { rows: [{ count: 0 }] },
    quoteIds.length > 0
      ? client.query("select count(*)::int as count from quote_emails where quote_id = any($1::uuid[])", [quoteIds])
      : { rows: [{ count: 0 }] },
    client.query(
      `select count(*)::int as count
       from email_dispatches
       where (entity_type = 'booking' and entity_id = any($1::uuid[]))
          or (entity_type = 'quote' and entity_id = any($2::uuid[]))
          or (entity_type = 'payment' and entity_id = any($3::uuid[]))`,
      [bookingIds, quoteIds, paymentIds],
    ),
    client.query(
      `select count(*)::int as count
       from notification_dispatch_log
       where (entity_type = 'booking' and entity_id = any($1::uuid[]))
          or (entity_type = 'quote' and entity_id = any($2::uuid[]))
          or (entity_type = 'payment' and entity_id = any($3::uuid[]))`,
      [bookingIds, quoteIds, paymentIds],
    ),
  ]);

  return {
    cutoff: {
      jamaica: "2026-05-31 7:00 PM America/Jamaica",
      utc: cutoffParam,
    },
    counts: {
      bookings: bookingsBefore.rowCount ?? 0,
      bookingsKept: bookingsKept.rowCount ?? 0,
      payments: countFromRow(payments.rows[0]),
      bookingInvoiceDocuments: countFromRow(invoiceDocuments.rows[0]),
      bookingPrivateFiles: countFromRow(privateFiles.rows[0]),
      bookingVehicleInspections: countFromRow(inspections.rows[0]),
      bookingVehicleInspectionImages: countFromRow(inspectionImages.rows[0]),
      promoRedemptions: countFromRow(promoRedemptions.rows[0]),
      promoRedemptionEvents: countFromRow(promoRedemptionEvents.rows[0]),
      quotes: quotesBefore.rowCount ?? 0,
      quoteEvents: countFromRow(quoteEvents.rows[0]),
      quoteEmails: countFromRow(quoteEmails.rows[0]),
      blockouts: blockoutsBefore.rowCount ?? 0,
      emailDispatches: countFromRow(emailDispatches.rows[0]),
      notificationDispatchLogs: countFromRow(notificationLogs.rows[0]),
    },
    bookingsBeforeCutoff: bookingsBefore.rows.map((row: Record<string, unknown>) =>
      omitInternalId(row),
    ),
    bookingsKept: bookingsKept.rows.map((row: Record<string, unknown>) => omitInternalId(row)),
    quotesBeforeCutoff: quotesBefore.rows.map((row: Record<string, unknown>) =>
      omitInternalId(row),
    ),
    blockoutsBeforeCutoff: blockoutsBefore.rows.map((row: Record<string, unknown>) =>
      omitInternalId(row),
    ),
    ricardoBookings: ricardoBookings.rows,
  };
}

export async function GET(request: Request) {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const shouldExecute = url.searchParams.get("execute") === "1";
  const confirmation = url.searchParams.get("confirm");
  const pool = getDbPool();
  const client = await pool.connect();

  try {
    if (!shouldExecute) {
      const preview = await getPreview(client);
      return NextResponse.json({
        ok: true,
        mode: "preview",
        confirmationRequired: CONFIRMATION,
        ...preview,
      });
    }

    if (confirmation !== CONFIRMATION) {
      return NextResponse.json(
        {
          ok: false,
          error: "Confirmation did not match. Nothing was deleted.",
          confirmationRequired: CONFIRMATION,
        },
        { status: 400 },
      );
    }

    await client.query("begin");
    const before = await getPreview(client);
    const cutoffParam = new Date(CUTOFF_ISO).toISOString();
    const bookingIds = (
      await client.query("select id from bookings where created_at < $1::timestamptz", [
        cutoffParam,
      ])
    ).rows.map((row: { id: string }) => row.id);
    const quoteIds = (
      await client.query("select id from quotes where created_at < $1::timestamptz", [cutoffParam])
    ).rows.map((row: { id: string }) => row.id);
    const paymentIds =
      bookingIds.length > 0
        ? (
            await client.query("select id from payments where booking_id = any($1::uuid[])", [
              bookingIds,
            ])
          ).rows.map((row: { id: string }) => row.id)
        : [];

    await client.query(
      `delete from email_dispatches
       where (entity_type = 'booking' and entity_id = any($1::uuid[]))
          or (entity_type = 'quote' and entity_id = any($2::uuid[]))
          or (entity_type = 'payment' and entity_id = any($3::uuid[]))`,
      [bookingIds, quoteIds, paymentIds],
    );
    await client.query(
      `delete from notification_dispatch_log
       where (entity_type = 'booking' and entity_id = any($1::uuid[]))
          or (entity_type = 'quote' and entity_id = any($2::uuid[]))
          or (entity_type = 'payment' and entity_id = any($3::uuid[]))`,
      [bookingIds, quoteIds, paymentIds],
    );
    await client.query("delete from blockouts where created_at < $1::timestamptz", [cutoffParam]);
    await client.query("delete from quotes where id = any($1::uuid[])", [quoteIds]);
    await client.query("delete from bookings where id = any($1::uuid[])", [bookingIds]);
    await client.query(
      `update customers c
       set last_booked_at = latest.last_booked_at
       from (
         select c2.id, max(b.created_at) as last_booked_at
         from customers c2
         left join bookings b on b.customer_id = c2.id
         group by c2.id
       ) latest
       where latest.id = c.id`,
    );
    await client.query("commit");

    const after = await getPreview(client);
    return NextResponse.json({
      ok: true,
      mode: "executed",
      before,
      after,
    });
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    logError("api.admin.maintenance.cleanup-prelaunch", error, { userId: auth.actor.userId });
    return NextResponse.json({ ok: false, error: "Cleanup failed." }, { status: 500 });
  } finally {
    client.release();
  }
}
