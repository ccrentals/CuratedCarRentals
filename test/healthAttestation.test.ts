import assert from "node:assert/strict";
import test from "node:test";

import { readNetlifyReleaseAttestation } from "@/lib/health";

test("Netlify release attestation returns only non-secret deployment markers", () => {
  const attestation = readNetlifyReleaseAttestation({
    NETLIFY: "true",
    CONTEXT: "production",
    BRANCH: "main",
    DEPLOY_URL: "https://curatedcarrentals.com",
    DEPLOY_ID: "deploy-id",
    COMMIT_REF: "0123456789abcdef",
    SITE_ID: "site-id",
    STRIPE_SECRET_KEY: "must-not-be-present",
  });

  assert.deepEqual(attestation, {
    ok: true,
    configured: true,
    context: "production",
    branch: "main",
    deployUrl: "https://curatedcarrentals.com",
    deployId: "deploy-id",
    commitRef: "0123456789abcdef",
    siteId: "site-id",
  });
});
