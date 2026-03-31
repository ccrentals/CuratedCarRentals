import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminVehiclePost } from "@/app/api/admin/vehicles/route";
import { handleAdminVehiclePatch } from "@/app/api/admin/vehicles/[id]/route";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";

function authorizedActor() {
  return {
    ok: true as const,
    actor: {
      userId: "admin-user-id",
      appRole: "ADMIN",
    },
  };
}

test("admin vehicle create API defaults vehicles to private and stores gallery metadata", async () => {
  let storedFeatures: Record<string, unknown> | null = null;

  const response = await handleAdminVehiclePost(
    new Request("http://localhost/api/admin/vehicles", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({
        make: "Subaru",
        model: "Impreza Sport",
        year: 2018,
        daily_rate_jmd: 7200,
        deposit_jmd: 7000,
        image_urls_json: ["https://ucarecdn.com/11111111-1111-4111-8111-111111111111/"],
        csrfToken: "token",
      }),
    }),
    {
      authorize: async () => authorizedActor(),
      requireCsrfCheck: async () => true,
      connect: async () =>
        ({
          async query(text: string, values?: unknown[]) {
            if (text === "begin" || text === "commit" || text === "rollback") {
              return { rows: [] };
            }
            if (text.startsWith("insert into vehicles")) {
              return {
                rows: [
                  {
                    id: VEHICLE_ID,
                    public_id: "VE000123",
                    make: "Subaru",
                    model: "Impreza Sport",
                    year: 2018,
                    seat_count: 5,
                    daily_rate_cents: 7200,
                    deposit_cents: 7000,
                    status: "AVAILABLE",
                    created_at: "2026-03-29T00:00:00.000Z",
                  },
                ],
              };
            }
            if (text.startsWith("update vehicles set features_json")) {
              storedFeatures = JSON.parse(String(values?.[0] ?? "{}")) as Record<string, unknown>;
              return { rows: [] };
            }
            throw new Error(`Unexpected query: ${text}`);
          },
          release() {},
        }),
    },
  );

  assert.equal(response.status, 201);
  assert.equal(storedFeatures?.public_visible, false);
  assert.deepEqual(storedFeatures?.gallery_images, [
    {
      name: "VE000123-subaru-impreza-sport-gallery-01",
      uploadcareFileId: "11111111-1111-4111-8111-111111111111",
      url: "https://ucarecdn.com/11111111-1111-4111-8111-111111111111/",
      position: 1,
    },
  ]);
});

