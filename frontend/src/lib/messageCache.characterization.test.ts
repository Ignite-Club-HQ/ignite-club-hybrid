import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addMessageToCache,
  cacheMessages,
  clearMessageCache,
  getCachedMessages,
  hasCachedMessages,
  removeMessageFromCache,
  shouldRefetchMessages,
  type CachedMessage,
} from "./messageCache";

function message(id: string, minute: number, text = id): CachedMessage {
  return {
    id,
    text,
    author_id: "user-1",
    created_at: `2026-07-26T10:${String(minute).padStart(2, "0")}:00.000Z`,
    image_url: null,
    reply_to_id: null,
    profiles: { display_name: "Synthetic User", avatar_url: null },
  };
}

const scopes = [
  ["team", "team-1"],
  ["club", "club-1"],
  ["group", "group-1"],
  ["broadcast", "global"],
  ["dm", "dm-1"],
  ["club_admin", "admin-1"],
] as const;

describe("messageCache characterization — ordering, isolation, and optimistic changes", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    for (const [type, id] of scopes) clearMessageCache(type, id);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("normalizes mixed input into deterministic chronological order", () => {
    cacheMessages("team", "team-1", [message("c", 3), message("a", 1), message("b", 2)]);
    expect(getCachedMessages("team", "team-1").map(row => row.id)).toEqual(["a", "b", "c"]);
  });

  it("uses message id as a stable tie-breaker for equal timestamps", () => {
    cacheMessages("team", "team-1", [message("b", 1), message("a", 1)]);
    expect(getCachedMessages("team", "team-1").map(row => row.id)).toEqual(["a", "b"]);
  });

  it("retains the newest 100 messages rather than stale history", () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({
      ...message(`message-${String(index).padStart(3, "0")}`, index % 60),
      created_at: new Date(Date.UTC(2026, 6, 26, 10, index)).toISOString(),
    }));
    cacheMessages("team", "team-1", rows.reverse());
    const cached = getCachedMessages("team", "team-1");
    expect(cached).toHaveLength(100);
    expect(cached[0].id).toBe("message-020");
    expect(cached.at(-1)?.id).toBe("message-119");
  });

  it("replaces a realtime copy of the same id instead of duplicating it", () => {
    cacheMessages("group", "group-1", [message("m1", 1, "optimistic")]);
    addMessageToCache("group", "group-1", message("m1", 1, "confirmed"));
    expect(getCachedMessages("group", "group-1")).toEqual([
      expect.objectContaining({ id: "m1", text: "confirmed" }),
    ]);
  });

  it.each(scopes)("reconciles optimistic, realtime update and delete behaviour for %s", (type, target) => {
    const optimistic = message("shared-id", 1, "optimistic");
    addMessageToCache(type, target, optimistic);
    expect(getCachedMessages(type, target)).toEqual([optimistic]);

    addMessageToCache(type, target, message("shared-id", 1, "server-confirmed"));
    expect(getCachedMessages(type, target)).toEqual([
      expect.objectContaining({ id: "shared-id", text: "server-confirmed" }),
    ]);

    removeMessageFromCache(type, target, "shared-id");
    expect(getCachedMessages(type, target)).toEqual([]);
  });

  it("removes only the deleted message from the selected conversation", () => {
    cacheMessages("group", "group-1", [message("m1", 1), message("m2", 2)]);
    cacheMessages("team", "team-1", [message("m1", 1)]);
    removeMessageFromCache("group", "group-1", "m1");
    expect(getCachedMessages("group", "group-1").map(row => row.id)).toEqual(["m2"]);
    expect(getCachedMessages("team", "team-1").map(row => row.id)).toEqual(["m1"]);
  });

  it.each(scopes)("keeps %s cache data isolated by chat type and target", (type, target) => {
    cacheMessages(type, target, [message(`${type}-message`, 1)]);
    expect(getCachedMessages(type, target)).toHaveLength(1);
    expect(getCachedMessages(type, `${target}-other`)).toEqual([]);
  });

  it("requests a refetch only when a populated cache unexpectedly receives zero rows", () => {
    cacheMessages("club", "club-1", [message("m1", 1)]);
    expect(shouldRefetchMessages("club", "club-1", 0)).toBe(true);
    expect(shouldRefetchMessages("club", "club-1", 1)).toBe(false);
    expect(shouldRefetchMessages("club", "unknown", 0)).toBe(false);
  });

  it("clears one conversation without leaking into another", () => {
    cacheMessages("team", "team-1", [message("m1", 1)]);
    cacheMessages("team", "team-2", [message("m2", 2)]);
    clearMessageCache("team", "team-1");
    expect(hasCachedMessages("team", "team-1")).toBe(false);
    expect(hasCachedMessages("team", "team-2")).toBe(true);
  });
});
