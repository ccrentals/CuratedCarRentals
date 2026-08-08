import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBunnyPublicUrl,
  buildBunnyStorageObjectUrl,
  createBunnyStorageKey,
  getBunnyStorageConfig,
  normalizeBunnyStorageKey,
  uploadBunnyStorageObject,
} from "@/lib/uploads/bunny";

const ENV = {
  BUNNY_STORAGE_ENDPOINT: "https://ny.storage.bunnycdn.com",
  BUNNY_STORAGE_PUBLIC_ZONE: "ccr-staging-public",
  BUNNY_STORAGE_PUBLIC_ACCESS_KEY: "public-zone-secret",
  BUNNY_STORAGE_PRIVATE_ZONE: "ccr-staging-private",
  BUNNY_STORAGE_PRIVATE_ACCESS_KEY: "private-zone-secret",
  BUNNY_PUBLIC_CDN_URL: "https://staging-media.example.com",
} as NodeJS.ProcessEnv;

test("Bunny storage: resolves separate public and private zone credentials", () => {
  const publicConfig = getBunnyStorageConfig("public", ENV);
  const privateConfig = getBunnyStorageConfig("private", ENV);

  assert.equal(publicConfig.storageZone, "ccr-staging-public");
  assert.equal(publicConfig.publicCdnUrl, "https://staging-media.example.com");
  assert.equal(privateConfig.storageZone, "ccr-staging-private");
  assert.equal(privateConfig.publicCdnUrl, null);
});

test("Bunny storage: builds encoded API and public URLs without exposing private scopes", () => {
  const publicConfig = getBunnyStorageConfig("public", ENV);
  const privateConfig = getBunnyStorageConfig("private", ENV);
  const key = "public/2026-08-08/vehicle image.jpg";

  assert.equal(
    buildBunnyStorageObjectUrl(publicConfig, key),
    "https://ny.storage.bunnycdn.com/ccr-staging-public/public/2026-08-08/vehicle%20image.jpg",
  );
  assert.equal(
    buildBunnyPublicUrl(publicConfig, key),
    "https://staging-media.example.com/public/2026-08-08/vehicle%20image.jpg",
  );
  assert.throws(() => buildBunnyPublicUrl(privateConfig, "private/file.jpg"), /public Bunny CDN/i);
});

test("Bunny storage: prevents traversal and sends access keys only to Bunny Storage", async () => {
  assert.throws(() => normalizeBunnyStorageKey("../private/file.jpg"), /invalid Bunny storage key/i);
  const config = getBunnyStorageConfig("public", ENV);
  let receivedUrl = "";
  let accessKey = "";

  await uploadBunnyStorageObject(config, "public/a.jpg", new Blob(["image"]), {
    fetchFn: async (input, init) => {
      receivedUrl = String(input);
      accessKey = new Headers(init?.headers).get("AccessKey") ?? "";
      return new Response(null, { status: 201 });
    },
  });

  assert.equal(receivedUrl, "https://ny.storage.bunnycdn.com/ccr-staging-public/public/a.jpg");
  assert.equal(accessKey, "public-zone-secret");
});

test("Bunny storage: creates deterministic, scoped object keys when given a migration id", () => {
  assert.equal(
    createBunnyStorageKey({
      scope: "private",
      fileName: "Damian's licence.png",
      now: new Date("2026-08-08T12:00:00.000Z"),
      id: "migration-1",
    }),
    "private/2026-08-08/migration-1-Damian-s-licence.png",
  );
});
