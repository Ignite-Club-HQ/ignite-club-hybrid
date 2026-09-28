import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheMessagesPageData,
  clearMessagesPageCache,
  getCachedMessagesPageData,
} from "./messagesPageCache";

const team = {
  id: "team-1",
  name: "Riverside U8 Blue",
  logo_url: null,
  clubs: { name: "Riverside FC", logo_url: null, sport: "football" },
};
const club = { id: "club-1", name: "Riverside FC", logo_url: null, sport: "football" };

describe("messagesPageCache characterization — user and partial-update isolation", () => {
  beforeEach(() => {
    localStorage.clear();
    clearMessagesPageCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("never exposes one user's inbox cache to another user", () => {
    cacheMessagesPageData("user-a", { teams: [team] });
    expect(getCachedMessagesPageData("user-a")?.teams).toEqual([team]);
    expect(getCachedMessagesPageData("user-b")).toBeNull();
  });

  it("preserves unaffected inbox sections across partial query completions", () => {
    cacheMessagesPageData("user-a", { teams: [team], memberClubs: [club] });
    cacheMessagesPageData("user-a", {
      latestTeamMessages: {
        "team-1": { text: "Training moved", author: "Coach", created_at: "2026-07-26T10:00:00Z" },
      },
    });
    const cached = getCachedMessagesPageData("user-a");
    expect(cached?.teams).toEqual([team]);
    expect(cached?.memberClubs).toEqual([club]);
    expect(cached?.latestTeamMessages["team-1"]?.text).toBe("Training moved");
  });

  it("replaces prior-user state when a different user becomes active", () => {
    cacheMessagesPageData("user-a", { teams: [team], memberClubs: [club] });
    cacheMessagesPageData("user-b", { adminClubs: [club] });
    expect(getCachedMessagesPageData("user-a")).toBeNull();
    expect(getCachedMessagesPageData("user-b")).toEqual(expect.objectContaining({
      teams: [],
      memberClubs: [],
      adminClubs: [club],
    }));
  });

  it("distinguishes an explicit empty result from an omitted field", () => {
    cacheMessagesPageData("user-a", { teams: [team], memberClubs: [club] });
    cacheMessagesPageData("user-a", { teams: [] });
    const cached = getCachedMessagesPageData("user-a");
    expect(cached?.teams).toEqual([]);
    expect(cached?.memberClubs).toEqual([club]);
  });

  it("clears every in-memory and persisted inbox value on sign-out", () => {
    cacheMessagesPageData("user-a", { teams: [team], memberClubs: [club] });
    clearMessagesPageCache();
    expect(getCachedMessagesPageData("user-a")).toBeNull();
    expect(localStorage.getItem("messages-page-cache-v2")).toBeNull();
  });
});
