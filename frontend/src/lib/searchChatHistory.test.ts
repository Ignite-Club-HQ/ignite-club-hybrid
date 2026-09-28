import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ profiles: vi.fn() }));
const mockSupabase = await vi.hoisted(async () => {
  const { createMockSupabaseClient } = await import("@/test/mockSupabaseClient");
  return createMockSupabaseClient();
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: mockSupabase }));
vi.mock("@/lib/profileCache", () => ({ fetchProfilesWithCache: mocks.profiles }));

import { searchChatHistory } from "./searchChatHistory";

function query(result: { data?: any[]; error?: any }) {
  const q: any = {};
  for (const name of ["select", "ilike", "order", "limit", "abortSignal", "is", "eq", "in"]) {
    q[name] = vi.fn(() => q);
  }
  q.then = (resolve: (value: any) => void) => Promise.resolve(result).then(resolve);
  return q;
}

describe("searchChatHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profiles.mockResolvedValue(new Map());
  });

  it("escapes wildcard input, excludes soft-deleted rows and applies exact scope", async () => {
    const messages = query({ data: [], error: null });
    mockSupabase.from.mockReturnValue(messages);
    const controller = new AbortController();
    await searchChatHistory({
      table: "team_messages", scope: { team_id: "team-1" }, query: "50%_\\", signal: controller.signal,
      selectColumns: "id,text,author_id,created_at,reply_to_id",
    });
    expect(messages.ilike).toHaveBeenCalledWith("text", "%50\\%\\_\\\\%");
    expect(messages.is).toHaveBeenCalledWith("deleted_at", null);
    expect(messages.eq).toHaveBeenCalledWith("team_id", "team-1");
    expect(messages.abortSignal).toHaveBeenCalledWith(controller.signal);
  });

  it("returns no results and performs no enrichment after a failed or empty search", async () => {
    for (const result of [{ data: null, error: { message: "denied" } }, { data: [], error: null }]) {
      mockSupabase.from.mockReset();
      mockSupabase.from.mockReturnValue(query(result as any));
      expect(await searchChatHistory({
        table: "club_messages", scope: { club_id: "club-1" }, query: "hello", signal: new AbortController().signal,
        selectColumns: "id,text,author_id,created_at,reply_to_id",
      })).toEqual([]);
      expect(mocks.profiles).not.toHaveBeenCalled();
    }
  });

  it("enriches results with exact reactions, reply context and cached profiles", async () => {
    const messages = query({ data: [
      { id: "m1", text: "target", author_id: "u1", reply_to_id: "parent" },
      { id: "m2", text: "other", author_id: "u2", reply_to_id: null },
    ], error: null });
    const reactions = query({ data: [
      { id: "r1", team_message_id: "m1", user_id: "u2", reaction_type: "heart" },
      { id: "r2", team_message_id: "m2", user_id: "u1", reaction_type: "like" },
    ] });
    const replies = query({ data: [{ id: "parent", text: "context", author_id: "u2" }] });
    mockSupabase.from.mockImplementation((table) => table === "message_reactions" ? reactions : mockSupabase.from.mock.calls.length === 1 ? messages : replies);
    mocks.profiles.mockResolvedValue(new Map([
      ["u1", { display_name: "Alex", avatar_url: "a.png" }],
      ["u2", { display_name: "Sam", avatar_url: null }],
    ]));

    const result = await searchChatHistory({
      table: "team_messages", scope: { team_id: "team-1" }, query: "target", signal: new AbortController().signal,
      selectColumns: "id,text,author_id,created_at,reply_to_id",
    });
    expect(result[0]).toMatchObject({
      id: "m1", profiles: { display_name: "Alex", avatar_url: "a.png" },
      reply_to: { id: "parent", text: "context" }, reactions: [{ id: "r1" }],
    });
    expect(result[1].reactions).toEqual([expect.objectContaining({ id: "r2" })]);
  });

  it("normalizes announcement flags only for message types that request them", async () => {
    const messages = query({ data: [{ id: "m1", text: "notice", author_id: "u1", reply_to_id: null }], error: null });
    const reactions = query({ data: [] });
    mockSupabase.from.mockImplementation((table) => table === "message_reactions" ? reactions : messages);
    const result = await searchChatHistory({
      table: "team_messages", scope: { team_id: "team-1" }, query: "notice", signal: new AbortController().signal,
      selectColumns: "id,text,author_id,created_at,reply_to_id", hasAnnouncements: true,
    });
    expect(result[0]).toMatchObject({ is_club_announcement: false, club_announcement_name: null, is_system_message: false });
  });

  it("uses the correct reaction foreign key for every message table", async () => {
    const expected = {
      team_messages: "team_message_id", club_messages: "club_message_id", group_messages: "group_message_id",
      broadcast_messages: "broadcast_message_id", club_admin_messages: "club_admin_message_id", direct_messages: "direct_message_id",
    } as const;
    for (const [table, fk] of Object.entries(expected)) {
      const messages = query({ data: [{ id: "m1", text: "x", author_id: "u1", reply_to_id: null }], error: null });
      const reactions = query({ data: [] });
      mockSupabase.from.mockImplementation((name) => name === "message_reactions" ? reactions : messages);
      await searchChatHistory({ table: table as any, scope: {}, query: "x", signal: new AbortController().signal,
        selectColumns: "id,text,author_id,created_at,reply_to_id" });
      expect(reactions.in).toHaveBeenCalledWith(fk, ["m1"]);
    }
  });
});
