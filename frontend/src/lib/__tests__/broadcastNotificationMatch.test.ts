import { describe, expect, it } from "vitest";
import { isIcpBroadcastChatNotification } from "../broadcastNotificationMatch";

describe("isIcpBroadcastChatNotification", () => {
  const broadcastId = "bcast-conv-1";

  it("matches a message_chat alert scoped to the broadcast conversation via club", () => {
    expect(
      isIcpBroadcastChatNotification({ kind: "message_chat", club: broadcastId, related_id: [] }, broadcastId),
    ).toBe(true);
  });

  it("matches a message_chat alert scoped via related_id fallback", () => {
    expect(
      isIcpBroadcastChatNotification({ kind: "message_chat", club: "", related_id: [broadcastId] }, broadcastId),
    ).toBe(true);
  });

  it("does not match a message_chat alert scoped to a different conversation (e.g. a team chat)", () => {
    expect(
      isIcpBroadcastChatNotification({ kind: "message_chat", club: "team-123", related_id: [] }, broadcastId),
    ).toBe(false);
  });

  it("does not match when the broadcast conversation id could not be resolved", () => {
    expect(
      isIcpBroadcastChatNotification({ kind: "message_chat", club: broadcastId, related_id: [] }, null),
    ).toBe(false);
  });

  it("matches legacy alerts with no chat scope by kind alone", () => {
    expect(isIcpBroadcastChatNotification({ kind: "broadcast" }, broadcastId)).toBe(true);
    expect(isIcpBroadcastChatNotification({ kind: "broadcast" }, null)).toBe(true);
  });

  it("ignores unrelated kinds", () => {
    expect(isIcpBroadcastChatNotification({ kind: "event_reminder" }, broadcastId)).toBe(false);
  });
});
