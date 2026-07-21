import assert from "node:assert/strict";
import test from "node:test";

import assetSourceModel from "../src/admin/assetSource.ts";

const { buildAdminAssetSource } = assetSourceModel;

test("admin asset source attaches bearer only to same-service private paths", () => {
  assert.deepEqual(buildAdminAssetSource("/api/admin/private/image", "native-token", "https://staging.example.com/"), { uri: "https://staging.example.com/api/admin/private/image", headers: { Authorization: "Bearer native-token" } });
  assert.deepEqual(buildAdminAssetSource("https://ucarecdn.com/file/", "native-token", "https://staging.example.com"), { uri: "https://ucarecdn.com/file/" });
});

test("admin asset source blocks protocol-relative, insecure, and malformed external values", () => {
  assert.deepEqual(buildAdminAssetSource("//evil.example/image", "native-token", "https://staging.example.com"), { uri: "" });
  assert.deepEqual(buildAdminAssetSource("http://evil.example/image", "native-token", "https://staging.example.com"), { uri: "" });
  assert.deepEqual(buildAdminAssetSource("javascript:alert(1)", "native-token", "https://staging.example.com"), { uri: "" });
});
