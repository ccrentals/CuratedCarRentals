import assert from "node:assert/strict";
import test from "node:test";

import { mergeUploadcareImageUrls } from "@/components/admin/UploadcareImagesInput";

test("Uploadcare image input appends new vehicle images without replacing existing images", () => {
  assert.deepEqual(
    mergeUploadcareImageUrls(
      ["https://project-files.ucarecd.net/existing/"],
      [
        "https://project-files.ucarecd.net/new-one/",
        "https://project-files.ucarecd.net/new-two/",
      ],
    ),
    [
      "https://project-files.ucarecd.net/existing/",
      "https://project-files.ucarecd.net/new-one/",
      "https://project-files.ucarecd.net/new-two/",
    ],
  );
});

test("Uploadcare image input deduplicates uploads and respects the gallery limit", () => {
  const existing = Array.from(
    { length: 20 },
    (_, index) => `https://project-files.ucarecd.net/image-${index + 1}/`,
  );

  assert.deepEqual(
    mergeUploadcareImageUrls(existing, [
      existing[0],
      "https://project-files.ucarecd.net/image-21/",
    ]),
    existing,
  );
});
