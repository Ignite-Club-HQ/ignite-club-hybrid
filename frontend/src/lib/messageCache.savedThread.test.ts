import { afterEach, describe, expect, it } from "vitest";
import {
  addMessageToCache,
  cacheMessages,
  clearMessageCache,
  isCachedThreadComplete,
  removeMessageFromCache,
  type CachedMessage,
} from "./messageCache";
import { selectHistoryChatPlaceholderSource } from "@/lab/chatThreadCacheHydration";
import { runFewAtATime } from "@/features/messaging/thread/icpTeamThreadPage";

const row = (id: string): CachedMessage => ({
  id, text: id, author_id: "u", created_at: "2026-10-29T00:00:00.000Z",
  image_url: null, reply_to_id: null, profiles: null,
});

afterEach(() => { clearMessageCache("group", "g-saved"); clearMessageCache("team", "t-stub"); });

describe("saved chat copies open straight away", () => {
  it("an empty chat read is saved as a complete copy", () => {
    cacheMessages("group", "g-saved", []);
    expect(isCachedThreadComplete("group", "g-saved")).toBe(true);
  });

  it("a lone notification preload is never a complete copy", () => {
    addMessageToCache("team", "t-stub", row("pushed"));
    expect(isCachedThreadComplete("team", "t-stub")).toBe(false);
  });

  it("a preload or deletion on a real copy keeps it complete", () => {
    cacheMessages("group", "g-saved", [row("a")]);
    addMessageToCache("group", "g-saved", row("b"));
    removeMessageFromCache("group", "g-saved", "a");
    expect(isCachedThreadComplete("group", "g-saved")).toBe(true);
  });

  it("a complete copy with zero or one message paints from the device", () => {
    expect(selectHistoryChatPlaceholderSource({ hasPrevious: false, cachedMessageCount: 0, openedFromNotification: false, cachedComplete: true })).toBe("cache");
    expect(selectHistoryChatPlaceholderSource({ hasPrevious: false, cachedMessageCount: 1, openedFromNotification: false, cachedComplete: false })).toBe("none");
  });
});

describe("ahead-of-time chat loading", () => {
  it("runs at most three reads at once and finishes them all", async () => {
    let active = 0, peak = 0;
    const done: number[] = [];
    await runFewAtATime([1, 2, 3, 4, 5, 6], async n => {
      active++; peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 5));
      active--; done.push(n);
      if (n === 2) throw new Error("ignored");
    });
    expect(peak).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
