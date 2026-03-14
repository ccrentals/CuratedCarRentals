import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

test("Users page search uses contains matching and SQL total-count pagination", () => {
  const code = read("src/app/admin/(protected)/users/page.tsx");
  assert.match(code, /%\$\{q\}%/);
  assert.match(code, /count\(\*\)::int as total/i);
  assert.match(code, /withLimit\(/);
});

test("Settings API GET requires admin role only", () => {
  const code = read("src/app/api/admin/settings/route.ts");
  assert.match(code, /requireAdmin\?: \(\) => Promise<RequireAdminRoleResult>;/);
  assert.match(code, /deps\.requireAdmin \?\? requireAdminRole/);
  assert.doesNotMatch(code, /requireStaffOrAdminRole/);
});

test("User mutation route prevents removing last active privileged account", () => {
  const code = read("src/app/api/admin/users/[userId]/route.ts");
  assert.match(code, /countActivePrivilegedUsers/);
  assert.match(code, /last active privileged account/i);
});
