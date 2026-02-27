import assert from "node:assert/strict";
import test from "node:test";

import {
  handleVehicleMaintenanceGet,
  handleVehicleMaintenancePost,
} from "@/app/api/admin/vehicles/[id]/maintenance/route";
import {
  handleVehicleMaintenanceRecordGet,
  handleVehicleMaintenanceRecordDelete,
  handleVehicleMaintenanceRecordPatch,
} from "@/app/api/admin/vehicles/[id]/maintenance/[recordId]/route";
import { handleVehicleMaintenanceExportGet } from "@/app/api/admin/vehicles/[id]/maintenance/export/route";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";
const RECORD_ID = "22222222-2222-4222-8222-222222222222";
const LINKED_EXPENSE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LINKED_REPAIR_ORDER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function adminSession() {
  return {
    userId: "99999999-9999-4999-8999-999999999999",
    role: "ADMIN",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

function maintenanceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RECORD_ID,
    public_id: "ME000001",
    vehicle_id: VEHICLE_ID,
    status: "SCHEDULED",
    category: "SERVICE",
    title: "Oil change",
    description: null,
    vendor_name: null,
    vendor_contact: null,
    reference_number: null,
    service_date: null,
    scheduled_date: "2026-03-10",
    completed_date: null,
    odometer_km: 22000,
    next_due_date: "2026-03-15",
    next_due_odometer_km: 26000,
    reminder_lead_days: 7,
    labor_cost_cents: 11000,
    parts_cost_cents: 4200,
    tax_cost_cents: 2280,
    estimated_cost_cents: null,
    actual_cost_cents: null,
    total_cost_cents: 17480,
    linked_expense_id: null,
    linked_repair_order_id: null,
    currency: "JMD",
    priority: "NORMAL",
    created_by_user_id: "99999999-9999-4999-8999-999999999999",
    completed_by_user_id: null,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    archived_at: null,
    current_odometer_km: 22000,
    linked_blockout_id: null,
    linked_blockout_start_at: null,
    linked_blockout_end_at: null,
    linked_blockout_reason: null,
    linked_blockout_source: null,
    ...overrides,
  };
}

test("admin vehicle maintenance API: GET requires auth", async () => {
  const response = await handleVehicleMaintenanceGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => null,
      requireCsrfCheck: async () => true,
      listRecords: async () => [],
      createRecord: async () => null,
      summarize: async () => ({
        totalMaintenanceCostCents: 0,
        lastServiceDate: null,
        nextDueDate: null,
        overdueCount: 0,
        openScheduledCount: 0,
      }),
    },
  );

  assert.equal(response.status, 401);
});

test("admin vehicle maintenance API: GET applies pagination/search/sort parameters", async () => {
  let capturedFilters: Record<string, unknown> | null = null;

  const response = await handleVehicleMaintenanceGet(
    new Request(
      `http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance?view=completed&q=oil&sort=cost&dir=desc&limit=999&offset=-10`,
    ),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      listRecords: async (_vehicleId, filters) => {
        capturedFilters = filters;
        return {
          rows: [maintenanceRow({ status: "COMPLETED", title: "Oil change complete" })],
          total: 42,
        };
      },
      createRecord: async () => null,
      summarize: async () => ({
        totalMaintenanceCostCents: 17480,
        lastServiceDate: "2026-02-10",
        nextDueDate: "2026-03-15",
        overdueCount: 0,
        openScheduledCount: 1,
      }),
    },
  );

  assert.equal(response.status, 200);
  assert.ok(capturedFilters, "Expected parsed filters");
  const parsedFilters = capturedFilters as {
    view?: string;
    query?: string | null;
    sort?: string;
    dir?: string;
    limit?: number;
    offset?: number;
  };
  assert.equal(parsedFilters.view, "completed");
  assert.equal(parsedFilters.query, "oil");
  assert.equal(parsedFilters.sort, "cost");
  assert.equal(parsedFilters.dir, "desc");
  assert.equal(parsedFilters.limit, 50);
  assert.equal(parsedFilters.offset, 0);

  const body = (await response.json()) as {
    ok?: boolean;
    rows?: Array<{ publicId?: string }>;
    paging?: { total?: number; limit?: number; offset?: number };
  };
  assert.equal(body.ok, true);
  assert.equal(body.rows?.length, 1);
  assert.equal(body.rows?.[0]?.publicId, "ME000001");
  assert.equal(body.paging?.total, 42);
  assert.equal(body.paging?.limit, 50);
  assert.equal(body.paging?.offset, 0);
});

