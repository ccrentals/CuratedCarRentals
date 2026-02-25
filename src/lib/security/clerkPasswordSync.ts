import { ensureCsrfToken } from "@/lib/security/csrf-client";

const LEGACY_PASSWORD_SYNC_ENDPOINT = "/api/public/auth/sync-legacy-password";
const DEFAULT_SYNC_ERROR =
  "Password updated in Clerk, but legacy password sync failed. Legacy login may still require an admin reset.";

type SyncLegacyPasswordResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
    };

type SyncResponseBody = {
  error?: string;
  message?: string;
};

function getErrorMessage(body: SyncResponseBody | null) {
  return body?.error ?? body?.message ?? DEFAULT_SYNC_ERROR;
}

async function postSyncRequest(password: string, csrfToken: string | null) {
  const response = await fetch(LEGACY_PASSWORD_SYNC_ENDPOINT, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken ?? "",
    },
    body: JSON.stringify({
      password,
      csrfToken: csrfToken ?? undefined,
    }),
  });

  const body = (await response.json().catch(() => null)) as SyncResponseBody | null;
  return { response, body };
}

export async function syncLegacyPasswordWithClerkSession({
  password,
}: {
  password: string;
}): Promise<SyncLegacyPasswordResult> {
  const csrfToken = await ensureCsrfToken();

  try {
    // The Clerk session cookie can take a short moment to propagate after setActive().
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { response, body } = await postSyncRequest(password, csrfToken);
      if (response.ok) {
        return { ok: true };
      }

      if (response.status === 401 && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }

      return {
        ok: false,
        message: getErrorMessage(body),
      };
    }
  } catch {
    return { ok: false, message: DEFAULT_SYNC_ERROR };
  }

  return { ok: false, message: DEFAULT_SYNC_ERROR };
}
