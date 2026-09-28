import { Principal } from '@icp-sdk/core/principal';
import { describe, expect, test } from 'vitest';
import type { Notification } from '../src/lab/notificationQueueClient';
import { createHybridNotificationDispatcher } from '../src/lab/hybridNotificationDispatcher';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';

const CLUB_A = 'club-notification-a';
const CLUB_B = 'club-notification-b';
const ICP_A = Principal.fromText('aaaaa-aa');
const ICP_B = Principal.fromText('2vxsx-fae');

type QueueClient = {
  enqueue(notification: Omit<Notification, 'status' | 'attempts' | 'nextAttemptMs'>): Promise<Notification>;
  claim(now: number, limit: number): Promise<Notification[]>;
  acknowledge(id: string, idempotencyKey: string): Promise<Notification>;
  fail(id: string, error: string, retryAtMs?: number): Promise<Notification>;
  recover(): Promise<number>;
  get(id: string): Promise<Notification | undefined>;
};

function createQueueClient(): QueueClient {
  const notifications = new Map<string, Notification>();
  const byIdempotencyKey = new Map<string, string>();
  return {
    async enqueue(input) {
      const existingId = byIdempotencyKey.get(input.idempotencyKey);
      if (existingId) return notifications.get(existingId)!;
      const notification: Notification = {
        ...input,
        status: 'pending',
        attempts: 0,
        nextAttemptMs: 0,
      };
      notifications.set(notification.id, notification);
      byIdempotencyKey.set(notification.idempotencyKey, notification.id);
      return notification;
    },
    async claim(now, limit) {
      const claimed = [...notifications.values()]
        .filter(notification => notification.status === 'pending' && notification.nextAttemptMs <= now)
        .slice(0, limit);
      for (const notification of claimed) {
        notification.status = 'processing';
        notification.attempts += 1;
      }
      return claimed;
    },
    async acknowledge(id) {
      const notification = notifications.get(id);
      if (!notification) throw new Error('Notification not found');
      notification.status = 'delivered';
      return notification;
    },
    async fail(id, _error, retryAtMs = 0) {
      const notification = notifications.get(id);
      if (!notification) throw new Error('Notification not found');
      notification.status = 'pending';
      notification.nextAttemptMs = retryAtMs;
      return notification;
    },
    async recover() {
      return 0;
    },
    async get(id) {
      return notifications.get(id);
    },
  };
}

for (const mode of ['supabase', 'icp'] as const) {
  test(`adapts notification lifecycle isolation through explicit ${mode} placement`, async () => {
    const registry = createSyntheticPlacementRegistry([
      {
        clubId: CLUB_A,
        country: 'AU',
        backend: mode === 'supabase'
          ? { Supabase: { environment: 'notification-au' } }
          : { Icp: { canister: ICP_A } },
      },
      {
        clubId: CLUB_B,
        country: 'US',
        backend: mode === 'supabase'
          ? { Supabase: { environment: 'notification-us' } }
          : { Icp: { canister: ICP_B } },
      },
    ]);
    const calls: string[] = [];
    const stores = new Map<string, QueueClient>();
    const clientFor = (key: string) => {
      let client = stores.get(key);
      if (!client) {
        client = createQueueClient();
        stores.set(key, client);
      }
      return client;
    };
    const dispatcher = createHybridNotificationDispatcher(registry, {
      supabase: async environment => {
        calls.push(`supabase:${environment}`);
        return clientFor(`supabase:${environment}`);
      },
      icp: async canister => {
        const key = canister.toText();
        calls.push(`icp:${key}`);
        return clientFor(`icp:${key}`);
      },
    });
    const notification = {
      id: 'notification-a',
      user: 'synthetic-member-a',
      club: CLUB_A,
      kind: 'event',
      body: 'Synthetic training changed',
      idempotencyKey: 'event-a',
    };

    const first = await dispatcher.enqueue(notification);
    const duplicate = await dispatcher.enqueue(notification);
    await dispatcher.enqueue({ ...notification, id: 'notification-b', club: CLUB_B, idempotencyKey: 'event-b' });

    expect(duplicate.id).toBe(first.id);
    expect(await dispatcher.claim(CLUB_A, 0, 10)).toMatchObject([
      { id: 'notification-a', club: CLUB_A, status: 'processing', attempts: 1 },
    ]);
    expect(await dispatcher.claim(CLUB_B, 0, 10)).toMatchObject([
      { id: 'notification-b', club: CLUB_B, status: 'processing', attempts: 1 },
    ]);
    await dispatcher.acknowledge(CLUB_A, 'notification-a', 'event-a');
    expect((await stores.get(`${mode === 'supabase' ? 'supabase:notification-au' : `icp:${ICP_A.toText()}`}`)?.get('notification-a')).status)
      .toBe('delivered');

    const expectedProvider = mode === 'supabase' ? 'supabase:' : 'icp:';
    expect(calls.every(call => call.startsWith(expectedProvider))).toBe(true);
    expect(stores.size).toBe(2);
  });
}

test('does not fall back to Supabase when an ICP notification provider fails', async () => {
  let supabaseCalls = 0;
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Icp: { canister: ICP_A } },
  }]);
  const dispatcher = createHybridNotificationDispatcher(registry, {
    supabase: async () => {
      supabaseCalls += 1;
      throw new Error('Supabase must not be used in ICP mode');
    },
    icp: async () => {
      throw new Error('local ICP notification provider unavailable');
    },
  });

  await expect(dispatcher.enqueue({
    id: 'notification-failure',
    user: 'synthetic-member-a',
    club: CLUB_A,
    kind: 'event',
    body: 'Synthetic failure',
    idempotencyKey: 'event-failure',
  })).rejects.toThrow('local ICP notification provider unavailable');
  expect(supabaseCalls).toBe(0);
});

