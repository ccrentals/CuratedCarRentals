import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminBookingsGet } from "@/app/api/admin/bookings/route";

test("admin bookings API: GET requires auth", async () => {
  const response = await handleAdminBookingsGet(new Request("http://localhost/api/admin/bookings"), {
    getSession: async () => null,
    fetchPage: async () => ({
      bookings: [],
      nextCursor: null,
      hasMore: false,
      totalCount: 0,
      archiveNotConfigured: false,
      limit: 10,
    }),
  });

  assert.equal(response.status, 401);
});

test("admin bookings API: forwards sortBy/sortDir to list fetch", async () => {
  let capturedSortBy: string | null | undefined;
  let capturedSortDir: string | null | undefined;

  const response = await handleAdminBookingsGet(
    new Request("http://localhost/api/admin/bookings?scope=upcoming&sortBy=dates&sortDir=asc"),
    {
      getSession: async () => ({
        userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
        role: "ADMIN",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60000,
      }),
      fetchPage: async (input) => {
        capturedSortBy = input.sortBy;
        capturedSortDir = input.sortDir;
        return {
          bookings: [],
          nextCursor: null,
          hasMore: false,
          totalCount: 0,
          archiveNotConfigured: false,
          limit: 10,
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(capturedSortBy, "dates");
  assert.equal(capturedSortDir, "asc");
});

