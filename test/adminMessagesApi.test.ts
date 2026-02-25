import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminMessagesListGet } from "@/app/api/admin/messages/route";
import { handleAdminMessagesBulkPost } from "@/app/api/admin/messages/bulk/route";
import { handleAdminMessagePatch } from "@/app/api/admin/messages/[id]/route";
import { handleAdminMessagesUnreadCountGet } from "@/app/api/admin/messages/unread-count/route";

test("admin messages API: list requires auth", async () => {
  const response = await handleAdminMessagesListGet(
    new Request("http://localhost/api/admin/messages"),
    {
      getSession: async () => null,
      getPage: async () => ({
        items: [],
        nextCursor: null,
        hasMore: false,
        totalCount: 0,
        limit: 20,
      }),
    },
  );

  assert.equal(response.status, 401);
});

test("admin messages API: non-staff role is forbidden", async () => {
  const response = await handleAdminMessagesListGet(
    new Request("http://localhost/api/admin/messages"),
    {
      getSession: async () => ({
        userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
        role: "CUSTOMER",
        expiresAt: 999999999,
        issuedAt: 999999000,
      }),
      getPage: async () => ({
        items: [],
        nextCursor: null,
        hasMore: false,
        totalCount: 0,
        limit: 20,
      }),
    },
  );

  assert.equal(response.status, 403);
});

test("admin messages API: staff role can access admin list", async () => {
  const response = await handleAdminMessagesListGet(
    new Request("http://localhost/api/admin/messages"),
    {
      getSession: async () => ({
        userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
        role: "USER",
        expiresAt: 999999999,
        issuedAt: 999999000,
      }),
      getPage: async () => ({
        items: [],
        nextCursor: null,
        hasMore: false,
        totalCount: 0,
        limit: 20,
      }),
    },
  );

  assert.equal(response.status, 200);
});

test("admin messages API: list returns items", async () => {
  const response = await handleAdminMessagesListGet(
    new Request("http://localhost/api/admin/messages?status=NEW&q=damian"),
    {
      getSession: async () => ({
        userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
        role: "ADMIN",
        expiresAt: 999999999,
        issuedAt: 999999000,
      }),
      getPage: async () => ({
        items: [
          {
            id: "msg-1",
            createdAt: "2026-02-22T08:00:00.000Z",
            name: "Damian Thompson",
            email: "damian@example.com",
            status: "NEW",
            snippet: "Need details for a booking",
            source: "contact_page",
          },
        ],
        nextCursor: "cursor-1",
        hasMore: true,
        totalCount: 1,
        limit: 20,
      }),
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok: boolean;
    items: Array<{ id: string }>;
    nextCursor: string | null;
    hasMore: boolean;
  };

  assert.equal(body.ok, true);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0]?.id, "msg-1");
  assert.equal(body.nextCursor, "cursor-1");
  assert.equal(body.hasMore, true);
});

