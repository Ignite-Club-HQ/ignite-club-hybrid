import { describe, it, expect } from "vitest";
import {
  authoritativeMessageExists,
  AUTHORITATIVE_MATCH_SKEW_MS,
  splitPollMarkup,
  createSendTempId,
  restoreFailedSendComposer,
  type FailedSendContext,
  findSupersededOptimisticIndex,
  dropSupersededOptimisticRow,
} from "./failedSendRestore";

const NOW = 1_760_000_000_000;
const AUTHOR = "author-1";

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "real-1",
    author_id: AUTHOR,
    text: "hello",
    image_url: null,
    reply_to_id: null,
    created_at: new Date(NOW + 500).toISOString(),
    ...over,
  } as never;
}

const base = { authorId: AUTHOR, text: "hello", imageUrl: null, replyToId: null, sentAtMs: NOW };

const stateSetter = <T>(state: { current: T }) =>
  (update: (current: T) => T) => { state.current = update(state.current); };

describe("authoritativeMessageExists", () => {
  it("matches a recent exact payload", () => {
    expect(authoritativeMessageExists([row()], base)).toBe(true);
  });

  it("does not match an old same-author, same-text message", () => {
    const old = row({ created_at: new Date(NOW - 3 * 60 * 60 * 1000).toISOString() });
    expect(authoritativeMessageExists([old], base)).toBe(false);
  });

  it("does not match a different author", () => {
    expect(authoritativeMessageExists([row({ author_id: "other" })], base)).toBe(false);
  });

  it("does not match different text", () => {
    expect(authoritativeMessageExists([row({ text: "hello there" })], base)).toBe(false);
  });

  it("does not match a different attachment", () => {
    expect(authoritativeMessageExists([row({ image_url: "https://reference.invalid" })], base)).toBe(false);
    expect(
      authoritativeMessageExists([row()], { ...base, imageUrl: "https://reference.invalid" }),
    ).toBe(false);
  });

  it("does not match a different reply target", () => {
    expect(authoritativeMessageExists([row({ reply_to_id: "msg-9" })], base)).toBe(false);
    expect(authoritativeMessageExists([row()], { ...base, replyToId: "msg-9" })).toBe(false);
  });

  it("ignores temp-* and queued-* rows", () => {
    expect(authoritativeMessageExists([row({ id: "temp-abc" })], base)).toBe(false);
    expect(authoritativeMessageExists([row({ id: "queued-abc" })], base)).toBe(false);
  });

  it("tolerates reasonable clock skew", () => {
    const skewed = row({ created_at: new Date(NOW - (AUTHORITATIVE_MATCH_SKEW_MS - 1000)).toISOString() });
    expect(authoritativeMessageExists([skewed], base)).toBe(true);
    const tooEarly = row({ created_at: new Date(NOW - (AUTHORITATIVE_MATCH_SKEW_MS + 5000)).toISOString() });
    expect(authoritativeMessageExists([tooEarly], base)).toBe(false);
  });

  it("fails safe on malformed or missing timestamps", () => {
    expect(authoritativeMessageExists([row({ created_at: "not-a-date" })], base)).toBe(false);
    expect(authoritativeMessageExists([row({ created_at: null })], base)).toBe(false);
    expect(authoritativeMessageExists([row()], { ...base, sentAtMs: undefined })).toBe(false);
    expect(authoritativeMessageExists([row()], { ...base, sentAtMs: NaN })).toBe(false);
  });

  it("handles empty inputs", () => {
    expect(authoritativeMessageExists([], base)).toBe(false);
    expect(authoritativeMessageExists(null, base)).toBe(false);
  });

  it("does not match a different author, text, attachment or reply target", () => {
    expect(authoritativeMessageExists([row({ author_id: "other" })], base)).toBe(false);
    expect(authoritativeMessageExists([row({ text: "hello there" })], base)).toBe(false);
    expect(authoritativeMessageExists([row({ image_url: "https://reference.invalid" })], base)).toBe(false);
    expect(
      authoritativeMessageExists([row()], { ...base, imageUrl: "https://reference.invalid" }),
    ).toBe(false);
    expect(authoritativeMessageExists([row({ reply_to_id: "msg-9" })], base)).toBe(false);
    expect(authoritativeMessageExists([row()], { ...base, replyToId: "msg-9" })).toBe(false);
  });

  it("ignores optimistic and queued rows", () => {
    expect(authoritativeMessageExists([row({ id: "temp-abc" })], base)).toBe(false);
    expect(authoritativeMessageExists([row({ id: "queued-abc" })], base)).toBe(false);
  });

  it("tolerates bounded clock skew but rejects older messages", () => {
    const skewed = row({ created_at: new Date(NOW - (AUTHORITATIVE_MATCH_SKEW_MS - 1000)).toISOString() });
    expect(authoritativeMessageExists([skewed], base)).toBe(true);
    const tooEarly = row({ created_at: new Date(NOW - (AUTHORITATIVE_MATCH_SKEW_MS + 5000)).toISOString() });
    expect(authoritativeMessageExists([tooEarly], base)).toBe(false);
  });

  it("fails safe on malformed or missing timestamps and empty inputs", () => {
    expect(authoritativeMessageExists([row({ created_at: "not-a-date" })], base)).toBe(false);
    expect(authoritativeMessageExists([row({ created_at: null })], base)).toBe(false);
    expect(authoritativeMessageExists([row()], { ...base, sentAtMs: undefined })).toBe(false);
    expect(authoritativeMessageExists([row()], { ...base, sentAtMs: NaN })).toBe(false);
    expect(authoritativeMessageExists([], base)).toBe(false);
    expect(authoritativeMessageExists(null, base)).toBe(false);
  });
});

