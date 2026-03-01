#!/usr/bin/env tsx

import path from "node:path";

import { createClerkClient } from "@clerk/backend";
import dotenv from "dotenv";

import { generateStandardUsernameBase, resolveUsernameCollision } from "../src/lib/auth/username";

type ClerkListUser = Awaited<ReturnType<ReturnType<typeof createClerkClient>["users"]["getUserList"]>>["data"][number];

function loadEnv() {
  dotenv.config({ path: path.join(process.cwd(), ".env.local") });
  dotenv.config({ path: path.join(process.cwd(), ".env") });
}

function getPrimaryEmail(user: ClerkListUser) {
  const primary =
    user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId) ??
    user.emailAddresses[0];
  return primary?.emailAddress?.trim().toLowerCase() ?? "";
}

async function fetchAllUsers(clerk: ReturnType<typeof createClerkClient>) {
  const allUsers: ClerkListUser[] = [];
  const limit = 100;
  let offset = 0;

  for (;;) {
    const page = await clerk.users.getUserList({
      limit,
      offset,
      orderBy: "+created_at",
    });
    allUsers.push(...page.data);
    if (page.data.length < limit) {
      break;
    }
    offset += limit;
  }

  return allUsers;
}

async function main() {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");

  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is required.");
  }

  const clerk = createClerkClient({ secretKey });
  const users = await fetchAllUsers(clerk);

  const takenUsernames = new Set(
    users
      .map((user) => user.username?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const collisionResolutions: Array<{
    userId: string;
    email: string;
    base: string;
    final: string;
    previous: string;
  }> = [];

  for (const user of users) {
    scanned += 1;
    const email = getPrimaryEmail(user);
    const previousUsername = user.username?.trim().toLowerCase() ?? "";

    if (previousUsername) {
      takenUsernames.delete(previousUsername);
    }

    const desiredBase = generateStandardUsernameBase({
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      fullName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
      email,
    });

    const finalUsername = await resolveUsernameCollision(desiredBase, async (candidate) =>
      takenUsernames.has(candidate.toLowerCase()),
    );

    takenUsernames.add(finalUsername.toLowerCase());

    if (previousUsername === finalUsername) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      updated += 1;
      if (finalUsername !== desiredBase) {
        collisionResolutions.push({
          userId: user.id,
          email,
          base: desiredBase,
          final: finalUsername,
          previous: previousUsername,
        });
      }
      continue;
    }

    try {
      await clerk.users.updateUser(user.id, { username: finalUsername });
      updated += 1;
      if (finalUsername !== desiredBase) {
        collisionResolutions.push({
          userId: user.id,
          email,
          base: desiredBase,
          final: finalUsername,
          previous: previousUsername,
        });
      }
    } catch (error) {
      failed += 1;
      console.error(
        `[clerk:sync-usernames] Failed to update ${user.id} (${email || "no-email"}):`,
        (error as { message?: string } | null)?.message ?? error,
      );
    }
  }

  console.log("");
  console.log("[clerk:sync-usernames] Summary");
  console.log(`- total scanned: ${scanned}`);
  console.log(`- updated: ${updated}`);
  console.log(`- skipped: ${skipped}`);
  console.log(`- failed: ${failed}`);
  console.log(`- dry run: ${dryRun ? "yes" : "no"}`);

  if (collisionResolutions.length > 0) {
    console.log("");
    console.log("[clerk:sync-usernames] Collisions resolved:");
    for (const item of collisionResolutions) {
      console.log(
        `- ${item.userId} (${item.email || "no-email"}): ${item.previous || "(none)"} -> ${item.final} (base ${item.base})`,
      );
    }
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[clerk:sync-usernames] Fatal error:", error);
  process.exitCode = 1;
});

