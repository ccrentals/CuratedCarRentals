import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminMaintenanceGet } from "@/app/api/admin/maintenance/route";

function adminSession() {
  return {
    userId: "99999999-9999-4999-8999-999999999999",
    role: "ADMIN",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

test("admin maintenance list API: requires auth", async () => {
  const response = await handleAdminMaintenanceGet(
    new Request("http://localhost/api/admin/maintenance"),
    {
      getSession: async () => null,
      list: async () => [],
    },
  );

  assert.equal(response.status, 401);
});

test("admin maintenance list API: applies due-state and text filter", async () => {
  const response = await handleAdminMaintenanceGet(
    new Request("http://localhost/api/admin/maintenance?dueState=OVERDUE&q=oil"),
    {
      getSession: async () => adminSession(),
      list: async () => [
        {
          id: "11111111-1111-4111-8111-111111111111",
          vehicleId: "22222222-2222-4222-8222-222222222222",
          vehicleLabel: "2024 Toyota Yaris",
          status: "SCHEDULED",
          category: "SERVICE",
          title: "Oil change",
          scheduledDate: "2026-03-01",
          serviceDate: null,
          nextDueDate: "2026-03-02",
          dueState: "OVERDUE",
          totalCostCents: 12500,
          priority: "NORMAL",
          currentOdometerKm: 24000,
        },
      ],
    },
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as { ok?: boolean; items?: Array<{ title?: string }> };
  assert.equal(payload.ok, true);
  assert.equal(payload.items?.length, 1);
  assert.equal(payload.items?.[0]?.title, "Oil change");
});
