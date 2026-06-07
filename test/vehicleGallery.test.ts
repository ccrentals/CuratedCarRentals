import assert from "node:assert/strict";
import test from "node:test";

import { buildVehicleGalleryEntries } from "@/lib/vehicles/gallery";

test("vehicle gallery entries derive Uploadcare ownership metadata and sequential gallery names", () => {
  const entries = buildVehicleGalleryEntries({
    imageUrls: [
      "https://ucarecdn.com/11111111-1111-4111-8111-111111111111/",
      "https://ucarecdn.com/22222222-2222-4222-8222-222222222222/",
    ],
    vehiclePublicId: "VE000321",
    slug: "nissan-x-trail",
  });

  assert.deepEqual(entries, [
    {
      name: "VE000321-nissan-x-trail-gallery-01",
      uploadcareFileId: "11111111-1111-4111-8111-111111111111",
      url: "https://ucarecdn.com/11111111-1111-4111-8111-111111111111/",
      position: 1,
      isPrimary: true,
    },
    {
      name: "VE000321-nissan-x-trail-gallery-02",
      uploadcareFileId: "22222222-2222-4222-8222-222222222222",
      url: "https://ucarecdn.com/22222222-2222-4222-8222-222222222222/",
      position: 2,
      isPrimary: false,
    },
  ]);
});
