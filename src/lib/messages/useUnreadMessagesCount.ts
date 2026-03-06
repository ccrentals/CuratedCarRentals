"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

export const CONTACT_MESSAGE_CREATED_STORAGE_KEY = "ccr:contact-message-created-at";

export type UnreadMessagesCountSnapshot = {
  count: number;
  isLoading: boolean;
  errorStreak: number;
  lastSyncedAt: number;
};

export type UnreadMessagesCountStoreDeps = {
  fetchCount: (signal: AbortSignal) => Promise<number>;
  getBaseIntervalMs: () => number;
  schedule: (callback: () => void, delayMs: number) => unknown;
  clear: (timerId: unknown) => void;
  now: () => number;
  isDocumentHidden: () => boolean;
  addVisibilityListener: (listener: () => void) => () => void;
  addFocusListener: (listener: () => void) => () => void;
  addStorageListener: (listener: (event: StorageEvent) => void) => () => void;
};

function toSafeCount(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

function isAbortError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "AbortError"
  );
}

function buildDefaultStoreDeps(): UnreadMessagesCountStoreDeps {
  return {
    fetchCount: async (signal) => {
      const response = await fetch("/api/admin/messages/unread-count", {
        method: "GET",
        cache: "no-store",
        signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP_${response.status}`);
      }
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; count?: number }
        | null;
      if (!payload?.ok || typeof payload.count !== "number") {
        throw new Error("INVALID_UNREAD_COUNT_PAYLOAD");
      }
      return toSafeCount(payload.count);
    },
    getBaseIntervalMs: () => (process.env.NODE_ENV === "production" ? 30_000 : 5_000),
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    clear: (timerId) => clearTimeout(timerId as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
    isDocumentHidden: () => (typeof document !== "undefined" ? document.hidden : false),
    addVisibilityListener: (listener) => {
      if (typeof document === "undefined") return () => {};
      const onVisibilityChange = () => listener();
      document.addEventListener("visibilitychange", onVisibilityChange);
      return () => document.removeEventListener("visibilitychange", onVisibilityChange);
    },
    addFocusListener: (listener) => {
      if (typeof window === "undefined") return () => {};
      window.addEventListener("focus", listener);
      return () => window.removeEventListener("focus", listener);
    },
    addStorageListener: (listener) => {
      if (typeof window === "undefined") return () => {};
      const onStorage = (event: StorageEvent) => listener(event);
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    },
  };
}

export type UnreadMessagesCountStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => UnreadMessagesCountSnapshot;
  hydrate: (initialCount: number) => void;
  refresh: () => Promise<void>;
  destroy: () => void;
};

export function createUnreadMessagesCountStore(
  deps: UnreadMessagesCountStoreDeps,
): UnreadMessagesCountStore {
  let snapshot: UnreadMessagesCountSnapshot = {
    count: 0,
    isLoading: false,
    errorStreak: 0,
    lastSyncedAt: 0,
  };

  const listeners = new Set<() => void>();

  let isRunning = false;
  let timerId: unknown | null = null;
  let inFlight: Promise<void> | null = null;
  let inFlightAbortController: AbortController | null = null;

  let removeVisibilityListener: (() => void) | null = null;
  let removeFocusListener: (() => void) | null = null;
  let removeStorageListener: (() => void) | null = null;

  function emit() {
    listeners.forEach((listener) => listener());
  }

  function clearScheduledPoll() {
    if (!timerId) return;
    deps.clear(timerId);
    timerId = null;
  }

  function nextDelayMs() {
    const base = deps.getBaseIntervalMs();
    if (snapshot.errorStreak <= 0) return base;
    const multiplier = Math.min(4, 2 ** snapshot.errorStreak);
    return base * multiplier;
  }

  function scheduleNextPoll(delayMs: number) {
    if (!isRunning) return;
    clearScheduledPoll();
    timerId = deps.schedule(() => {
      void runFetch(false);
    }, delayMs);
  }

  function cleanupEventListeners() {
    removeVisibilityListener?.();
    removeFocusListener?.();
    removeStorageListener?.();
    removeVisibilityListener = null;
    removeFocusListener = null;
    removeStorageListener = null;
  }

  function stop() {
    isRunning = false;
    clearScheduledPoll();
    cleanupEventListeners();
    inFlightAbortController?.abort();
    inFlightAbortController = null;
    inFlight = null;
    if (snapshot.isLoading) {
      snapshot = {
        ...snapshot,
        isLoading: false,
      };
      emit();
    }
  }

  async function runFetch(force: boolean) {
    if (!isRunning && !force) return;

    if (deps.isDocumentHidden() && !force) {
      clearScheduledPoll();
      return;
    }

    if (inFlight) {
      return inFlight;
    }

    snapshot = {
      ...snapshot,
      isLoading: true,
    };
    emit();

    const controller = new AbortController();
    inFlightAbortController = controller;

    inFlight = (async () => {
      try {
        const count = await deps.fetchCount(controller.signal);
        snapshot = {
          ...snapshot,
          count: toSafeCount(count),
          errorStreak: 0,
          lastSyncedAt: deps.now(),
        };
      } catch (error) {
        if (!isAbortError(error)) {
          snapshot = {
            ...snapshot,
            errorStreak: Math.min(snapshot.errorStreak + 1, 6),
          };
        }
      } finally {
        if (inFlightAbortController === controller) {
          inFlightAbortController = null;
        }
        snapshot = {
          ...snapshot,
          isLoading: false,
        };
        inFlight = null;
        emit();
        if (isRunning) {
          scheduleNextPoll(nextDelayMs());
        }
      }
    })();

    return inFlight;
  }

  function start() {
    if (isRunning) return;
    isRunning = true;

    removeVisibilityListener = deps.addVisibilityListener(() => {
      if (!deps.isDocumentHidden()) {
        void runFetch(true);
      }
    });

    removeFocusListener = deps.addFocusListener(() => {
      void runFetch(true);
    });

    removeStorageListener = deps.addStorageListener((event) => {
      if (event.key === CONTACT_MESSAGE_CREATED_STORAGE_KEY) {
        void runFetch(true);
      }
    });

    void runFetch(true);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        start();
      }
      listener();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stop();
        }
      };
    },
    getSnapshot() {
      return snapshot;
    },
    hydrate(initialCount: number) {
      const normalizedCount = toSafeCount(initialCount);
      if (!Number.isFinite(normalizedCount)) return;
      if (snapshot.lastSyncedAt !== 0) return;
      if (snapshot.count === normalizedCount) return;
      snapshot = {
        ...snapshot,
        count: normalizedCount,
      };
      emit();
    },
    async refresh() {
      await runFetch(true);
    },
    destroy() {
      listeners.clear();
      stop();
    },
  };
}

const unreadMessagesCountStore = createUnreadMessagesCountStore(buildDefaultStoreDeps());

type UseUnreadMessagesCountOptions = {
  enabled?: boolean;
};

export function useUnreadMessagesCount(
  initialCount: number,
  options: UseUnreadMessagesCountOptions = {},
) {
  const enabled = options.enabled ?? true;

  useEffect(() => {
    unreadMessagesCountStore.hydrate(initialCount);
  }, [initialCount]);

  const subscribe = useCallback(
    (listener: () => void) => {
      if (!enabled) {
        return () => {};
      }
      return unreadMessagesCountStore.subscribe(listener);
    },
    [enabled],
  );
  const getSnapshot = useCallback(() => unreadMessagesCountStore.getSnapshot(), []);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const refresh = useCallback(() => unreadMessagesCountStore.refresh(), []);

  return {
    count: enabled ? snapshot.count : toSafeCount(initialCount),
    isLoading: enabled ? snapshot.isLoading : false,
    lastSyncedAt: enabled ? snapshot.lastSyncedAt : 0,
    refresh,
  };
}

export async function refreshUnreadMessagesCount() {
  await unreadMessagesCountStore.refresh();
}

export function getUnreadMessagesPollingIntervals() {
  const baseMs = process.env.NODE_ENV === "production" ? 30_000 : 5_000;
  return {
    baseMs,
    backoffStepsMs: [baseMs, baseMs * 2, baseMs * 4],
  };
}
