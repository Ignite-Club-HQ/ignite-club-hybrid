import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcResult, tableResults, queries } = vi.hoisted(() => ({
  rpcResult: { data: null as any, error: null as any, throws: null as any },
  tableResults: new Map<string, { data: any; error: any }>(),
  queries: [] as Array<{ table: string; chain: any }>,
}));

const mockSupabase = await vi.hoisted(async () => {
  const { createMockSupabaseClient } = await import("@/test/mockSupabaseClient");
  return createMockSupabaseClient();
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: mockSupabase }));

import {
  createEmptyUnreadMessageCounts,
  fetchUnreadMessageCounts,
  getTotalUnreadMessageCount,
} from "./unreadMessageCounts";
import { MESSAGE_NOTIFICATION_TYPES } from "./notificationTypes";

function tableQuery(table: string) {
  const result = tableResults.get(table) ?? { data: [], error: null };
  const chain: any = {};
  for (const method of ["select", "eq", "in", "order"]) chain[method] = vi.fn(() => chain);
  Object.defineProperty(chain, "then", {
    value: (resolve: any) => Promise.resolve(result).then(resolve),
  });
  queries.push({ table, chain });
  return chain;
}

describe("unread message count aggregation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableResults.clear();
    queries.length = 0;
    rpcResult.data = null;
    rpcResult.error = null;
    rpcResult.throws = null;
    mockSupabase.rpc.mockImplementation(() => {
      if (rpcResult.throws) return Promise.reject(rpcResult.throws);
      return Promise.resolve({ data: rpcResult.data, error: rpcResult.error });
    });
    mockSupabase.from.mockImplementation(tableQuery);
  });

  it("creates independent empty count containers", () => {
    const first = createEmptyUnreadMessageCounts();
    const second = createEmptyUnreadMessageCounts();
    first.teams["team-1"] = 3;

    expect(second).toEqual({ broadcast: 0, teams: {}, clubs: {}, groups: {}, dms: {} });
  });

  it("totals every unread scope", () => {
    expect(getTotalUnreadMessageCount({
      broadcast: 2,
      teams: { "team-1": 3, "team-2": 1 },
      clubs: { "club-1": 4 },
      groups: { "group-1": 2 },
      dms: { "conversation-1": 5 },
    })).toBe(17);
  });

  it("uses the single-RPC fast path and normalizes numeric values", async () => {
    rpcResult.data = {
      broadcast: "2",
      teams: { "team-1": 3 },
      clubs: { "club-1": 1 },
      groups: { "group-1": 4 },
      dms: { "conversation-1": 2 },
    };

    await expect(fetchUnreadMessageCounts("user-1")).resolves.toEqual({
      broadcast: 2,
      teams: { "team-1": 3 },
      clubs: { "club-1": 1 },
      groups: { "group-1": 4 },
      dms: { "conversation-1": 2 },
    });
    expect(mockSupabase.rpc).toHaveBeenCalledWith("get_unread_message_counts", { _user_id: "user-1" });
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it("fills missing RPC scopes with safe empty defaults", async () => {
    rpcResult.data = { broadcast: null, teams: null };

    await expect(fetchUnreadMessageCounts("user-1")).resolves.toEqual(
      createEmptyUnreadMessageCounts(),
    );
  });

  it.each(["rpc error", "rpc exception", "malformed response"])(
    "falls back to the legacy notification lookup after %s",
    async scenario => {
      if (scenario === "rpc error") rpcResult.error = { message: "RPC unavailable" };
      if (scenario === "rpc exception") rpcResult.throws = new Error("network adapter failed");
      if (scenario === "malformed response") rpcResult.data = "not-an-object";
      tableResults.set("notifications", { data: [], error: null });

      await expect(fetchUnreadMessageCounts("user-1")).resolves.toEqual(
        createEmptyUnreadMessageCounts(),
      );
      expect(mockSupabase.from).toHaveBeenCalledWith("notifications");
    },
  );

  it("scopes the legacy source query to the user's unread message notifications", async () => {
    rpcResult.error = { message: "RPC unavailable" };
    tableResults.set("notifications", { data: [], error: null });

    await fetchUnreadMessageCounts("user-1");

    const source = queries[0].chain;
    expect(source.select).toHaveBeenCalledWith("id, type, related_id");
    expect(source.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(source.eq).toHaveBeenCalledWith("is_read", false);
    expect(source.in).toHaveBeenCalledWith("type", MESSAGE_NOTIFICATION_TYPES);
  });

  it("aggregates broadcast, team, club and group notifications by owning scope", async () => {
    rpcResult.error = { message: "RPC unavailable" };
    tableResults.set("notifications", { data: [
      { id: "n1", type: "broadcast", related_id: null },
      { id: "n2", type: "broadcast", related_id: "unused" },
      { id: "n3", type: "team_message", related_id: "tm-1" },
      { id: "n4", type: "team_message", related_id: "tm-2" },
      { id: "n5", type: "club_message", related_id: "cm-1" },
      { id: "n6", type: "group_message", related_id: "gm-1" },
    ], error: null });
    tableResults.set("team_messages", { data: [
      { id: "tm-1", team_id: "team-1" },
      { id: "tm-2", team_id: "team-1" },
    ], error: null });
    tableResults.set("club_messages", { data: [{ id: "cm-1", club_id: "club-1" }], error: null });
    tableResults.set("group_messages", { data: [{ id: "gm-1", group_id: "group-1" }], error: null });

    await expect(fetchUnreadMessageCounts("user-1")).resolves.toEqual({
      broadcast: 2,
      teams: { "team-1": 2 },
      clubs: { "club-1": 1 },
      groups: { "group-1": 1 },
      dms: {},
    });
  });

  it("counts a DM conversation when its latest message came from another user", async () => {
    rpcResult.error = { message: "RPC unavailable" };
    tableResults.set("notifications", { data: [
      { id: "n1", type: "direct_message", related_id: "conversation-1" },
      { id: "n2", type: "direct_message", related_id: "conversation-1" },
    ], error: null });
    tableResults.set("direct_messages", { data: [
      { conversation_id: "conversation-1", author_id: "user-2", created_at: "2026-07-20T12:00:00Z" },
      { conversation_id: "conversation-1", author_id: "user-1", created_at: "2026-07-20T11:00:00Z" },
    ], error: null });

    const counts = await fetchUnreadMessageCounts("user-1");
    expect(counts.dms).toEqual({ "conversation-1": 2 });
  });

  it("suppresses a DM badge when the current user authored the latest message", async () => {
    rpcResult.error = { message: "RPC unavailable" };
    tableResults.set("notifications", { data: [
      { id: "n1", type: "direct_message", related_id: "conversation-1" },
    ], error: null });
    tableResults.set("direct_messages", { data: [
      { conversation_id: "conversation-1", author_id: "user-1", created_at: "2026-07-20T12:00:00Z" },
      { conversation_id: "conversation-1", author_id: "user-2", created_at: "2026-07-20T11:00:00Z" },
    ], error: null });

    const counts = await fetchUnreadMessageCounts("user-1");
    expect(counts.dms).toEqual({});
  });

  it("ignores notifications with missing relationships or unresolved message rows", async () => {
    rpcResult.error = { message: "RPC unavailable" };
    tableResults.set("notifications", { data: [
      { id: "n1", type: "team_message", related_id: null },
      { id: "n2", type: "team_message", related_id: "deleted-message" },
      { id: "n3", type: "unknown_type", related_id: "unknown" },
    ], error: null });
    tableResults.set("team_messages", { data: [], error: null });

    await expect(fetchUnreadMessageCounts("user-1")).resolves.toEqual(
      createEmptyUnreadMessageCounts(),
    );
  });

  it.each(["notifications", "team_messages", "club_messages", "group_messages", "direct_messages"])(
    "surfaces a legacy %s lookup failure",
    async failingTable => {
      rpcResult.error = { message: "RPC unavailable" };
      tableResults.set("notifications", { data: [
        { id: "n-team", type: "team_message", related_id: "tm-1" },
        { id: "n-club", type: "club_message", related_id: "cm-1" },
        { id: "n-group", type: "group_message", related_id: "gm-1" },
        { id: "n-dm", type: "direct_message", related_id: "conversation-1" },
      ], error: null });
      tableResults.set("team_messages", { data: [{ id: "tm-1", team_id: "team-1" }], error: null });
      tableResults.set("club_messages", { data: [{ id: "cm-1", club_id: "club-1" }], error: null });
      tableResults.set("group_messages", { data: [{ id: "gm-1", group_id: "group-1" }], error: null });
      tableResults.set("direct_messages", { data: [
        { conversation_id: "conversation-1", author_id: "user-2", created_at: "2026-07-20T12:00:00Z" },
      ], error: null });
      tableResults.set(failingTable, { data: null, error: { message: `${failingTable} denied` } });

      await expect(fetchUnreadMessageCounts("user-1")).rejects.toEqual({
        message: `${failingTable} denied`,
      });
    },
  );
});
