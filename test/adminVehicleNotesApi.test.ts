import assert from "node:assert/strict";
import test from "node:test";

import {
  handleAdminVehicleNotesGet,
  handleAdminVehicleNotesPost,
} from "@/app/api/admin/vehicles/[id]/notes/route";
import { handleAdminVehicleNoteDelete } from "@/app/api/admin/vehicles/[id]/notes/[noteId]/route";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "22222222-2222-4222-8222-222222222222";

function adminSession() {
  return {
    userId: "admin-user-id",
    role: "ADMIN",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

test("admin vehicle notes API: GET requires auth", async () => {
  const response = await handleAdminVehicleNotesGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/notes`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => null,
      requireCsrfCheck: async () => true,
      listNotes: async () => [],
      createNote: async () => {
        throw new Error("unreachable");
      },
    },
  );

  assert.equal(response.status, 401);
});

test("admin vehicle notes API: add/list/delete lifecycle", async () => {
  let rows: Array<{
    id: string;
    vehicle_id: string;
    note_text: string;
    created_by_user_id: string | null;
    created_by_email: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  }> = [];

  const postResponse = await handleAdminVehicleNotesPost(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/notes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({ noteText: "First note", csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      listNotes: async () => rows,
      createNote: async (_vehicleId, input) => {
        const next = {
          id: NOTE_ID,
          vehicle_id: VEHICLE_ID,
          note_text: input.noteText,
          created_by_user_id: "admin-user-id",
          created_by_email: "admin@example.com",
          created_at: "2026-02-24T10:00:00.000Z",
          updated_at: "2026-02-24T10:00:00.000Z",
          deleted_at: null,
        };
        rows = [next, ...rows];
        return next;
      },
    },
  );

  assert.equal(postResponse.status, 200);

  const listResponse = await handleAdminVehicleNotesGet(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/notes`),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      listNotes: async () => rows.filter((row) => row.deleted_at === null),
      createNote: async () => {
        throw new Error("unreachable");
      },
    },
  );

  assert.equal(listResponse.status, 200);
  const listPayload = (await listResponse.json()) as {
    ok?: boolean;
    items?: Array<{ id: string; noteText: string }>;
  };
  assert.equal(listPayload.ok, true);
  assert.equal(listPayload.items?.length, 1);
  assert.equal(listPayload.items?.[0]?.id, NOTE_ID);
  assert.equal(listPayload.items?.[0]?.noteText, "First note");

  const deleteResponse = await handleAdminVehicleNoteDelete(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}/notes/${NOTE_ID}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": "token",
      },
      body: JSON.stringify({ csrfToken: "token" }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID, noteId: NOTE_ID }) },
    {
      getSession: async () => adminSession(),
      requireCsrfCheck: async () => true,
      softDeleteNote: async (_vehicleId, noteId) => {
        const target = rows.find((row) => row.id === noteId);
        if (!target) return false;
        target.deleted_at = "2026-02-24T11:00:00.000Z";
        target.updated_at = "2026-02-24T11:00:00.000Z";
        return true;
      },
    },
  );

  assert.equal(deleteResponse.status, 200);
  assert.equal(rows.filter((row) => row.deleted_at === null).length, 0);
});