test("admin messages API: list forwards sortBy/sortDir", async () => {
  let capturedSortBy: string | null | undefined;
  let capturedSortDir: string | null | undefined;

  const response = await handleAdminMessagesListGet(
    new Request("http://localhost/api/admin/messages?sortBy=name&sortDir=asc"),
    {
      getSession: async () => ({
        userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
        role: "ADMIN",
        expiresAt: 999999999,
        issuedAt: 999999000,
      }),
      getPage: async (input) => {
        capturedSortBy = input.sortBy;
        capturedSortDir = input.sortDir;
        return {
          items: [],
          nextCursor: null,
          hasMore: false,
          totalCount: 0,
          limit: 20,
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(capturedSortBy, "name");
  assert.equal(capturedSortDir, "asc");
});

test("admin messages API: patch updates status", async () => {
  const response = await handleAdminMessagePatch(
    new Request("http://localhost/api/admin/messages/msg-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({ action: "MARK_READ", csrfToken: "token" }),
    }),
    {
      params: Promise.resolve({ id: "msg-1" }),
    },
    {
      getSession: async () => ({
        userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
        role: "ADMIN",
        expiresAt: 999999999,
        issuedAt: 999999000,
      }),
      requireCsrfCheck: async () => true,
      getMessage: async () => ({
        item: null,
        statusChanged: false,
        previousStatus: null,
      }),
      patchMessage: async () => ({
        previousStatus: "NEW",
        item: {
          id: "msg-1",
          createdAt: "2026-02-22T08:00:00.000Z",
          name: "Damian",
          email: "damian@example.com",
          status: "READ",
          snippet: "Need details",
          source: "contact_page",
          message: "Need details for a booking",
          readAt: "2026-02-22T08:10:00.000Z",
          readByUserId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
        },
      }),
      writeAudit: async () => {},
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok: boolean;
    item: { status: string };
  };
  assert.equal(body.ok, true);
  assert.equal(body.item.status, "READ");
});

test("admin messages API: patch requires auth", async () => {
  const response = await handleAdminMessagePatch(
    new Request("http://localhost/api/admin/messages/msg-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({ action: "MARK_READ", csrfToken: "token" }),
    }),
    {
      params: Promise.resolve({ id: "msg-1" }),
    },
    {
      getSession: async () => null,
      requireCsrfCheck: async () => true,
      getMessage: async () => ({
        item: null,
        statusChanged: false,
        previousStatus: null,
      }),
      patchMessage: async () => ({
        previousStatus: null,
        item: null,
      }),
      writeAudit: async () => {},
    },
  );

  assert.equal(response.status, 401);
});

test("admin messages API: unread count endpoint returns count", async () => {
  const response = await handleAdminMessagesUnreadCountGet(
    new Request("http://localhost/api/admin/messages/unread-count"),
    {
      getSession: async () => ({
        userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
        role: "ADMIN",
        expiresAt: 999999999,
        issuedAt: 999999000,
      }),
      getUnreadCount: async () => 3,
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean; count: number };
  assert.equal(body.ok, true);
  assert.equal(body.count, 3);
});

test("admin messages API: bulk endpoint requires auth", async () => {
  const response = await handleAdminMessagesBulkPost(
    new Request("http://localhost/api/admin/messages/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({
        ids: ["91c7c89a-9f07-4d59-b79b-f92d55f0cf8b"],
        action: "MARK_READ",
        csrfToken: "token",
      }),
    }),
    {
      getSession: async () => null,
      requireCsrfCheck: async () => true,
      bulkUpdate: async () => ({ updatedCount: 0, changes: [] }),
      writeAudit: async () => {},
    },
  );

  assert.equal(response.status, 401);
});

test("admin messages API: bulk endpoint updates statuses", async () => {
  const auditEntityIds: string[] = [];

  const response = await handleAdminMessagesBulkPost(
    new Request("http://localhost/api/admin/messages/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": "token" },
      body: JSON.stringify({
        ids: [
          "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
          "d0381b5d-17d8-4f1e-a2c6-0b4e64c12ce8",
        ],
        action: "ARCHIVE",
        csrfToken: "token",
      }),
    }),
    {
      getSession: async () => ({
        userId: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
        role: "ADMIN",
        expiresAt: 999999999,
        issuedAt: 999999000,
      }),
      requireCsrfCheck: async () => true,
      bulkUpdate: async () => ({
        updatedCount: 2,
        changes: [
          {
            id: "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
            previousStatus: "NEW",
            nextStatus: "ARCHIVED",
          },
          {
            id: "d0381b5d-17d8-4f1e-a2c6-0b4e64c12ce8",
            previousStatus: "READ",
            nextStatus: "ARCHIVED",
          },
        ],
      }),
      writeAudit: async (input) => {
        if (input.entityId) auditEntityIds.push(input.entityId);
      },
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean; updatedCount: number };
  assert.equal(body.ok, true);
  assert.equal(body.updatedCount, 2);
  assert.deepEqual(auditEntityIds, [
    "91c7c89a-9f07-4d59-b79b-f92d55f0cf8b",
    "d0381b5d-17d8-4f1e-a2c6-0b4e64c12ce8",
  ]);
});
