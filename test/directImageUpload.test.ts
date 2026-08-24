import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createDirectUploadToken,
  evaluateDirectImageEligibility,
  formatBytes,
  hashDirectUploadToken,
  MAX_DIRECT_IMAGE_BYTES,
  MAX_DIRECT_IMAGES_PER_SELECTION,
  normalizeSha256,
  uploadScopeForPurpose,
} from "@/lib/uploads/directUpload";

test("direct image eligibility accepts supported images through 50 MB", () => {
  assert.deepEqual(
    evaluateDirectImageEligibility({ size: MAX_DIRECT_IMAGE_BYTES, mimeType: "image/jpeg" }),
    { eligible: true, message: "Ready for direct upload." },
  );
  assert.equal(
    evaluateDirectImageEligibility({ size: MAX_DIRECT_IMAGE_BYTES + 1, mimeType: "image/jpeg" })
      .eligible,
    false,
  );
  assert.equal(evaluateDirectImageEligibility({ size: 10, mimeType: "application/pdf" }).eligible, false);
  assert.equal(evaluateDirectImageEligibility({ size: 0, mimeType: "image/png" }).eligible, false);
});

test("direct upload tokens are random and stored only as hashes", () => {
  const first = createDirectUploadToken();
  const second = createDirectUploadToken();
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.tokenHash, second.tokenHash);
  assert.equal(first.tokenHash, hashDirectUploadToken(first.token));
  assert.match(first.tokenHash, /^[a-f0-9]{64}$/);
});

test("direct upload helpers normalize checksums and isolate storage scopes", () => {
  const checksum = "a".repeat(64);
  assert.equal(normalizeSha256(checksum), checksum.toUpperCase());
  assert.equal(normalizeSha256("invalid"), null);
  assert.equal(uploadScopeForPurpose("VEHICLE_GALLERY"), "public");
  assert.equal(uploadScopeForPurpose("LANDING_CONTENT"), "public");
  assert.equal(uploadScopeForPurpose("CUSTOMER_LEGAL_ID"), "private");
  assert.equal(uploadScopeForPurpose("INSPECTION_IMAGE"), "private");
  assert.equal(formatBytes(MAX_DIRECT_IMAGE_BYTES), "50 MB");
  assert.equal(MAX_DIRECT_IMAGES_PER_SELECTION, 20);
});

test("gateway enforces exact origin, authorized metadata, raster signatures, and failure cleanup", async () => {
  const source = await readFile("bunny/edge-upload-gateway/index.ts", "utf8");
  assert.match(source, /allowed\.includes\(origin\)/);
  assert.doesNotMatch(source, /access-control-allow-origin["']?\s*:\s*["']\*["']/i);
  assert.match(source, /contentLength !== claim\.expectedBytes/);
  assert.match(source, /imageSignatureMatches\(signaturePrefix, claim\.mimeType\)/);
  assert.match(source, /Checksum: claim\.checksum/);
  assert.match(source, /Image storage authentication is misconfigured/);
  assert.match(source, /Bunny Storage rejected the upload with HTTP/);
  assert.match(source, /event: "direct_upload_failed"/);
  assert.match(source, /method: "DELETE"/);
});

test("authorization keeps public content admin-only while Operations retains private workflows", async () => {
  const source = await readFile("src/app/api/admin/uploads/direct/authorize/route.ts", "utf8");
  assert.match(source, /requireOperationsAccess\(\)/);
  assert.match(source, /purpose === "LANDING_CONTENT" \|\| purpose === "VEHICLE_GALLERY"/);
  assert.match(source, /hasRequiredAdminAccess\(auth\.actor\.role, "admin"\)/);
  assert.match(source, /requireCsrf/);
  assert.match(source, /A valid image checksum is required/);
});

test("database enforces the same 50 MiB ceiling and isolated upload states", async () => {
  const source = await readFile("migrations/051_direct_image_upload_sessions.sql", "utf8");
  assert.match(source, /expected_bytes > 0 and expected_bytes <= 52428800/);
  assert.match(source, /checksum_sha256 text not null/);
  assert.match(source, /storage_scope in \('public', 'private'\)/);
  assert.match(source, /status in \('AUTHORIZED', 'UPLOADING', 'UPLOADED', 'FINALIZED', 'FAILED', 'CLEANUP_PENDING', 'EXPIRED'\)/);
});
