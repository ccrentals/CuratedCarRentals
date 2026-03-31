import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUploadcareCdnUrl,
  extractUploadcareDeliveryUrl,
  extractUploadcareFileId,
  resolveUploadcareCdnUrl,
} from "@/lib/uploads/uploadcare";

const FILE_ID = "7f6b5a4a-84f9-4e57-8be4-7b4b2cbf76ad";

test("uploadcare helper: accepts real Uploadcare delivery URLs and extracts opaque ids", () => {
  const signedUrl = `https://ucarecdn.com/${FILE_ID}/-/preview/?token=test-token`;

  assert.equal(extractUploadcareDeliveryUrl(signedUrl), signedUrl);
  assert.equal(extractUploadcareFileId(signedUrl), FILE_ID);
});

test("uploadcare helper: rejects arbitrary external hosts with UUID-looking paths", () => {
  assert.equal(extractUploadcareDeliveryUrl(`https://attacker.example/${FILE_ID}/`), null);
  assert.equal(extractUploadcareDeliveryUrl(`https://evilucarecdn.com/${FILE_ID}/`), null);
  assert.equal(extractUploadcareFileId(`https://attacker.example/${FILE_ID}/`), null);
  assert.equal(extractUploadcareFileId(`https://evilucarecdn.com/${FILE_ID}/`), null);
});

test("uploadcare helper: buildUploadcareCdnUrl ignores untrusted CDN base hosts", () => {
  const previous = process.env.UPLOADCARE_CDN_BASE_URL;
  process.env.UPLOADCARE_CDN_BASE_URL = "https://attacker.example";

  try {
    assert.equal(buildUploadcareCdnUrl(FILE_ID), `https://ucarecdn.com/${FILE_ID}/`);
  } finally {
    if (previous === undefined) {
      delete process.env.UPLOADCARE_CDN_BASE_URL;
    } else {
      process.env.UPLOADCARE_CDN_BASE_URL = previous;
    }
  }
});

test("uploadcare helper: resolveUploadcareCdnUrl discovers a trusted project subdomain", async () => {
  const previous = process.env.UPLOADCARE_CDN_BASE_URL;
  delete process.env.UPLOADCARE_CDN_BASE_URL;

  try {
    const url = await resolveUploadcareCdnUrl(FILE_ID, {
      publicKey: "public-key",
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            cdn_url: "https://project-files.ucarecd.net/test-group~1/",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    });

    assert.equal(url, `https://project-files.ucarecd.net/${FILE_ID}/`);
  } finally {
    if (previous === undefined) {
      delete process.env.UPLOADCARE_CDN_BASE_URL;
    } else {
      process.env.UPLOADCARE_CDN_BASE_URL = previous;
    }
  }
});
