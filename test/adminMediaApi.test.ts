import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminMediaGet } from "@/app/api/admin/media/route";
import type { AdminMediaItem, AdminMediaSource } from "@/lib/uploads/adminMedia";

function item(id: string, source: AdminMediaSource, createdAt: string): AdminMediaItem {
  return { id, source, sourceLabel: source, title: `Title ${id}`, fileName: `${id}.jpg`, previewUrl: source === "vehicles" ? `https://ucarecdn.com/${id}/` : `/private/${id}`, openUrl: "/must-not-leak", manageUrl: "/admin/source", vehicleId: "vehicle-1", vehiclePublicId: "VE000001", vehicleLabel: "2025 Toyota Yaris", bookingId: source === "inspections" ? "booking-1" : null, bookingPublicId: source === "inspections" ? "BK000001" : null, category: "EXTERIOR", categoryLabel: "Exterior", subtype: "PICKUP", subtypeLabel: "Pickup", uploadedBy: "Admin", createdAt, isPrimary: false, canRemove: true, removeUrl: "/destructive", removePayload: { secret: "must-not-leak" } };
}

const admin = async () => ({ ok: true as const, actor: { userId: "admin-1", role: "ADMIN" as const } });

test("admin media API requires a privileged session", async () => {
  const response = await handleAdminMediaGet(new Request("http://localhost/api/admin/media"), { requireAdmin: async () => ({ ok: false as const, response: new Response(null, { status: 401 }) }), load: async () => [] });
  assert.equal(response.status, 401);
});

test("admin media API filters and paginates a privacy-safe response", async () => {
  const response = await handleAdminMediaGet(new Request("http://localhost/api/admin/media?source=inspections&q=second&sort=oldest"), {
    requireAdmin: admin,
    load: async (source) => source === "inspections" ? [item("first", source, "2026-06-02T00:00:00Z"), { ...item("second", source, "2026-06-01T00:00:00Z"), title: "Second evidence" }] : [item(source, source, "2026-06-03T00:00:00Z")],
  });
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, any>;
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].id, "second");
  assert.equal(body.items[0].previewUrl, "/private/second");
  assert.equal("removeUrl" in body.items[0], false);
  assert.equal("removePayload" in body.items[0], false);
  assert.equal("openUrl" in body.items[0], false);
  assert.deepEqual(body.counts, { inspections: 2, vehicles: 1, "vehicle-files": 1 });
  assert.deepEqual(body.options.vehicles, [{ value: "vehicle-1", label: "2025 Toyota Yaris" }]);
});

test("admin media API isolates a failed source without dropping healthy areas", async () => {
  const response = await handleAdminMediaGet(new Request("http://localhost/api/admin/media?source=vehicles"), {
    requireAdmin: admin,
    load: async (source) => { if (source === "inspections") throw new Error("missing table"); return [item(source, source, "2026-06-03T00:00:00Z")]; },
  });
  const body = await response.json() as { items: unknown[]; warnings: string[]; counts: Record<string, number> };
  assert.equal(body.items.length, 1);
  assert.equal(body.counts.inspections, 0);
  assert.deepEqual(body.warnings, ["inspections could not be loaded."]);
});
