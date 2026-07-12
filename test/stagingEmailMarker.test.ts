import assert from "node:assert/strict";
import test from "node:test";

import { applyStagingEmailMarker } from "../src/lib/notifications/emailDispatch";

test("staging email marker prefixes the subject and adds a visible warning", () => {
  const previousBranch = process.env.BRANCH;
  process.env.BRANCH = "staging";
  try {
    const result = applyStagingEmailMarker("Booking received", "<p>Details</p>");
    assert.equal(result.subject, "[STAGING] Booking received");
    assert.match(result.html, /STAGING TEST EMAIL - NOT A REAL BOOKING/);
    assert.match(result.html, /<p>Details<\/p>/);
  } finally {
    if (previousBranch === undefined) delete process.env.BRANCH;
    else process.env.BRANCH = previousBranch;
  }
});

test("production email content is unchanged", () => {
  const previousBranch = process.env.BRANCH;
  const previousContext = process.env.CONTEXT;
  delete process.env.BRANCH;
  process.env.CONTEXT = "production";
  try {
    assert.deepEqual(applyStagingEmailMarker("Booking received", "<p>Details</p>"), {
      subject: "Booking received",
      html: "<p>Details</p>",
    });
  } finally {
    if (previousBranch === undefined) delete process.env.BRANCH;
    else process.env.BRANCH = previousBranch;
    if (previousContext === undefined) delete process.env.CONTEXT;
    else process.env.CONTEXT = previousContext;
  }
});
