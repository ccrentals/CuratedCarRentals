import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminMessagesRetentionPost } from "@/app/api/admin/messages/retention/route";

test("admin messages retention endpoint is disabled for manual trash workflow", async () => {
  const response = await handleAdminMessagesRetentionPost();

  assert.equal(response.status, 410);
  const body = (await response.json()) as {
    ok: boolean;
    error: string;
  };

  assert.equal(body.ok, false);
  assert.match(body.error, /automatic 30-day trash is disabled/i);
});
