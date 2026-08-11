import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminMessagesExportGet } from "@/app/api/admin/messages/export/implementation";

test("admin messages export includes source and related entity context", async () => {
  const response = await handleAdminMessagesExportGet(
    new Request("http://localhost/api/admin/messages/export?status=TRASH&source=booking_inspection"),
    {
      getSession: async () => ({
        userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
        role: "ADMIN",
        expiresAt: 999999999,
        issuedAt: 999999000,
      }),
      getRows: async () => [
        {
          id: "msg-1",
          createdAt: "2026-03-19T12:00:00.000Z",
          name: "Vehicle inspection warning",
          email: "ops@example.com",
          displayName: "Vehicle inspection alert · BK000111",
          displayEmail: "Recipient: ops@example.com",
          status: "ARCHIVED",
          visibleStatus: "TRASH",
          statusLabel: "Trash",
          snippet: "Fuel mismatch recorded on return inspection.",
          source: "booking_inspection",
          sourceKey: "booking_inspection",
          sourceLabel: "Vehicle inspection alert",
          isTrashed: true,
          relatedEntityType: "booking",
          relatedEntityId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
          relatedEntityPublicId: "BK000111",
          relatedEntityLabel: "Booking BK000111",
          relatedEntityHref: "/admin/bookings/91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
          message: "Fuel mismatch recorded on return inspection.",
          readAt: "2026-03-19T12:10:00.000Z",
          readByUserId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
        },
      ],
    },
  );

  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /source_label/);
  assert.match(body, /Vehicle inspection alert/);
  assert.match(body, /Booking BK000111/);
  assert.match(body, /Trash/);
});
