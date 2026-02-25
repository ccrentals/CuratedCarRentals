import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("/admin/auth route is explicitly dynamic and non-cached", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/app/admin/auth/page.tsx"),
    "utf8",
  );

  assert.match(source, /export const dynamic = "force-dynamic"/);
  assert.match(source, /export const revalidate = 0/);
});
