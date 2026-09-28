import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  resolveDirectNotificationTarget,
  resolveLegacyReactionContainerPath,
  resolveLegacyReactionTarget,
  resolveScopedMessageNotificationTarget,
} from "./notificationNavigationRepository";

type IgniteSupabaseClient = SupabaseClient<Database>;
type Result = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

function scriptedClient(script: Record<string, Result[]>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const query: Record<string, unknown> = {};
    const record = (method: string) => (...args: unknown[]) => {
      calls.push({ table, method, args });
      return query;
    };
    for (const method of ["select", "gte", "lte", "order", "limit", "in", "eq", "is", "neq"]) {
      query[method] = record(method);
    }
    const take = () => script[table]?.shift() ?? { data: null, error: null };
    query.maybeSingle = async () => take();
    query.then = (
      resolve: (value: Result) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(take()).then(resolve, reject);
    return query;
  };
  return { client: { from } as unknown as IgniteSupabaseClient, calls };
}

const notification = {
  related_id: "scope-a",
  user_id: "author-a",
  created_at: "2026-08-18T00:00:10.000Z",
};

describe("legacy notification navigation repository", () => {
  it("does not query without a valid related scope and timestamp", async () => {
    const empty = scriptedClient({});
    await expect(resolveLegacyReactionTarget({ ...notification, related_id: null }, empty.client))
      .resolves.toBeNull();
    await expect(resolveLegacyReactionTarget({ ...notification, created_at: "invalid" }, empty.client))
      .resolves.toBeNull();
    expect(empty.calls).toEqual([]);
  });

  it("finds the exact team message inside the reaction time window and immutable scope", async () => {
    const fake = scriptedClient({
      message_reactions: [{
        data: [{ team_message_id: "message-a" }],
        error: null,
      }],
      team_messages: [{ data: [{ id: "message-a", team_id: "scope-a" }], error: null }],
    });
    await expect(resolveLegacyReactionTarget(notification, fake.client)).resolves.toEqual({
      kind: "team",
      targetId: "scope-a",
      messageId: "message-a",
      path: "/messages/scope-a?message=message-a",
    });
    expect(fake.calls).toEqual(expect.arrayContaining([
      { table: "message_reactions", method: "gte", args: ["created_at", "2026-08-18T00:00:05.000Z"] },
      { table: "message_reactions", method: "lte", args: ["created_at", "2026-08-18T00:00:15.000Z"] },
      { table: "team_messages", method: "eq", args: ["team_id", "scope-a"] },
      { table: "team_messages", method: "eq", args: ["author_id", "author-a"] },
    ]));
  });

  it.each([
    ["club_message_id", "club_messages", { id: "message-a", club_id: "scope-a" }, "club", "/messages/club/scope-a?message=message-a"],
    ["group_message_id", "group_messages", { id: "message-a", group_id: "scope-a" }, "group", "/groups/scope-a?message=message-a"],
    ["direct_message_id", "direct_messages", { id: "message-a", conversation_id: "scope-a" }, "dm", "/messages/dm/scope-a?message=message-a"],
    ["broadcast_message_id", "broadcast_messages", { id: "message-a" }, "broadcast", "/messages/broadcast?message=message-a"],
    ["club_admin_message_id", "club_admin_messages", { id: "message-a", conversation_id: "scope-a" }, "club_admin", "/messages/club-admin/scope-a?message=message-a"],
  ] as const)("resolves %s through its exact message table", async (
    reactionKey,
    table,
    row,
    kind,
    path,
  ) => {
    const fake = scriptedClient({
      message_reactions: [{ data: [{ [reactionKey]: "message-a" }], error: null }],
      [table]: [{ data: [row], error: null }],
    });
    await expect(resolveLegacyReactionTarget(notification, fake.client)).resolves.toMatchObject({
      kind,
      messageId: "message-a",
      path,
    });
  });

  it("returns null when candidate reaction rows do not resolve under RLS", async () => {
    const fake = scriptedClient({
      message_reactions: [{ data: [{ team_message_id: "hidden-message" }], error: null }],
      team_messages: [{ data: [], error: { code: "42501", message: "denied" } }],
    });
    await expect(resolveLegacyReactionTarget(notification, fake.client)).resolves.toBeNull();
  });

  it.each([
    ["teams", "/messages/scope-a"],
    ["clubs", "/messages/club/scope-a"],
    ["chat_groups", "/groups/scope-a"],
    ["direct_conversations", "/messages/dm/scope-a"],
  ] as const)("resolves a legacy %s container after earlier misses", async (matchedTable, path) => {
    const tables = ["teams", "clubs", "chat_groups", "direct_conversations"];
    const script = Object.fromEntries(tables.map((table) => [
      table,
      [{ data: table === matchedTable ? { id: "scope-a" } : null, error: null }],
    ]));
    await expect(resolveLegacyReactionContainerPath("scope-a", scriptedClient(script).client))
      .resolves.toBe(path);
  });

  it("returns null when the legacy container is inaccessible everywhere", async () => {
    const fake = scriptedClient({});
    await expect(resolveLegacyReactionContainerPath("scope-a", fake.client)).resolves.toBeNull();
  });
});