test("admin vehicle maintenance API: POST validates scheduled/service date", async () => {
  const response = await handleVehicleMaintenancePost(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        title: "Brake inspection",
        status: "SCHEDULED",
        category: "BRAKE",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      listRecords: async () => [],
      createRecord: async () => null,
      summarize: async () => ({
        totalMaintenanceCostCents: 0,
        lastServiceDate: null,
        nextDueDate: null,
        overdueCount: 0,
        openScheduledCount: 0,
      }),
    },
  );

  assert.equal(response.status, 400);
});

test("admin vehicle maintenance API: POST computes canonical total from parts", async () => {
  let capturedTotal = 0;
  const response = await handleVehicleMaintenancePost(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        status: "SCHEDULED",
        category: "SERVICE",
        title: "Oil change",
        scheduledDate: "2026-03-10",
        laborCostCents: 10000,
        partsCostCents: 5000,
        taxCostCents: 2250,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      listRecords: async () => [],
      createRecord: async (_vehicleId, input, userId) => {
        void userId;
        capturedTotal = input.totalCostCents;
        return maintenanceRow({ total_cost_cents: input.totalCostCents });
      },
      summarize: async () => ({
        totalMaintenanceCostCents: 0,
        lastServiceDate: null,
        nextDueDate: null,
        overdueCount: 0,
        openScheduledCount: 0,
      }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal(capturedTotal, 17250);
});

test("admin vehicle maintenance API: POST persists linked expense/repair IDs", async () => {
  let capturedExpenseId: string | null | undefined;
  let capturedRepairOrderId: string | null | undefined;
  const response = await handleVehicleMaintenancePost(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        status: "SCHEDULED",
        category: "SERVICE",
        title: "Linked maintenance row",
        scheduledDate: "2026-03-15",
        linkedExpenseId: LINKED_EXPENSE_ID,
        linkedRepairOrderId: LINKED_REPAIR_ORDER_ID,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      listRecords: async () => [],
      createRecord: async (_vehicleId, input) => {
        capturedExpenseId = input.linkedExpenseId;
        capturedRepairOrderId = input.linkedRepairOrderId;
        return maintenanceRow({
          linked_expense_id: input.linkedExpenseId,
          linked_repair_order_id: input.linkedRepairOrderId,
        });
      },
      summarize: async () => ({
        totalMaintenanceCostCents: 0,
        lastServiceDate: null,
        nextDueDate: null,
        overdueCount: 0,
        openScheduledCount: 0,
      }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal(capturedExpenseId, LINKED_EXPENSE_ID);
  assert.equal(capturedRepairOrderId, LINKED_REPAIR_ORDER_ID);
});

test("admin vehicle maintenance API: POST rejects invalid linked UUID values", async () => {
  const response = await handleVehicleMaintenancePost(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        status: "SCHEDULED",
        category: "SERVICE",
        title: "Invalid link ids",
        scheduledDate: "2026-03-15",
        linkedExpenseId: "not-a-uuid",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      listRecords: async () => [],
      createRecord: async () => {
        throw new Error("should not create");
      },
      summarize: async () => ({
        totalMaintenanceCostCents: 0,
        lastServiceDate: null,
        nextDueDate: null,
        overdueCount: 0,
        openScheduledCount: 0,
      }),
    },
  );

  assert.equal(response.status, 400);
  const body = (await response.json()) as { ok?: boolean; error?: string };
  assert.equal(body.ok, false);
  assert.match(body.error ?? "", /Linked expense ID/i);
});

test("admin vehicle maintenance API: GET filters by dueState query", async () => {
  const response = await handleVehicleMaintenanceGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance?dueState=OVERDUE`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      listRecords: async () => [maintenanceRow({ next_due_date: "2026-02-01" })],
      createRecord: async () => null,
      summarize: async () => ({
        totalMaintenanceCostCents: 17480,
        lastServiceDate: "2026-01-20",
        nextDueDate: "2026-02-01",
        overdueCount: 1,
        openScheduledCount: 1,
      }),
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok?: boolean; items?: Array<{ dueState?: string }> };
  assert.equal(body.ok, true);
  assert.equal(body.items?.length, 1);
  assert.equal(body.items?.[0]?.dueState, "OVERDUE");
});

test("admin vehicle maintenance API: GET supports completed due-state filter", async () => {
  const response = await handleVehicleMaintenanceGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance?dueState=COMPLETED`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      listRecords: async () =>
        [
          maintenanceRow({ status: "COMPLETED", service_date: "2026-02-10" }),
          maintenanceRow({ id: "44444444-4444-4444-8444-444444444444", status: "SCHEDULED" }),
        ],
      createRecord: async () => null,
      summarize: async () => ({
        totalMaintenanceCostCents: 17480,
        lastServiceDate: "2026-02-10",
        nextDueDate: null,
        overdueCount: 0,
        openScheduledCount: 1,
      }),
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok?: boolean;
    items?: Array<{ dueState?: string; status?: string }>;
  };
  assert.equal(body.ok, true);
  assert.equal(body.items?.length, 1);
  assert.equal(body.items?.[0]?.status, "COMPLETED");
  assert.equal(body.items?.[0]?.dueState, "COMPLETED");
});

test("admin vehicle maintenance API: GET returns settings-driven options metadata", async () => {
  const response = await handleVehicleMaintenanceGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getSettingsMeta: async () => ({
        categories: ["SERVICE", "REPAIR", "INSPECTION"],
        priorities: ["LOW", "NORMAL", "HIGH"],
        defaultReminderLeadDays: 10,
      }),
      listRecords: async () => [maintenanceRow()],
      createRecord: async () => null,
      summarize: async () => ({
        totalMaintenanceCostCents: 17480,
        lastServiceDate: "2026-01-20",
        nextDueDate: "2026-03-15",
        overdueCount: 0,
        openScheduledCount: 1,
      }),
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok?: boolean;
    options?: { categories?: string[]; priorities?: string[]; defaultReminderLeadDays?: number };
  };
  assert.equal(body.ok, true);
  assert.deepEqual(body.options?.categories, ["SERVICE", "REPAIR", "INSPECTION"]);
  assert.deepEqual(body.options?.priorities, ["LOW", "NORMAL", "HIGH"]);
  assert.equal(body.options?.defaultReminderLeadDays, 10);
});

test("admin maintenance record API: PATCH updates a record", async () => {
  const response = await handleVehicleMaintenanceRecordPatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance/${RECORD_ID}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        title: "Updated oil change",
        laborCostCents: 12000,
        partsCostCents: 5200,
        taxCostCents: 2580,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID, recordId: RECORD_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getRecord: async () => maintenanceRow(),
      updateRecord: async (_vehicleId, _recordId, patch) =>
        maintenanceRow({
          title: patch.title ?? "Updated oil change",
          labor_cost_cents: patch.laborCostCents ?? 12000,
          parts_cost_cents: patch.partsCostCents ?? 5200,
          tax_cost_cents: patch.taxCostCents ?? 2580,
          total_cost_cents: 19780,
        }),
      archiveRecord: async () => true,
    },
  );

  assert.equal(response.status, 200);
});

