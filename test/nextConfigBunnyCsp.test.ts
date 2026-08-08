import assert from "node:assert/strict";
import test from "node:test";

import { getConfiguredBunnyPublicCdn } from "../next.config";

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
