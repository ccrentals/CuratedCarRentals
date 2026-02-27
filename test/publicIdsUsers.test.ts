import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";

import { config as loadEnv } from "dotenv";

import { fetchAdminUsers } from "@/app/api/admin/users/route";
import { dbQuery } from "@/lib/db";

loadEnv({ path: ".env.local" });
loadEnv();

type CreatedUser = {
  id: string;
  public_id: string;
  email: string;
};

function requireDatabaseOrSkip(t: TestContext) {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is not set; skipping DB-backed users public id tests.");
  }
}

async function insertUser(runTag: string, options: { publicId?: string } = {}) {
  const result = await dbQuery<CreatedUser>(
    "insert into users (email, username, full_name, password_hash, role, is_active, must_change_password, password_updated_at, public_id) values ($1, $2, $3, $4, 'USER', true, false, now(), $5) returning id, public_id, email",
    [
      `public-id-user-${runTag}@example.com`,
      `public_id_${runTag}`.slice(0, 32),
      `Public ID User ${runTag}`,
      `hash-${runTag}`,
      options.publicId ?? null,
    ],
  );
  return result.rows[0];
}

async function cleanup(userIds: string[]) {
  if (userIds.length > 0) {
    await dbQuery("delete from users where id = any($1::uuid[])", [userIds]);
  }
}

test("user insert auto-generates UR public_id", async (t) => {
  requireDatabaseOrSkip(t);

  const runTag = `ur-public-id-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];

  try {
    const user = await insertUser(runTag);
    userIds.push(user.id);

    assert.match(user.public_id, /^UR\d{6,}$/);
  } finally {
    await cleanup(userIds);
  }
});

test("users public_id unique index rejects duplicates", async (t) => {
  requireDatabaseOrSkip(t);

  const runTag = `ur-public-id-uniq-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];

  try {
    const first = await insertUser(`${runTag}-1`);
    userIds.push(first.id);

    await assert.rejects(
      () =>
        insertUser(`${runTag}-2`, {
          publicId: first.public_id,
        }),
      (error: unknown) => {
        const code = (error as { code?: string } | null)?.code;
        return code === "23505";
      },
    );
  } finally {
    await cleanup(userIds);
  }
});

test("admin users search returns public_id matches", async (t) => {
  requireDatabaseOrSkip(t);

  const runTag = `ur-public-id-search-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];

  try {
    const user = await insertUser(runTag);
    userIds.push(user.id);

    const list = await fetchAdminUsers({ q: user.public_id.toLowerCase() });
    const found = list.find((item: { id: string; public_id: string | null }) => item.id === user.id);

    assert.ok(found);
    assert.equal(found?.public_id, user.public_id);
  } finally {
    await cleanup(userIds);
  }
});
