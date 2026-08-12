import assert from "node:assert/strict";
import test from "node:test";

import { validateRasterImageFile } from "@/lib/uploads/rasterImageValidation";

function file(bytes: number[], type: string) {
  return new Blob([new Uint8Array(bytes)], { type });
}

test("raster image validation accepts supported matching signatures", async () => {
  assert.equal(await validateRasterImageFile(file([0xff, 0xd8, 0xff, 0xe0], "image/jpeg")), null);
  assert.equal(await validateRasterImageFile(file([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image/png")), null);
  assert.equal(await validateRasterImageFile(file([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], "image/webp")), null);
  assert.equal(await validateRasterImageFile(file([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], "image/heic")), null);
});

test("raster image validation rejects unknown bytes and mismatched MIME labels", async () => {
  assert.match(String(await validateRasterImageFile(file([0x3c, 0x73, 0x76, 0x67], "image/jpeg"))), /not a recognized/i);
  assert.match(String(await validateRasterImageFile(file([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image/jpeg"))), /do not match/i);
  assert.match(String(await validateRasterImageFile(file([0xff, 0xd8, 0xff], "image/svg+xml"))), /Choose a JPG/i);
});
