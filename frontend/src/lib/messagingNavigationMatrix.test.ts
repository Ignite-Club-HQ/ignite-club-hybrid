import { describe, expect, it, vi } from "vitest";
import {
  consumePendingChatJump,
  getJumpTarget,
  normalizeNotificationChatUrl,
  setPendingChatJump,
} from "./pendingChatJump";

const cases = [
  { kind: "team", path: "/messages/team-1", targetId: "team-1", type: "team_message" },
  { kind: "club", path: "/messages/club/club-1", targetId: "club-1", type: "club_message" },
  { kind: "group", path: "/groups/group-1", targetId: "group-1", type: "group_message" },
  { kind: "dm", path: "/messages/dm/dm-1", targetId: "dm-1", type: "direct_message" },
  { kind: "club_admin", path: "/messages/club-admin/admin-1", targetId: "admin-1", type: "club_admin_message" },
  { kind: "broadcast", path: "/messages/broadcast", targetId: null, type: "broadcast" },
] as const;

describe("message notification navigation matrix", () => {
  it.each(cases)("preserves the exact message for $kind notification URLs", ({ kind, path, targetId, type }) => {
    const staleUrl = `${path}?message=stale-message`;
    const data = { type, message_id: "exact-message" };

    const normalized = normalizeNotificationChatUrl(data, staleUrl);
    expect(normalized).toContain("message=exact-message");
    expect(normalized).not.toContain("message=stale-message");
    expect(getJumpTarget(data, normalized)).toEqual({
      kind,
      targetId,
      messageId: "exact-message",
    });
  });

  it("never mistakes a direct-message conversation related_id for a message id", () => {
    expect(getJumpTarget(
      { type: "direct_message", related_id: "conversation-1" },
      "/messages/dm/conversation-1",
    )).toBeNull();
  });

  it.each(cases)("can recover the $kind target from payload context when a URL is absent", ({ kind, targetId, type }) => {
    const context = targetId === null ? {} : { context_id: targetId };
    expect(getJumpTarget({ type, message_id: "message-9", ...context }, null)).toEqual({
      kind,
      targetId,
      messageId: "message-9",
    });
  });

  it("keeps the exact message in the route after the separate session jump expires", () => {
    const started = new Date("2026-07-27T00:00:00.000Z").getTime();
    const now = vi.spyOn(Date, "now").mockReturnValue(started);
    setPendingChatJump("team", "team-1", "exact-message");
    const route = normalizeNotificationChatUrl(
      { type: "team_message", message_id: "exact-message" },
      "/messages/team-1?message=stale-message",
    );

    now.mockReturnValue(started + 61_000);
    expect(consumePendingChatJump("team", "team-1")).toBeNull();
    expect(new URL(route!, "https://igniteclubhq.app").searchParams.get("message")).toBe("exact-message");
    now.mockRestore();
  });
});
