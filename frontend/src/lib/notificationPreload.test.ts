import { beforeEach, describe, expect, it, vi } from "vitest";

const { addMessageToCache } = vi.hoisted(() => ({
  addMessageToCache: vi.fn(),
}));

vi.mock("@/lib/messageCache", () => ({ addMessageToCache }));

import {
  consumeFromNotificationFlag,
  preloadMessageFromNotification,
  setFromNotificationFlag,
} from "./notificationPreload";

const basePayload = {
  message_id: "message-1",
  author_id: "author-1",
  text: "Training has moved",
  created_at: "2026-07-19T11:59:00.000Z",
};

describe("notification message preloading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-07-19T12:00:00Z").getTime());
  });

  it.each([
    ["dm", { conversation_id: "conversation-1" }, "conversation-1"],
    ["group", { group_id: "group-1" }, "group-1"],
    ["team", { team_id: "team-1" }, "team-1"],
    ["club", { club_id: "club-1" }, "club-1"],
    ["broadcast", { broadcast_id: "broadcast-1" }, "broadcast-1"],
    [
      "club_admin",
      { notificationType: "club_admin_message", context_id: "admin-thread-1" },
      "admin-thread-1",
    ],
  ])("preloads a %s push into the correct conversation cache", (kind, scope, targetId) => {
    preloadMessageFromNotification({ ...basePayload, ...scope });

    expect(addMessageToCache).toHaveBeenCalledWith(
      kind,
      targetId,
      expect.objectContaining({
        id: "message-1",
        text: "Training has moved",
        author_id: "author-1",
        created_at: "2026-07-19T11:59:00.000Z",
      }),
    );
    expect(consumeFromNotificationFlag(kind as any, targetId)).toBe(Date.now());
  });

  it("treats the string form of the FCM admin-thread flag as true", () => {
    preloadMessageFromNotification({
      ...basePayload,
      club_id: "club-1",
      is_admin_thread: "true",
    });

    expect(addMessageToCache).toHaveBeenCalledWith(
      "club_admin",
      "club-1",
      expect.any(Object),
    );
  });

  it("gives a direct-message conversation precedence over other scope identifiers", () => {
    preloadMessageFromNotification({
      ...basePayload,
      conversation_id: "conversation-1",
      group_id: "group-1",
      team_id: "team-1",
      club_id: "club-1",
    });

    expect(addMessageToCache).toHaveBeenCalledOnce();
    expect(addMessageToCache).toHaveBeenCalledWith(
      "dm",
      "conversation-1",
      expect.any(Object),
    );
  });

  it.each([
    ["missing payload", null],
    ["missing message identity", { author_id: "author-1", team_id: "team-1" }],
    ["missing author identity", { message_id: "message-1", team_id: "team-1" }],
    ["missing chat scope", { message_id: "message-1", author_id: "author-1" }],
  ])("ignores %s instead of polluting a conversation cache", (_label, payload) => {
    preloadMessageFromNotification(payload);

    expect(addMessageToCache).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it("normalizes optional message fields and author display metadata", () => {
    preloadMessageFromNotification({
      messageId: "message-2",
      sender_id: "author-2",
      body: "Photo attached",
      createdAt: "2026-07-19T11:58:00.000Z",
      teamId: "team-2",
      image_url: "https://cdn.test/photo.jpg",
      reply_to_id: "message-1",
      author_display_name: "Alex Morgan",
      author_avatar_url: "https://cdn.test/avatar.jpg",
    });

    expect(addMessageToCache).toHaveBeenCalledWith("team", "team-2", {
      id: "message-2",
      text: "Photo attached",
      author_id: "author-2",
      created_at: "2026-07-19T11:58:00.000Z",
      image_url: "https://cdn.test/photo.jpg",
      reply_to_id: "message-1",
      profiles: {
        display_name: "Alex Morgan",
        avatar_url: "https://cdn.test/avatar.jpg",
      },
      reactions: [],
      reply_to: null,
      __notification_preload: true,
    });
  });

  it("broadcasts the parsed message to an already-mounted chat", () => {
    const listener = vi.fn();
    window.addEventListener("ignite:preload-message", listener);

    preloadMessageFromNotification({ ...basePayload, team_id: "team-1" });

    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      kind: "team",
      targetId: "team-1",
      message: expect.objectContaining({ id: "message-1", author_id: "author-1" }),
    });
    window.removeEventListener("ignite:preload-message", listener);
  });

  it("consumes a fresh notification marker only once", () => {
    setFromNotificationFlag("team", "team-1");

    expect(consumeFromNotificationFlag("team", "team-1")).toBe(Date.now());
    expect(consumeFromNotificationFlag("team", "team-1")).toBeNull();
  });

  it("rejects and removes notification markers older than sixty seconds", () => {
    sessionStorage.setItem(
      "ignite_from_notification_team_team-1",
      String(Date.now() - 60_001),
    );

    expect(consumeFromNotificationFlag("team", "team-1")).toBeNull();
    expect(sessionStorage.getItem("ignite_from_notification_team_team-1")).toBeNull();
  });

  it("rejects malformed notification marker timestamps", () => {
    sessionStorage.setItem("ignite_from_notification_team_team-1", "not-a-timestamp");

    expect(consumeFromNotificationFlag("team", "team-1")).toBeNull();
    expect(sessionStorage.getItem("ignite_from_notification_team_team-1")).toBeNull();
  });
});
