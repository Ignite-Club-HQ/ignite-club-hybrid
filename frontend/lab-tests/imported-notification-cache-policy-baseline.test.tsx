import { QueryClient } from '@tanstack/react-query';
import { expect, test, vi } from 'vitest';
import { notificationCacheRoots, notificationKeys } from '../src/lab/notificationQueryKeys';
import {
  beginNotificationListUpdate,
  invalidateNotificationSurfaces,
  notificationListFamilyKey,
  restoreQuerySnapshots,
  snapshotAndUpdateQueries,
} from '../src/lab/notificationCachePolicy';

// This module is pure/provider-neutral: it only computes cache keys and
// performs React Query snapshot/update/restore/invalidate operations. It
// never talks to Supabase or ICP, so these tests exercise the contract
// directly rather than through backend routing.

type Row = { id: string; read: boolean };

function seed() {
  const client = new QueryClient();
  const clubA = notificationKeys.list('user-1', 'club-a');
  const clubB = notificationKeys.list('user-1', 'club-b');
  const otherUser = notificationKeys.list('user-2', 'club-a');
  client.setQueryData<Row[]>(clubA, [{ id: 'a', read: false }]);
  client.setQueryData<Row[]>(clubB, [{ id: 'b', read: false }]);
  client.setQueryData<Row[]>(otherUser, [{ id: 'other', read: false }]);
  return { client, clubA, clubB, otherUser };
}

test('normalizes missing and null club filters to one all-clubs identity', () => {
  expect(notificationKeys.list('user-1')).toEqual(['notifications', 'user-1', 'all']);
  expect(notificationKeys.list('user-1', null)).toEqual(notificationKeys.list('user-1', undefined));
  expect(notificationKeys.recentFor('user-1', null)).toEqual(['recent-notifications', 'user-1', null]);
});

test('preserves the existing disabled-query and header key shapes', () => {
  expect(notificationKeys.list(undefined, null)).toEqual(['notifications', undefined, 'all']);
  expect(notificationKeys.recentFor(undefined, null)).toEqual(['recent-notifications', undefined, null]);
  expect(notificationKeys.clubUnreadFor(undefined, null)).toEqual(['club-unread-count', undefined, null]);
  expect(notificationKeys.chatGroupUnreadFor(undefined)).toEqual(['chat-group-unread-cache', undefined]);
  expect(notificationKeys.chatGroupUnreadFor(null)).toEqual(['chat-group-unread-cache', null]);
});

test('gives different users and clubs different exact cache identities', () => {
  const keys = [
    notificationKeys.list('user-1', 'club-a'),
    notificationKeys.list('user-1', 'club-b'),
    notificationKeys.list('user-2', 'club-a'),
  ];

  expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(3);
  expect(notificationKeys.clubUnreadFor('user-1', 'club-a')).not.toEqual(
    notificationKeys.clubUnreadFor('user-1', 'club-b'),
  );
});

test('retains every legacy root used for intentional family invalidation', () => {
  expect(notificationCacheRoots).toEqual([
    ['notifications'],
    ['recent-notifications'],
    ['unread-count'],
    ['club-unread-count'],
    ['unread-message-counts'],
    ['club-messages-unread'],
    ['chat-group-unread-cache'],
  ]);
});

test('allows an exact club refresh without marking another club or user stale', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const clubA = notificationKeys.list('user-1', 'club-a');
  const clubB = notificationKeys.list('user-1', 'club-b');
  const otherUser = notificationKeys.list('user-2', 'club-a');

  client.setQueryData(clubA, ['a']);
  client.setQueryData(clubB, ['b']);
  client.setQueryData(otherUser, ['other']);
  await client.invalidateQueries({ queryKey: clubA, exact: true });

  expect(client.getQueryState(clubA)?.isInvalidated).toBe(true);
  expect(client.getQueryState(clubB)?.isInvalidated).toBe(false);
  expect(client.getQueryState(otherUser)?.isInvalidated).toBe(false);
});

