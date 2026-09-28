import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSupabase = await vi.hoisted(async () => {
  const { createMockSupabaseClient } = await import("@/test/mockSupabaseClient");
  return createMockSupabaseClient();
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: mockSupabase }));

import {
  getQueueCount,
  getQueuedMessages,
  getQueuedMessagesForTarget,
  hasQueuedMessages,
  queueMessage,
  removeFromQueue,
  syncQueuedMessages,
  type QueuedMessageType,
} from "./messageQueue";

function insertResult(error: unknown = null) {
  return { insert: vi.fn().mockResolvedValue({ error }) };
}

function enqueue(type: QueuedMessageType, targetId = "target-1") {
  return queueMessage({
    type,
    targetId,
    authorId: "author-1",
    text: "Synthetic message",
    imageUrl: "https://example.invalid/image.jpg",
    replyToId: "reply-1",
    createdAt: "2026-07-19T12:00:00.000Z",
  });
}

describe("offline message queue", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it.each([
    ["team", "team_messages", "team_id"],
    ["club", "club_messages", "club_id"],
    ["group", "group_messages", "group_id"],
    ["dm", "direct_messages", "conversation_id"],
    ["club_admin", "club_admin_messages", "conversation_id"],
  ] as const)("routes %s messages only to %s using %s", async (type, table, targetColumn) => {
    const query = insertResult();
    mockSupabase.from.mockReturnValueOnce(query);
    enqueue(type, "scope-123");

    await expect(syncQueuedMessages()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(mockSupabase.from).toHaveBeenCalledOnce();
    expect(mockSupabase.from).toHaveBeenCalledWith(table);
    expect(query.insert).toHaveBeenCalledWith({
      [targetColumn]: "scope-123",
      author_id: "author-1",
      text: "Synthetic message",
      image_url: "https://example.invalid/image.jpg",
      reply_to_id: "reply-1",
    });
    expect(getQueueCount()).toBe(0);
  });

  it("routes broadcasts without leaking an unrelated target identifier", async () => {
    const query = insertResult();
    mockSupabase.from.mockReturnValueOnce(query);
    enqueue("broadcast", "must-not-be-written");

    await expect(syncQueuedMessages()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(mockSupabase.from).toHaveBeenCalledWith("broadcast_messages");
    expect(query.insert).toHaveBeenCalledWith({
      author_id: "author-1",
      text: "Synthetic message",
      image_url: "https://example.invalid/image.jpg",
      reply_to_id: "reply-1",
    });
  });

  it("keeps queued messages isolated by both chat type and target", () => {
    enqueue("team", "shared-id");
    enqueue("club", "shared-id");
    enqueue("team", "other-team");

    expect(getQueuedMessagesForTarget("team", "shared-id")).toEqual([
      expect.objectContaining({ type: "team", targetId: "shared-id" }),
    ]);
    expect(getQueuedMessagesForTarget("club", "shared-id")).toEqual([
      expect.objectContaining({ type: "club", targetId: "shared-id" }),
    ]);
  });

  it("removes only the selected queued message", () => {
    const first = enqueue("team", "team-1");
    const second = enqueue("team", "team-2");
    removeFromQueue(first.id);

    expect(getQueuedMessages()).toEqual([expect.objectContaining({ id: second.id, targetId: "team-2" })]);
    expect(hasQueuedMessages()).toBe(true);
  });

  it("syncs successful messages while retaining a transient failure", async () => {
    enqueue("team", "team-1");
    enqueue("club", "club-1");
    mockSupabase.from
      .mockReturnValueOnce(insertResult())
      .mockReturnValueOnce(insertResult({ message: "offline" }));

    await expect(syncQueuedMessages()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(getQueuedMessages()).toEqual([
      expect.objectContaining({ type: "club", targetId: "club-1", retryCount: 1 }),
    ]);
  });

  it("discards and reports a message only after its third failed attempt", async () => {
    enqueue("group", "group-1");
    mockSupabase.from.mockImplementation(() => insertResult({ message: "denied" }));

    await expect(syncQueuedMessages()).resolves.toEqual({ synced: 0, failed: 0 });
    expect(getQueuedMessages()[0].retryCount).toBe(1);
    await expect(syncQueuedMessages()).resolves.toEqual({ synced: 0, failed: 0 });
    expect(getQueuedMessages()[0].retryCount).toBe(2);
    await expect(syncQueuedMessages()).resolves.toEqual({ synced: 0, failed: 1 });
    expect(hasQueuedMessages()).toBe(false);
  });

  it("treats malformed persisted queue data as empty", () => {
    localStorage.setItem("ignite_message_queue", "not-json");
    expect(getQueuedMessages()).toEqual([]);
    expect(getQueueCount()).toBe(0);
    expect(hasQueuedMessages()).toBe(false);
  });
});
