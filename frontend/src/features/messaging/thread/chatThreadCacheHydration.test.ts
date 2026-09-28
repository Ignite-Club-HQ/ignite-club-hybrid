import { describe, expect, it } from "vitest";
import {
  mergeCachedChatMessagesChronologically,
  selectHistoryChatPlaceholderSource,
} from "./chatThreadCacheHydration";

describe("mergeCachedChatMessagesChronologically", () => {
  it("adds cached rows missing from the query snapshot and orders the result", () => {
    const result = mergeCachedChatMessagesChronologically(
      [{ id: "existing", created_at: "2026-08-04T10:00:00.000Z" }],
      [{ id: "cached-older", created_at: "2026-08-04T09:59:00.000Z" }],
    );

    expect(result.map((message) => message.id)).toEqual(["cached-older", "existing"]);
  });

  it("keeps the existing query row when cache contains the same id", () => {
    const result = mergeCachedChatMessagesChronologically(
      [{ id: "same", created_at: "2026-08-04T10:00:00.000Z", text: "query" }],
      [{ id: "same", created_at: "2026-08-04T10:00:00.000Z", text: "cache" }],
    );

    expect(result).toEqual([
      { id: "same", created_at: "2026-08-04T10:00:00.000Z", text: "query" },
    ]);
  });

  it("does not mutate query-owned or cache-owned arrays", () => {
    const existing = [{ id: "existing", created_at: "2026-08-04T10:00:00.000Z" }];
    const cached = [{ id: "cached", created_at: "2026-08-04T09:59:00.000Z" }];

    const result = mergeCachedChatMessagesChronologically(existing, cached);

    expect(result).not.toBe(existing);
    expect(result).not.toBe(cached);
    expect(existing.map((message) => message.id)).toEqual(["existing"]);
    expect(cached.map((message) => message.id)).toEqual(["cached"]);
  });
});

describe("selectHistoryChatPlaceholderSource", () => {
  it("uses a meaningful five-row cache for notification first paint", () => {
    expect(
      selectHistoryChatPlaceholderSource({
        hasPrevious: true,
        cachedMessageCount: 5,
        openedFromNotification: true,
      }),
    ).toBe("cache");
  });

  it("preserves the previous snapshot when notification cache is only a preload stub", () => {
    expect(
      selectHistoryChatPlaceholderSource({
        hasPrevious: true,
        cachedMessageCount: 1,
        openedFromNotification: true,
      }),
    ).toBe("previous");
  });

  it("uses an ordinary two-row cache only when no previous snapshot exists", () => {
    expect(
      selectHistoryChatPlaceholderSource({
        hasPrevious: false,
        cachedMessageCount: 2,
        openedFromNotification: false,
      }),
    ).toBe("cache");
  });

  it("does not treat a lone ordinary cached row as usable history", () => {
    expect(
      selectHistoryChatPlaceholderSource({
        hasPrevious: false,
        cachedMessageCount: 1,
        openedFromNotification: false,
      }),
    ).toBe("none");
  });

  it("preserves a previous snapshot before considering ordinary cache", () => {
    expect(
      selectHistoryChatPlaceholderSource({
        hasPrevious: true,
        cachedMessageCount: 20,
        openedFromNotification: false,
      }),
    ).toBe("previous");
  });
});
