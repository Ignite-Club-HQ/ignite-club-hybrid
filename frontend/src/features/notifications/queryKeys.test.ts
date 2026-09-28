import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { notificationCacheRoots, notificationKeys } from "./queryKeys";

describe("notification query-key contract", () => {
  it("normalizes missing and null club filters to one all-clubs identity", () => {
    expect(notificationKeys.list("user-1")).toEqual([
      "notifications",
      "user-1",
      "all",
    ]);
    expect(notificationKeys.list("user-1", null)).toEqual(
      notificationKeys.list("user-1", undefined),
    );
    expect(notificationKeys.recentFor("user-1", null)).toEqual([
      "recent-notifications",
      "user-1",
      null,
    ]);
  });

  it("preserves the existing disabled-query and header key shapes", () => {
    expect(notificationKeys.list(undefined, null)).toEqual([
      "notifications",
      undefined,
      "all",
    ]);
    expect(notificationKeys.recentFor(undefined, null)).toEqual([
      "recent-notifications",
      undefined,
      null,
    ]);
    expect(notificationKeys.clubUnreadFor(undefined, null)).toEqual([
      "club-unread-count",
      undefined,
      null,
    ]);
  });

  it("gives different users and clubs different exact cache identities", () => {
    const keys = [
      notificationKeys.list("user-1", "club-a"),
      notificationKeys.list("user-1", "club-b"),
      notificationKeys.list("user-2", "club-a"),
    ];

    expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(3);
    expect(notificationKeys.clubUnreadFor("user-1", "club-a")).not.toEqual(
      notificationKeys.clubUnreadFor("user-1", "club-b"),
    );
  });

  it("retains every legacy root used for intentional family invalidation", () => {
    expect(notificationCacheRoots).toEqual([
      ["notifications"],
      ["recent-notifications"],
      ["unread-count"],
      ["club-unread-count"],
      ["unread-message-counts"],
      ["club-messages-unread"],
      ["chat-group-unread-cache"],
    ]);
  });

  it("allows an exact club refresh without marking another club or user stale", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const clubA = notificationKeys.list("user-1", "club-a");
    const clubB = notificationKeys.list("user-1", "club-b");
    const otherUser = notificationKeys.list("user-2", "club-a");

    client.setQueryData(clubA, ["a"]);
    client.setQueryData(clubB, ["b"]);
    client.setQueryData(otherUser, ["other"]);
    await client.invalidateQueries({ queryKey: clubA, exact: true });

    expect(client.getQueryState(clubA)?.isInvalidated).toBe(true);
    expect(client.getQueryState(clubB)?.isInvalidated).toBe(false);
    expect(client.getQueryState(otherUser)?.isInvalidated).toBe(false);
  });

  it("allows deliberate user-family updates without touching another account", () => {
    const client = new QueryClient();
    const userOneA = notificationKeys.list("user-1", "club-a");
    const userOneB = notificationKeys.list("user-1", "club-b");
    const userTwo = notificationKeys.list("user-2", "club-a");
    client.setQueryData(userOneA, ["a"]);
    client.setQueryData(userOneB, ["b"]);
    client.setQueryData(userTwo, ["other"]);

    client.setQueriesData(
      { queryKey: [notificationKeys.lists[0], "user-1"] },
      () => ["cleared"],
    );

    expect(client.getQueryData(userOneA)).toEqual(["cleared"]);
    expect(client.getQueryData(userOneB)).toEqual(["cleared"]);
    expect(client.getQueryData(userTwo)).toEqual(["other"]);
  });
});
