import assert from "node:assert/strict";
import test from "node:test";

import {
  createUnreadMessagesCountStore,
  type UnreadMessagesCountStoreDeps,
} from "@/lib/messages/useUnreadMessagesCount";

type ScheduledTask = {
  id: number;
  delayMs: number;
  callback: () => void;
};

function createHarness(options: {
  counts?: number[];
  failAlways?: boolean;
  baseIntervalMs?: number;
}) {
  const scheduled: ScheduledTask[] = [];
  let nextTaskId = 1;
  let hidden = false;
  let fetchCallCount = 0;

  const counts = [...(options.counts ?? [])];

  const deps: UnreadMessagesCountStoreDeps = {
    fetchCount: async () => {
      fetchCallCount += 1;
      if (options.failAlways) {
        throw new Error("UNREAD_COUNT_FAILED");
      }
      return counts.length > 0 ? Number(counts.shift()) : 0;
    },
    getBaseIntervalMs: () => options.baseIntervalMs ?? 5_000,
    schedule: (callback, delayMs) => {
      const id = nextTaskId;
      nextTaskId += 1;
      scheduled.push({ id, delayMs, callback });
      return id;
    },
    clear: (timerId) => {
      const index = scheduled.findIndex((task) => task.id === timerId);
      if (index >= 0) {
        scheduled.splice(index, 1);
      }
    },
    now: () => 1_700_000_000_000,
    isDocumentHidden: () => hidden,
    addVisibilityListener: () => () => {},
    addFocusListener: () => () => {},
    addStorageListener: () => () => {},
  };

  const store = createUnreadMessagesCountStore(deps);

  return {
    store,
    scheduled,
    getFetchCallCount: () => fetchCallCount,
    setHidden: (nextHidden: boolean) => {
      hidden = nextHidden;
    },
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

test("unread count store: initial subscribe fetch sets count", async () => {
  const harness = createHarness({ counts: [3] });

  const unsubscribe = harness.store.subscribe(() => {});
  await flushMicrotasks();

  const snapshot = harness.store.getSnapshot();
  assert.equal(snapshot.count, 3);
  assert.equal(snapshot.errorStreak, 0);
  assert.equal(harness.getFetchCallCount(), 1);

  unsubscribe();
  harness.store.destroy();
});

test("unread count store: refresh updates count immediately", async () => {
  const harness = createHarness({ counts: [1, 4] });

  const unsubscribe = harness.store.subscribe(() => {});
  await flushMicrotasks();

  assert.equal(harness.store.getSnapshot().count, 1);

  await harness.store.refresh();

  assert.equal(harness.store.getSnapshot().count, 4);
  assert.equal(harness.getFetchCallCount(), 2);

  unsubscribe();
  harness.store.destroy();
});

test("unread count store: polling backoff increases to 2x then 4x on failures", async () => {
  const harness = createHarness({ failAlways: true, baseIntervalMs: 5_000 });

  const unsubscribe = harness.store.subscribe(() => {});
  await flushMicrotasks();

  assert.equal(harness.getFetchCallCount(), 1);
  assert.equal(harness.scheduled.length, 1);
  assert.equal(harness.scheduled[0]?.delayMs, 10_000);

  const firstScheduled = harness.scheduled.shift();
  assert.ok(firstScheduled);
  firstScheduled?.callback();
  await flushMicrotasks();

  assert.equal(harness.getFetchCallCount(), 2);
  assert.equal(harness.scheduled.length, 1);
  assert.equal(harness.scheduled[0]?.delayMs, 20_000);

  unsubscribe();
  harness.store.destroy();
});

test("unread count store: hidden tab skips polling fetch", async () => {
  const harness = createHarness({ counts: [2], baseIntervalMs: 5_000 });

  const unsubscribe = harness.store.subscribe(() => {});
  await flushMicrotasks();
  assert.equal(harness.getFetchCallCount(), 1);

  harness.setHidden(true);
  const scheduled = harness.scheduled.shift();
  assert.ok(scheduled);
  scheduled?.callback();
  await flushMicrotasks();

  assert.equal(harness.getFetchCallCount(), 1);
  assert.equal(harness.scheduled.length, 0);

  unsubscribe();
  harness.store.destroy();
});
