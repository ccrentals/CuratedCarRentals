import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readSource(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("admin session resolver: Clerk bridge is opt-in and not used by default", () => {
  const source = readSource("src/lib/auth/session.ts");

  assert.match(source, /allowClerkBridge\?: boolean/);
  assert.match(source, /if \(!options\.allowClerkBridge\) \{\s*return null;\s*\}/);
  assert.match(source, /return getSessionFromClerkBridge\(options\);/);
});

test("/admin/auth: bootstrap requests are redirected into the route-handler bootstrap flow", () => {
  const source = readSource("src/app/admin/auth/page.tsx");

  assert.match(source, /const bootstrapRequested = params\.bootstrap === "1";/);
  assert.match(source, /function buildBootstrapHref\(/);
  assert.match(source, /return `\/api\/admin\/session\/bootstrap\?\$\{query\.toString\(\)\}`;/);
  assert.match(source, /redirect\(buildBootstrapHref\(params\)\);/);
  assert.match(source, /redirect\(buildLogoutRedirectHref\(params\)\);/);
});

test("admin bootstrap route: route handler is the only place that rehydrates admin cookie from Clerk", () => {
  const source = readSource("src/app/api/admin/session/bootstrap/route.ts");

  assert.match(
    source,
    /getSessionFromRequest\(\{\s*allowClerkBridge: true,\s*clerkBridgeMode: "any-local-user",\s*\}\)/,
  );
  assert.match(source, /await setSessionCookie\(createSessionToken\(bootstrapSession\.userId, bootstrapSession\.role\)\);/);
  assert.match(source, /return NextResponse\.redirect\(new URL\(buildLogoutRedirectHref\(request\), request\.url\)\);/);
});

test("admin sign-in: Clerk return path uses explicit admin bootstrap route", () => {
  const source = readSource("src/app/sign-in/[[...sign-in]]/page.tsx");

  assert.match(source, /function buildAdminBootstrapHref\(/);
  assert.match(source, /return `\/api\/admin\/session\/bootstrap\?\$\{query\.toString\(\)\}`;/);
  assert.match(
    source,
    /const fallbackRedirectUrl = hideSiteActions\s*\?\s*buildAdminBootstrapHref\(params\)\s*:\s*postClerkAdminAuthPath;/,
  );
  assert.match(source, /fallbackRedirectUrl=\{fallbackRedirectUrl\}/);
});
