import assert from "node:assert/strict";
import test from "node:test";

import {
  getConfiguredBunnyPublicCdn,
  getConfiguredDirectImageUploadGateway,
} from "../next.config";

test("Bunny public CDN config accepts a standalone HTTPS origin", () => {
  assert.deepEqual(getConfiguredBunnyPublicCdn("https://ccrstagingmedia.b-cdn.net"), {
    origin: "https://ccrstagingmedia.b-cdn.net",
    hostname: "ccrstagingmedia.b-cdn.net",
  });
});

test("Bunny public CDN config rejects paths and non-HTTPS URLs", () => {
  assert.throws(
    () => getConfiguredBunnyPublicCdn("https://ccrstagingmedia.b-cdn.net/public"),
    /valid HTTPS origin/i,
  );
  assert.throws(() => getConfiguredBunnyPublicCdn("http://ccrstagingmedia.b-cdn.net"), /valid HTTPS origin/i);
});

test("direct image upload gateway config accepts only an HTTPS origin", () => {
  assert.deepEqual(
    getConfiguredDirectImageUploadGateway("https://ccr-staging-image-upload-gateway.example"),
    {
      origin: "https://ccr-staging-image-upload-gateway.example",
      hostname: "ccr-staging-image-upload-gateway.example",
    },
  );
  assert.throws(
    () => getConfiguredDirectImageUploadGateway("http://ccr-staging-image-upload-gateway.example"),
    /DIRECT_IMAGE_UPLOAD_GATEWAY_URL must be a valid HTTPS origin/i,
  );
});