describe("direct-message notification navigation", () => {
  it("opens an exact message id without probing legacy conversations", async () => {
    const fake = scriptedClient({ direct_messages: [{ data: { id: "message-a", conversation_id: "conversation-a" }, error: null }] });
    await expect(resolveDirectNotificationTarget("message-a", "user-a", null, fake.client)).resolves.toEqual({
      conversationId: "conversation-a",
      messageId: "message-a",
      path: "/messages/dm/conversation-a?message=message-a",
    });
    expect(fake.calls.some((call) => call.table === "direct_conversations")).toBe(false);
  });

  it("resolves a legacy conversation to the nearest incoming message before the click boundary", async () => {
    const fake = scriptedClient({
      direct_messages: [
        { data: null, error: null },
        { data: { id: "nearest-a", conversation_id: "conversation-a" }, error: null },
      ],
      direct_conversations: [{ data: { id: "conversation-a" }, error: null }],
    });
    await expect(resolveDirectNotificationTarget("conversation-a", "user-a", "2026-08-18T00:00:00.000Z", fake.client)).resolves.toEqual({
      conversationId: "conversation-a",
      messageId: "nearest-a",
      path: "/messages/dm/conversation-a?message=nearest-a",
    });
    expect(fake.calls).toEqual(expect.arrayContaining([
      { table: "direct_messages", method: "eq", args: ["conversation_id", "conversation-a"] },
      { table: "direct_messages", method: "is", args: ["deleted_at", null] },
      { table: "direct_messages", method: "neq", args: ["author_id", "user-a"] },
      { table: "direct_messages", method: "lte", args: ["created_at", "2026-08-18T00:00:30.000Z"] },
      { table: "direct_messages", method: "order", args: ["created_at", { ascending: false }] },
      { table: "direct_messages", method: "limit", args: [1] },
    ]));
  });

  it("opens an accessible empty conversation without inventing a message jump", async () => {
    const fake = scriptedClient({
      direct_messages: [{ data: null, error: null }, { data: null, error: null }],
      direct_conversations: [{ data: { id: "conversation-a" }, error: null }],
    });
    await expect(resolveDirectNotificationTarget("conversation-a", "user-a", null, fake.client)).resolves.toEqual({
      conversationId: "conversation-a",
      messageId: null,
      path: "/messages/dm/conversation-a",
    });
  });

  it("does not apply a timestamp bound when the notification timestamp is invalid", async () => {
    const fake = scriptedClient({
      direct_messages: [{ data: null, error: null }, { data: null, error: null }],
      direct_conversations: [{ data: { id: "conversation-a" }, error: null }],
    });
    await resolveDirectNotificationTarget("conversation-a", undefined, "invalid", fake.client);
    expect(fake.calls.some((call) => call.method === "lte" || call.method === "neq")).toBe(false);
  });

  it("returns null when neither the message nor conversation is accessible", async () => {
    const fake = scriptedClient({ direct_messages: [{ data: null, error: null }], direct_conversations: [{ data: null, error: null }] });
    await expect(resolveDirectNotificationTarget("hidden", "user-a", null, fake.client)).resolves.toBeNull();
  });
});

describe("scoped message notification navigation", () => {
  it.each([
    ["club", "club_messages", { club_id: "club-a" }, "/messages/club/club-a?message=message-a"],
    ["group", "group_messages", { group_id: "group-a" }, "/groups/group-a?message=message-a"],
  ] as const)("resolves an exact %s message under its accessible scope", async (kind, table, data, path) => {
    const fake = scriptedClient({ [table]: [{ data, error: null }] });
    await expect(resolveScopedMessageNotificationTarget(kind, "message-a", fake.client)).resolves.toMatchObject({
      kind,
      messageId: "message-a",
      path,
    });
  });

  it.each(["club", "group"] as const)("returns null for an inaccessible %s message", async (kind) => {
    await expect(resolveScopedMessageNotificationTarget(kind, "hidden", scriptedClient({}).client)).resolves.toBeNull();
  });

  it("resolves an exact club-admin message to its conversation", async () => {
    const fake = scriptedClient({ club_admin_messages: [{ data: { conversation_id: "conversation-a" }, error: null }] });
    await expect(resolveScopedMessageNotificationTarget("club_admin", "message-a", fake.client)).resolves.toEqual({
      kind: "club_admin",
      targetId: "conversation-a",
      messageId: "message-a",
      path: "/messages/club-admin/conversation-a?message=message-a",
    });
  });

  it("supports legacy club-admin notifications that stored the conversation id", async () => {
    const fake = scriptedClient({
      club_admin_messages: [{ data: null, error: null }],
      club_admin_conversations: [{ data: { id: "conversation-a" }, error: null }],
    });
    await expect(resolveScopedMessageNotificationTarget("club_admin", "conversation-a", fake.client)).resolves.toEqual({
      kind: "club_admin",
      targetId: "conversation-a",
      messageId: null,
      path: "/messages/club-admin/conversation-a",
    });
  });

  it("returns null when a club-admin message and legacy conversation are both inaccessible", async () => {
    await expect(resolveScopedMessageNotificationTarget("club_admin", "hidden", scriptedClient({}).client)).resolves.toBeNull();
  });
});
