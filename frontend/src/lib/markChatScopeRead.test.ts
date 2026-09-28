import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { markChatScopeNotificationsRead } from "./markChatScopeRead";

const initialCounts = {
  broadcast: 2,
  teams: { "team-1": 3, "team-2": 5 },
  clubs: { "club-1": 4 },
  groups: { "group-1": 6 },
  dms: { "dm-1": 7 },
};

function harness(serverAffected = 0) {
  let cached: any = structuredClone(initialCounts);
  const queryClient = {
    getQueryData: vi.fn(() => cached),
    setQueryData: vi.fn((_key, next) => { cached = next; }),
    setQueriesData: vi.fn(),
    invalidateQueries: vi.fn(),
  } as any;
  const decrementUnreadCount = vi.fn();
  const refreshUnreadCount = vi.fn().mockResolvedValue(undefined);
  rpc.mockResolvedValue({ data: serverAffected, error: null });
  return { queryClient, decrementUnreadCount, refreshUnreadCount, getCached: () => cached };
}

async function waitForBackgroundWork(h: ReturnType<typeof harness>) {
  await vi.waitFor(() => expect(h.refreshUnreadCount).toHaveBeenCalledOnce());
}

describe("markChatScopeNotificationsRead", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [{ kind: "team", teamId: "team-1" } as const, 3, "team-1"],
    [{ kind: "club", clubId: "club-1" } as const, 4, "club-1"],
    [{ kind: "group", groupId: "group-1" } as const, 6, "group-1"],
    [{ kind: "dm", conversationId: "dm-1" } as const, 7, "dm-1"],
  ])("clears only the selected %s scope", async (scope, expectedCount, removedKey) => {
    const h = harness(expectedCount);
    markChatScopeNotificationsRead({ userId: "user-1", scope, ...h });

    expect(h.decrementUnreadCount).toHaveBeenCalledWith(expectedCount);
    const cached = h.getCached();
    const bucket = scope.kind === "team" ? cached.teams
      : scope.kind === "club" ? cached.clubs
      : scope.kind === "group" ? cached.groups
      : cached.dms;
    expect(bucket).not.toHaveProperty(removedKey);
    expect(cached.teams["team-2"]).toBe(5);
    expect(cached.broadcast).toBe(2);
    await waitForBackgroundWork(h);
  });

  it("clears broadcast scope and sends a null RPC scope id", async () => {
    const h = harness(2);
    markChatScopeNotificationsRead({ userId: "user-1", scope: { kind: "broadcast" }, ...h });

    expect(h.getCached().broadcast).toBe(0);
    expect(h.decrementUnreadCount).toHaveBeenCalledWith(2);
    await waitForBackgroundWork(h);
    expect(rpc).toHaveBeenCalledWith("mark_chat_scope_notifications_read", {
      _user_id: "user-1",
      _scope_kind: "broadcast",
      _scope_id: null,
    });
  });

  it("passes the exact selected scope to the RPC and optimistically updates both club badges", async () => {
    const h = harness(3);
    markChatScopeNotificationsRead({ userId: "user-1", scope: { kind: "team", teamId: "team-1" }, ...h });

    expect(h.queryClient.setQueriesData).toHaveBeenCalledTimes(2);
    const badgeUpdater = h.queryClient.setQueriesData.mock.calls[0][1];
    expect(badgeUpdater(2)).toBe(0);
    expect(badgeUpdater(undefined)).toBeUndefined();
    await waitForBackgroundWork(h);
    expect(rpc).toHaveBeenCalledWith("mark_chat_scope_notifications_read", {
      _user_id: "user-1",
      _scope_kind: "team",
      _scope_id: "team-1",
    });
  });

  it("applies an additional decrement when the server clears more rows than the cache knew about", async () => {
    const h = harness(5);
    markChatScopeNotificationsRead({ userId: "user-1", scope: { kind: "team", teamId: "team-1" }, ...h });
    await waitForBackgroundWork(h);

    expect(h.decrementUnreadCount).toHaveBeenNthCalledWith(1, 3);
    expect(h.decrementUnreadCount).toHaveBeenNthCalledWith(2, 2);
    expect(h.queryClient.setQueriesData).toHaveBeenCalledTimes(4);
  });

  it("still reconciles and invalidates caches when the RPC reports an error", async () => {
    const h = harness();
    rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    markChatScopeNotificationsRead({ userId: "user-1", scope: { kind: "group", groupId: "group-1" }, ...h });
    await waitForBackgroundWork(h);

    expect(h.refreshUnreadCount).toHaveBeenCalledOnce();
    expect(h.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["unread-message-counts", "user-1"] });
    expect(h.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["chat-group-unread-cache", "user-1"] });
    expect(h.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["recent-notifications"] });
  });

  it("does not decrement local badges for an already-clear scope but still reconciles the server", async () => {
    const h = harness();
    markChatScopeNotificationsRead({ userId: "user-1", scope: { kind: "team", teamId: "missing-team" }, ...h });

    expect(h.decrementUnreadCount).not.toHaveBeenCalled();
    expect(h.queryClient.setQueryData).not.toHaveBeenCalled();
    await waitForBackgroundWork(h);
    expect(rpc).toHaveBeenCalledWith("mark_chat_scope_notifications_read", expect.objectContaining({
      _scope_kind: "team",
      _scope_id: "missing-team",
    }));
  });
});
