import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { channel, removeChannel, invalidateQueries, channels, mode, queryOptions, listLivePinnedMessages } = vi.hoisted(() => ({
  channel: vi.fn(), removeChannel: vi.fn(), invalidateQueries: vi.fn(), channels: new Map<string, any>(),
  mode: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  queryOptions: { current: null as any },
  listLivePinnedMessages: vi.fn(),
}));
const supabaseMode = mode === "supabase";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { channel, removeChannel, auth: { getUser: vi.fn() } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
  useQuery: (options: any) => {
    queryOptions.current = options;
    return { data: [], isLoading: false };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/live/loadBackendRouting", () => ({
  isFeatureRoutedToIcp: () => mode === "icp",
}));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    mode === "icp" ? providers.icp({ identity: {}, target: {} }) : providers.supabase(),
}));
vi.mock("@/live/features/messaging", () => ({
  listLivePinnedMessages: (...args: unknown[]) => listLivePinnedMessages(...args),
  pinLiveMessage: vi.fn(),
  unpinLiveMessage: vi.fn(),
}));

import { pinnedQueryKey, usePinnedMessages } from "./usePinnedMessages";

function makeChannel(name: string) {
  const record: any = { name };
  record.on = vi.fn((_event: string, config: any, handler: () => void) => { record.config = config; record.handler = handler; return record; });
  record.subscribe = vi.fn(() => record);
  channels.set(name, record);
  return record;
}

describe.runIf(supabaseMode)("usePinnedMessages realtime scoping", () => {
  beforeEach(() => { vi.clearAllMocks(); channels.clear(); channel.mockImplementation(makeChannel); });

  it("does not subscribe without a chat id", () => {
    renderHook(() => usePinnedMessages("team", undefined));
    expect(channel).not.toHaveBeenCalled();
  });

  it.each(["team", "club", "group", "dm"] as const)("scopes %s pin events to the exact chat", (chatType) => {
    renderHook(() => usePinnedMessages(chatType, "chat-1"));
    const record = channels.get(`pinned-${chatType}-chat-1`);
    expect(record.config).toEqual({ event: "*", schema: "public", table: "pinned_messages", filter: "chat_id=eq.chat-1" });
    act(() => record.handler());
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: pinnedQueryKey(chatType, "chat-1") });
  });

  it("cleans up before changing chat type or id", () => {
    const { rerender } = renderHook(({ type, id }) => usePinnedMessages(type, id), {
      initialProps: { type: "team" as "team" | "group", id: "team-1" },
    });
    const old = channels.get("pinned-team-team-1");
    rerender({ type: "group", id: "group-1" });
    expect(removeChannel).toHaveBeenCalledWith(old);
    expect(channels.has("pinned-group-group-1")).toBe(true);
  });

  it("removes the active subscription on unmount", () => {
    const { unmount } = renderHook(() => usePinnedMessages("dm", "conversation-1"));
    const active = channels.get("pinned-dm-conversation-1");
    unmount();
    expect(removeChannel).toHaveBeenCalledWith(active);
  });
});

describe.runIf(!supabaseMode)("usePinnedMessages ICP polling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channels.clear();
    queryOptions.current = null;
    listLivePinnedMessages.mockResolvedValue([{
      id: "pin-1",
      messageId: "message-1",
      pinnedBy: { toText: () => "principal-1" },
      createdAtMs: 1_700_000_000_000,
    }]);
  });

  it("maps canister pins, polls, and never opens Supabase realtime", async () => {
    renderHook(() => usePinnedMessages("team", "team-1"));
    expect(queryOptions.current.refetchInterval).toBe(15_000);

    await expect(queryOptions.current.queryFn()).resolves.toEqual([{
      id: "pin-1",
      message_id: "message-1",
      pinned_by: "principal-1",
      created_at: new Date(1_700_000_000_000).toISOString(),
      text: null,
      image_url: null,
      author_id: "principal-1",
      author_name: null,
      author_avatar: null,
    }]);
    expect(listLivePinnedMessages).toHaveBeenCalledWith({ identity: {}, target: {} }, "team-1");
    expect(channel).not.toHaveBeenCalled();
  });
});