test("admin maintenance record API: PATCH updates linked expense/repair IDs", async () => {
  let capturedExpenseId: string | null | undefined;
  let capturedRepairOrderId: string | null | undefined;

  const response = await handleVehicleMaintenanceRecordPatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance/${RECORD_ID}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        linkedExpenseId: LINKED_EXPENSE_ID,
        linkedRepairOrderId: LINKED_REPAIR_ORDER_ID,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID, recordId: RECORD_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getRecord: async () => maintenanceRow(),
      updateRecord: async (_vehicleId, _recordId, patch) => {
        capturedExpenseId = patch.linkedExpenseId;
        capturedRepairOrderId = patch.linkedRepairOrderId;
        return maintenanceRow({
          linked_expense_id: patch.linkedExpenseId ?? null,
          linked_repair_order_id: patch.linkedRepairOrderId ?? null,
        });
      },
      archiveRecord: async () => true,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(capturedExpenseId, LINKED_EXPENSE_ID);
  assert.equal(capturedRepairOrderId, LINKED_REPAIR_ORDER_ID);
});

test("admin maintenance record API: PATCH rejects invalid linked UUID values", async () => {
  const response = await handleVehicleMaintenanceRecordPatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance/${RECORD_ID}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        linkedRepairOrderId: "invalid",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID, recordId: RECORD_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getRecord: async () => maintenanceRow(),
      updateRecord: async () => maintenanceRow(),
      archiveRecord: async () => true,
    },
  );

  assert.equal(response.status, 400);
  const body = (await response.json()) as { ok?: boolean; error?: string };
  assert.equal(body.ok, false);
  assert.match(body.error ?? "", /Linked repair order ID/i);
});

