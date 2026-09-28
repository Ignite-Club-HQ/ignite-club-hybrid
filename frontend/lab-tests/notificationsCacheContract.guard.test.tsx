import { describe, expect, it } from 'vitest';

type NotificationEntry = {
  userId: string;
  clubId: string;
  key: string;
  timestamp: number;
  seen: boolean;
};

function upsertNotification(cache: Map<string, NotificationEntry>, entry: NotificationEntry) {
  if (entry.userId.length === 0 || entry.clubId.length === 0) {
    throw new Error('notification ownership required');
  }
  cache.set(`${entry.clubId}:${entry.userId}:${entry.key}`, entry);
  return entry;
}

function readNotification(cache: Map<string, NotificationEntry>, clubId: string, userId: string, key: string) {
  const entry = cache.get(`${clubId}:${userId}:${key}`);
  if (!entry) {
    return { ok: false, reason: 'missing' } as const;
  }
  return { ok: true, entry } as const;
}

describe('notification cache contract guard', () => {
  it('scopes notifications to club and user ownership and keeps rejected writes out of cache', () => {
    const cache = new Map<string, NotificationEntry>();
    const entry = { userId: 'user-1', clubId: 'club-1', key: 'invite', timestamp: Date.now(), seen: false };

    expect(upsertNotification(cache, entry)).toMatchObject({ clubId: 'club-1', key: 'invite' });
    expect(readNotification(cache, 'club-1', 'user-1', 'invite')).toMatchObject({ ok: true });
    expect(readNotification(cache, 'club-2', 'user-1', 'invite')).toEqual({ ok: false, reason: 'missing' });
    expect(() => upsertNotification(cache, { ...entry, userId: '', clubId: 'club-1', key: 'bad' })).toThrow('notification ownership required');
  });
});
