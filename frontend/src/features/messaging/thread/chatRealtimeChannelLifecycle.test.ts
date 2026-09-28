import { beforeEach, describe, expect, it, vi } from "vitest";

const { subscribe, removeChannel, registerChannel, noteChannelSubscribed, noteChannelRemoved } = vi.hoisted(() => ({
  subscribe: vi.fn(),
  removeChannel: vi.fn(),
  registerChannel: vi.fn(),
  noteChannelSubscribed: vi.fn(),
  noteChannelRemoved: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { removeChannel },
}));
vi.mock("@/lib/realtimeChannelRegistry", () => ({ registerChannel }));
vi.mock("@/lib/chatPerfDiagnostics", () => ({ noteChannelSubscribed, noteChannelRemoved }));

import { startChatRealtimeChannel } from "./chatRealtimeChannelLifecycle";

describe("startChatRealtimeChannel", () => {
  const channel = { subscribe } as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("subscribes, records, and registers an authenticated route channel", () => {
    const unregister = vi.fn();
    registerChannel.mockReturnValue(unregister);

    const cleanup = startChatRealtimeChannel({
      channel,
      channelKey: "team-messages-team-1",
      userId: "user-1",
      scope: { kind: "team", id: "team-1" },
      cacheKeys: [["team-messages", "team-1"]],
    });

    expect(subscribe).toHaveBeenCalledOnce();
    expect(noteChannelSubscribed).toHaveBeenCalledWith("team-messages-team-1");
    expect(registerChannel).toHaveBeenCalledWith({
      key: "team-messages-team-1",
      channel,
      userId: "user-1",
      scope: { kind: "team", id: "team-1" },
      cacheKeys: [["team-messages", "team-1"]],
    });

    cleanup();

    expect(unregister).toHaveBeenCalledOnce();
    expect(removeChannel).not.toHaveBeenCalled();
    expect(noteChannelRemoved).toHaveBeenCalledWith("team-messages-team-1");
  });

  it("removes an unauthenticated channel directly during cleanup", () => {
    const cleanup = startChatRealtimeChannel({
      channel,
      channelKey: "broadcast-messages-realtime",
      userId: undefined,
      scope: { kind: "global", id: "" },
    });

    expect(registerChannel).not.toHaveBeenCalled();

    cleanup();

    expect(removeChannel).toHaveBeenCalledWith(channel);
    expect(noteChannelRemoved).toHaveBeenCalledWith("broadcast-messages-realtime");
  });

  it("replaces an existing registration key without duplicating cleanup calls", () => {
    const firstUnregister = vi.fn();
    registerChannel.mockReturnValueOnce(firstUnregister);

    const firstCleanup = startChatRealtimeChannel({
      channel,
      channelKey: "club-admin-chat-conv-1",
      userId: "user-1",
      scope: { kind: "club_admin", id: "club-1" },
      cacheKeys: [["club-admin-messages", "conv-1"]],
    });

    firstCleanup();

    expect(firstUnregister).toHaveBeenCalledOnce();
    expect(removeChannel).not.toHaveBeenCalled();
  });
});
