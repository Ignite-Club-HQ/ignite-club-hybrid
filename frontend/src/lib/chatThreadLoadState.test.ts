import { describe, it, expect } from "vitest";
import {
  classifyChatThreadState,
  nextEmptyRetryDelay,
  isUsableCachedThread,
  NOTIFICATION_PRELOAD_FLAG,
  type ChatThreadStateInput,
} from "./chatThreadLoadState";

const base: ChatThreadStateInput = {
  authReady: true,
  status: "success",
  fetchStatus: "idle",
  isError: false,
  hasUsableCached: false,
  fetchedCount: null,
  inboxSaysHasMessage: false,
  recoveryExhausted: false,
};

describe("classifyChatThreadState", () => {
  it("treats a paused pending query as loading, never as empty", () => {
    expect(
      classifyChatThreadState({ ...base, status: "pending", fetchStatus: "paused" }),
    ).toBe("loading");
  });

  it("treats a pending query with no data as loading", () => {
    expect(classifyChatThreadState({ ...base, status: "pending", fetchStatus: "fetching" })).toBe(
      "loading",
    );
  });

  it("waits for auth before deciding anything", () => {
    expect(classifyChatThreadState({ ...base, authReady: false })).toBe("loading");
  });

  it("shows cached content while the authoritative fetch is delayed", () => {
    expect(
      classifyChatThreadState({
        ...base,
        status: "pending",
        fetchStatus: "fetching",
        hasUsableCached: true,
      }),
    ).toBe("content");
  });

  it("renders content once messages arrive", () => {
    expect(classifyChatThreadState({ ...base, fetchedCount: 3 })).toBe("content");
  });

  it("keeps recovering on an empty response the inbox contradicts", () => {
    expect(
      classifyChatThreadState({ ...base, fetchedCount: 0, inboxSaysHasMessage: true }),
    ).toBe("loading");
  });

  it("surfaces an error once recovery is exhausted and the inbox disagrees", () => {
    expect(
      classifyChatThreadState({
        ...base,
        fetchedCount: 0,
        inboxSaysHasMessage: true,
        recoveryExhausted: true,
      }),
    ).toBe("error");
  });

  it("shows the empty state only for an authoritative empty conversation", () => {
    expect(classifyChatThreadState({ ...base, fetchedCount: 0 })).toBe("empty");
  });

  it("shows a recoverable error, not empty, when the query failed with no cache", () => {
    expect(
      classifyChatThreadState({ ...base, status: "error", isError: true, recoveryExhausted: true }),
    ).toBe("error");
    expect(classifyChatThreadState({ ...base, status: "error", isError: true })).toBe("loading");
  });

  it("prefers cached content over an error state", () => {
    expect(
      classifyChatThreadState({
        ...base,
        status: "error",
        isError: true,
        recoveryExhausted: true,
        hasUsableCached: true,
      }),
    ).toBe("content");
  });
});

describe("nextEmptyRetryDelay", () => {
  it("uses bounded backoff and then stops", () => {
    expect(nextEmptyRetryDelay(0)).toBe(400);
    expect(nextEmptyRetryDelay(1)).toBe(1200);
    expect(nextEmptyRetryDelay(2)).toBe(3000);
    expect(nextEmptyRetryDelay(3)).toBeNull();
    expect(nextEmptyRetryDelay(-1)).toBeNull();
  });
});

describe("isUsableCachedThread", () => {
  it("accepts a genuine one-message cached thread", () => {
    expect(isUsableCachedThread([{ id: "a" }])).toBe(true);
  });

  it("rejects a notification-preload-only cache", () => {
    expect(isUsableCachedThread([{ id: "a", [NOTIFICATION_PRELOAD_FLAG]: true }])).toBe(false);
  });

  it("accepts a preload plus real cached messages", () => {
    expect(
      isUsableCachedThread([{ id: "a", [NOTIFICATION_PRELOAD_FLAG]: true }, { id: "b" }]),
    ).toBe(true);
  });

  it("rejects empty/missing caches", () => {
    expect(isUsableCachedThread([])).toBe(false);
    expect(isUsableCachedThread(undefined)).toBe(false);
  });
});
