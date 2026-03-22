import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminMaintenanceExportGet } from "@/app/api/admin/maintenance/export/route";

const mockPayload = {
  ok: true,
  items: [
    {
      vehicleLabel: "2020 Honda Fit",
      title: "Oil change",
      category: "SERVICE",
      status: "COMPLETED",
      dueState: "COMPLETED",
      scheduledDate: "2026-03-10",
      serviceDate: "2026-03-10",
      nextDueDate: "2026-05-10",
      totalCostCents: 17480,
    },
  ],
};

test("admin maintenance export route returns branded PDF when requested", async () => {
  const response = await handleAdminMaintenanceExportGet(
    new Request("http://localhost/api/admin/maintenance/export?format=pdf&q=oil"),
    {
      fetchListResponse: async () =>
        new Response(JSON.stringify(mockPayload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      now: () => new Date("2026-03-19T15:30:00.000Z"),
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/pdf/i);
  const text = Buffer.from(await response.arrayBuffer()).toString("latin1");
  assert.match(text, /Maintenance Report/);
  assert.match(text, /Curated Car Rentals/);
  assert.match(text, /Oil change/);
});

test("admin maintenance export route keeps CSV as the default format", async () => {
  const response = await handleAdminMaintenanceExportGet(
    new Request("http://localhost/api/admin/maintenance/export"),
    {
      fetchListResponse: async () =>
        new Response(JSON.stringify(mockPayload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      now: () => new Date("2026-03-19T15:30:00.000Z"),
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/csv/i);
  const csv = await response.text();
  assert.match(csv, /Vehicle,Maintenance Item,Category/);
  assert.match(csv, /2020 Honda Fit/);
});
