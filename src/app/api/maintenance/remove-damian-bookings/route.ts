import { NextResponse } from "next/server";

import { getDbPool } from "@/lib/db";
import { logError } from "@/lib/log";

const CUSTOMER_NAME = "Damian Thompson";
const CONFIRMATION = "remove-damian-thompson-bookings-only";

type Queryable = {
  query: <T = unknown>(
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: T[]; rowCount: number | null }>;
};
type BookingPreviewRow = {
  id: string;
  public_id: string;
  created_at: string;
  full_name: string;
  email: string;
  vehicle: string;
  status: string;
};

function countFromRow(row: unknown) {
  return Number((row as { count?: unknown } | undefined)?.count ?? 0);
}

function omitInternalId(row: BookingPreviewRow) {
  return {
    public_id: row.public_id,
    created_at: row.created_at,
    full_name: row.full_name,
    email: row.email,
    vehicle: row.vehicle,
    status: row.status,
  };
}

async function getTargetBookings(client: Queryable) {
  const result = await client.query<BookingPreviewRow>(
    `select b.id,
            b.public_id,
            b.created_at::text as created_at,
            c.full_name,
            c.email,
            v.make || ' ' || v.model as vehicle,
            b.status
       from bookings b
       join customers c on c.id = b.customer_id
       join vehicles v on v.id = b.vehicle_id
      where c.full_name = $1
      order by b.created_at asc`,
    [CUSTOMER_NAME],
  );
  return result.rows;
}

