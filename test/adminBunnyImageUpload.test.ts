import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminImageUploadPost } from "@/app/api/admin/uploads/images/route";
import type { BunnyStorageConfig } from "@/lib/uploads/bunny";
import type { RequireAdminApiSessionResult } from "@/lib/auth/adminGuards";

const CONFIG: BunnyStorageConfig = {
  scope: "public",
  storageZone: "ccr-staging-public",
  accessKey: "secret",
  endpoint: "https://ny.storage.bunnycdn.com",
  publicCdnUrl: "https://ccrstagingmedia.b-cdn.net",
};

function authorized(): RequireAdminApiSessionResult {
  return {
    ok: true,
    session: { userId: "00000000-0000-4000-8000-000000000001", role: "OPERATIONS", source: "legacy", issuedAt: 1, expiresAt: 2 },
    actor: { userId: "00000000-0000-4000-8000-000000000001", role: "OPERATIONS", appRole: "OPERATIONS", authSource: "legacy", clerkUserId: null, issuedAt: 1, expiresAt: 2 },
  };
}

function request(files: Array<{ name: string; type: string; contents: string }>) {
  const form = new FormData();
  form.set("csrfToken", "token");
  for (const file of files) form.append("files", new Blob([file.contents], { type: file.type }), file.name);
  return new Request("http://localhost/api/admin/uploads/images", {
    method: "POST",
    headers: { "x-csrf-token": "token" },
    body: form,
  });
}

test("admin Bunny image upload stores validated images using server-only credentials", async () => {
  const uploads: Array<{ key: string; accessKey: string }> = [];
  const response = await handleAdminImageUploadPost(request([{ name: "vehicle.jpg", type: "image/jpeg", contents: "jpg" }]), {
    requireUploadAccess: async () => authorized(),
    requireCsrfCheck: async () => true,
    getProvider: () => "bunny",
    getPublicConfig: () => CONFIG,
    createStorageKey: () => "public/2026-08-08/vehicle.jpg",
    uploadObject: async (config, key) => { uploads.push({ key, accessKey: config.accessKey }); },
    deleteObject: async () => ({ alreadyDeleted: false }),
    buildPublicUrl: (_config, key) => `https://ccrstagingmedia.b-cdn.net/${key}`,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(uploads, [{ key: "public/2026-08-08/vehicle.jpg", accessKey: "secret" }]);
  assert.deepEqual(await response.json(), {
    ok: true,
    items: [{
      url: "https://ccrstagingmedia.b-cdn.net/public/2026-08-08/vehicle.jpg",
      storageKey: "public/2026-08-08/vehicle.jpg",
      storageProvider: "BUNNY_STORAGE",
      originalFileName: "vehicle.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 3,
    }],
  });
});

test("admin Bunny image upload rejects unsupported types before writing to storage", async () => {
  let uploads = 0;
  const response = await handleAdminImageUploadPost(request([{ name: "payload.svg", type: "image/svg+xml", contents: "svg" }]), {
    requireUploadAccess: async () => authorized(),
    requireCsrfCheck: async () => true,
    getProvider: () => "bunny",
    getPublicConfig: () => CONFIG,
    createStorageKey: () => "public/payload.svg",
    uploadObject: async () => { uploads += 1; },
    deleteObject: async () => ({ alreadyDeleted: false }),
    buildPublicUrl: () => "https://ccrstagingmedia.b-cdn.net/public/payload.svg",
  });

  assert.equal(response.status, 400);
  assert.equal(uploads, 0);
  assert.match(String((await response.json()).error), /JPG, PNG, WebP, HEIC, or HEIF/i);
});

test("admin Bunny image upload does not permit Uploadcare mode to write Bunny files", async () => {
  const response = await handleAdminImageUploadPost(request([{ name: "vehicle.jpg", type: "image/jpeg", contents: "jpg" }]), {
    requireUploadAccess: async () => authorized(),
    requireCsrfCheck: async () => true,
    getProvider: () => "uploadcare",
  });

  assert.equal(response.status, 409);
  assert.match(String((await response.json()).error), /not active/i);
});
