import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { handleAdminUploadcareSignatureGet } from "@/app/api/admin/uploads/uploadcare/signature/route";
import type { RequireAdminApiSessionResult } from "@/lib/auth/adminGuards";

const OPERATIONS_ACTOR = {
  userId: "operations-user-id",
  role: "OPERATIONS",
  appRole: "OPERATIONS" as const,
  authSource: "legacy" as const,
  clerkUserId: null,
  issuedAt: 1,
  expiresAt: 2,
};

function operationsAccess(): RequireAdminApiSessionResult {
  return {
    ok: true,
    session: {
      userId: OPERATIONS_ACTOR.userId,
      role: OPERATIONS_ACTOR.role,
      source: "legacy",
      issuedAt: OPERATIONS_ACTOR.issuedAt,
      expiresAt: OPERATIONS_ACTOR.expiresAt,
    },
    actor: OPERATIONS_ACTOR,
  };
}

test("operations role can request signed credentials for inspection and customer uploads", async () => {
  const response = await handleAdminUploadcareSignatureGet({
    requireUploadAccess: async () => operationsAccess(),
    createCredentials: () => ({
      publicKey: "public-key",
      secureSignature: "signature",
      secureExpire: "1234567890",
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    publicKey: "public-key",
    secureSignature: "signature",
    secureExpire: "1234567890",
  });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("signed upload credentials still reject unauthenticated users", async () => {
  const response = await handleAdminUploadcareSignatureGet({
    requireUploadAccess: async () => ({
      ok: false,
      reason: "unauthorized",
      response: new Response("Unauthorized", { status: 401 }),
    }),
  });

  assert.equal(response.status, 401);
});

test("operations workflow routes use operations-level authorization", async () => {
  const routePaths = [
    "src/app/api/admin/uploads/uploadcare/signature/route.ts",
    "src/app/api/admin/bookings/route.ts",
    "src/app/api/admin/bookings/[id]/route.ts",
    "src/app/api/admin/bookings/[id]/inspections/route.ts",
    "src/app/api/admin/bookings/[id]/inspections/images/route.ts",
    "src/app/api/admin/bookings/[id]/inspections/images/[imageId]/route.ts",
    "src/app/api/admin/customers/route.ts",
    "src/app/api/admin/customers/[id]/route.ts",
    "src/app/api/admin/customers/[id]/private-files/route.ts",
    "src/app/api/admin/customers/[id]/private-files/[fileId]/route.ts",
    "src/app/api/admin/blockouts/route.ts",
    "src/app/api/admin/blockouts/[id]/route.ts",
    "src/app/api/admin/quotes/route.ts",
    "src/app/api/admin/quotes/[id]/route.ts",
    "src/app/api/admin/me/route.ts",
  ];

  for (const routePath of routePaths) {
    const source = await readFile(routePath, "utf8");
    assert.match(source, /requireOperationsAccess/, `${routePath} must allow OPERATIONS`);
  }
});

test("privileged inspection overrides remain admin-only", async () => {
  const [inspectionRoute, archiveRoute] = await Promise.all([
    readFile("src/app/api/admin/bookings/[id]/inspections/route.ts", "utf8"),
    readFile("src/app/api/admin/bookings/[id]/inspections/images/archive/route.ts", "utf8"),
  ]);

  assert.match(inspectionRoute, /hasRequiredAdminAccess\(auth\.actor\.role,\s*"admin"\)/);
  assert.match(archiveRoute, /requireAdminRole/);
});
