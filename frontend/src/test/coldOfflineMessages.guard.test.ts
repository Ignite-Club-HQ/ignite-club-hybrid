import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard: cold-offline must never leave the Messages inbox on a skeleton or a
 * blank list. Cached, user-scoped conversations render immediately and stay
 * selectable while Supabase REST is unreachable.
 */
const messages = [
  readFileSync(join(__dirname, "../pages/MessagesPage.tsx"), "utf8"),
  readFileSync(join(__dirname, "../pages/MessagesInboxSections.tsx"), "utf8"),
].join("\n");
const cache = readFileSync(join(__dirname, "../lib/messagesPageCache.ts"), "utf8");

describe("cold-offline messages inbox guards", () => {
  it("tracks online status", () => {
    expect(messages).toMatch(/useOnlineStatus/);
  });

  it("never shows skeletons while offline", () => {
    expect(messages).toMatch(/const showSkeletonLoading = isOnline &&/);
  });

  it("does not wait on remote queries to settle while offline", () => {
    expect(messages).toMatch(/const freshSortDataReady = !isOnline \|\|/);
  });

  it("keeps cached teams, clubs and groups when offline results are empty", () => {
    expect(messages).toMatch(/!isOnline \|\| !teamsFetched\) \? \(cachedData\?\.teams as any\)/);
    expect(messages).toMatch(/!isOnline \|\| !memberClubsFetched\) \? \(cachedData\?\.memberClubs as any\)/);
    expect(messages).toMatch(/!isOnline \|\| !chatGroupsFetched\) \? \(cachedData\?\.chatGroups as any\)/);
  });

  it("does not drop club/team groups when roles cannot load offline", () => {
    expect(messages).toMatch(/rolesUnavailableOffline/);
  });

  it("rebuilds DM conversations from the cache when offline", () => {
    expect(messages).toMatch(/offlineCachedDMs/);
    expect(messages).toMatch(/effectiveDMConversations/);
  });

  it("shows offline status and a friendly offline empty state", () => {
    expect(messages).toMatch(/You're offline — showing saved conversations\./);
    expect(messages).toMatch(/You're offline and no saved conversations are available yet/);
  });

  it("keeps the inbox cache user-scoped", () => {
    expect(cache).toMatch(/userId/);
  });
});
