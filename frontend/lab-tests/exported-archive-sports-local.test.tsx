import { describe, expect, test } from 'vitest';
import {
  applyLocalLineup,
  createSpectatorSessionLock,
  findDueSubstitution,
  pickFairBenchPlayer,
} from '../src/lab/archivedSportsLocalDoubles';

describe('archived sports behavioral equivalents', () => {
  test('keeps due substitutions period-scoped and ignores completed work', () => {
    const substitutions = [
      { period: 1, time: 30, playerOutId: 'a', playerInId: 'b' },
      { period: 2, time: 20, playerOutId: 'c', playerInId: 'd', skipped: true },
      { period: 2, time: 40, playerOutId: 'e', playerInId: 'f' },
    ];

    expect(findDueSubstitution(substitutions, 2, 35)).toBeUndefined();
    expect(findDueSubstitution(substitutions, 2, 45)?.playerOutId).toBe('e');
  });

  test('selects the lowest-minute exact or zone-compatible eligible player', () => {
    const players = [
      { id: 'exact-high', minutesPlayed: 20, position: null, preferredPositions: ['GA'] },
      { id: 'exact-low', minutesPlayed: 5, position: null, preferredPositions: ['GA'] },
      { id: 'zone-low', minutesPlayed: 1, position: null, preferredPositions: ['GS'] },
      { id: 'injured', minutesPlayed: 0, position: null, preferredPositions: ['GA'], unavailable: true },
    ];
    const sameNetballZone = (preferred: string, target: string) =>
      new Set([preferred, target]).size <= 2 && ['GS', 'GA'].includes(preferred) && ['GS', 'GA'].includes(target);

    expect(pickFairBenchPlayer('GA', players, sameNetballZone)?.id).toBe('exact-low');
    expect(pickFairBenchPlayer('GS', players, sameNetballZone)?.id).toBe('zone-low');
  });

  test('applies a lineup atomically and records bench transitions', () => {
    const next = applyLocalLineup([
      { id: 'a', minutesPlayed: 10, position: 'PG' },
      { id: 'b', minutesPlayed: 5, position: null, lastBenchedAt: 4 },
    ], { PG: 'b' }, 100);

    expect(next).toEqual([
      { id: 'a', minutesPlayed: 10, position: null, lastBenchedAt: 100 },
      { id: 'b', minutesPlayed: 5, position: 'PG', lastBenchedAt: null },
    ]);
  });

  test('locks to one spectator session, follows row rotation, and releases on deactivation', () => {
    const lock = createSpectatorSessionLock();

    expect(lock.observe({ sessionId: 'session-a', rowId: 'row-1', active: true }))
      .toEqual({ sessionId: 'session-a', rowId: 'row-1' });
    expect(lock.observe({ sessionId: 'session-b', rowId: 'row-2', active: true })).toBeNull();
    expect(lock.current()).toEqual({ sessionId: 'session-a', rowId: 'row-1' });
    expect(lock.observe({ sessionId: 'session-a', rowId: 'row-3', active: true }))
      .toEqual({ sessionId: 'session-a', rowId: 'row-3' });
    expect(lock.observe({ sessionId: 'session-b', rowId: 'row-2', active: false })).toBeNull();
    expect(lock.current()).toEqual({ sessionId: 'session-a', rowId: 'row-3' });
    expect(lock.observe({ sessionId: 'session-a', rowId: 'row-3', active: false })).toBeNull();
    expect(lock.observe({ sessionId: 'session-b', rowId: 'row-4', active: true }))
      .toEqual({ sessionId: 'session-b', rowId: 'row-4' });
  });
});
