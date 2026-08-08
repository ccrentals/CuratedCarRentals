import assert from "node:assert/strict";
import test from "node:test";

import { validateVehicleGalleryFiles } from "@/lib/uploads/vehicleGallery";

const POLICY = {
  label: "Vehicle gallery",
  maxCount: 20,
  maxBytes: 10 * 1024 * 1024,
  imagesOnly: true,
  allowedMimeTypes: ["image/jpeg"],
} as const;

test("vehicle gallery validation accepts configured Bunny public CDN objects", async () => {
  const previous = process.env.BUNNY_PUBLIC_CDN_URL;
  process.env.BUNNY_PUBLIC_CDN_URL = "https://ccrstagingmedia.b-cdn.net";
  try {
    const result = await validateVehicleGalleryFiles(
      ["https://ccrstagingmedia.b-cdn.net/public/2026-08-08/example.jpg"],
      POLICY,
    );
    assert.deepEqual(result, []);
  } finally {
    if (previous === undefined) delete process.env.BUNNY_PUBLIC_CDN_URL;
    else process.env.BUNNY_PUBLIC_CDN_URL = previous;
  }
});

test("vehicle gallery validation rejects Bunny URLs outside the public namespace", async () => {
  const previous = process.env.BUNNY_PUBLIC_CDN_URL;
  process.env.BUNNY_PUBLIC_CDN_URL = "https://ccrstagingmedia.b-cdn.net";
  try {
    await assert.rejects(
      () => validateVehicleGalleryFiles(["https://ccrstagingmedia.b-cdn.net/private/secret.jpg"], POLICY),
      /invalid vehicle gallery upload reference/i,
    );
  } finally {
    if (previous === undefined) delete process.env.BUNNY_PUBLIC_CDN_URL;
    else process.env.BUNNY_PUBLIC_CDN_URL = previous;
  }
});
