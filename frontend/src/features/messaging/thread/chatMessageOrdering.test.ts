import { describe, expect, it } from "vitest";
import {
  mergeOlderChatMessagesChronologically,
  orderChatMessagesChronologically,
  prependStrictlyOlderChatMessages,
} from "./chatMessageOrdering";

describe("orderChatMessagesChronologically", () => {
  it("orders older messages before newer messages", () => {
    const result = orderChatMessagesChronologically([
      { id: "newer", created_at: "2026-08-04T10:01:00.000Z" },
      { id: "older", created_at: "2026-08-04T10:00:00.000Z" },
    ]);

    expect(result.map((message) => message.id)).toEqual(["older", "newer"]);
  });

  it("uses immutable message id to make equal timestamps deterministic", () => {
    const created_at = "2026-08-04T10:00:00.000Z";

    expect(
      orderChatMessagesChronologically([
        { id: "message-b", created_at },
        { id: "message-a", created_at },
      ]).map((message) => message.id),
    ).toEqual(["message-a", "message-b"]);
  });

  it("retains the existing id fallback when timestamps are invalid", () => {
    expect(
      orderChatMessagesChronologically([
        { id: "message-b", created_at: "invalid" },
        { id: "message-a", created_at: "invalid" },
      ]).map((message) => message.id),
    ).toEqual(["message-a", "message-b"]);
  });

  it("does not mutate the query-owned input array", () => {
    const messages = [
      { id: "newer", created_at: "2026-08-04T10:01:00.000Z" },
      { id: "older", created_at: "2026-08-04T10:00:00.000Z" },
    ];

    const result = orderChatMessagesChronologically(messages);

    expect(result).not.toBe(messages);
    expect(messages.map((message) => message.id)).toEqual(["newer", "older"]);
  });
});

describe("prependStrictlyOlderChatMessages", () => {
  it("preserves older-page and current-page order while prepending", () => {
    expect(
      prependStrictlyOlderChatMessages(
        [{ id: "older-a" }, { id: "older-b" }],
        [{ id: "current-a" }, { id: "current-b" }],
      ).map((message) => message.id),
    ).toEqual(["older-a", "older-b", "current-a", "current-b"]);
  });

  it("intentionally preserves repeated ids because strict timestamp queries own the boundary", () => {
    expect(
      prependStrictlyOlderChatMessages(
        [{ id: "repeated", source: "older" }],
        [{ id: "repeated", source: "current" }],
      ),
    ).toEqual([
      { id: "repeated", source: "older" },
      { id: "repeated", source: "current" },
    ]);
  });

  it("supports an absent current page without returning an input reference", () => {
    const older = [{ id: "older" }];
    const result = prependStrictlyOlderChatMessages(older, undefined);

    expect(result).toEqual(older);
    expect(result).not.toBe(older);
  });

  it("does not mutate either input", () => {
    const older = [{ id: "older" }];
    const current = [{ id: "current" }];

    prependStrictlyOlderChatMessages(older, current);

    expect(older).toEqual([{ id: "older" }]);
    expect(current).toEqual([{ id: "current" }]);
  });
});

describe("mergeOlderChatMessagesChronologically", () => {
  it("prepends an older page in chronological order", () => {
    const result = mergeOlderChatMessagesChronologically(
      [
        { id: "oldest", created_at: "2026-08-04T09:58:00.000Z" },
        { id: "older", created_at: "2026-08-04T09:59:00.000Z" },
      ],
      [{ id: "current", created_at: "2026-08-04T10:00:00.000Z" }],
    );

    expect(result.map((message) => message.id)).toEqual([
      "oldest",
      "older",
      "current",
    ]);
  });

  it("keeps current in-memory state when the page boundary repeats an id", () => {
    const result = mergeOlderChatMessagesChronologically(
      [{ id: "boundary", created_at: "2026-08-04T09:59:00.000Z", text: "stale" }],
      [{ id: "boundary", created_at: "2026-08-04T09:59:00.000Z", text: "realtime edit" }],
    );

    expect(result).toEqual([
      { id: "boundary", created_at: "2026-08-04T09:59:00.000Z", text: "realtime edit" },
    ]);
  });

  it("does not mutate either input collection", () => {
    const older = [{ id: "older", created_at: "2026-08-04T09:59:00.000Z" }];
    const current = [{ id: "current", created_at: "2026-08-04T10:00:00.000Z" }];

    const result = mergeOlderChatMessagesChronologically(older, current);

    expect(result).not.toBe(older);
    expect(result).not.toBe(current);
    expect(older.map((message) => message.id)).toEqual(["older"]);
    expect(current.map((message) => message.id)).toEqual(["current"]);
  });

  it("supports an absent current page", () => {
    expect(
      mergeOlderChatMessagesChronologically(
        [{ id: "older", created_at: "2026-08-04T09:59:00.000Z" }],
        undefined,
      ).map((message) => message.id),
    ).toEqual(["older"]);
  });
});
