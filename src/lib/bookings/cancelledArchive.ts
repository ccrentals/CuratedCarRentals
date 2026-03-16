import { writeAuditLog } from "@/lib/audit";
import { dbQuery } from "@/lib/db";

export const CANCELLED_BOOKING_AUTO_ARCHIVE_DAYS = 15;
const CANCELLED_BOOKING_AUTO_ARCHIVE_REASON = `Cancelled > ${CANCELLED_BOOKING_AUTO_ARCHIVE_DAYS} days`;
const CANCELLED_BOOKING_AUTO_ARCHIVE_SOURCE = "cancelled_retention";

type ArchivedCancelledBookingRow = {
  id: string;
  public_id: string | null;
  cancelled_at: string | Date | null;
};

type ArchiveCancelledBookingsDeps = {
  query?: typeof dbQuery;
  writeAudit?: typeof writeAuditLog;
};

export type ArchiveCancelledBookingsResult = {
  archivedCount: number;
  archiveNotConfigured: boolean;
  archivedBookings: Array<{
    id: string;
    publicId: string | null;
    cancelledAt: string | null;
  }>;
};

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.includes(`"${column}"`) && message.includes("does not exist");
}

export async function archiveCancelledBookingsOlderThanDays(
  input?: { now?: Date; olderThanDays?: number },
  deps: ArchiveCancelledBookingsDeps = {},
): Promise<ArchiveCancelledBookingsResult> {
  const query = deps.query ?? dbQuery;
  const writeAudit = deps.writeAudit ?? writeAuditLog;
  const now = input?.now instanceof Date && !Number.isNaN(input.now.getTime()) ? input.now : new Date();
  const olderThanDays =
    typeof input?.olderThanDays === "number" && Number.isFinite(input.olderThanDays) && input.olderThanDays > 0
      ? Math.floor(input.olderThanDays)
      : CANCELLED_BOOKING_AUTO_ARCHIVE_DAYS;
  const archiveReason =
    olderThanDays === CANCELLED_BOOKING_AUTO_ARCHIVE_DAYS
      ? CANCELLED_BOOKING_AUTO_ARCHIVE_REASON
      : `Cancelled > ${olderThanDays} days`;

  try {
    const result = (await query<ArchivedCancelledBookingRow>(
      `update bookings b
          set archived_at = $1::timestamptz,
              archived_by_user_id = null,
              archived_reason = $2,
              updated_at = $1::timestamptz
        where b.archived_at is null
          and upper(coalesce(b.status, '')) = 'CANCELLED'
          and coalesce(
            case
              when coalesce(b.pricing_json->>'cancelled_at', '') ~ '^\\d{4}-\\d{2}-\\d{2}T'
                then (b.pricing_json->>'cancelled_at')::timestamptz
            end,
            b.updated_at
          ) < ($1::timestamptz - make_interval(days => $3::int))
      returning b.id::text as id,
                b.public_id,
                coalesce(
                  case
                    when coalesce(b.pricing_json->>'cancelled_at', '') ~ '^\\d{4}-\\d{2}-\\d{2}T'
                      then (b.pricing_json->>'cancelled_at')::timestamptz
                  end,
                  b.updated_at
                ) as cancelled_at`,
      [now.toISOString(), archiveReason, olderThanDays],
    )) as { rowCount?: number | null; rows: ArchivedCancelledBookingRow[] };

    const archivedBookings = result.rows.map((row: ArchivedCancelledBookingRow) => ({
      id: row.id,
      publicId: typeof row.public_id === "string" && row.public_id.trim() ? row.public_id : null,
      cancelledAt:
        row.cancelled_at instanceof Date
          ? row.cancelled_at.toISOString()
          : typeof row.cancelled_at === "string"
            ? row.cancelled_at
            : null,
    }));

    for (const booking of archivedBookings) {
      await writeAudit({
        userId: "system",
        action: "BOOKING_ARCHIVED",
        entityType: "booking",
        entityId: booking.id,
        details: {
          reason: archiveReason,
          source: CANCELLED_BOOKING_AUTO_ARCHIVE_SOURCE,
          automatic: true,
          older_than_days: olderThanDays,
          cancelled_at: booking.cancelledAt,
        },
      });
    }

    return {
      archivedCount: result.rowCount ?? archivedBookings.length,
      archiveNotConfigured: false,
      archivedBookings,
    };
  } catch (error) {
    if (isUndefinedColumn(error, "archived_at")) {
      return {
        archivedCount: 0,
        archiveNotConfigured: true,
        archivedBookings: [],
      };
    }
    throw error;
  }
}
