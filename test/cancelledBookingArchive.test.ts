import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveCancelledBookingsOlderThanDays,
  CANCELLED_BOOKING_AUTO_ARCHIVE_DAYS,
} from "@/lib/bookings/cancelledArchive";

test("cancelled booking archive: archives cancelled bookings older than 15 days and writes audit", async () => {
  const queryCalls: Array<{ text: string; values: unknown[] | undefined }> = [];
  const auditCalls: Array<{
    userId?: string | null;
    action: string;
    entityType: string;
    entityId?: string;
    details?: Record<string, unknown>;
  }> = [];

  const result = await archiveCancelledBookingsOlderThanDays(
    { now: new Date("2026-03-16T08:00:00.000Z") },
    {
      query: async (text, values) => {
        queryCalls.push({ text, values });
        return {
          rowCount: 2,
          rows: [
            {
              id: "booking-1",
              public_id: "BK000101",
              cancelled_at: "2026-02-28T10:00:00.000Z",
            },
            {
              id: "booking-2",
              public_id: "BK000102",
              cancelled_at: "2026-02-27T09:30:00.000Z",
            },
          ],
        };
      },
      writeAudit: async (input) => {
        auditCalls.push(input);
      },
    },
  );

  assert.equal(result.archiveNotConfigured, false);
  assert.equal(result.archivedCount, 2);
  assert.equal(result.archivedBookings[0]?.publicId, "BK000101");
  assert.equal(queryCalls.length, 1);
  assert.match(queryCalls[0]?.text ?? "", /upper\(coalesce\(b\.status, ''\)\) = 'CANCELLED'/i);
  assert.match(queryCalls[0]?.text ?? "", /pricing_json->>'cancelled_at'/i);
  assert.match(queryCalls[0]?.text ?? "", /archived_at is null/i);
  assert.deepEqual(queryCalls[0]?.values, [
    "2026-03-16T08:00:00.000Z",
    "Cancelled > 15 days",
    CANCELLED_BOOKING_AUTO_ARCHIVE_DAYS,
  ]);
  assert.equal(auditCalls.length, 2);
  assert.equal(auditCalls[0]?.action, "BOOKING_ARCHIVED");
  assert.equal(auditCalls[0]?.entityType, "booking");
  assert.equal(auditCalls[0]?.userId, "system");
  assert.equal(auditCalls[0]?.details?.source, "cancelled_retention");
});

test("cancelled booking archive: reports archive-not-configured when archive columns are unavailable", async () => {
  const error = Object.assign(new Error('column "archived_at" does not exist'), { code: "42703" });

  const result = await archiveCancelledBookingsOlderThanDays(
    { now: new Date("2026-03-16T08:00:00.000Z") },
    {
      query: async () => {
        throw error;
      },
      writeAudit: async () => {
        throw new Error("writeAudit should not be called");
      },
    },
  );

  assert.equal(result.archiveNotConfigured, true);
  assert.equal(result.archivedCount, 0);
  assert.equal(result.archivedBookings.length, 0);
});