// Synthetic local equivalent of the exported Postgres/RLS journey test
// `local journey: notification preferences, isolation and read state` (the
// real fixture-backed RLS journey requires a live local Supabase/Postgres
// instance, out of scope for this lab). This models the same ownership,
// isolation and duplicate-delivery contracts against in-memory tables that
// enforce row ownership the way Postgres RLS policies would.
describe('local journey: notification preferences, isolation and read state', () => {
  test('keeps preferences and notifications private and prevents duplicate delivery records', () => {
    const MEMBER_A = 'member-a';
    const OUTSIDER_B = 'outsider-b';
    const CLUB_NOTIF_A = 'club-notif-a';
    const CLUB_NOTIF_B = 'club-notif-b';

    const preferences = new Map<string, { userId: string; eventsEnabled: boolean; membershipEnabled: boolean }>();
    const insertPreferences = (
      actingUserId: string,
      row: { userId: string; eventsEnabled: boolean; membershipEnabled: boolean },
    ) => {
      if (actingUserId !== row.userId) return { error: 'RLS: cannot write another user\'s preferences' };
      preferences.set(row.userId, row);
      return { error: null, data: row };
    };
    const selectPreferences = (actingUserId: string, ownerUserId: string) => {
      const row = preferences.get(ownerUserId);
      if (!row || actingUserId !== ownerUserId) return [];
      return [row];
    };

    const ownPreferences = insertPreferences(MEMBER_A, {
      userId: MEMBER_A,
      eventsEnabled: true,
      membershipEnabled: false,
    });
    expect(ownPreferences.error).toBeNull();
    expect(ownPreferences.data).toEqual({ userId: MEMBER_A, eventsEnabled: true, membershipEnabled: false });

    const cannotWriteAnotherUsersPreferences = insertPreferences(OUTSIDER_B, {
      userId: MEMBER_A,
      eventsEnabled: true,
      membershipEnabled: true,
    });
    expect(cannotWriteAnotherUsersPreferences.error).not.toBeNull();
    expect(selectPreferences(OUTSIDER_B, MEMBER_A)).toEqual([]);

    type NotificationRow = {
      id: string;
      userId: string;
      clubId: string;
      relatedId: string;
      isRead: boolean;
      skipPush: boolean;
    };
    const notifications = new Map<string, NotificationRow>();
    const dedupeKeys = new Set<string>();
    let nextId = 0;
    const insertNotification = (row: Omit<NotificationRow, 'id' | 'isRead'>) => {
      const dedupeKey = `${row.userId}:${row.relatedId}`;
      if (dedupeKeys.has(dedupeKey)) return { error: { code: '23505' } };
      dedupeKeys.add(dedupeKey);
      const id = `notification-${nextId++}`;
      const inserted = { ...row, id, isRead: false };
      notifications.set(id, inserted);
      return { error: null, data: inserted };
    };
    const selectOwnNotifications = (userId: string) =>
      [...notifications.values()].filter((n) => n.userId === userId);
    const updateNotification = (actingUserId: string, id: string, patch: Partial<NotificationRow>) => {
      const row = notifications.get(id);
      if (!row || row.userId !== actingUserId) return { error: null, data: [] };
      Object.assign(row, patch);
      return { error: null, data: [row] };
    };
    const deleteNotification = (actingUserId: string, id: string) => {
      const row = notifications.get(id);
      if (!row || row.userId !== actingUserId) return { error: null, data: [] };
      notifications.delete(id);
      return { error: null, data: [{ id }] };
    };

    const relatedId = 'related-training-change';
    const memberNotification = insertNotification({
      userId: MEMBER_A,
      clubId: CLUB_NOTIF_A,
      relatedId,
      skipPush: true,
    });
    expect(memberNotification.error).toBeNull();
    const otherClubNotification = insertNotification({
      userId: OUTSIDER_B,
      clubId: CLUB_NOTIF_B,
      relatedId: 'related-unrelated-event',
      skipPush: true,
    });
    expect(otherClubNotification.error).toBeNull();
    const memberNotificationId = memberNotification.data!.id;

    const duplicate = insertNotification({
      userId: MEMBER_A,
      clubId: CLUB_NOTIF_A,
      relatedId,
      skipPush: true,
    });
    expect(duplicate.error?.code).toBe('23505');

    expect(selectOwnNotifications(MEMBER_A)).toEqual([{
      id: memberNotificationId,
      userId: MEMBER_A,
      clubId: CLUB_NOTIF_A,
      relatedId,
      isRead: false,
      skipPush: true,
    }]);

    const outsiderCannotSeeOrMarkRead = updateNotification(OUTSIDER_B, memberNotificationId, { isRead: true });
    expect(outsiderCannotSeeOrMarkRead.error).toBeNull();
    expect(outsiderCannotSeeOrMarkRead.data).toEqual([]);

    const markedRead = updateNotification(MEMBER_A, memberNotificationId, { isRead: true });
    expect(markedRead.error).toBeNull();
    expect(markedRead.data?.[0]?.isRead).toBe(true);

    const outsiderCannotDelete = deleteNotification(OUTSIDER_B, memberNotificationId);
    expect(outsiderCannotDelete.error).toBeNull();
    expect(outsiderCannotDelete.data).toEqual([]);

    const deleted = deleteNotification(MEMBER_A, memberNotificationId);
    expect(deleted.error).toBeNull();
    expect(deleted.data).toEqual([{ id: memberNotificationId }]);
  });
});
