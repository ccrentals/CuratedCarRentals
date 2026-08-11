import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminVehiclePost } from "@/app/api/admin/vehicles/implementation";
import { handleAdminVehiclePatch } from "@/app/api/admin/vehicles/[id]/implementation";
import { UploadcareFileValidationError } from "@/lib/uploads/uploadcare";

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
      isPrimary: true,
    },
  ]);
});

test("admin vehicle create API rejects gallery files that fail Uploadcare verification", async () => {
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
      consumeRateLimitCheck: async () => allowRateLimit(),
      validateUploads: async () => {
        throw new UploadcareFileValidationError(
          "The uploaded file was not found in this Uploadcare project.",
        );
      },
      connect: async () => {
        throw new Error("Database should not be reached");
      },
    },
  );

  assert.equal(response.status, 400);
  const body = (await response.json()) as { error?: string };
  assert.match(body.error ?? "", /not found in this Uploadcare project/i);
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
      isPrimary: true,
    },
  ]);
});

test("admin vehicle patch API updates a deposit without revalidating an unchanged legacy image", async () => {
  const legacyFileId = "33333333-3333-4333-8333-333333333333";
  const legacyImageUrl = `https://legacy-project.ucarecd.net/${legacyFileId}/`;
  let trustedFileIds: string[] = [];

  const response = await handleAdminVehiclePatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({
        deposit_jmd: 3800,
        image_urls_json: [legacyImageUrl],
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      authorize: async () => authorizedActor(),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => allowRateLimit(),
      validateUploads: async (_references, _policy, options) => {
        trustedFileIds = [...(options.trustedExistingFileIds ?? [])];
        return [];
      },
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
                    public_id: "VE000005",
                    make: "BMW",
                    model: "2 Series Active Tourer",
                    year: 2018,
                    features_json: { gallery_images: [] },
                    image_urls_json: [legacyImageUrl],
                  },
                ],
              };
            }
            if (text.startsWith("update vehicles set")) {
              assert.equal(values?.[0], 3800);
              return {
                rows: [
                  {
                    id: VEHICLE_ID,
                    public_id: "VE000005",
                    make: "BMW",
                    model: "2 Series Active Tourer",
                    year: 2018,
                    seat_count: 5,
                    daily_rate_cents: 9400,
                    deposit_cents: 3800,
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
  assert.deepEqual(trustedFileIds, [legacyFileId]);
  const payload = (await response.json()) as { vehicle?: { deposit_cents?: number } };
  assert.equal(payload.vehicle?.deposit_cents, 3800);
});

test("admin vehicle patch API still rejects a newly added foreign-project image", async () => {
  const legacyFileId = "33333333-3333-4333-8333-333333333333";
  const newFileId = "44444444-4444-4444-8444-444444444444";
  const legacyImageUrl = `https://legacy-project.ucarecd.net/${legacyFileId}/`;
  const newImageUrl = `https://ucarecdn.com/${newFileId}/`;
  let rolledBack = false;

  const response = await handleAdminVehiclePatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({
        image_urls_json: [legacyImageUrl, newImageUrl],
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      authorize: async () => authorizedActor(),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => allowRateLimit(),
      validateUploads: async (references, _policy, options) => {
        assert.deepEqual(references, [legacyImageUrl, newImageUrl]);
        assert.deepEqual([...(options.trustedExistingFileIds ?? [])], [legacyFileId]);
        throw new UploadcareFileValidationError(
          "The uploaded file was not found in this Uploadcare project.",
        );
      },
      connect: async () =>
        ({
          async query(text: string) {
            if (text === "begin" || text === "commit") return { rows: [] };
            if (text === "rollback") {
              rolledBack = true;
              return { rows: [] };
            }
            if (text.includes("from vehicles where id = $1::uuid for update")) {
              return {
                rowCount: 1,
                rows: [
                  {
                    id: VEHICLE_ID,
                    public_id: "VE000005",
                    make: "BMW",
                    model: "2 Series Active Tourer",
                    year: 2018,
                    features_json: { gallery_images: [] },
                    image_urls_json: [legacyImageUrl],
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

  assert.equal(response.status, 400);
  assert.equal(rolledBack, true);
  const payload = (await response.json()) as { error?: string };
  assert.match(payload.error ?? "", /not found in this Uploadcare project/i);
});

test("admin vehicle patch API deletes an orphaned Uploadcare gallery file after save", async () => {
  const removedFileId = "33333333-3333-4333-8333-333333333333";
  let deletedFileId = "";

  const response = await handleAdminVehiclePatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({
        image_urls_json: [],
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      authorize: async () => authorizedActor(),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => allowRateLimit(),
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
                      gallery_images: [],
                    },
                    image_urls_json: [`https://ucarecdn.com/${removedFileId}/`],
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
      writeAudit: async () => undefined,
      countActiveFileReferences: async () => 0,
      deleteFile: async (fileId) => {
        deletedFileId = fileId;
        return { fileId, alreadyDeleted: false };
      },
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    galleryCleanup?: { deletedCount?: number };
  };
  assert.equal(body.galleryCleanup?.deletedCount, 1);
  assert.equal(deletedFileId, removedFileId);
});

test("admin vehicle patch API updates title fields used by public vehicle displays", async () => {
  let updateValues: unknown[] = [];
  let auditFields: unknown[] = [];

  const response = await handleAdminVehiclePatch(
    new Request(`http://localhost/api/admin/vehicles/${VEHICLE_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({
        make: "Nissan",
        model: "X-Trail",
        year: 2020,
        csrfToken: "token",
      }),
    }),
    { params: Promise.resolve({ id: VEHICLE_ID }) },
    {
      authorize: async () => authorizedActor(),
      requireCsrfCheck: async () => true,
      consumeRateLimitCheck: async () => allowRateLimit(),
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
                    make: "Nissan",
                    model: "X-Trail",
                    year: 2018,
                    features_json: {
                      name: "Nissan X-Trail",
                      slug: "nissan-x-trail",
                      public_visible: true,
                      gallery_images: [],
                    },
                    image_urls_json: [],
                  },
                ],
              };
            }
            if (text.startsWith("update vehicles set")) {
              updateValues = values ?? [];
              return {
                rows: [
                  {
                    id: VEHICLE_ID,
                    public_id: "VE000222",
                    make: "Nissan",
                    model: "X-Trail",
                    year: 2020,
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
      writeAudit: async (input) => {
        auditFields = Array.isArray(input.details?.fields) ? input.details.fields : [];
      },
    },
  );

  const payload = (await response.json()) as { vehicle?: { make?: string; model?: string; year?: number } };
  assert.equal(response.status, 200);
  assert.deepEqual(payload.vehicle, {
    id: VEHICLE_ID,
    public_id: "VE000222",
    make: "Nissan",
    model: "X-Trail",
    year: 2020,
    seat_count: 5,
    daily_rate_cents: 7200,
    deposit_cents: 7000,
    status: "AVAILABLE",
  });
  assert.equal(updateValues[0], "Nissan");
  assert.equal(updateValues[1], "X-Trail");
  assert.equal(updateValues[2], 2020);
  assert.deepEqual(auditFields, ["make", "model", "year"]);
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
