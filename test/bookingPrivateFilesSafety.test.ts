import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  parseSafePrivateBookingImageDataUrl,
  resolveSafePrivateBookingResponseMimeType,
  sanitizePrivateBookingFileName,
} from "@/lib/bookings/privateFiles";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

test("booking private-file helper: only safe image data URLs are accepted", () => {
  const parsed = parseSafePrivateBookingImageDataUrl("data:image/png;base64,ZmFrZQ==");
  assert.equal(parsed?.mimeType, "image/png");
  assert.match(parsed?.normalizedDataUrl ?? "", /^data:image\/png;base64,/);

  assert.equal(
    parseSafePrivateBookingImageDataUrl(
      "data:text/html;base64,PGgxPk5vdCBhbiBzYWZlIGltYWdlPC9oMT4=",
    ),
    null,
  );
});

test("booking private-file helper: response MIME resolution rejects unsafe or mismatched content", () => {
  assert.equal(resolveSafePrivateBookingResponseMimeType("image/*", "image/jpeg"), "image/jpeg");
  assert.equal(resolveSafePrivateBookingResponseMimeType("image/png", "image/png"), "image/png");
  assert.equal(resolveSafePrivateBookingResponseMimeType("image/png", "image/jpeg"), null);
  assert.equal(resolveSafePrivateBookingResponseMimeType("image/*", "text/html"), null);
  assert.equal(resolveSafePrivateBookingResponseMimeType("text/html", "text/html"), null);
});

test("booking private-file helper: filename sanitization strips unsafe characters", () => {
  assert.equal(
    sanitizePrivateBookingFileName("SIGNATURE", "bad name\r\n\".png", "image/png"),
    "bad_name_.png",
  );
  assert.equal(
    sanitizePrivateBookingFileName("DRIVERS_LICENSE", null, "image/jpeg"),
    "drivers_license.jpg",
  );
});

test("booking private-file routes and agreement loader use shared safe-image helpers", () => {
  const files = [
    "src/app/api/public/bookings/[id]/private-files/[documentType]/route.ts",
    "src/app/admin/(protected)/bookings/[id]/private-files/[documentType]/route.ts",
    "src/lib/agreements/rentalAgreementPayload.ts",
  ];

  for (const file of files) {
    const code = read(file);
    assert.match(code, /privateFiles/);
  }
});
