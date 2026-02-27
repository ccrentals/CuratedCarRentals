type StorageLike = {
  removeItem: (key: string) => void;
};

type CookieDocumentLike = {
  cookie: string;
};

type BrowserLike = {
  sessionStorage?: StorageLike;
  localStorage?: StorageLike;
  document?: CookieDocumentLike;
};

type ClearBookingDraftInput = {
  keys?: string[];
  browser?: BrowserLike | null;
};

export const BOOKING_DRAFT_STORAGE_KEYS = ["ccr_booking_wizard_draft_v1"] as const;

function resolveBrowser(browser: BrowserLike | null | undefined): BrowserLike | null {
  if (browser) {
    return browser;
  }
  if (typeof window === "undefined") {
    return null;
  }
  return window as unknown as BrowserLike;
}

function expireCookie(documentLike: CookieDocumentLike | undefined, key: string) {
  if (!documentLike) return;
  documentLike.cookie = `${encodeURIComponent(key)}=; Max-Age=0; Path=/; SameSite=Lax`;
}

function removeStorageItem(storage: StorageLike | undefined, key: string) {
  if (!storage) return;
  storage.removeItem(key);
}

export function clearBookingDraft(input?: ClearBookingDraftInput) {
  const keys = input?.keys && input.keys.length > 0 ? input.keys : [...BOOKING_DRAFT_STORAGE_KEYS];
  const browser = resolveBrowser(input?.browser);
  if (!browser) return;

  for (const key of keys) {
    removeStorageItem(browser.sessionStorage, key);
    removeStorageItem(browser.localStorage, key);
    expireCookie(browser.document, key);
  }
}