test("admin vehicle patch API toggles public visibility and refreshes gallery metadata", async () => {
  let updatedFeatures: Record<string, unknown> | null = null;

  const response = await handleAdminVehiclePatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({
        public_visible: true,
        image_urls_json: ["https://ucarecdn.com/22222222-2222-4222-8222-222222222222/"],
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      authorize: async () => authorizedActor(),
      requireCsrfCheck: async () => true,
      connect: async () =>
        ({
          async query(text: string, values?: unknown[]) {
            if (text === "begin" || text === "commit" || text === "rollback") {
              return { rows: [] };
            }
            if (text.includes("from vehicles where id = $1::uuid for update")) {
              return {
                rowCount: 1,
                rows: [
                  {
                    id: VEHICLE_ID,
                    public_id: "VE000222",
                    make: "Subaru",
                    model: "Impreza Sport",
                    year: 2018,
                    features_json: {
                      slug: "subaru-impreza-sport",
                      public_visible: false,
                      gallery_images: [],
                    },
                    image_urls_json: [],
                  },
                ],
              };
            }
            if (text.startsWith("update vehicles set")) {
              const maybeFeatures = values?.find(
                (value) => typeof value === "string" && String(value).includes("gallery_images"),
              );
              updatedFeatures = JSON.parse(String(maybeFeatures ?? "{}")) as Record<string, unknown>;
              return {
                rows: [
                  {
                    id: VEHICLE_ID,
                    public_id: "VE000222",
                    make: "Subaru",
                    model: "Impreza Sport",
                    year: 2018,
                    seat_count: 5,
                    daily_rate_cents: 7200,
                    deposit_cents: 7000,
                    status: "AVAILABLE",
                  },
                ],
              };
            }
            throw new Error(`Unexpected query: ${text}`);
          },
          release() {},
        }),
      writeAudit: async () => undefined,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(updatedFeatures?.public_visible, true);
  assert.deepEqual(updatedFeatures?.gallery_images, [
    {
      name: "VE000222-subaru-impreza-sport-gallery-01",
      uploadcareFileId: "22222222-2222-4222-8222-222222222222",
      url: "https://ucarecdn.com/22222222-2222-4222-8222-222222222222/",
      position: 1,
    },
  ]);
});

test("admin vehicle patch API maps unavailable to UNAVAILABLE", async () => {
  let storedStatus: unknown = null;

  const response = await handleAdminVehiclePatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({
        status: "unavailable",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      authorize: async () => authorizedActor(),
      requireCsrfCheck: async () => true,
      connect: async () =>
        ({
          async query(text: string, values?: unknown[]) {
            if (text === "begin" || text === "commit" || text === "rollback") {
              return { rows: [] };
            }
            if (text.includes("from vehicles where id = $1::uuid for update")) {
              return {
                rowCount: 1,
                rows: [
                  {
                    id: VEHICLE_ID,
                    public_id: "VE000222",
                    make: "Subaru",
                    model: "Impreza Sport",
                    year: 2018,
                    features_json: {
                      slug: "subaru-impreza-sport",
                      public_visible: true,
                      gallery_images: [],
                    },
                    image_urls_json: [],
                  },
                ],
              };
            }
            if (text.startsWith("update vehicles set")) {
              storedStatus = values?.[0];
              return {
                rows: [
                  {
                    id: VEHICLE_ID,
                    public_id: "VE000222",
                    make: "Subaru",
                    model: "Impreza Sport",
                    year: 2018,
                    seat_count: 5,
                    daily_rate_cents: 7200,
                    deposit_cents: 7000,
                    status: "UNAVAILABLE",
                  },
                ],
              };
            }
            throw new Error(`Unexpected query: ${text}`);
          },
          release() {},
        }),
      writeAudit: async () => undefined,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(storedStatus, "UNAVAILABLE");
});

test("admin vehicle patch API still succeeds when post-commit audit logging fails", async () => {
  const response = await handleAdminVehiclePatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({
        status: "available",
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      authorize: async () => authorizedActor(),
      requireCsrfCheck: async () => true,
      connect: async () =>
        ({
          async query(text: string) {
            if (text === "begin" || text === "commit" || text === "rollback") {
              return { rows: [] };
            }
            if (text.includes("from vehicles where id = $1::uuid for update")) {
              return {
                rowCount: 1,
                rows: [
                  {
                    id: VEHICLE_ID,
                    public_id: "VE000222",
                    make: "Subaru",
                    model: "Impreza Sport",
                    year: 2018,
                    features_json: {
                      slug: "subaru-impreza-sport",
                      public_visible: true,
                      gallery_images: [],
                    },
                    image_urls_json: [],
                  },
                ],
              };
            }
            if (text.startsWith("update vehicles set")) {
              return {
                rows: [
                  {
                    id: VEHICLE_ID,
                    public_id: "VE000222",
                    make: "Subaru",
                    model: "Impreza Sport",
                    year: 2018,
                    seat_count: 5,
                    daily_rate_cents: 7200,
                    deposit_cents: 7000,
                    status: "AVAILABLE",
                  },
                ],
              };
            }
            throw new Error(`Unexpected query: ${text}`);
          },
          release() {},
        }),
      writeAudit: async () => {
        throw new Error("audit unavailable");
      },
    },
  );

  assert.equal(response.status, 200);
});
