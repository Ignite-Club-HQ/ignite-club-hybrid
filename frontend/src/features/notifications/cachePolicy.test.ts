import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { notificationKeys } from "./queryKeys";
import {
  beginNotificationListUpdate,
  invalidateNotificationSurfaces,
  notificationListFamilyKey,
  restoreQuerySnapshots,
  snapshotAndUpdateQueries,
} from "./cachePolicy";

type Row = { id: string; read: boolean };

function seed() {
  const client = new QueryClient();
  const clubA = notificationKeys.list("user-1", "club-a");
  const clubB = notificationKeys.list("user-1", "club-b");
  const otherUser = notificationKeys.list("user-2", "club-a");
  client.setQueryData<Row[]>(clubA, [{ id: "a", read: false }]);
  client.setQueryData<Row[]>(clubB, [{ id: "b", read: false }]);
  client.setQueryData<Row[]>(otherUser, [{ id: "other", read: false }]);
  return { client, clubA, clubB, otherUser };
}

describe("notification optimistic cache policy", () => {
  it("updates every club view for one user without touching another account", () => {
    const h = seed();
    const snapshots = snapshotAndUpdateQueries<Row[]>(
      h.client,
      [notificationKeys.lists[0], "user-1"],
      (rows) => rows?.map((row) => ({ ...row, read: true })) ?? [],
    );

    expect(h.client.getQueryData<Row[]>(h.clubA)?.[0].read).toBe(true);
    expect(h.client.getQueryData<Row[]>(h.clubB)?.[0].read).toBe(true);
    expect(h.client.getQueryData<Row[]>(h.otherUser)?.[0].read).toBe(false);
    expect(snapshots).toHaveLength(2);
  });

  it("restores every affected club view after a failed optimistic mark", () => {
    const h = seed();
    const snapshots = snapshotAndUpdateQueries<Row[]>(
      h.client,
      [notificationKeys.lists[0], "user-1"],
      (rows) => rows?.map((row) => ({ ...row, read: true })) ?? [],
    );

    restoreQuerySnapshots(h.client, snapshots);

    expect(h.client.getQueryData(h.clubA)).toEqual([{ id: "a", read: false }]);
    expect(h.client.getQueryData(h.clubB)).toEqual([{ id: "b", read: false }]);
    expect(h.client.getQueryData(h.otherUser)).toEqual([
      { id: "other", read: false },
    ]);
  });

  it("restores deleted rows in their original order after failure", () => {
    const h = seed();
    h.client.setQueryData<Row[]>(h.clubA, [
      { id: "first", read: false },
      { id: "delete-me", read: false },
      { id: "last", read: true },
    ]);
    const snapshots = snapshotAndUpdateQueries<Row[]>(
      h.client,
      [notificationKeys.lists[0], "user-1"],
      (rows) => rows?.filter((row) => row.id !== "delete-me") ?? [],
    );

    restoreQuerySnapshots(h.client, snapshots);

    expect(h.client.getQueryData(h.clubA)).toEqual([
      { id: "first", read: false },
      { id: "delete-me", read: false },
      { id: "last", read: true },
    ]);
  });

  it("restores cleared lists after failure and is a no-op for no cached matches", () => {
    const h = seed();
    const snapshots = snapshotAndUpdateQueries<Row[]>(
      h.client,
      [notificationKeys.lists[0], "user-1"],
      () => [],
    );
    restoreQuerySnapshots(h.client, snapshots);
    expect(h.client.getQueryData(h.clubA)).toEqual([{ id: "a", read: false }]);
    expect(h.client.getQueryData(h.clubB)).toEqual([{ id: "b", read: false }]);

    const absent = snapshotAndUpdateQueries<Row[]>(
      h.client,
      [notificationKeys.lists[0], "missing-user"],
      () => [],
    );
    expect(absent).toEqual([]);
    expect(() => restoreQuerySnapshots(h.client, absent)).not.toThrow();
  });

  it("cancels the exact user family before applying an optimistic update", async () => {
    const h = seed();
    const cancel = vi.spyOn(h.client, "cancelQueries");
    const snapshots = await beginNotificationListUpdate<Row[]>(
      h.client,
      "user-1",
      () => [],
    );

    expect(notificationListFamilyKey("user-1")).toEqual([
      "notifications",
      "user-1",
    ]);
    expect(notificationListFamilyKey()).toEqual(["notifications"]);
    expect(cancel).toHaveBeenCalledWith({
      queryKey: ["notifications", "user-1"],
    });
    expect(snapshots).toHaveLength(2);
    expect(h.client.getQueryData(h.otherUser)).toEqual([
      { id: "other", read: false },
    ]);
  });

  it("invalidates the same surfaces in the same order as the page and header", () => {
    const client = new QueryClient();
    const invalidate = vi
      .spyOn(client, "invalidateQueries")
      .mockResolvedValue(undefined);

    invalidateNotificationSurfaces(client);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      notificationKeys.recent,
      notificationKeys.lists,
      notificationKeys.globalUnread,
      notificationKeys.clubUnread,
    ]);

    invalidate.mockClear();
    invalidateNotificationSurfaces(client, { includeMessageUnread: true });
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      notificationKeys.recent,
      notificationKeys.lists,
      notificationKeys.globalUnread,
      notificationKeys.clubUnread,
      notificationKeys.clubMessageUnread,
      notificationKeys.messageUnread,
    ]);
  });
});
