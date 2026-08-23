import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.join(process.cwd(), "src/components/admin/UserMenu.tsx"),
  "utf8",
);

test("admin sign-out clears both the local admin session and Clerk client session", () => {
  assert.match(source, /fetch\("\/api\/admin\/logout"/);
  assert.match(source, /useClerk\(\)/);
  assert.match(source, /signOut\(\{ redirectUrl: "\/sign-in" \}\)/);
  assert.match(source, /if \(clerkSignOut\) \{[\s\S]*await clerkSignOut\(\)/);
});

test("legacy admin sign-out returns to the legacy login page", () => {
  assert.match(source, /window\.location\.replace\("\/admin\/login"\)/);
});
