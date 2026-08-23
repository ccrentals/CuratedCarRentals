import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Clerk sign-in uses Curated Car Rentals branding", () => {
  const source = readFileSync(
    new URL("../src/components/security/OptionalClerkProvider.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /title: "Sign in to Curated Car Rentals"/);
  assert.match(source, /localization=\{clerkLocalization\}/);
  assert.doesNotMatch(source, /title: "Sign in to My Application"/);
});