async function getPreview(client: Queryable) {
  const bookings = await getTargetBookings(client);
  const bookingIds = bookings.map((booking) => booking.id);
  const bookingPublicIds = bookings.map((booking) => booking.public_id);
  const customerEmails = Array.from(new Set(bookings.map((booking) => booking.email)));

  const paymentRows =
    bookingIds.length > 0
      ? await client.query<{ id: string }>(
          "select id from payments where booking_id = any($1::uuid[])",
          [bookingIds],
        )
      : { rows: [] };
  const paymentIds = paymentRows.rows.map((payment) => payment.id);
  const paymentIdTexts = paymentIds.map(String);

  const [
    payments,
    invoiceDocuments,
    privateFiles,
    inspections,
    inspectionImages,
    promoRedemptions,
    promoRedemptionEvents,
    emailDispatches,
    notificationDispatchLogs,
    auditLogs,
    ricardoBookings,
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
    client.query(
      `select count(*)::int as count
         from email_dispatches
        where (entity_type = 'booking' and entity_id = any($1::uuid[]))
           or (entity_type = 'payment' and entity_id = any($2::uuid[]))
           or (entity_public_id = any($3::text[]))
           or (related_transaction_type = 'payment' and related_transaction_id = any($4::text[]))`,
      [bookingIds, paymentIds, bookingPublicIds, paymentIdTexts],
    ),
    client.query(
      `select count(*)::int as count
         from notification_dispatch_log
        where (entity_type = 'booking' and entity_id = any($1::uuid[]))
           or (entity_type = 'payment' and entity_id = any($2::uuid[]))`,
      [bookingIds, paymentIds],
    ),
    client.query(
      `select count(*)::int as count
         from audit_logs
        where (entity_type = 'booking' and entity_id = any($1::uuid[]))
           or (entity_type = 'payment' and entity_id = any($2::uuid[]))`,
      [bookingIds, paymentIds],
    ),
    client.query(
      `select b.public_id,
              b.created_at::text as created_at,
              c.full_name,
              c.email,
              v.make || ' ' || v.model as vehicle,
              b.status
         from bookings b
         join customers c on c.id = b.customer_id
         join vehicles v on v.id = b.vehicle_id
        where lower(c.email) = lower($1)
        order by b.created_at desc`,
      ["ricardobarlock31@gmail.com"],
    ),
  ]);

  return {
    target: {
      customerName: CUSTOMER_NAME,
      customerEmails,
    },
    confirmationRequired: CONFIRMATION,
    counts: {
      bookings: bookings.length,
      payments: countFromRow(payments.rows[0]),
      bookingInvoiceDocuments: countFromRow(invoiceDocuments.rows[0]),
      bookingPrivateFiles: countFromRow(privateFiles.rows[0]),
      bookingVehicleInspections: countFromRow(inspections.rows[0]),
      bookingVehicleInspectionImages: countFromRow(inspectionImages.rows[0]),
      promoRedemptions: countFromRow(promoRedemptions.rows[0]),
      promoRedemptionEvents: countFromRow(promoRedemptionEvents.rows[0]),
      emailDispatches: countFromRow(emailDispatches.rows[0]),
      notificationDispatchLogs: countFromRow(notificationDispatchLogs.rows[0]),
      auditLogs: countFromRow(auditLogs.rows[0]),
    },
    bookings: bookings.map(omitInternalId),
    ricardoBookings: ricardoBookings.rows,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const shouldExecute = url.searchParams.get("execute") === "1";
  const confirmation = url.searchParams.get("confirm");
  const pool = getDbPool();
  const client = (await pool.connect()) as Queryable & { release: () => void };

  try {
    if (!shouldExecute) {
      const preview = await getPreview(client);
      return NextResponse.json({ ok: true, mode: "preview", ...preview });
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
    const bookings = await getTargetBookings(client);
    const bookingIds = bookings.map((booking) => booking.id);
    const bookingPublicIds = bookings.map((booking) => booking.public_id);
    const customerEmails = Array.from(new Set(bookings.map((booking) => booking.email)));
    const customerIds =
      bookingIds.length > 0
        ? (
            await client.query<{ customer_id: string }>(
              "select distinct customer_id from bookings where id = any($1::uuid[])",
              [bookingIds],
            )
          ).rows.map((row) => row.customer_id)
        : [];
    const paymentIds =
      bookingIds.length > 0
        ? (
            await client.query<{ id: string }>(
              "select id from payments where booking_id = any($1::uuid[])",
              [bookingIds],
            )
          ).rows.map((row) => row.id)
        : [];
    const paymentIdTexts = paymentIds.map(String);

    await client.query(
      `delete from email_dispatches
        where (entity_type = 'booking' and entity_id = any($1::uuid[]))
           or (entity_type = 'payment' and entity_id = any($2::uuid[]))
           or (entity_public_id = any($3::text[]))
           or (related_transaction_type = 'payment' and related_transaction_id = any($4::text[]))`,
      [bookingIds, paymentIds, bookingPublicIds, paymentIdTexts],
    );
    await client.query(
      `delete from notification_dispatch_log
        where (entity_type = 'booking' and entity_id = any($1::uuid[]))
           or (entity_type = 'payment' and entity_id = any($2::uuid[]))`,
      [bookingIds, paymentIds],
    );
    await client.query(
      `delete from audit_logs
        where (entity_type = 'booking' and entity_id = any($1::uuid[]))
           or (entity_type = 'payment' and entity_id = any($2::uuid[]))`,
      [bookingIds, paymentIds],
    );
    await client.query("delete from bookings where id = any($1::uuid[])", [bookingIds]);
    await client.query(
      `update customers c
          set last_booked_at = latest.last_booked_at
         from (
           select c2.id, max(b.created_at) as last_booked_at
             from customers c2
             left join bookings b on b.customer_id = c2.id
            where c2.id = any($1::uuid[])
            group by c2.id
         ) latest
        where latest.id = c.id`,
      [customerIds],
    );

    await client.query("commit");

    const after = await getPreview(client);
    return NextResponse.json({
      ok: true,
      mode: "executed",
      removedCustomerName: CUSTOMER_NAME,
      removedCustomerEmails: customerEmails,
      before,
      after,
    });
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    logError("api.maintenance.remove-damian-bookings", error, {
      mode: shouldExecute ? "execute" : "preview",
    });
    return NextResponse.json({ ok: false, error: "Cleanup failed." }, { status: 500 });
  } finally {
    client.release();
  }
}
