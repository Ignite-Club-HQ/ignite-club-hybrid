import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearChatThreadLabelCache,
  getChatThreadLabel,
  rememberChatThreadLabel,
  rememberChatThreadLabels,
  resetChatThreadLabelCacheForTests,
} from "./chatThreadLabelCache";

const DISK_KEY = "ignite_chat_thread_labels_v1";

/** Labels are written in-memory at once and flushed to disk on an idle timer. */
function flushToDisk(): void {
  vi.advanceTimersByTime(1600);
}

beforeEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  clearChatThreadLabelCache();
  resetChatThreadLabelCacheForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("chat thread label cache", () => {
  it("returns the name a thread was last seen under", () => {
    rememberChatThreadLabel("user-a", "group", "group-1", { title: "Riverside Rovers" });
    expect(getChatThreadLabel("user-a", "group", "group-1")).toEqual({ title: "Riverside Rovers" });
  });

  it("never shows another account's thread names", () => {
    rememberChatThreadLabel("user-a", "dm", "dm-1", { title: "Jane Parent" });
    expect(getChatThreadLabel("user-b", "dm", "dm-1")).toBeNull();
  });

  it("ignores a stored blob that belongs to a different account", () => {
    rememberChatThreadLabel("user-a", "team", "team-1", { title: "U12 Tigers" });
    flushToDisk();
    // Fresh device load for a second account on the same device.
    resetChatThreadLabelCacheForTests();
    expect(getChatThreadLabel("user-b", "team", "team-1")).toBeNull();
  });

  it("keeps private message text out of the stored labels", () => {
    rememberChatThreadLabels("user-a", [
      {
        type: "dm",
        id: "dm-9",
        name: "Jane Parent",
        // Rows handed over from the inbox carry preview text; it must not be kept.
        lastMessage: { text: "PRIVATE-CHILD-DETAIL-LEAK", author: "Jane Parent" },
      } as never,
    ]);
    flushToDisk();
    const stored = localStorage.getItem(DISK_KEY) ?? "";
    expect(stored).toContain("Jane Parent");
    expect(stored).not.toContain("PRIVATE-CHILD-DETAIL-LEAK");
    expect(getChatThreadLabel("user-a", "dm", "dm-9")).toEqual({ title: "Jane Parent" });
  });

  it("records every thread name the inbox is showing", () => {
    rememberChatThreadLabels("user-a", [
      { type: "team", id: "team-1", name: "U12 Tigers", avatarUrl: "https://cdn.test/tigers.png" },
      { type: "league", id: "league-1", name: "Winter Cup" },
      { type: "admin_group", id: "adm-1", name: "Riverside Admin" },
    ]);
    expect(getChatThreadLabel("user-a", ["group", "league"], "league-1")).toEqual({ title: "Winter Cup" });
    expect(getChatThreadLabel("user-a", "admin_group", "adm-1")).toEqual({ title: "Riverside Admin" });
    expect(getChatThreadLabel("user-a", "team", "team-1")).toEqual({
      title: "U12 Tigers",
      avatarUrl: "https://cdn.test/tigers.png",
    });
  });

  it("keeps the number of remembered labels bounded", () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({
      type: "group" as const,
      id: `group-${index}`,
      name: `Group ${index}`,
    }));
    rememberChatThreadLabels("user-a", rows);
    flushToDisk();
    const stored = JSON.parse(localStorage.getItem(DISK_KEY) ?? '{"labels":{}}') as {
      labels: Record<string, unknown>;
    };
    expect(Object.keys(stored.labels).length).toBeLessThanOrEqual(120);
  });

  it("drops non-https avatar URLs", () => {
    rememberChatThreadLabel("user-a", "club", "club-1", {
      title: "Riverside",
      avatarUrl: "data:image/png;base64,AAAA",
    });
    expect(getChatThreadLabel("user-a", "club", "club-1")).toEqual({ title: "Riverside" });
  });

  it("keeps an existing subtitle when a later write carries none", () => {
    rememberChatThreadLabel("user-a", "group", "group-2", { title: "Canteen", subtitle: "Club group" });
    rememberChatThreadLabel("user-a", "group", "group-2", { title: "Canteen" });
    expect(getChatThreadLabel("user-a", "group", "group-2")).toEqual({
      title: "Canteen",
      subtitle: "Club group",
    });
  });

  it("removes both the in-memory copy and the stored blob on sign-out", () => {
    rememberChatThreadLabel("user-a", "dm", "dm-1", { title: "Jane Parent" });
    flushToDisk();
    expect(localStorage.getItem(DISK_KEY)).toBeTruthy();

    clearChatThreadLabelCache();

    expect(localStorage.getItem(DISK_KEY)).toBeNull();
    expect(getChatThreadLabel("user-a", "dm", "dm-1")).toBeNull();
  });

  it("ignores empty and non-string labels", () => {
    rememberChatThreadLabel("user-a", "dm", "dm-1", { title: "   " });
    rememberChatThreadLabel("", "dm", "dm-2", { title: "Nobody" });
    rememberChatThreadLabel("user-a", "dm", null, { title: "Nobody" });
    expect(getChatThreadLabel("user-a", "dm", "dm-1")).toBeNull();
    expect(getChatThreadLabel("user-a", "dm", "dm-2")).toBeNull();
  });
});
