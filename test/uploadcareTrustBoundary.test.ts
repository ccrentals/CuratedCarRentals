import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUploadcareCdnUrl,
  createUploadcareSignedUploadCredentials,
  extractUploadcareDeliveryUrl,
  extractUploadcareFileId,
  getUploadcareFileMetadata,
  normalizeUploadcareDeliveryUrl,
  resolveUploadcareCdnUrl,
  validateUploadcareFiles,
} from "@/lib/uploads/uploadcare";

const FILE_ID = "7f6b5a4a-84f9-4e57-8be4-7b4b2cbf76ad";

test("uploadcare helper: creates deterministic short-lived signed upload credentials", () => {
  const credentials = createUploadcareSignedUploadCredentials({
    publicKey: "public-key",
    secretKey: "secret-key",
    now: new Date("2026-06-06T12:00:00.000Z"),
    lifetimeSeconds: 600,
  });

  assert.deepEqual(credentials, {
    publicKey: "public-key",
    secureExpire: "1780747800",
    secureSignature: "98899c876c0ecdf6a0dc210ee1a17f3dd795f048b92736a721ed9327c9f40c9f",
  });
});

test("uploadcare helper: refuses to sign without both project keys", () => {
  assert.throws(
    () =>
      createUploadcareSignedUploadCredentials({
        publicKey: "public-key",
        secretKey: "",
      }),
    /signed uploads are not configured/i,
  );
});

test("uploadcare helper: verifies file ownership and metadata with server credentials", async () => {
  let requestHeaders: Headers | null = null;
  const metadata = await getUploadcareFileMetadata(FILE_ID, {
    publicKey: "public-key",
    secretKey: "secret-key",
    fetchFn: async (_input, init) => {
      requestHeaders = new Headers(init?.headers);
      return new Response(
        JSON.stringify({
          uuid: FILE_ID,
          size: 12345,
          mime_type: "image/jpeg",
          is_image: true,
          is_ready: true,
          datetime_stored: "2026-06-06T12:00:00.000Z",
          datetime_removed: null,
          original_filename: "vehicle.jpg",
          original_file_url: `https://project-files.ucarecd.net/${FILE_ID}/`,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  assert.equal(requestHeaders?.get("Authorization"), "Uploadcare.Simple public-key:secret-key");
  assert.equal(metadata.uuid, FILE_ID);
  assert.equal(metadata.isStored, true);
  assert.equal(metadata.originalFilename, "vehicle.jpg");
  assert.equal(metadata.originalFileUrl, `https://project-files.ucarecd.net/${FILE_ID}/`);
});

test("uploadcare helper: treats missing project files as foreign or invalid references", async () => {
  await assert.rejects(
    () =>
      getUploadcareFileMetadata(FILE_ID, {
        publicKey: "public-key",
        secretKey: "secret-key",
        fetchFn: async () => new Response(JSON.stringify({ detail: "Not found" }), { status: 404 }),
      }),
    /not found in this Uploadcare project/i,
  );
});

test("uploadcare helper: enforces image type, size, readiness, and permanent storage", async () => {
  const basePayload = {
    uuid: FILE_ID,
    size: 1024,
    mime_type: "image/jpeg",
    is_image: true,
    is_ready: true,
    datetime_stored: "2026-06-06T12:00:00.000Z",
    datetime_removed: null,
  };
  const validatePayload = (payload: Record<string, unknown>) =>
    validateUploadcareFiles(
      [FILE_ID],
      {
        label: "Vehicle gallery",
        maxCount: 20,
        maxBytes: 10 * 1024 * 1024,
        imagesOnly: true,
        allowedMimeTypes: ["image/jpeg", "image/png"],
      },
      {
        publicKey: "public-key",
        secretKey: "secret-key",
        fetchFn: async () =>
          new Response(JSON.stringify({ ...basePayload, ...payload }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      },
    );

  await assert.rejects(
    () => validatePayload({ size: 11 * 1024 * 1024 }),
    /10 MB or smaller/i,
  );
  await assert.rejects(
    () => validatePayload({ mime_type: "image/svg+xml" }),
    /does not support/i,
  );
  await assert.rejects(
    () => validatePayload({ is_ready: false }),
    /not ready/i,
  );
  await assert.rejects(
    () => validatePayload({ datetime_stored: null }),
    /not stored permanently/i,
  );
});

test("uploadcare helper: rejects duplicate uploads before provider lookup", async () => {
  await assert.rejects(
    () =>
      validateUploadcareFiles(
        [FILE_ID, FILE_ID],
        {
          label: "Inspection image",
          maxCount: 20,
          maxBytes: 10 * 1024 * 1024,
          imagesOnly: true,
        },
        {
          publicKey: "public-key",
          secretKey: "secret-key",
          fetchFn: async () => {
            throw new Error("Provider lookup should not run");
          },
        },
      ),
    /duplicate/i,
  );
});

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

test("uploadcare helper: preserves a verified direct delivery URL over a configured fallback", () => {
  const previous = process.env.UPLOADCARE_CDN_BASE_URL;
  process.env.UPLOADCARE_CDN_BASE_URL = "https://project-files.ucarecd.net";

  try {
    assert.equal(
      normalizeUploadcareDeliveryUrl(`https://ucarecdn.com/${FILE_ID}/`),
      `https://ucarecdn.com/${FILE_ID}/`,
    );
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
