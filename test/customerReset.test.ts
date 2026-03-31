import assert from "node:assert/strict";
import test from "node:test";

import { CUSTOMER_BOOKING_LOCATIONS, CUSTOMER_FLEET_BOOTSTRAP } from "@/data/customerFleetBootstrap";
import { runApply, syncPublicIdSequence } from "../scripts/customer-reset";

test("customer reset reseeds public-id sequences from a fresh baseline", async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return { rows: [{ exists: true }], rowCount: 1 };
    },
  };

  await syncPublicIdSequence(client, "vehicles_public_id_seq");

  assert.deepEqual(calls, [
    {
      text: "select setval($1, 1, false)",
      values: ["vehicles_public_id_seq"],
    },
  ]);
});

test("customer reset applies live booking locations and inserts rebooted fleet images with owned URLs", async () => {
  const uploadCalls: Array<{ url: string; fileName?: string }> = [];
  const insertedLocations: string[] = [];
  const insertedVehicles: Array<{ imageUrls: string[]; features: Record<string, unknown> }> = [];

  const client = {
    async query(text: string, values?: unknown[]) {
      if (text.includes("to_regclass")) {
        return { rows: [{ exists: true }], rowCount: 1 };
      }
      if (text.startsWith("delete") || text.startsWith("update customers") || text.startsWith("select setval")) {
        return { rows: [], rowCount: 1 };
      }
      if (text.startsWith("insert into booking_locations")) {
        insertedLocations.push(String(values?.[0] ?? ""));
        return { rows: [], rowCount: 1 };
      }
      if (text.startsWith("insert into vehicles")) {
        insertedVehicles.push({
          imageUrls: JSON.parse(String(values?.[6] ?? "[]")) as string[],
          features: JSON.parse(String(values?.[7] ?? "{}")) as Record<string, unknown>,
        });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };

  await runApply(client, {
    uploadRemoteFile: async (url: string, options?: { fileName?: string }) => {
      uploadCalls.push({ url, fileName: options?.fileName });
      return "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    },
    resolveUploadcareUrl: async (fileId: string) =>
      `https://project-files.ucarecd.net/${fileId}/`,
  });

  assert.deepEqual(insertedLocations, [...CUSTOMER_BOOKING_LOCATIONS]);
  assert.equal(insertedLocations.length, 2);
  assert.equal(insertedVehicles.length, CUSTOMER_FLEET_BOOTSTRAP.length);
  assert.equal(insertedVehicles.length, 6);
  assert.equal(uploadCalls[0]?.fileName, "VE000001-subaru-impreza-sport-gallery-01.png");
  assert.equal(
    insertedVehicles[0]?.imageUrls[0],
    "https://project-files.ucarecd.net/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/",
  );
  assert.equal(insertedVehicles[0]?.features.public_visible, true);
});