test("admin maintenance record API: PATCH can create or update linked maintenance blockout", async () => {
  let linked = false;
  const response = await handleVehicleMaintenanceRecordPatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance/${RECORD_ID}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        createBlockout: true,
        blockoutStartAt: "2026-03-10T08:00:00.000Z",
        blockoutEndAt: "2026-03-10T18:00:00.000Z",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID, recordId: RECORD_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getRecord: async () =>
        maintenanceRow({
          linked_blockout_id: "33333333-3333-4333-8333-333333333333",
          linked_blockout_start_at: "2026-03-10T08:00:00.000Z",
          linked_blockout_end_at: "2026-03-10T18:00:00.000Z",
          linked_blockout_reason: "Maintenance window",
          linked_blockout_source: "MAINTENANCE",
        }),
      updateRecord: async () => maintenanceRow(),
      archiveRecord: async () => true,
      createOrUpdateLinkedBlockout: async () => {
        linked = true;
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(linked, true);
});

test("admin maintenance record API: PATCH removes linked blockout when canceled", async () => {
  let removed = false;
  const response = await handleVehicleMaintenanceRecordPatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance/${RECORD_ID}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        status: "CANCELLED",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID, recordId: RECORD_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getRecord: async () => maintenanceRow(),
      updateRecord: async () => maintenanceRow({ status: "CANCELLED" }),
      archiveRecord: async () => true,
      removeLinkedBlockout: async () => {
        removed = true;
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(removed, true);
});

test("admin maintenance record API: PATCH completed records trigger blockout sync removal path", async () => {
  let syncCalled = false;
  const response = await handleVehicleMaintenanceRecordPatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance/${RECORD_ID}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        status: "COMPLETED",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID, recordId: RECORD_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getRecord: async () =>
        maintenanceRow({
          linked_blockout_id: "33333333-3333-4333-8333-333333333333",
          scheduled_date: "2026-03-10",
        }),
      updateRecord: async () =>
        maintenanceRow({
          status: "COMPLETED",
          completed_date: "2026-03-10",
          linked_blockout_id: null,
        }),
      archiveRecord: async () => true,
      syncLinkedBlockout: async (input) => {
        syncCalled = input.status === "COMPLETED" && input.completedDate === "2026-03-10";
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(syncCalled, true);
});

test("admin maintenance record API: PATCH reopen triggers blockout recreation semantics", async () => {
  let syncEnsureWhenOpen = false;
  const response = await handleVehicleMaintenanceRecordPatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance/${RECORD_ID}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({
        status: "SCHEDULED",
        completedDate: null,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID, recordId: RECORD_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getRecord: async () =>
        maintenanceRow({
          status: "COMPLETED",
          completed_date: "2026-03-08",
          linked_blockout_id: null,
          scheduled_date: "2026-03-12",
        }),
      updateRecord: async () =>
        maintenanceRow({
          status: "SCHEDULED",
          completed_date: null,
          scheduled_date: "2026-03-12",
        }),
      archiveRecord: async () => true,
      syncLinkedBlockout: async (input) => {
        syncEnsureWhenOpen = input.ensureWhenOpen;
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(syncEnsureWhenOpen, true);
});

test("admin maintenance record API: GET includes sorted status history for selected record", async () => {
  const response = await handleVehicleMaintenanceRecordGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance/${RECORD_ID}`),
    { params: Promise.resolve({ id: VEHICLE_ID, recordId: RECORD_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getRecord: async () => maintenanceRow(),
      getStatusHistory: async () => [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          previous_status: "SCHEDULED",
          next_status: "IN_PROGRESS",
          note: "Started work",
          changed_by_user_id: "99999999-9999-4999-8999-999999999999",
          changed_by_email: "admin@example.com",
          changed_at: "2026-03-12T10:00:00.000Z",
        },
      ],
      updateRecord: async () => maintenanceRow(),
      archiveRecord: async () => true,
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok?: boolean;
    item?: { publicId?: string };
    statusHistory?: Array<{ status?: string; changedBy?: string; note?: string }>;
  };
  assert.equal(body.ok, true);
  assert.equal(body.item?.publicId, "ME000001");
  assert.equal(body.statusHistory?.length, 1);
  assert.equal(body.statusHistory?.[0]?.status, "IN_PROGRESS");
  assert.equal(body.statusHistory?.[0]?.changedBy, "admin@example.com");
  assert.equal(body.statusHistory?.[0]?.note, "Started work");
});

test("admin maintenance record API: DELETE archives record", async () => {
  let removed = false;
  const response = await handleVehicleMaintenanceRecordDelete(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance/${RECORD_ID}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({ csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID, recordId: RECORD_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      getRecord: async () => maintenanceRow(),
      updateRecord: async () => maintenanceRow(),
      archiveRecord: async () => true,
      removeLinkedBlockout: async () => {
        removed = true;
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(removed, true);
});

test("admin vehicle maintenance export API: returns CSV with expected headers", async () => {
  const response = await handleVehicleMaintenanceExportGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/maintenance/export?view=all`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      authorize: async () => null,
      fetchPage: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            rows: [
              {
                id: RECORD_ID,
                publicId: "ME000123",
                title: "Oil change",
                status: "COMPLETED",
                category: "SERVICE",
                scheduledDate: "2026-03-10",
                serviceDate: "2026-03-10",
                nextDueDate: "2026-05-10",
                totalCostCents: 17480,
                linkedExpenseId: LINKED_EXPENSE_ID,
                linkedRepairOrderId: LINKED_REPAIR_ORDER_ID,
                updatedAt: "2026-03-10T12:00:00.000Z",
              },
            ],
            paging: { total: 1 },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    },
  );

  assert.equal(response.status, 200);
  const csv = await response.text();
  assert.match(
    csv,
    /record_public_id,title,status,category,scheduled_date,service_date,next_due_date,total_cost_jmd/,
  );
  assert.match(csv, /ME000123/);
  assert.match(csv, /Oil change/);
});
