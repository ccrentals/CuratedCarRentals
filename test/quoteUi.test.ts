import assert from "node:assert/strict";
import test from "node:test";

import { MIN_QUOTE_SEARCH_LENGTH, normalizeQuoteSearchTerm } from "@/lib/quotes/quoteUi";

test("quote UI search threshold starts filtering at three characters", () => {
  assert.equal(MIN_QUOTE_SEARCH_LENGTH, 3);
  assert.equal(normalizeQuoteSearchTerm("ab"), "");
  assert.equal(normalizeQuoteSearchTerm("abc"), "abc");
  assert.equal(normalizeQuoteSearchTerm("  BK000123  "), "BK000123");
});
