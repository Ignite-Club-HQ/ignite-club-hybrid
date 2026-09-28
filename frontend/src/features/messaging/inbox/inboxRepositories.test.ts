import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  fetchInboxAdminTeamIds,
  fetchInboxAdminClubs,
  fetchInboxAppAdminStatus,
  fetchInboxBroadcastPrefetchPage,
  fetchInboxClubScopeFilter,
  fetchInboxClubProStatus,
  fetchInboxClubPrefetchPage,
  fetchInboxCommitteeMemberStatus,
  fetchInboxCompetitionClubMap,
  fetchInboxEventTitleMap,
  fetchInboxHiddenDirectMessages,
  fetchInboxHiddenGroups,
  fetchInboxGroupPrefetchPage,
  fetchInboxHasAnyProAccess,
  fetchInboxMutedChats,
  fetchInboxMemberClubsWithMessages,
  fetchInboxMemberTeamsWithMessages,
  fetchInboxChatGroupsWithMessages,
  fetchInboxLatestBroadcast,
  fetchInboxLatestDirectMessages,
  fetchInboxSystemMessage,
  fetchInboxTeamPrefetchPage,
  fetchInboxDirectConversationMembership,
  fetchInboxUserLeagueIds,
  fetchInboxUserRoles,
  fetchInboxVaultFileNameMap,
  fetchInboxVaultFolderNameMap,
} from "./inboxRepositories";

type IgniteSupabaseClient = SupabaseClient<Database>;

