import assert from "node:assert/strict";
import test from "node:test";

import {
  formatQuoteActivityActorLabel,
  formatQuoteActivityMeta,
  formatQuoteActivityTitle,
} from "@/lib/quotes/activityLog";

test("quote activity log titles use locked wording", () => {
  assert.equal(formatQuoteActivityTitle("STATUS_CHANGED"), "Status updated");
  assert.equal(formatQuoteActivityTitle("UPDATED"), "Quote updated");
  assert.equal(formatQuoteActivityTitle("CREATED"), "Quote created");
  assert.equal(formatQuoteActivityTitle("PDF_GENERATED"), "PDF generated");
});

test("quote activity log actor labels vary by event type", () => {
  assert.equal(formatQuoteActivityActorLabel("STATUS_CHANGED"), "Changed by:");
  assert.equal(formatQuoteActivityActorLabel("UPDATED"), "Updated by:");
  assert.equal(formatQuoteActivityActorLabel("CREATED"), "Created by:");
  assert.equal(formatQuoteActivityActorLabel("EMAILED"), "Actor:");
});

test("quote activity log meta formats status transition and repriced values", () => {
  const text = formatQuoteActivityMeta({
    fromStatus: "DRAFT",
    toStatus: "SENT",
    repriced: false,
  });

  assert.equal(text, "From: DRAFT  To: SENT · Price recalculated: No");
});

test("quote activity log meta formats repriced true as Yes", () => {
  const text = formatQuoteActivityMeta({ repriced: true });

  assert.equal(text, "Price recalculated: Yes");
});

test("quote activity log meta humanizes source labels for display", () => {
  const text = formatQuoteActivityMeta({ source: "admin_quote_pdf" });

  assert.equal(text, "Source: Admin Quote PDF");
});
