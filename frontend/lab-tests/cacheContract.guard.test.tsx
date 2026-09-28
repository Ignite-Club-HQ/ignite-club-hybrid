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

describe('cache contract guard', () => {
  it('keeps notification cache entries club- and user-owned and rejects invalid writes', () => {
    const cache = new Map<string, NotificationEntry>();
    const entry = { userId: 'user-1', clubId: 'club-1', key: 'invite', timestamp: Date.now(), seen: false };

    expect(upsertNotification(cache, entry)).toMatchObject({ clubId: 'club-1', userId: 'user-1' });
    expect(cache.has('club-1:user-1:invite')).toBe(true);
    expect(() => upsertNotification(cache, { ...entry, userId: '' })).toThrow('notification ownership required');
  });
});
