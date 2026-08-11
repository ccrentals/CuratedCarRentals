import assert from "node:assert/strict";
import test from "node:test";

import { resendSetupPendingInviteForUser } from "@/app/api/admin/users/[userId]/implementation";

test("admin user invite resend: sends setup email for setup-pending user", async () => {
  const auditCalls: Array<Record<string, unknown>> = [];
  const emailCalls: Array<Record<string, unknown>> = [];

  const result = await resendSetupPendingInviteForUser(
    {
      userId: "11111111-1111-4111-8111-111111111111",
      userPublicId: "UR000024",
      email: "tjbell1@yahoo.com",
      username: "tbell",
      fullName: "Trevor Bell",
      lifecycleState: "setup_pending",
      actorUserId: "22222222-2222-4222-8222-222222222222",
      siteUrl: "https://ccrentals.netlify.app",
    },
    {
      sendWelcomeEmail: async (input) => {
        emailCalls.push(input as unknown as Record<string, unknown>);
        return { ok: true, skipped: false, delivered: 1, errors: [] };
      },
      writeAudit: async (input) => {
        auditCalls.push(input as Record<string, unknown>);
      },
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.setupEmail, "tjbell1@yahoo.com");
  assert.equal(result.setupPath, "/sign-up?redirect=%2Fadmin");
  assert.equal(result.setupUrl, "https://ccrentals.netlify.app/sign-up?redirect=%2Fadmin");
  assert.equal(emailCalls.length, 1);
  assert.equal(emailCalls[0]?.userEmail, "tjbell1@yahoo.com");
  assert.equal(emailCalls[0]?.username, "tbell");
  assert.equal(emailCalls[0]?.setupUrl, "https://ccrentals.netlify.app/sign-up?redirect=%2Fadmin");
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0]?.action, "USER_SETUP_INVITE_RESENT");
});

test("admin user invite resend: rejects non-setup-pending user", async () => {
  const result = await resendSetupPendingInviteForUser(
    {
      userId: "11111111-1111-4111-8111-111111111111",
      email: "info@curatedcarrentals.com",
      username: "kedwards",
      fullName: "Knicole Edwards",
      lifecycleState: "active",
      actorUserId: "22222222-2222-4222-8222-222222222222",
    },
    {
      sendWelcomeEmail: async () => {
        throw new Error("unreachable");
      },
      writeAudit: async () => undefined,
    },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 409);
  assert.match(result.error, /setup-pending/i);
});