describe("composer helpers", () => {
  it("splits poll markup", () => {
    expect(splitPollMarkup("caption [poll:abc]")).toEqual({ baseText: "caption", pollId: "abc" });
    expect(splitPollMarkup("plain")).toEqual({ baseText: "plain", pollId: null });
  });

  it("creates unique temp ids", () => {
    expect(createSendTempId()).not.toBe(createSendTempId());
  });
});

describe("failed send composer restoration", () => {
  it("creates unique optimistic ids and separates poll markup", () => {
    const ids = new Set(Array.from({ length: 50 }, () => createSendTempId()));
    expect(ids.size).toBe(50);
    expect([...ids].every((id) => id.startsWith("temp-"))).toBe(true);
    expect(splitPollMarkup("Training update [poll:poll-123]")).toEqual({
      baseText: "Training update",
      pollId: "poll-123",
    });
    expect(splitPollMarkup("plain")).toEqual({ baseText: "plain", pollId: null });
  });

  it("restores every still-empty composer slot", () => {
    const text = { current: "" };
    const image = { current: null as string | null };
    const reply = { current: null as { id: string } | null };
    const poll = { current: null as string | null };
    const context: FailedSendContext<{ id: string }> = {
      tempId: "temp-one",
      sentText: "Unsent caption",
      sentImageUrl: "https://local.invalid/image.png",
      previousReplyTarget: { id: "parent-one" },
      pendingPollId: "poll-one",
      sentAtMs: NOW,
    };

    restoreFailedSendComposer({
      context,
      setText: stateSetter(text),
      setImage: stateSetter(image),
      setReply: stateSetter(reply),
      setPoll: stateSetter(poll),
    });

    expect({ text: text.current, image: image.current, reply: reply.current, poll: poll.current }).toEqual({
      text: "Unsent caption",
      image: "https://local.invalid/image.png",
      reply: { id: "parent-one" },
      poll: "poll-one",
    });
  });

  it("never overwrites content selected after Send", () => {
    const text = { current: "New draft" };
    const image = { current: "new-image" as string | null };
    const reply = { current: { id: "new-parent" } as { id: string } | null };
    const poll = { current: "new-poll" as string | null };

    restoreFailedSendComposer({
      context: {
        tempId: "temp-old",
        sentText: "Old draft",
        sentImageUrl: "old-image",
        previousReplyTarget: { id: "old-parent" },
        pendingPollId: "old-poll",
        sentAtMs: NOW,
      },
      setText: stateSetter(text),
      setImage: stateSetter(image),
      setReply: stateSetter(reply),
      setPoll: stateSetter(poll),
    });

    expect({ text: text.current, image: image.current, reply: reply.current, poll: poll.current }).toEqual({
      text: "New draft",
      image: "new-image",
      reply: { id: "new-parent" },
      poll: "new-poll",
    });
  });
});

describe("concurrent-send isolation", () => {
  const a = { id: "temp-1", author_id: AUTHOR, text: "one", image_url: null, reply_to_id: null };
  const b = { id: "temp-2", author_id: AUTHOR, text: "two", image_url: null, reply_to_id: null };
  const real = { id: "real-1", author_id: AUTHOR, text: "one", image_url: null, reply_to_id: null };

  it("finds only the payload-identical optimistic row", () => {
    expect(findSupersededOptimisticIndex([a, b], real)).toBe(0);
    expect(findSupersededOptimisticIndex([b, a], real)).toBe(1);
    expect(findSupersededOptimisticIndex([b], real)).toBe(-1);
  });

  it("never matches a non-temp row or another author", () => {
    expect(findSupersededOptimisticIndex([{ ...a, id: "real-x" }], real)).toBe(-1);
    expect(findSupersededOptimisticIndex([{ ...a, author_id: "other" }], real)).toBe(-1);
    expect(findSupersededOptimisticIndex([{ ...a, id: "queued-1" }], real)).toBe(-1);
  });

  it("distinguishes attachment and reply target", () => {
    expect(findSupersededOptimisticIndex([{ ...a, image_url: "https://reference.invalid" }], real)).toBe(-1);
    expect(findSupersededOptimisticIndex([{ ...a, reply_to_id: "m9" }], real)).toBe(-1);
    expect(
      findSupersededOptimisticIndex([{ ...a, reply_to_id: "m9" }], { ...real, reply_to_id: "m9" }),
    ).toBe(0);
  });

  it("drops exactly one row and keeps concurrent optimistic sends", () => {
    expect(dropSupersededOptimisticRow([a, b], real).map((m) => m.id)).toEqual(["temp-2"]);
    // two identical concurrent sends: each success consumes one
    const dup = { ...a, id: "temp-3" };
    const once = dropSupersededOptimisticRow([a, dup, b], real);
    expect(once.map((m) => m.id)).toEqual(["temp-3", "temp-2"]);
    expect(dropSupersededOptimisticRow(once, real).map((m) => m.id)).toEqual(["temp-2"]);
  });

  it("is a no-op when nothing matches, and handles empty input", () => {
    expect(dropSupersededOptimisticRow([b], real).map((m) => m.id)).toEqual(["temp-2"]);
    expect(dropSupersededOptimisticRow([], real)).toEqual([]);
    expect(dropSupersededOptimisticRow(null, real)).toEqual([]);
  });
});
