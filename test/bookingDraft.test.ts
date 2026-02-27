import assert from "node:assert/strict";
import test from "node:test";

import { BOOKING_DRAFT_STORAGE_KEYS, clearBookingDraft } from "@/lib/bookings/draft";

class MockStorage {
  removed: string[] = [];

  removeItem(key: string) {
    this.removed.push(key);
  }
}

function createCookieDocument() {
  const writes: string[] = [];
  return {
    writes,
    document: {
      get cookie() {
        return "";
      },
      set cookie(value: string) {
        writes.push(value);
      },
    },
  };
}

test("clearBookingDraft clears known draft keys from session/local storage and cookie scope", () => {
  const sessionStorage = new MockStorage();
  const localStorage = new MockStorage();
  const cookieDoc = createCookieDocument();

  clearBookingDraft({
    browser: {
      sessionStorage,
      localStorage,
      document: cookieDoc.document,
    },
  });

  assert.deepEqual(sessionStorage.removed, [...BOOKING_DRAFT_STORAGE_KEYS]);
  assert.deepEqual(localStorage.removed, [...BOOKING_DRAFT_STORAGE_KEYS]);
  assert.equal(cookieDoc.writes.length, BOOKING_DRAFT_STORAGE_KEYS.length);
  assert.match(cookieDoc.writes[0] ?? "", /ccr_booking_wizard_draft_v1=;/);
});

test("clearBookingDraft uses custom key list and tolerates absent browser state", () => {
  const sessionStorage = new MockStorage();
  const localStorage = new MockStorage();
  const cookieDoc = createCookieDocument();

  clearBookingDraft({
    keys: ["draft-a", "draft-b"],
    browser: {
      sessionStorage,
      localStorage,
      document: cookieDoc.document,
    },
  });

  assert.deepEqual(sessionStorage.removed, ["draft-a", "draft-b"]);
  assert.deepEqual(localStorage.removed, ["draft-a", "draft-b"]);
  assert.equal(cookieDoc.writes.length, 2);
  clearBookingDraft({ browser: null });
});