test('allows deliberate user-family updates without touching another account', () => {
  const client = new QueryClient();
  const userOneA = notificationKeys.list('user-1', 'club-a');
  const userOneB = notificationKeys.list('user-1', 'club-b');
  const userTwo = notificationKeys.list('user-2', 'club-a');
  client.setQueryData(userOneA, ['a']);
  client.setQueryData(userOneB, ['b']);
  client.setQueryData(userTwo, ['other']);

  client.setQueriesData({ queryKey: [notificationKeys.lists[0], 'user-1'] }, () => ['cleared']);

  expect(client.getQueryData(userOneA)).toEqual(['cleared']);
  expect(client.getQueryData(userOneB)).toEqual(['cleared']);
  expect(client.getQueryData(userTwo)).toEqual(['other']);
});

test('updates every club view for one user without touching another account', () => {
  const h = seed();
  const snapshots = snapshotAndUpdateQueries<Row[]>(
    h.client,
    [notificationKeys.lists[0], 'user-1'],
    (rows) => rows?.map((row) => ({ ...row, read: true })) ?? [],
  );

  expect(h.client.getQueryData<Row[]>(h.clubA)?.[0].read).toBe(true);
  expect(h.client.getQueryData<Row[]>(h.clubB)?.[0].read).toBe(true);
  expect(h.client.getQueryData<Row[]>(h.otherUser)?.[0].read).toBe(false);
  expect(snapshots).toHaveLength(2);
});

test('restores every affected club view after a failed optimistic mark', () => {
  const h = seed();
  const snapshots = snapshotAndUpdateQueries<Row[]>(
    h.client,
    [notificationKeys.lists[0], 'user-1'],
    (rows) => rows?.map((row) => ({ ...row, read: true })) ?? [],
  );

  restoreQuerySnapshots(h.client, snapshots);

  expect(h.client.getQueryData(h.clubA)).toEqual([{ id: 'a', read: false }]);
  expect(h.client.getQueryData(h.clubB)).toEqual([{ id: 'b', read: false }]);
  expect(h.client.getQueryData(h.otherUser)).toEqual([{ id: 'other', read: false }]);
});

test('restores deleted rows in their original order after failure', () => {
  const h = seed();
  h.client.setQueryData<Row[]>(h.clubA, [
    { id: 'first', read: false },
    { id: 'delete-me', read: false },
    { id: 'last', read: true },
  ]);
  const snapshots = snapshotAndUpdateQueries<Row[]>(
    h.client,
    [notificationKeys.lists[0], 'user-1'],
    (rows) => rows?.filter((row) => row.id !== 'delete-me') ?? [],
  );

  restoreQuerySnapshots(h.client, snapshots);

  expect(h.client.getQueryData(h.clubA)).toEqual([
    { id: 'first', read: false },
    { id: 'delete-me', read: false },
    { id: 'last', read: true },
  ]);
});

test('restores cleared lists after failure and is a no-op for no cached matches', () => {
  const h = seed();
  const snapshots = snapshotAndUpdateQueries<Row[]>(h.client, [notificationKeys.lists[0], 'user-1'], () => []);
  restoreQuerySnapshots(h.client, snapshots);
  expect(h.client.getQueryData(h.clubA)).toEqual([{ id: 'a', read: false }]);
  expect(h.client.getQueryData(h.clubB)).toEqual([{ id: 'b', read: false }]);

  const absent = snapshotAndUpdateQueries<Row[]>(h.client, [notificationKeys.lists[0], 'missing-user'], () => []);
  expect(absent).toEqual([]);
  expect(() => restoreQuerySnapshots(h.client, absent)).not.toThrow();
});

test('cancels the exact user family before applying an optimistic update', async () => {
  const h = seed();
  const cancel = vi.spyOn(h.client, 'cancelQueries');
  const snapshots = await beginNotificationListUpdate<Row[]>(h.client, 'user-1', () => []);

  expect(notificationListFamilyKey('user-1')).toEqual(['notifications', 'user-1']);
  expect(notificationListFamilyKey()).toEqual(['notifications']);
  expect(cancel).toHaveBeenCalledWith({ queryKey: ['notifications', 'user-1'] });
  expect(snapshots).toHaveLength(2);
  expect(h.client.getQueryData(h.otherUser)).toEqual([{ id: 'other', read: false }]);
});

test('invalidates the same surfaces in the same order as the page and header', () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);

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
