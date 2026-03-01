import assert from "node:assert/strict";
import test from "node:test";

import {
  generateBaseUsername,
  generateStandardUsernameBase,
  normalizeNamePart,
  resolveUsernameCollision,
} from "@/lib/auth/username";

test("normalizeNamePart strips punctuation, spaces, and diacritics", () => {
  assert.equal(normalizeNamePart("  Málcólm-O'Neil.  "), "malcolmoneil");
  assert.equal(normalizeNamePart("Jean_Paul"), "jean_paul");
  assert.equal(normalizeNamePart(""), "");
});

test("generateBaseUsername uses first initial + full last name", () => {
  assert.equal(generateBaseUsername("Melody", "Malcolm"), "mmalcolm");
  assert.equal(generateBaseUsername("A", "Li"), "ali");
});

test("generateStandardUsernameBase falls back from full name and email", () => {
  assert.equal(
    generateStandardUsernameBase({
      firstName: "",
      lastName: "",
      fullName: "Melody Malcolm",
      email: "melody@example.com",
    }),
    "mmalcolm",
  );

  assert.equal(
    generateStandardUsernameBase({
      firstName: "",
      lastName: "",
      fullName: "",
      email: "john.doe+ops@example.com",
    }),
    "johndoeops",
  );
});

test("resolveUsernameCollision increments numerically", async () => {
  const taken = new Set(["mmalcolm", "mmalcolm2", "mmalcolm3"]);
  const resolved = await resolveUsernameCollision("mmalcolm", async (candidate) =>
    taken.has(candidate),
  );
  assert.equal(resolved, "mmalcolm4");
});

test("resolveUsernameCollision keeps base when available", async () => {
  const resolved = await resolveUsernameCollision("newuser", async () => false);
  assert.equal(resolved, "newuser");
});

