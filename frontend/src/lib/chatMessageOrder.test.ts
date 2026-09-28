import { describe, expect, it } from "vitest";
import {
  compareChatMessagesChronologically,
  sortChatMessagesChronologically,
} from "./chatMessageOrder";

describe("compareChatMessagesChronologically", () => {
  it("orders ascending by created_at", () => {
    const earlier = { id: "a", created_at: "2026-01-01T00:00:00.000Z" };
    const later = { id: "b", created_at: "2026-01-02T00:00:00.000Z" };
    expect(compareChatMessagesChronologically(earlier, later)).toBeLessThan(0);
    expect(compareChatMessagesChronologically(later, earlier)).toBeGreaterThan(0);
  });

  it("breaks ties on equal timestamps by id, lexicographically", () => {
    const first = { id: "aaa", created_at: "2026-01-01T00:00:00.000Z" };
    const second = { id: "zzz", created_at: "2026-01-01T00:00:00.000Z" };
    expect(compareChatMessagesChronologically(first, second)).toBeLessThan(0);
    expect(compareChatMessagesChronologically(second, first)).toBeGreaterThan(0);
  });

  it("returns 0 for identical timestamp and id", () => {
    const message = { id: "same", created_at: "2026-01-01T00:00:00.000Z" };
    expect(compareChatMessagesChronologically(message, { ...message })).toBe(0);
  });
});

describe("sortChatMessagesChronologically", () => {
  it("sorts an unordered list ascending with id tie-breaking", () => {
    const messages = [
      { id: "c", created_at: "2026-01-03T00:00:00.000Z" },
      { id: "b2", created_at: "2026-01-01T00:00:00.000Z" },
      { id: "b1", created_at: "2026-01-01T00:00:00.000Z" },
      { id: "a", created_at: "2026-01-02T00:00:00.000Z" },
    ];

    expect(sortChatMessagesChronologically(messages).map((m) => m.id)).toEqual([
      "b1",
      "b2",
      "a",
      "c",
    ]);
  });

  it("does not mutate the input array", () => {
    const messages = [
      { id: "b", created_at: "2026-01-02T00:00:00.000Z" },
      { id: "a", created_at: "2026-01-01T00:00:00.000Z" },
    ];
    const original = [...messages];
    sortChatMessagesChronologically(messages);
    expect(messages).toEqual(original);
  });

  it("preserves extra fields on each message", () => {
    const messages = [
      { id: "b", created_at: "2026-01-02T00:00:00.000Z", text: "second" },
      { id: "a", created_at: "2026-01-01T00:00:00.000Z", text: "first" },
    ];
    expect(sortChatMessagesChronologically(messages)).toEqual([
      { id: "a", created_at: "2026-01-01T00:00:00.000Z", text: "first" },
      { id: "b", created_at: "2026-01-02T00:00:00.000Z", text: "second" },
    ]);
  });
});
