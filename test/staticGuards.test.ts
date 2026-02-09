import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

test("RBAC: dangerous admin routes contain an explicit 403 Forbidden guard", () => {
  const files = [
    "src/app/api/admin/users/route.ts",
    "src/app/api/admin/users/[userId]/route.ts",
    "src/app/api/admin/payments/[paymentId]/route.ts",
    "src/app/api/admin/payments/[paymentId]/refund/route.ts",
    "src/app/api/admin/bookings/[id]/route.ts",
  ];

  for (const file of files) {
    const code = read(file);
    assert.match(code, /status:\s*403|{ status: 403 }/);
    assert.match(code, /Forbidden/);
  }
});

test("Idempotency: WiPay webhook uses webhook_events insert gate and short-circuits duplicates", () => {
  const code = read("src/app/api/payments/wipay/webhook/route.ts");
  assert.match(code, /insert into webhook_events/i);
  assert.match(code, /on conflict\s*\(provider,\s*event_id\)\s*do nothing/i);
  assert.match(code, /duplicate/i);
});