function queryClient(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
    neq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    or: vi.fn(),
    maybeSingle: vi.fn(),
    then: (
      resolve: (value: typeof result) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.is.mockReturnValue(builder);
  builder.neq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  builder.or.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue(result);
  const from = vi.fn().mockReturnValue(builder);

  return {
    client: { from } as unknown as IgniteSupabaseClient,
    from,
    builder,
  };
}

function tableQueryClient(results: Record<string, { data: unknown; error: unknown }>) {
  const queries = Object.fromEntries(
    Object.entries(results).map(([table, result]) => [table, queryClient(result)]),
  );
  const from = vi.fn((table: string) => queries[table].builder);
  return {
    client: { from } as unknown as IgniteSupabaseClient,
    from,
    queries,
  };
}

describe("messaging inbox repositories", () => {
  it("prefetches only the requested immutable group scope", async () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({
      id: `group-message-${3 - index}`,
      text: `Message ${3 - index}`,
      created_at: `2026-08-06T12:0${3 - index}:00Z`,
      author_id: "member-1",
      image_url: null,
      reply_to_id: null,
      group_id: "group-1",
    }));
    const fake = queryClient({ data: rows, error: null });

    await expect(fetchInboxGroupPrefetchPage("group-1", 2, fake.client)).resolves.toEqual({
      messages: [rows[1], rows[0]],
      hasOlderMessages: true,
    });
    expect(fake.from).toHaveBeenCalledWith("group_messages");
    expect(fake.builder.select).toHaveBeenCalledWith(
      "id, text, created_at, author_id, image_url, reply_to_id, group_id",
    );
    expect(fake.builder.eq).toHaveBeenCalledWith("group_id", "group-1");
    expect(fake.builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(fake.builder.limit).toHaveBeenCalledWith(3);
  });

  it("returns a short group prefetch page in chronological order", async () => {
    const newest = {
      id: "newest", text: "Newest", created_at: "2026-08-06T12:02:00Z",
      author_id: "member-1", image_url: null, reply_to_id: null, group_id: "group-1",
    };
    const oldest = {
      id: "oldest", text: "Oldest", created_at: "2026-08-06T12:01:00Z",
      author_id: "member-1", image_url: null, reply_to_id: null, group_id: "group-1",
    };
    const fake = queryClient({ data: [newest, oldest], error: null });

    await expect(fetchInboxGroupPrefetchPage("group-1", 15, fake.client)).resolves.toEqual({
      messages: [oldest, newest],
      hasOlderMessages: false,
    });
  });

  it("keeps an unavailable group prefetch non-blocking", async () => {
    const unavailable = queryClient({ data: null, error: new Error("group messages unavailable") });
    await expect(fetchInboxGroupPrefetchPage("group-1", 15, unavailable.client)).resolves.toEqual({
      messages: [], hasOlderMessages: false,
    });
  });

  it("prefetches only the requested immutable club scope", async () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({
      id: `club-message-${3 - index}`,
      text: `Message ${3 - index}`,
      created_at: `2026-08-06T12:0${3 - index}:00Z`,
      author_id: "admin-1",
      image_url: null,
      reply_to_id: null,
      club_id: "club-1",
    }));
    const fake = queryClient({ data: rows, error: null });

    await expect(fetchInboxClubPrefetchPage("club-1", 2, fake.client)).resolves.toEqual({
      messages: [rows[1], rows[0]],
      hasOlderMessages: true,
    });
    expect(fake.from).toHaveBeenCalledWith("club_messages");
    expect(fake.builder.select).toHaveBeenCalledWith(
      "id, text, created_at, author_id, image_url, reply_to_id, club_id",
    );
    expect(fake.builder.eq).toHaveBeenCalledWith("club_id", "club-1");
    expect(fake.builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(fake.builder.limit).toHaveBeenCalledWith(3);
  });

  it("returns a short club prefetch page in chronological order", async () => {
    const newest = {
      id: "newest", text: "Newest", created_at: "2026-08-06T12:02:00Z",
      author_id: "admin-1", image_url: null, reply_to_id: null, club_id: "club-1",
    };
    const oldest = {
      id: "oldest", text: "Oldest", created_at: "2026-08-06T12:01:00Z",
      author_id: "admin-1", image_url: null, reply_to_id: null, club_id: "club-1",
    };
    const fake = queryClient({ data: [newest, oldest], error: null });

    await expect(fetchInboxClubPrefetchPage("club-1", 15, fake.client)).resolves.toEqual({
      messages: [oldest, newest],
      hasOlderMessages: false,
    });
  });

  it("keeps an unavailable club prefetch non-blocking", async () => {
    const unavailable = queryClient({ data: null, error: new Error("club messages unavailable") });
    await expect(fetchInboxClubPrefetchPage("club-1", 15, unavailable.client)).resolves.toEqual({
      messages: [], hasOlderMessages: false,
    });
  });

  it("prefetches only the requested immutable team scope", async () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({
      id: `team-message-${3 - index}`,
      text: `Message ${3 - index}`,
      created_at: `2026-08-06T12:0${3 - index}:00Z`,
      author_id: "coach-1",
      image_url: null,
      reply_to_id: null,
      team_id: "team-1",
    }));
    const fake = queryClient({ data: rows, error: null });

    await expect(fetchInboxTeamPrefetchPage("team-1", 2, fake.client)).resolves.toEqual({
      messages: [rows[1], rows[0]],
      hasOlderMessages: true,
    });
    expect(fake.from).toHaveBeenCalledWith("team_messages");
    expect(fake.builder.select).toHaveBeenCalledWith(
      "id, text, created_at, author_id, image_url, reply_to_id, team_id",
    );
    expect(fake.builder.eq).toHaveBeenCalledWith("team_id", "team-1");
    expect(fake.builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(fake.builder.limit).toHaveBeenCalledWith(3);
  });

  it("returns a short team prefetch page in chronological order", async () => {
    const newest = {
      id: "newest", text: "Newest", created_at: "2026-08-06T12:02:00Z",
      author_id: "coach-1", image_url: null, reply_to_id: null, team_id: "team-1",
    };
    const oldest = {
      id: "oldest", text: "Oldest", created_at: "2026-08-06T12:01:00Z",
      author_id: "coach-1", image_url: null, reply_to_id: null, team_id: "team-1",
    };
    const fake = queryClient({ data: [newest, oldest], error: null });

    await expect(fetchInboxTeamPrefetchPage("team-1", 15, fake.client)).resolves.toEqual({
      messages: [oldest, newest],
      hasOlderMessages: false,
    });
  });

  it("keeps an unavailable team prefetch non-blocking", async () => {
    const unavailable = queryClient({ data: null, error: new Error("team messages unavailable") });
    await expect(fetchInboxTeamPrefetchPage("team-1", 15, unavailable.client)).resolves.toEqual({
      messages: [], hasOlderMessages: false,
    });
  });

  it("prefetches one descending broadcast page plus an older-page sentinel", async () => {
    const rows = Array.from({ length: 16 }, (_, index) => ({
      id: `message-${16 - index}`,
      text: `Message ${16 - index}`,
      created_at: `2026-08-06T12:${String(16 - index).padStart(2, "0")}:00Z`,
      author_id: "admin-1",
      image_url: null,
      reply_to_id: null,
    }));
    const fake = queryClient({ data: rows, error: null });

    const result = await fetchInboxBroadcastPrefetchPage(15, fake.client);
    expect(result.hasOlderMessages).toBe(true);
    expect(result.messages).toHaveLength(15);
    expect(result.messages[0].id).toBe("message-2");
    expect(result.messages[14].id).toBe("message-16");
    expect(fake.from).toHaveBeenCalledWith("broadcast_messages");
    expect(fake.builder.select).toHaveBeenCalledWith(
      "id, text, created_at, author_id, image_url, reply_to_id",
    );
    expect(fake.builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(fake.builder.limit).toHaveBeenCalledWith(16);
  });

  it("preserves chronological order for a short broadcast prefetch page", async () => {
    const newest = {
      id: "newest", text: "Newest", created_at: "2026-08-06T12:02:00Z",
      author_id: "admin-1", image_url: null, reply_to_id: null,
    };
    const oldest = {
      id: "oldest", text: "Oldest", created_at: "2026-08-06T12:01:00Z",
      author_id: "admin-1", image_url: null, reply_to_id: null,
    };
    const fake = queryClient({ data: [newest, oldest], error: null });

    await expect(fetchInboxBroadcastPrefetchPage(15, fake.client)).resolves.toEqual({
      messages: [oldest, newest],
      hasOlderMessages: false,
    });
  });

  it("keeps an empty or unavailable broadcast prefetch non-blocking", async () => {
    const empty = queryClient({ data: [], error: null });
    await expect(fetchInboxBroadcastPrefetchPage(15, empty.client)).resolves.toEqual({
      messages: [], hasOlderMessages: false,
    });

    const unavailable = queryClient({ data: null, error: new Error("broadcast unavailable") });
    await expect(fetchInboxBroadcastPrefetchPage(15, unavailable.client)).resolves.toEqual({
      messages: [], hasOlderMessages: false,
    });
  });

  it("reads only the current user's newest welcome system message", async () => {
    const welcome = {
      id: "welcome-1",
      user_id: "user-1",
      message_type: "welcome",
      text: "Welcome to Ignite",
      created_at: "2026-08-06T12:00:00Z",
      read_at: null,
    };
    const fake = queryClient({ data: welcome, error: null });

    await expect(fetchInboxSystemMessage("user-1", fake.client)).resolves.toEqual(welcome);
    expect(fake.from).toHaveBeenCalledWith("system_messages");
    expect(fake.builder.select).toHaveBeenCalledWith("*");
    expect(fake.builder.eq).toHaveBeenNthCalledWith(1, "user_id", "user-1");
    expect(fake.builder.eq).toHaveBeenNthCalledWith(2, "message_type", "welcome");
    expect(fake.builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(fake.builder.limit).toHaveBeenCalledWith(1);
    expect(fake.builder.maybeSingle).toHaveBeenCalledOnce();
  });

  it("keeps the established empty and unavailable system-message behavior", async () => {
    const empty = queryClient({ data: null, error: null });
    await expect(fetchInboxSystemMessage("user-1", empty.client)).resolves.toBeNull();

    const unavailable = queryClient({ data: null, error: new Error("welcome unavailable") });
    await expect(fetchInboxSystemMessage("user-1", unavailable.client)).resolves.toBeNull();
  });

  it("reads direct-conversation membership for either participant in latest-update order", async () => {
    const conversations = [
      { id: "dm-2", participant_1: "user-2", participant_2: "user-1", updated_at: "2026-08-06T11:00:00Z" },
      { id: "dm-1", participant_1: "user-1", participant_2: "user-3", updated_at: "2026-08-06T10:00:00Z" },
    ];
    const fake = queryClient({ data: conversations, error: null });

    await expect(fetchInboxDirectConversationMembership("user-1", fake.client)).resolves.toEqual({
      conversations,
      otherUserIds: ["user-2", "user-3"],
    });
    expect(fake.from).toHaveBeenCalledWith("direct_conversations");
    expect(fake.builder.select).toHaveBeenCalledWith("*");
    expect(fake.builder.or).toHaveBeenCalledWith("participant_1.eq.user-1,participant_2.eq.user-1");
    expect(fake.builder.order).toHaveBeenCalledWith("updated_at", { ascending: false });
  });

  it("returns an empty direct-conversation membership result without inventing peers", async () => {
    const fake = queryClient({ data: [], error: null });

    await expect(fetchInboxDirectConversationMembership("user-1", fake.client))
      .resolves.toEqual({ conversations: [], otherUserIds: [] });
  });

  it("does not convert a direct-conversation membership failure into an empty inbox", async () => {
    const failure = new Error("conversation membership unavailable");
    const fake = queryClient({ data: null, error: failure });

    await expect(fetchInboxDirectConversationMembership("user-1", fake.client)).rejects.toBe(failure);
  });

  function latestDirectMessagesClient(options: {
    rpc: { data: unknown; error: unknown } | Error;
    messages?: Record<string, { data: unknown; error: unknown }>;
  }) {
    const operations: Array<[string, string, ...unknown[]]> = [];
    const from = vi.fn((table: string) => {
      let conversationId = "";
      const result = () => options.messages?.[conversationId] ?? { data: null, error: null };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {};
      for (const method of ["select", "order", "limit"]) {
        builder[method] = vi.fn((...args: unknown[]) => {
          operations.push([table, method, ...args]);
          return builder;
        });
      }
      builder.eq = vi.fn((column: string, value: unknown) => {
        operations.push([table, "eq", column, value]);
        if (column === "conversation_id") conversationId = String(value);
        return builder;
      });
      builder.maybeSingle = vi.fn(async () => result());
      return builder;
    });
    const rpc = vi.fn(async () => {
      if (options.rpc instanceof Error) throw options.rpc;
      return options.rpc;
    });
    return { client: { from, rpc } as unknown as IgniteSupabaseClient, from, rpc, operations };
  }

  it("keeps an empty direct-message preview scope query-free", async () => {
    const fake = latestDirectMessagesClient({ rpc: { data: [], error: null } });

    const result = await fetchInboxLatestDirectMessages([], fake.client);
    expect([...result.entries()]).toEqual([]);
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("maps the batched latest-direct-message RPC by immutable conversation id", async () => {
    const fake = latestDirectMessagesClient({
      rpc: { data: [
        { conversation_id: "dm-1", text: "One", image_url: null, created_at: "2026-08-06T10:00:00Z", author_id: "user-1" },
        { conversation_id: "dm-2", text: "Two", image_url: "photo.jpg", created_at: "2026-08-06T11:00:00Z", author_id: "user-2" },
      ], error: null },
    });

    const result = await fetchInboxLatestDirectMessages(["dm-1", "dm-2"], fake.client);
    expect([...result.entries()]).toEqual([
      ["dm-1", { text: "One", image_url: null, created_at: "2026-08-06T10:00:00Z", author_id: "user-1" }],
      ["dm-2", { text: "Two", image_url: "photo.jpg", created_at: "2026-08-06T11:00:00Z", author_id: "user-2" }],
    ]);
    expect(fake.rpc).toHaveBeenCalledWith("get_inbox_latest_dm_messages", { _conversation_ids: ["dm-1", "dm-2"] });
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("treats a successful empty latest-direct-message RPC as authoritative", async () => {
    const fake = latestDirectMessagesClient({ rpc: { data: [], error: null } });

    const result = await fetchInboxLatestDirectMessages(["dm-1"], fake.client);
    expect([...result.entries()]).toEqual([]);
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("falls back to one exact latest-message read per conversation when the DM RPC fails", async () => {
    const fake = latestDirectMessagesClient({
      rpc: { data: null, error: new Error("RPC unavailable") },
      messages: {
        "dm-1": { data: { text: "One", image_url: null, created_at: "2026-08-06T10:00:00Z", author_id: "user-1" }, error: null },
        "dm-2": { data: null, error: null },
      },
    });

    const result = await fetchInboxLatestDirectMessages(["dm-1", "dm-2"], fake.client);
    expect([...result.entries()]).toEqual([
      ["dm-1", { text: "One", image_url: null, created_at: "2026-08-06T10:00:00Z", author_id: "user-1" }],
      ["dm-2", null],
    ]);
    expect(fake.from.mock.calls).toEqual([["direct_messages"], ["direct_messages"]]);
    expect(fake.operations).toContainEqual(["direct_messages", "select", "text, image_url, created_at, author_id"]);
    expect(fake.operations).toContainEqual(["direct_messages", "eq", "conversation_id", "dm-1"]);
    expect(fake.operations).toContainEqual(["direct_messages", "eq", "conversation_id", "dm-2"]);
    expect(fake.operations).toContainEqual(["direct_messages", "order", "created_at", { ascending: false }]);
    expect(fake.operations).toContainEqual(["direct_messages", "limit", 1]);
  });

  it("returns null for an empty broadcast feed and preserves the exact latest-row query", async () => {
    const fake = queryClient({ data: null, error: null });
    const selectProfile = vi.fn();

    await expect(fetchInboxLatestBroadcast({
      client: fake.client,
      selectProfile: selectProfile as unknown as typeof import("@/lib/profileCache").selectCachedProfileById,
    })).resolves.toBeNull();
    expect(fake.from).toHaveBeenCalledWith("broadcast_messages");
    expect(fake.builder.select).toHaveBeenCalledWith("text, created_at, image_url, author_id");
    expect(fake.builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(fake.builder.limit).toHaveBeenCalledWith(1);
    expect(fake.builder.maybeSingle).toHaveBeenCalledOnce();
    expect(selectProfile).not.toHaveBeenCalled();
  });

  it("returns an author-free broadcast without issuing a profile lookup", async () => {
    const row = { text: "System notice", created_at: "2026-08-06T10:00:00Z", image_url: null, author_id: null };
    const fake = queryClient({ data: row, error: null });
    const selectProfile = vi.fn();

    await expect(fetchInboxLatestBroadcast({
      client: fake.client,
      selectProfile: selectProfile as unknown as typeof import("@/lib/profileCache").selectCachedProfileById,
    })).resolves.toEqual({ ...row, profiles: { display_name: "" } });
    expect(selectProfile).not.toHaveBeenCalled();
  });

  it("maps the cached display name for an authored broadcast", async () => {
    const row = { text: "Latest notice", created_at: "2026-08-06T10:00:00Z", image_url: "notice.jpg", author_id: "author-1" };
    const fake = queryClient({ data: row, error: null });
    const selectProfile = vi.fn(async () => ({ data: { id: "author-1", display_name: "App Admin" }, error: null }));

    await expect(fetchInboxLatestBroadcast({
      client: fake.client,
      selectProfile: selectProfile as unknown as typeof import("@/lib/profileCache").selectCachedProfileById,
    })).resolves.toEqual({ ...row, profiles: { display_name: "App Admin" } });
    expect(selectProfile).toHaveBeenCalledOnce();
    expect(selectProfile).toHaveBeenCalledWith("author-1");
  });

  it("preserves an empty display name when an authored broadcast profile is unavailable", async () => {
    const row = { text: "Latest notice", created_at: "2026-08-06T10:00:00Z", image_url: null, author_id: "author-1" };
    const fake = queryClient({ data: row, error: null });
    const selectProfile = vi.fn(async () => ({ data: null, error: null }));

    await expect(fetchInboxLatestBroadcast({
      client: fake.client,
      selectProfile: selectProfile as unknown as typeof import("@/lib/profileCache").selectCachedProfileById,
    })).resolves.toEqual({ ...row, profiles: { display_name: "" } });
  });

  function memberClubsClient(options: {
    roles?: { data: unknown; error: unknown };
    clubs?: { data: unknown; error: unknown };
    rpc?: { data: unknown; error: unknown } | Error;
    messages?: Record<string, { data: unknown; error: unknown }>;
  }) {
    const operations: Array<[string, string, ...unknown[]]> = [];
    const from = vi.fn((table: string) => {
      let selectedClubId = "";
      const result = () => table === "user_roles"
        ? (options.roles ?? { data: [], error: null })
        : table === "clubs"
          ? (options.clubs ?? { data: [], error: null })
          : (options.messages?.[selectedClubId] ?? { data: null, error: null });
      // A deliberately small fluent PostgREST test double; production types
      // are asserted at the repository boundary by TypeScript.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {};
      for (const method of ["select", "in", "is", "neq", "not", "order", "limit"]) {
        builder[method] = vi.fn((...args: unknown[]) => {
          operations.push([table, method, ...args]);
          return builder;
        });
      }
      builder.eq = vi.fn((column: string, value: unknown) => {
        operations.push([table, "eq", column, value]);
        if (table === "club_messages" && column === "club_id") selectedClubId = String(value);
        return builder;
      });
      builder.maybeSingle = vi.fn(async () => result());
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject);
      return builder;
    });
    const rpc = vi.fn(async () => {
      if (options.rpc instanceof Error) throw options.rpc;
      return options.rpc ?? { data: [], error: null };
    });
    return {
      client: { from, rpc } as unknown as IgniteSupabaseClient,
      from,
      rpc,
      operations,
    };
  }

  function memberTeamsClient(options: {
    roles?: { data: unknown; error: unknown };
    teams?: { data: unknown; error: unknown };
    rpc?: { data: unknown; error: unknown } | Error;
    messages?: Record<string, { data: unknown; error: unknown }>;
  }) {
    const operations: Array<[string, string, ...unknown[]]> = [];
    const from = vi.fn((table: string) => {
      let selectedTeamId = "";
      const result = () => table === "user_roles"
        ? (options.roles ?? { data: [], error: null })
        : table === "teams"
          ? (options.teams ?? { data: [], error: null })
          : (options.messages?.[selectedTeamId] ?? { data: null, error: null });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {};
      for (const method of ["select", "in", "is", "not", "order", "limit"]) {
        builder[method] = vi.fn((...args: unknown[]) => {
          operations.push([table, method, ...args]);
          return builder;
        });
      }
      builder.eq = vi.fn((column: string, value: unknown) => {
        operations.push([table, "eq", column, value]);
        if (table === "team_messages" && column === "team_id") selectedTeamId = String(value);
        return builder;
      });
      builder.maybeSingle = vi.fn(async () => result());
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject);
      return builder;
    });
    const rpc = vi.fn(async () => {
      if (options.rpc instanceof Error) throw options.rpc;
      return options.rpc ?? { data: [], error: null };
    });
    return {
      client: { from, rpc } as unknown as IgniteSupabaseClient,
      from,
      rpc,
      operations,
    };
  }

  function chatGroupsClient(options: {
    groups?: { data: unknown; error: unknown };
    accessibleIds?: { data: unknown; error: unknown } | Error;
    latestMessages?: { data: unknown; error: unknown } | Error;
    messages?: Record<string, { data: unknown; error: unknown }>;
  }) {
    const operations: Array<[string, string, ...unknown[]]> = [];
    const from = vi.fn((table: string) => {
      let selectedGroupId = "";
      const result = () => table === "chat_groups"
        ? (options.groups ?? { data: [], error: null })
        : (options.messages?.[selectedGroupId] ?? { data: null, error: null });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {};
      for (const method of ["select", "in", "is", "order", "limit"]) {
        builder[method] = vi.fn((...args: unknown[]) => {
          operations.push([table, method, ...args]);
          return builder;
        });
      }
      builder.eq = vi.fn((column: string, value: unknown) => {
        operations.push([table, "eq", column, value]);
        if (table === "group_messages" && column === "group_id") selectedGroupId = String(value);
        return builder;
      });
      builder.maybeSingle = vi.fn(async () => result());
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject);
      return builder;
    });
    const rpc = vi.fn(async (name: string) => {
      const result = name === "get_my_accessible_chat_group_ids"
        ? (options.accessibleIds ?? { data: null, error: null })
        : (options.latestMessages ?? { data: [], error: null });
      if (result instanceof Error) throw result;
      return result;
    });
    return {
      client: { from, rpc } as unknown as IgniteSupabaseClient,
      from,
      rpc,
      operations,
    };
  }

  it("returns an empty member-club inbox without querying clubs or messages when no roles exist", async () => {
    const fake = memberClubsClient({ roles: { data: [], error: null } });

    await expect(fetchInboxMemberClubsWithMessages("user-1", { client: fake.client }))
      .resolves.toEqual({ clubs: [], latestMessages: {} });
    expect(fake.from).toHaveBeenCalledTimes(1);
    expect(fake.operations).toContainEqual(["user_roles", "not", "club_id", "is", null]);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when member-club role discovery fails", async () => {
    const failure = new Error("roles unavailable");
    const fake = memberClubsClient({ roles: { data: null, error: failure } });

    await expect(fetchInboxMemberClubsWithMessages("user-1", { client: fake.client }))
      .rejects.toBe(failure);
    expect(fake.from).not.toHaveBeenCalledWith("clubs");
  });

  it("deduplicates club scope, excludes deleted/shell clubs and uses the RPC fast path", async () => {
    const clubs = [{ id: "club-1", name: "Riverside", logo_url: null, sport: "football" }];
    const fake = memberClubsClient({
      roles: { data: [{ club_id: "club-1" }, { club_id: "club-1" }, { club_id: null }], error: null },
      clubs: { data: clubs, error: null },
      rpc: { data: [{ club_id: "club-1", text: "Latest", author_display_name: "Alex", created_at: "2026-08-06T10:00:00Z", image_url: null }], error: null },
    });
    const selectProfiles = vi.fn();

    await expect(fetchInboxMemberClubsWithMessages("user-1", {
      client: fake.client,
      selectProfiles: selectProfiles as unknown as typeof import("@/lib/profileCache").selectCachedProfilesByIds,
    })).resolves.toEqual({
      clubs,
      latestMessages: {
        "club-1": { text: "Latest", author: "Alex", created_at: "2026-08-06T10:00:00Z", image_url: null },
      },
    });
    expect(fake.operations).toContainEqual(["clubs", "in", "id", ["club-1"]]);
    expect(fake.operations).toContainEqual(["clubs", "is", "deleted_at", null]);
    expect(fake.operations).toContainEqual(["clubs", "neq", "kind", "shell"]);
    expect(fake.rpc).toHaveBeenCalledWith("get_inbox_latest_club_messages", { _club_ids: ["club-1"] });
    expect(fake.from).not.toHaveBeenCalledWith("club_messages");
    expect(selectProfiles).not.toHaveBeenCalled();
  });

  it("treats an empty successful RPC result as authoritative instead of starting the fallback", async () => {
    const clubs = [{ id: "club-1", name: "Riverside", logo_url: null, sport: "football" }];
    const fake = memberClubsClient({
      roles: { data: [{ club_id: "club-1" }], error: null },
      clubs: { data: clubs, error: null },
      rpc: { data: [], error: null },
    });

    await expect(fetchInboxMemberClubsWithMessages("user-1", { client: fake.client }))
      .resolves.toEqual({ clubs, latestMessages: {} });
    expect(fake.from).not.toHaveBeenCalledWith("club_messages");
  });

  it("preserves the legacy fallback and batches unique author profile lookup when the RPC fails", async () => {
    const clubs = [
      { id: "club-1", name: "Riverside", logo_url: null, sport: "football" },
      { id: "club-2", name: "Hills", logo_url: null, sport: "football" },
      { id: "club-3", name: "Empty", logo_url: null, sport: "football" },
    ];
    const fake = memberClubsClient({
      roles: { data: clubs.map(({ id }) => ({ club_id: id })), error: null },
      clubs: { data: clubs, error: null },
      rpc: { data: null, error: new Error("RPC unavailable") },
      messages: {
        "club-1": { data: { text: "One", author_id: "author-1", created_at: "2026-08-06T10:00:00Z", image_url: null }, error: null },
        "club-2": { data: { text: "Two", author_id: "author-1", created_at: "2026-08-06T11:00:00Z", image_url: "photo.jpg" }, error: null },
        "club-3": { data: null, error: null },
      },
    });
    const selectProfiles = vi.fn(async () => ({
      data: [{ id: "author-1", display_name: "Alex Member" }],
      error: null,
    }));

    const result = await fetchInboxMemberClubsWithMessages("user-1", {
      client: fake.client,
      selectProfiles: selectProfiles as unknown as typeof import("@/lib/profileCache").selectCachedProfilesByIds,
    });

    expect(result).toEqual({
      clubs,
      latestMessages: {
        "club-1": { text: "One", author: "Alex Member", created_at: "2026-08-06T10:00:00Z", image_url: null },
        "club-2": { text: "Two", author: "Alex Member", created_at: "2026-08-06T11:00:00Z", image_url: "photo.jpg" },
      },
    });
    expect(selectProfiles).toHaveBeenCalledOnce();
    expect(selectProfiles).toHaveBeenCalledWith(["author-1"]);
    expect(fake.from.mock.calls.filter(([table]) => table === "club_messages")).toHaveLength(3);
    expect(fake.operations).toContainEqual(["club_messages", "is", "deleted_at", null]);
    expect(fake.operations).toContainEqual(["club_messages", "order", "created_at", { ascending: false }]);
    expect(fake.operations).toContainEqual(["club_messages", "limit", 1]);
  });

  it("keeps the team inbox query-free beyond role discovery when no team membership exists", async () => {
    const fake = memberTeamsClient({ roles: { data: [], error: null } });

    await expect(fetchInboxMemberTeamsWithMessages("user-1", { client: fake.client }))
      .resolves.toEqual({ teams: [], latestMessages: {} });
    expect(fake.from).toHaveBeenCalledTimes(1);
    expect(fake.operations).toContainEqual(["user_roles", "not", "team_id", "is", null]);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when team membership or active-team discovery fails", async () => {
    const rolesFailure = new Error("roles unavailable");
    const failedRoles = memberTeamsClient({ roles: { data: null, error: rolesFailure } });
    await expect(fetchInboxMemberTeamsWithMessages("user-1", { client: failedRoles.client }))
      .rejects.toBe(rolesFailure);

    const teamsFailure = new Error("teams unavailable");
    const failedTeams = memberTeamsClient({
      roles: { data: [{ team_id: "team-1" }], error: null },
      teams: { data: null, error: teamsFailure },
    });
    await expect(fetchInboxMemberTeamsWithMessages("user-1", { client: failedTeams.client }))
      .rejects.toBe(teamsFailure);
    expect(failedTeams.rpc).not.toHaveBeenCalled();
  });

  it("excludes deleted teams and teams belonging to deleted or purged clubs before reading previews", async () => {
    const inactiveTeams = [
      { id: "team-1", name: "Deleted team", logo_url: null, deleted_at: "2026-01-01", clubs: { id: "club-1", name: "Club", logo_url: null, sport: "football" } },
      { id: "team-2", name: "Deleted club", logo_url: null, deleted_at: null, clubs: { id: "club-2", name: "Club", logo_url: null, sport: "football", deleted_at: "2026-01-01" } },
      { id: "team-3", name: "Purged club", logo_url: null, deleted_at: null, clubs: { id: "club-3", name: "Club", logo_url: null, sport: "football", purged_at: "2026-01-01" } },
    ];
    const fake = memberTeamsClient({
      roles: { data: inactiveTeams.map(({ id }) => ({ team_id: id })), error: null },
      teams: { data: inactiveTeams, error: null },
    });

    await expect(fetchInboxMemberTeamsWithMessages("user-1", { client: fake.client }))
      .resolves.toEqual({ teams: [], latestMessages: {} });
    expect(fake.operations).toContainEqual(["teams", "is", "deleted_at", null]);
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.from).not.toHaveBeenCalledWith("team_messages");
  });

  it("uses only active team ids in the RPC and preserves club-announcement authorship", async () => {
    const activeTeam = { id: "team-1", name: "U8 Blue", logo_url: null, deleted_at: null, clubs: { id: "club-1", name: "Riverside", logo_url: null, sport: "football", deleted_at: null, purged_at: null } };
    const deletedTeam = { ...activeTeam, id: "team-2", deleted_at: "2026-01-01" };
    const fake = memberTeamsClient({
      roles: { data: [{ team_id: "team-1" }, { team_id: "team-2" }], error: null },
      teams: { data: [activeTeam, deletedTeam], error: null },
      rpc: { data: [{ team_id: "team-1", text: "Club update", author_display_name: "Ignored", created_at: "2026-08-06T10:00:00Z", image_url: null, is_club_announcement: true, club_announcement_name: "Riverside FC" }], error: null },
    });

    await expect(fetchInboxMemberTeamsWithMessages("user-1", { client: fake.client })).resolves.toEqual({
      teams: [activeTeam],
      latestMessages: {
        "team-1": { text: "Club update", author: "Riverside FC", created_at: "2026-08-06T10:00:00Z", image_url: null, is_announcement: true },
      },
    });
    expect(fake.rpc).toHaveBeenCalledWith("get_inbox_latest_team_messages", { _team_ids: ["team-1"] });
    expect(fake.from).not.toHaveBeenCalledWith("team_messages");
  });

  it("treats an empty successful team RPC result as authoritative", async () => {
    const team = { id: "team-1", name: "U8 Blue", logo_url: null, deleted_at: null, clubs: { id: "club-1", name: "Riverside", logo_url: null, sport: "football" } };
    const fake = memberTeamsClient({
      roles: { data: [{ team_id: "team-1" }], error: null },
      teams: { data: [team], error: null },
      rpc: { data: [], error: null },
    });

    await expect(fetchInboxMemberTeamsWithMessages("user-1", { client: fake.client }))
      .resolves.toEqual({ teams: [team], latestMessages: {} });
    expect(fake.from).not.toHaveBeenCalledWith("team_messages");
  });

  it("preserves the team fallback, announcement metadata and one batched regular-author lookup", async () => {
    const teams = [
      { id: "team-1", name: "U8 Blue", logo_url: null, deleted_at: null, clubs: { id: "club-1", name: "Riverside", logo_url: null, sport: "football" } },
      { id: "team-2", name: "U9 Blue", logo_url: null, deleted_at: null, clubs: { id: "club-1", name: "Riverside", logo_url: null, sport: "football" } },
      { id: "team-3", name: "U10 Blue", logo_url: null, deleted_at: null, clubs: { id: "club-1", name: "Riverside", logo_url: null, sport: "football" } },
    ];
    const fake = memberTeamsClient({
      roles: { data: teams.map(({ id }) => ({ team_id: id })), error: null },
      teams: { data: teams, error: null },
      rpc: new Error("RPC unavailable"),
      messages: {
        "team-1": { data: { text: "One", author_id: "author-1", created_at: "2026-08-06T10:00:00Z", image_url: null, is_club_announcement: false, club_announcement_name: null }, error: null },
        "team-2": { data: { text: "Two", author_id: "author-1", created_at: "2026-08-06T11:00:00Z", image_url: null, is_club_announcement: false, club_announcement_name: null }, error: null },
        "team-3": { data: { text: "Announcement", author_id: "author-2", created_at: "2026-08-06T12:00:00Z", image_url: "notice.jpg", is_club_announcement: true, club_announcement_name: "Riverside FC" }, error: null },
      },
    });
    const selectProfiles = vi.fn(async () => ({ data: [{ id: "author-1", display_name: "Alex Member" }], error: null }));

    const result = await fetchInboxMemberTeamsWithMessages("user-1", {
      client: fake.client,
      selectProfiles: selectProfiles as unknown as typeof import("@/lib/profileCache").selectCachedProfilesByIds,
    });

    expect(result.latestMessages).toEqual({
      "team-1": { text: "One", author: "Alex Member", created_at: "2026-08-06T10:00:00Z", image_url: null, is_announcement: false },
      "team-2": { text: "Two", author: "Alex Member", created_at: "2026-08-06T11:00:00Z", image_url: null, is_announcement: false },
      "team-3": { text: "Announcement", author: "Riverside FC", created_at: "2026-08-06T12:00:00Z", image_url: "notice.jpg", is_announcement: true },
    });
    expect(selectProfiles).toHaveBeenCalledOnce();
    expect(selectProfiles).toHaveBeenCalledWith(["author-1"]);
    expect(fake.from.mock.calls.filter(([table]) => table === "team_messages")).toHaveLength(3);
    expect(fake.operations).toContainEqual(["team_messages", "order", "created_at", { ascending: false }]);
    expect(fake.operations).toContainEqual(["team_messages", "limit", 1]);
  });

  it("returns immediately when the accessible-group RPC authoritatively returns no scope", async () => {
    const fake = chatGroupsClient({ accessibleIds: { data: [], error: null } });

    await expect(fetchInboxChatGroupsWithMessages("user-1", { client: fake.client }))
      .resolves.toEqual({ groups: [], latestMessages: {} });
    expect(fake.rpc).toHaveBeenCalledWith("get_my_accessible_chat_group_ids", { _user_id: "user-1" });
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("falls back to the existing RLS-protected group read when accessible-id discovery fails", async () => {
    const fake = chatGroupsClient({
      accessibleIds: { data: null, error: new Error("scope RPC unavailable") },
      groups: { data: [], error: null },
    });

    await expect(fetchInboxChatGroupsWithMessages("user-1", { client: fake.client }))
      .resolves.toEqual({ groups: [], latestMessages: {} });
    expect(fake.from).toHaveBeenCalledWith("chat_groups");
    expect(fake.operations.some(([table, method]) => table === "chat_groups" && method === "in")).toBe(false);
  });

  it("honours the accessible-id RPC kill switch without changing the RLS-backed query", async () => {
    const fake = chatGroupsClient({ groups: { data: [], error: null } });

    await fetchInboxChatGroupsWithMessages("user-1", {
      client: fake.client,
      accessibleIdsRpcEnabled: false,
    });
    expect(fake.rpc).not.toHaveBeenCalledWith("get_my_accessible_chat_group_ids", expect.anything());
    expect(fake.from).toHaveBeenCalledWith("chat_groups");
  });

  it("scopes the group read to accessible IDs and excludes deleted team or club parents", async () => {
    const active = { id: "group-1", deleted_at: null, teams: { name: "U8", deleted_at: null }, clubs: { name: "Riverside", logo_url: null, deleted_at: null, purged_at: null }, mini_leagues: null };
    const deletedTeam = { ...active, id: "group-2", teams: { name: "Old", deleted_at: "2026-01-01" } };
    const purgedClub = { ...active, id: "group-3", clubs: { ...active.clubs, purged_at: "2026-01-01" } };
    const fake = chatGroupsClient({
      accessibleIds: { data: ["group-1", "group-2", "group-3"], error: null },
      groups: { data: [active, deletedTeam, purgedClub], error: null },
      latestMessages: { data: [], error: null },
    });

    await expect(fetchInboxChatGroupsWithMessages("user-1", { client: fake.client }))
      .resolves.toEqual({ groups: [active], latestMessages: {} });
    expect(fake.operations).toContainEqual(["chat_groups", "in", "id", ["group-1", "group-2", "group-3"]]);
    expect(fake.operations).toContainEqual(["chat_groups", "is", "deleted_at", null]);
    expect(fake.rpc).toHaveBeenCalledWith("get_inbox_latest_group_messages", { _group_ids: ["group-1"] });
  });

  it("maps the latest-group RPC result and does not start the legacy fallback", async () => {
    const group = { id: "group-1", deleted_at: null, teams: null, clubs: { name: "Riverside", logo_url: null, deleted_at: null, purged_at: null }, mini_leagues: null };
    const fake = chatGroupsClient({
      accessibleIds: { data: ["group-1"], error: null },
      groups: { data: [group], error: null },
      latestMessages: { data: [{ group_id: "group-1", text: "Latest", author_display_name: "Alex", created_at: "2026-08-06T10:00:00Z", image_url: null }], error: null },
    });
    const selectProfiles = vi.fn();

    await expect(fetchInboxChatGroupsWithMessages("user-1", {
      client: fake.client,
      selectProfiles: selectProfiles as unknown as typeof import("@/lib/profileCache").selectCachedProfilesByIds,
    })).resolves.toEqual({
      groups: [group],
      latestMessages: { "group-1": { text: "Latest", author: "Alex", created_at: "2026-08-06T10:00:00Z", image_url: null } },
    });
    expect(fake.from).not.toHaveBeenCalledWith("group_messages");
    expect(selectProfiles).not.toHaveBeenCalled();
  });

  it("treats a successful empty latest-group RPC as authoritative", async () => {
    const group = { id: "group-1", deleted_at: null, teams: null, clubs: null, mini_leagues: { name: "Mini League" } };
    const fake = chatGroupsClient({
      accessibleIds: { data: ["group-1"], error: null },
      groups: { data: [group], error: null },
      latestMessages: { data: [], error: null },
    });

    await expect(fetchInboxChatGroupsWithMessages("user-1", { client: fake.client }))
      .resolves.toEqual({ groups: [group], latestMessages: {} });
    expect(fake.from).not.toHaveBeenCalledWith("group_messages");
  });

  it("preserves the group fallback and batches unique message-author profiles", async () => {
    const groups = ["group-1", "group-2", "group-3"].map((id) => ({
      id, deleted_at: null, teams: null, clubs: null, mini_leagues: null,
    }));
    const fake = chatGroupsClient({
      accessibleIds: { data: groups.map(({ id }) => id), error: null },
      groups: { data: groups, error: null },
      latestMessages: new Error("latest RPC unavailable"),
      messages: {
        "group-1": { data: { text: "One", author_id: "author-1", created_at: "2026-08-06T10:00:00Z", image_url: null }, error: null },
        "group-2": { data: { text: "Two", author_id: "author-1", created_at: "2026-08-06T11:00:00Z", image_url: "photo.jpg" }, error: null },
        "group-3": { data: null, error: null },
      },
    });
    const selectProfiles = vi.fn(async () => ({ data: [{ id: "author-1", display_name: "Alex Member" }], error: null }));

    const result = await fetchInboxChatGroupsWithMessages("user-1", {
      client: fake.client,
      selectProfiles: selectProfiles as unknown as typeof import("@/lib/profileCache").selectCachedProfilesByIds,
    });

    expect(result.latestMessages).toEqual({
      "group-1": { text: "One", author: "Alex Member", created_at: "2026-08-06T10:00:00Z", image_url: null },
      "group-2": { text: "Two", author: "Alex Member", created_at: "2026-08-06T11:00:00Z", image_url: "photo.jpg" },
    });
    expect(selectProfiles).toHaveBeenCalledOnce();
    expect(selectProfiles).toHaveBeenCalledWith(["author-1"]);
    expect(fake.from.mock.calls.filter(([table]) => table === "group_messages")).toHaveLength(3);
    expect(fake.operations).toContainEqual(["group_messages", "order", "created_at", { ascending: false }]);
    expect(fake.operations).toContainEqual(["group_messages", "limit", 1]);
  });

  it("returns false without querying entitlement tables when the user has no roles", async () => {
    const fake = tableQueryClient({
      user_roles: { data: [], error: null },
    });

    await expect(fetchInboxHasAnyProAccess("user-1", { client: fake.client })).resolves.toBe(false);
    expect(fake.from).toHaveBeenCalledOnce();
    expect(fake.from).toHaveBeenCalledWith("user_roles");
  });

  it("inherits current club Pro through a team's parent club and skips team subscriptions", async () => {
    const fake = tableQueryClient({
      user_roles: {
        data: [{ team_id: "team-1", club_id: null }, { team_id: null, club_id: "club-2" }],
        error: null,
      },
      teams: { data: [{ club_id: "club-1" }], error: null },
      club_subscriptions: {
        data: [{
          club_id: "club-1",
          is_pro: false,
          is_pro_football: true,
          admin_pro_override: false,
          admin_pro_football_override: false,
          expires_at: "2026-08-04T12:00:01.000Z",
        }],
        error: null,
      },
      team_subscriptions: { data: [], error: null },
    });

    await expect(fetchInboxHasAnyProAccess("user-1", {
      client: fake.client,
      now: new Date("2026-08-04T12:00:00.000Z"),
    })).resolves.toBe(true);
    expect(fake.queries.user_roles.builder.select).toHaveBeenCalledWith("team_id, club_id");
    expect(fake.queries.user_roles.builder.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(fake.queries.teams.builder.in).toHaveBeenCalledWith("id", ["team-1"]);
    expect(fake.queries.club_subscriptions.builder.in).toHaveBeenCalledWith(
      "club_id",
      ["club-2", "club-1"],
    );
    expect(fake.from).not.toHaveBeenCalledWith("team_subscriptions");
  });

  it("falls back to a current team override when club access is absent or expired", async () => {
    const fake = tableQueryClient({
      user_roles: { data: [{ team_id: "team-1", club_id: "club-1" }], error: null },
      teams: { data: [{ club_id: "club-1" }], error: null },
      club_subscriptions: {
        data: [{
          club_id: "club-1",
          is_pro: true,
          is_pro_football: false,
          admin_pro_override: false,
          admin_pro_football_override: false,
          expires_at: "2026-08-04T12:00:00.000Z",
        }],
        error: null,
      },
      team_subscriptions: {
        data: [{
          team_id: "team-1",
          is_pro: false,
          is_pro_football: false,
          admin_pro_override: true,
          admin_pro_football_override: false,
          expires_at: null,
        }],
        error: null,
      },
    });

    await expect(fetchInboxHasAnyProAccess("user-1", {
      client: fake.client,
      now: new Date("2026-08-04T12:00:00.000Z"),
    })).resolves.toBe(true);
    expect(fake.queries.team_subscriptions.builder.in).toHaveBeenCalledWith("team_id", ["team-1"]);
  });

  it("returns false when every applicable entitlement is absent or expired", async () => {
    const fake = tableQueryClient({
      user_roles: { data: [{ team_id: "team-1", club_id: "club-1" }], error: null },
      teams: { data: [{ club_id: "club-1" }], error: null },
      club_subscriptions: { data: [], error: null },
      team_subscriptions: {
        data: [{
          team_id: "team-1",
          is_pro: true,
          is_pro_football: false,
          admin_pro_override: false,
          admin_pro_football_override: false,
          expires_at: "2026-08-04T11:59:59.999Z",
        }],
        error: null,
      },
    });

    await expect(fetchInboxHasAnyProAccess("user-1", {
      client: fake.client,
      now: new Date("2026-08-04T12:00:00.000Z"),
    })).resolves.toBe(false);
  });

  it.each(["user_roles", "teams", "club_subscriptions", "team_subscriptions"])(
    "does not convert a %s failure into a false entitlement",
    async (failingTable) => {
      const failure = new Error(`${failingTable} unavailable`);
      const fake = tableQueryClient({
        user_roles: {
          data: [{ team_id: "team-1", club_id: "club-1" }],
          error: failingTable === "user_roles" ? failure : null,
        },
        teams: {
          data: [{ club_id: "club-1" }],
          error: failingTable === "teams" ? failure : null,
        },
        club_subscriptions: {
          data: [],
          error: failingTable === "club_subscriptions" ? failure : null,
        },
        team_subscriptions: {
          data: [],
          error: failingTable === "team_subscriptions" ? failure : null,
        },
      });

      await expect(fetchInboxHasAnyProAccess("user-1", {
        client: fake.client,
        now: new Date("2026-08-04T12:00:00.000Z"),
      })).rejects.toBe(failure);
    },
  );

  it("loads only active non-shell clubs for the current user's club-admin roles", async () => {
    const fake = tableQueryClient({
      user_roles: {
        data: [{ club_id: "club-1" }, { club_id: "club-2" }, { club_id: null }],
        error: null,
      },
      clubs: {
        data: [
          { id: "club-1", name: "Riverside FC", logo_url: null, sport: "football" },
          { id: "club-2", name: "Hills FC", logo_url: "logo.png", sport: "football" },
        ],
        error: null,
      },
    });

    await expect(fetchInboxAdminClubs("user-1", fake.client)).resolves.toEqual([
      { id: "club-1", name: "Riverside FC", logo_url: null, sport: "football" },
      { id: "club-2", name: "Hills FC", logo_url: "logo.png", sport: "football" },
    ]);
    expect(fake.from).toHaveBeenNthCalledWith(1, "user_roles");
    expect(fake.queries.user_roles.builder.select).toHaveBeenCalledWith("club_id");
    expect(fake.queries.user_roles.builder.eq).toHaveBeenNthCalledWith(1, "user_id", "user-1");
    expect(fake.queries.user_roles.builder.eq).toHaveBeenNthCalledWith(2, "role", "club_admin");
    expect(fake.from).toHaveBeenNthCalledWith(2, "clubs");
    expect(fake.queries.clubs.builder.select).toHaveBeenCalledWith("id, name, logo_url, sport");
    expect(fake.queries.clubs.builder.in).toHaveBeenCalledWith("id", ["club-1", "club-2"]);
    expect(fake.queries.clubs.builder.is).toHaveBeenCalledWith("deleted_at", null);
    expect(fake.queries.clubs.builder.neq).toHaveBeenCalledWith("kind", "shell");
  });

  it("keeps the clubs read query-free when no club-admin role exists", async () => {
    const fake = tableQueryClient({
      user_roles: { data: [], error: null },
      clubs: { data: [], error: null },
    });

    await expect(fetchInboxAdminClubs("user-1", fake.client)).resolves.toEqual([]);
    expect(fake.from).toHaveBeenCalledOnce();
    expect(fake.from).toHaveBeenCalledWith("user_roles");
  });

  it.each(["user_roles", "clubs"])(
    "does not publish empty admin clubs when the %s read fails",
    async (failingTable) => {
      const failure = new Error(`${failingTable} unavailable`);
      const fake = tableQueryClient({
        user_roles: {
          data: [{ club_id: "club-1" }],
          error: failingTable === "user_roles" ? failure : null,
        },
        clubs: {
          data: null,
          error: failingTable === "clubs" ? failure : null,
        },
      });

      await expect(fetchInboxAdminClubs("user-1", fake.client)).rejects.toBe(failure);
    },
  );

  it.each([
    {
      label: "event titles",
      fetcher: fetchInboxEventTitleMap,
      table: "events",
      selection: "id, title",
      rows: [
        { id: "EVENT-A", title: "Final" },
        { id: "event-b", title: "" },
      ],
      expected: { "event-a": "Final" },
    },
    {
      label: "vault folder names",
      fetcher: fetchInboxVaultFolderNameMap,
      table: "vault_folders",
      selection: "id, name",
      rows: [
        { id: "FOLDER-A", name: "Policies" },
        { id: "folder-b", name: "" },
      ],
      expected: { "folder-a": "Policies" },
    },
    {
      label: "vault file names",
      fetcher: fetchInboxVaultFileNameMap,
      table: "vault_files",
      selection: "id, name",
      rows: [
        { id: "FILE-A", name: "Roster.pdf" },
        { id: "file-b", name: "" },
      ],
      expected: { "file-a": "Roster.pdf" },
    },
  ])("maps $label with normalized identifiers and exact scoped reads", async ({
    fetcher,
    table,
    selection,
    rows,
    expected,
  }) => {
    const fake = queryClient({ data: rows, error: null });
    await expect(fetcher(["A", "B"], fake.client)).resolves.toEqual(expected);
    expect(fake.from).toHaveBeenCalledWith(table);
    expect(fake.builder.select).toHaveBeenCalledWith(selection);
    expect(fake.builder.in).toHaveBeenCalledWith("id", ["A", "B"]);
  });

  it.each([
    ["event titles", fetchInboxEventTitleMap],
    ["vault folder names", fetchInboxVaultFolderNameMap],
    ["vault file names", fetchInboxVaultFileNameMap],
  ])("keeps empty %s reads query-free and propagates failures", async (_label, fetcher) => {
    const empty = queryClient({ data: [], error: null });
    await expect(fetcher([], empty.client)).resolves.toEqual({});
    expect(empty.from).not.toHaveBeenCalled();

    const failure = new Error("metadata lookup failed");
    const failed = queryClient({ data: null, error: failure });
    await expect(fetcher(["id-1"], failed.client)).rejects.toBe(failure);
  });

  it("builds the active-club scope from personal-group members and DM peers", async () => {
    const fake = tableQueryClient({
      group_members: {
        data: [
          { group_id: "group-1", user_id: "user-1" },
          { group_id: "group-1", user_id: "member-1" },
          { group_id: "group-2", user_id: "member-2" },
          { group_id: "group-2", user_id: "dm-peer" },
        ],
        error: null,
      },
      user_roles: {
        data: [
          { user_id: "member-1" },
          { user_id: "dm-peer" },
          { user_id: "dm-peer" },
        ],
        error: null,
      },
    });

    const result = await fetchInboxClubScopeFilter({
      userId: "user-1",
      clubId: "club-1",
      personalGroupIds: ["group-1", "group-2"],
      dmOtherUserIds: ["dm-peer"],
      client: fake.client,
    });

    expect(result.groupMembersMap).toEqual(new Map([
      ["group-1", ["user-1", "member-1"]],
      ["group-2", ["member-2", "dm-peer"]],
    ]));
    expect([...result.usersInClub]).toEqual(["member-1", "dm-peer"]);
    expect(fake.from.mock.calls.map(([table]) => table)).toEqual(["group_members", "user_roles"]);
    expect(fake.queries.group_members.builder.in).toHaveBeenCalledWith(
      "group_id", ["group-1", "group-2"],
    );
    expect(fake.queries.user_roles.builder.eq).toHaveBeenCalledWith("club_id", "club-1");
    expect(fake.queries.user_roles.builder.in).toHaveBeenCalledWith(
      "user_id", ["dm-peer", "member-1", "member-2"],
    );
  });

  it("supports DM-only and group-only club scopes", async () => {
    const dmOnly = tableQueryClient({
      user_roles: { data: [{ user_id: "dm-peer" }], error: null },
    });
    const dmResult = await fetchInboxClubScopeFilter({
      userId: "user-1", clubId: "club-1", personalGroupIds: [],
      dmOtherUserIds: ["dm-peer"], client: dmOnly.client,
    });
    expect(dmResult.groupMembersMap).toEqual(new Map());
    expect(dmResult.usersInClub).toEqual(new Set(["dm-peer"]));
    expect(dmOnly.from.mock.calls.map(([table]) => table)).toEqual(["user_roles"]);

    const groupOnly = tableQueryClient({
      group_members: { data: [{ group_id: "group-1", user_id: "member-1" }], error: null },
      user_roles: { data: [{ user_id: "member-1" }], error: null },
    });
    const groupResult = await fetchInboxClubScopeFilter({
      userId: "user-1", clubId: "club-1", personalGroupIds: ["group-1"],
      dmOtherUserIds: [], client: groupOnly.client,
    });
    expect(groupResult.groupMembersMap).toEqual(new Map([["group-1", ["member-1"]]]));
    expect(groupResult.usersInClub).toEqual(new Set(["member-1"]));
  });

  it("keeps an empty club scope query-free", async () => {
    const fake = tableQueryClient({});
    await expect(fetchInboxClubScopeFilter({
      userId: "user-1", clubId: "club-1", personalGroupIds: [],
      dmOtherUserIds: [], client: fake.client,
    })).resolves.toEqual({ groupMembersMap: new Map(), usersInClub: new Set() });
    expect(fake.from).not.toHaveBeenCalled();
  });

  it.each([
    ["group-members", "group_members"],
    ["club-roles", "user_roles"],
  ])("propagates a %s scope-filter failure", async (_label, failingTable) => {
    const failure = new Error(`${failingTable} unavailable`);
    const fake = tableQueryClient({
      group_members: {
        data: [{ group_id: "group-1", user_id: "member-1" }],
        error: failingTable === "group_members" ? failure : null,
      },
      user_roles: {
        data: [{ user_id: "member-1" }],
        error: failingTable === "user_roles" ? failure : null,
      },
    });

    await expect(fetchInboxClubScopeFilter({
      userId: "user-1", clubId: "club-1", personalGroupIds: ["group-1"],
      dmOtherUserIds: [], client: fake.client,
    })).rejects.toBe(failure);
  });

  it("reads the exact group-management roles and returns only scoped team ids", async () => {
    const success = queryClient({
      data: [
        { team_id: "team-1", club_id: "club-1", role: "coach" },
        { team_id: null, club_id: "club-1", role: "committee_member" },
        { team_id: "team-2", club_id: "club-2", role: "team_admin" },
      ],
      error: null,
    });

    await expect(fetchInboxAdminTeamIds("user-1", success.client)).resolves.toEqual([
      "team-1", "team-2",
    ]);
    expect(success.from).toHaveBeenCalledWith("user_roles");
    expect(success.builder.select).toHaveBeenCalledWith("team_id, club_id, role");
    expect(success.builder.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(success.builder.in).toHaveBeenCalledWith(
      "role", ["team_admin", "coach", "committee_member"],
    );
  });

  it("does not replace admin-team capability with an empty list on failure", async () => {
    const failure = new Error("admin team roles unavailable");
    const failed = queryClient({ data: null, error: failure });
    await expect(fetchInboxAdminTeamIds("user-1", failed.client)).rejects.toBe(failure);
  });

  it("reads committee capability for only the current user and propagates failure", async () => {
    const success = queryClient({ data: { id: "role-1" }, error: null });
    await expect(fetchInboxCommitteeMemberStatus("user-1", success.client)).resolves.toBe(true);
    expect(success.builder.eq).toHaveBeenNthCalledWith(1, "user_id", "user-1");
    expect(success.builder.eq).toHaveBeenNthCalledWith(2, "role", "committee_member");
    expect(success.builder.maybeSingle).toHaveBeenCalledOnce();

    const failure = new Error("committee role unavailable");
    const failed = queryClient({ data: null, error: failure });
    await expect(fetchInboxCommitteeMemberStatus("user-1", failed.client)).rejects.toBe(failure);
  });

  it("preserves all role scopes and does not publish empty roles on failure", async () => {
    const rows = [
      { role: "coach", club_id: "club-1", team_id: "team-1" },
      { role: "parent", club_id: "club-1", team_id: null },
    ];
    const success = queryClient({ data: rows, error: null });
    await expect(fetchInboxUserRoles("user-1", success.client)).resolves.toEqual(rows);
    expect(success.builder.select).toHaveBeenCalledWith("role, club_id, team_id");
    expect(success.builder.eq).toHaveBeenCalledWith("user_id", "user-1");

    const failure = new Error("all roles unavailable");
    const failed = queryClient({ data: null, error: failure });
    await expect(fetchInboxUserRoles("user-1", failed.client)).rejects.toBe(failure);
  });

  it("unions primary and guardian children before reading mini-league assignments", async () => {
    const fake = tableQueryClient({
      children: { data: [{ id: "child-1" }, { id: "shared-child" }], error: null },
      child_guardians: {
        data: [{ child_id: "shared-child" }, { child_id: "child-2" }],
        error: null,
      },
      child_mini_league_assignments: {
        data: [
          { mini_league_id: "league-1" },
          { mini_league_id: "league-1" },
          { mini_league_id: "league-2" },
        ],
        error: null,
      },
    });

    const result = await fetchInboxUserLeagueIds("user-1", fake.client);
    expect([...result]).toEqual(["league-1", "league-2"]);
    expect(fake.from.mock.calls.map(([table]) => table)).toEqual([
      "children", "child_guardians", "child_mini_league_assignments",
    ]);
    expect(fake.queries.children.builder.eq).toHaveBeenCalledWith("parent_id", "user-1");
    expect(fake.queries.child_guardians.builder.eq).toHaveBeenCalledWith("guardian_id", "user-1");
    expect(fake.queries.child_mini_league_assignments.builder.in).toHaveBeenCalledWith(
      "child_id", ["child-1", "shared-child", "child-2"],
    );
  });

  it("supports guardian-only membership and avoids an assignment query with no children", async () => {
    const guardianOnly = tableQueryClient({
      children: { data: [], error: null },
      child_guardians: { data: [{ child_id: "child-2" }], error: null },
      child_mini_league_assignments: {
        data: [{ mini_league_id: "league-2" }], error: null,
      },
    });
    await expect(fetchInboxUserLeagueIds("user-1", guardianOnly.client)).resolves.toEqual(
      new Set(["league-2"]),
    );

    const noChildren = tableQueryClient({
      children: { data: [], error: null },
      child_guardians: { data: [], error: null },
    });
    await expect(fetchInboxUserLeagueIds("user-1", noChildren.client)).resolves.toEqual(
      new Set(),
    );
    expect(noChildren.from).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["primary-child", "children"],
    ["guardian-link", "child_guardians"],
    ["assignment", "child_mini_league_assignments"],
  ])("propagates a %s membership read failure", async (_label, failingTable) => {
    const failure = new Error(`${failingTable} unavailable`);
    const fake = tableQueryClient({
      children: {
        data: [{ id: "child-1" }],
        error: failingTable === "children" ? failure : null,
      },
      child_guardians: {
        data: [],
        error: failingTable === "child_guardians" ? failure : null,
      },
      child_mini_league_assignments: {
        data: [{ mini_league_id: "league-1" }],
        error: failingTable === "child_mini_league_assignments" ? failure : null,
      },
    });

    await expect(fetchInboxUserLeagueIds("user-1", fake.client)).rejects.toBe(failure);
  });

  it("reads only the current user's app-admin role and propagates failures", async () => {
    const success = queryClient({ data: { id: "role-1" }, error: null });
    await expect(fetchInboxAppAdminStatus("user-1", success.client)).resolves.toBe(true);
    expect(success.from).toHaveBeenCalledWith("user_roles");
    expect(success.builder.select).toHaveBeenCalledWith("id");
    expect(success.builder.eq).toHaveBeenNthCalledWith(1, "user_id", "user-1");
    expect(success.builder.eq).toHaveBeenNthCalledWith(2, "role", "app_admin");
    expect(success.builder.maybeSingle).toHaveBeenCalledOnce();

    const failure = new Error("role lookup failed");
    const failed = queryClient({ data: null, error: failure });
    await expect(fetchInboxAppAdminStatus("user-1", failed.client)).rejects.toBe(failure);
  });

  it("returns early for an empty club scope without issuing a query", async () => {
    const fake = queryClient({ data: [], error: null });
    await expect(fetchInboxClubProStatus([], { client: fake.client })).resolves.toEqual({});
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("maps current Pro flags and preserves false entries for missing or expired clubs", async () => {
    const fake = queryClient({
      data: [
        {
          club_id: "pro",
          is_pro: true,
          is_pro_football: false,
          admin_pro_override: false,
          admin_pro_football_override: false,
          expires_at: null,
        },
        {
          club_id: "football",
          is_pro: false,
          is_pro_football: true,
          admin_pro_override: false,
          admin_pro_football_override: false,
          expires_at: "2026-08-04T12:00:00.001Z",
        },
        {
          club_id: "expired",
          is_pro: true,
          is_pro_football: false,
          admin_pro_override: false,
          admin_pro_football_override: false,
          expires_at: "2026-08-04T12:00:00.000Z",
        },
      ],
      error: null,
    });

    await expect(fetchInboxClubProStatus(
      ["pro", "football", "expired", "missing"],
      { client: fake.client, now: Date.parse("2026-08-04T12:00:00.000Z") },
    )).resolves.toEqual({
      pro: true,
      football: true,
      expired: false,
      missing: false,
    });
    expect(fake.from).toHaveBeenCalledWith("club_subscriptions");
    expect(fake.builder.in).toHaveBeenCalledWith(
      "club_id",
      ["pro", "football", "expired", "missing"],
    );
  });

  it("does not convert a Pro lookup failure into an all-false entitlement map", async () => {
    const failure = new Error("subscription lookup failed");
    const fake = queryClient({ data: null, error: failure });
    await expect(fetchInboxClubProStatus(["club-1"], { client: fake.client })).rejects.toBe(failure);
  });

  it("deduplicates competition club membership while preserving competition scope", async () => {
    const fake = queryClient({
      data: [
        { competition_id: "comp-1", status: "accepted", teams: { club_id: "club-1", deleted_at: null } },
        { competition_id: "comp-1", status: "accepted", teams: { club_id: "club-1", deleted_at: null } },
        { competition_id: "comp-1", status: "accepted", teams: { club_id: "club-2", deleted_at: null } },
        { competition_id: "comp-2", status: "accepted", teams: { club_id: "club-3", deleted_at: null } },
        { competition_id: "comp-2", status: "accepted", teams: null },
      ],
      error: null,
    });

    const result = await fetchInboxCompetitionClubMap(["comp-1", "comp-2"], fake.client);
    expect([...result["comp-1"]]).toEqual(["club-1", "club-2"]);
    expect([...result["comp-2"]]).toEqual(["club-3"]);
    expect(fake.from).toHaveBeenCalledWith("competition_entries");
    expect(fake.builder.select).toHaveBeenCalledWith("competition_id, status, teams!inner(club_id, deleted_at)");
    expect(fake.builder.in).toHaveBeenCalledWith("competition_id", ["comp-1", "comp-2"]);
    expect(fake.builder.eq).toHaveBeenCalledWith("status", "accepted");
    expect(fake.builder.is).toHaveBeenCalledWith("teams.deleted_at", null);
  });

  it("keeps an empty competition scope query-free and propagates backend failures", async () => {
    const empty = queryClient({ data: [], error: null });
    await expect(fetchInboxCompetitionClubMap([], empty.client)).resolves.toEqual({});
    expect(empty.from).not.toHaveBeenCalled();

    const failure = new Error("competition lookup failed");
    const failed = queryClient({ data: null, error: failure });
    await expect(fetchInboxCompetitionClubMap(["comp-1"], failed.client)).rejects.toBe(failure);
  });

  it("does not replace known mute preferences with an empty result when their read fails", async () => {
    const failure = new Error("mute preferences unavailable");
    const failed = queryClient({ data: null, error: failure });

    await expect(fetchInboxMutedChats("user-1", {
      client: failed.client,
      now: Date.parse("2026-08-04T12:00:00.000Z"),
    })).rejects.toBe(failure);
  });

  it("preserves valid mute preferences and their exact user-scoped query", async () => {
    const success = queryClient({
      data: [
        { chat_id: "team-1", chat_type: "team", muted_until: null },
        { chat_id: "group-1", chat_type: "group", muted_until: "2026-08-05T00:00:00.000Z" },
      ],
      error: null,
    });

    const result = await fetchInboxMutedChats("user-1", {
      client: success.client,
      now: Date.parse("2026-08-04T12:00:00.000Z"),
    });
    expect([...result.teams]).toEqual(["team-1"]);
    expect([...result.groups]).toEqual(["group-1"]);
    expect(success.from).toHaveBeenCalledWith("chat_mute_preferences");
    expect(success.builder.select).toHaveBeenCalledWith("chat_id, chat_type, muted_until");
    expect(success.builder.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("does not convert a hidden-DM preference failure into an empty map", async () => {
    const failure = new Error("hidden DM preferences unavailable");
    const failed = queryClient({ data: null, error: failure });

    await expect(fetchInboxHiddenDirectMessages("user-1", failed.client)).rejects.toBe(failure);
  });

  it("does not convert a hidden-group preference failure into an empty map", async () => {
    const failure = new Error("hidden group preferences unavailable");
    const failed = queryClient({ data: null, error: failure });

    await expect(fetchInboxHiddenGroups("user-1", failed.client)).rejects.toBe(failure);
  });

  it("maps valid hidden DM and group preferences using separate scoped tables", async () => {
    const direct = queryClient({
      data: [{ conversation_id: "dm-1", hidden_at: "2026-08-04T10:00:00.000Z" }],
      error: null,
    });
    const groups = queryClient({
      data: [{ group_id: "group-1", hidden_at: "2026-08-04T11:00:00.000Z" }],
      error: null,
    });

    await expect(fetchInboxHiddenDirectMessages("user-1", direct.client)).resolves.toEqual(
      new Map([["dm-1", "2026-08-04T10:00:00.000Z"]]),
    );
    await expect(fetchInboxHiddenGroups("user-1", groups.client)).resolves.toEqual(
      new Map([["group-1", "2026-08-04T11:00:00.000Z"]]),
    );
    expect(direct.from).toHaveBeenCalledWith("hidden_dm_conversations");
    expect(groups.from).toHaveBeenCalledWith("hidden_chat_groups");
    expect(direct.builder.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(groups.builder.eq).toHaveBeenCalledWith("user_id", "user-1");
  });
});
