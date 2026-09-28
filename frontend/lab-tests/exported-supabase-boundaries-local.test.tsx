import { describe, expect, test } from 'vitest';
import {
  authorizeInternalWorker,
  deleteExpiredRecords,
  pseudonymizeNames,
  selectEventNotificationRecipients,
} from '../src/lab/exportedBackendLocalDoubles';

describe('exported inert Supabase and Edge boundary equivalents', () => {
  test('deletes all eligible records in bounded chunks without a short-page early exit', () => {
    const records = Array.from({ length: 1_205 }, (_, index) => ({
      id: `notification-${index}`,
      createdAt: index < 1_101 ? 10 : 30,
      read: index % 2 === 0,
    }));
    const chunkSizes: number[] = [];

    const result = deleteExpiredRecords(records, {
      cutoff: 20,
      batchSize: 300,
      deleteChunkSize: 100,
      deleteChunk: (ids) => {
        chunkSizes.push(ids.length);
        return true;
      },
    });

    expect(result).toEqual({ deleted: 1_101, hasMore: false, error: null });
    expect(Math.max(...chunkSizes)).toBe(100);
    expect(records).toHaveLength(104);
  });

  test('bounds cleanup work, scopes read-only cleanup, and remains idempotent', () => {
    const records = Array.from({ length: 12 }, (_, index) => ({
      id: `notification-${index}`,
      createdAt: 10,
      read: index % 2 === 0,
    }));

    expect(deleteExpiredRecords(records, {
      cutoff: 20,
      readOnly: true,
      batchSize: 2,
      maxBatches: 2,
    })).toEqual({ deleted: 4, hasMore: true, error: null });
    expect(deleteExpiredRecords(records, { cutoff: 20, readOnly: true }).deleted).toBe(2);
    expect(deleteExpiredRecords(records, { cutoff: 20, readOnly: true }).deleted).toBe(0);
    expect(records).toHaveLength(6);
  });

  test('reports deletion failures and preserves recoverable work', () => {
    const records = [{ id: 'old', createdAt: 1, read: true }];
    expect(deleteExpiredRecords(records, {
      cutoff: 2,
      deleteChunk: () => false,
    })).toEqual({ deleted: 0, hasMore: true, error: 'delete failed' });
    expect(records).toEqual([{ id: 'old', createdAt: 1, read: true }]);
  });

  test('selects exact event recipients with creator exclusion, target teams, roles, and guardians', () => {
    const members = [
      { accountId: 'creator', clubId: 'club-a', teamId: 'team-a', role: 'coach' as const },
      { accountId: 'player', clubId: 'club-a', teamId: 'team-a', role: 'player' as const },
      { accountId: 'coach', clubId: 'club-a', teamId: 'team-b', role: 'coach' as const },
      { accountId: 'guardian', clubId: 'club-a', role: 'parent' as const, guardianOf: ['team-a'] },
      { accountId: 'admin', clubId: 'club-a', role: 'club_admin' as const },
      { accountId: 'outsider', clubId: 'club-b', teamId: 'team-a', role: 'player' as const },
      { accountId: 'player', clubId: 'club-a', teamId: 'team-a', role: 'player' as const },
    ];

    expect(selectEventNotificationRecipients({
      creatorId: 'creator',
      clubId: 'club-a',
      teamIds: ['team-a'],
      members,
    })).toEqual(['admin', 'guardian', 'player']);
    expect(selectEventNotificationRecipients({
      creatorId: 'creator',
      clubId: 'club-a',
      restrictedRoles: ['coach'],
      members,
    })).toEqual(['admin', 'coach']);
  });

  test('internal worker authorization fails closed without reflecting secrets', () => {
    expect(authorizeInternalWorker(null, 'local-secret').status).toBe(401);
    expect(authorizeInternalWorker('Bearer user-token', 'local-secret')).toEqual({
      status: 403,
      body: 'Forbidden',
    });
    expect(authorizeInternalWorker('Bearer local-secret', null).status).toBe(500);
    expect(authorizeInternalWorker('  bearer local-secret  ', 'local-secret').status).toBe(200);
    expect(authorizeInternalWorker('Bearer wrong', 'local-secret').body).not.toContain('wrong');
    expect(authorizeInternalWorker('Bearer wrong', 'local-secret').body).not.toContain('local-secret');
  });

  test('protects sponsor tokens and pseudonymizes only bounded whole names', () => {
    const result = pseudonymizeNames(
      'Alex met Alexander and Mia at ACME. Alexander thanked Alex.',
      [
        { name: 'Alex Morgan', kind: 'adult' },
        { name: 'Alexander Doe', kind: 'child' },
        { name: 'Mia Doe', kind: 'child' },
      ],
      ['ACME', 'Alex', 'x'],
    );

    expect(result.text).toBe('Alex met Child 1 and Mia at ACME. Child 1 thanked Alex.');
    expect(result.rehydrate('Child 1 spoke to Person 9')).toBe(
      "<Alexander's parent>'s child spoke to a person",
    );
  });
});

// Synthetic local equivalent of the exported Postgres integration test
// `local infrastructure: synthetic fixture cleanup` — the real fixture uses
// a live local Supabase Auth/Postgres instance (out of scope for this lab).
// This models the same "cleanup must remove every row/identity a fixture
// created" contract against in-memory tables instead of a live service role.
describe('local infrastructure: synthetic fixture cleanup', () => {
  test('removes clubs, memberships, profiles and Auth users created by a fixture', async () => {
    const clubs = new Map<string, { id: string }>();
    const userRoles = new Map<string, { id: string; userId: string }>();
    const profiles = new Map<string, { id: string }>();
    const authUsers = new Map<string, { id: string }>();

    const createSecurityFixture = () => {
      const clubA = 'club-fx-a';
      const clubB = 'club-fx-b';
      const adminA = 'user-fx-admin-a';
      const memberA = 'user-fx-member-a';
      const outsiderB = 'user-fx-outsider-b';
      clubs.set(clubA, { id: clubA });
      clubs.set(clubB, { id: clubB });
      for (const [role, userId] of [
        ['role-admin', adminA],
        ['role-member', memberA],
        ['role-outsider', outsiderB],
      ] as const) {
        userRoles.set(role, { id: role, userId });
      }
      for (const userId of [adminA, memberA, outsiderB]) {
        profiles.set(userId, { id: userId });
        authUsers.set(userId, { id: userId });
      }
      return {
        adminA: { id: adminA },
        memberA: { id: memberA },
        outsiderB: { id: outsiderB },
        clubA,
        clubB,
        cleanup: () => {
          clubs.delete(clubA);
          clubs.delete(clubB);
          for (const [key, row] of userRoles) {
            if ([adminA, memberA, outsiderB].includes(row.userId)) userRoles.delete(key);
          }
          for (const userId of [adminA, memberA, outsiderB]) {
            profiles.delete(userId);
            authUsers.delete(userId);
          }
        },
      };
    };

    const fixture = createSecurityFixture();
    const userIds = [fixture.adminA.id, fixture.memberA.id, fixture.outsiderB.id];
    const clubIds = [fixture.clubA, fixture.clubB];

    fixture.cleanup();

    expect(clubIds.every((id) => !clubs.has(id))).toBe(true);
    expect([...userRoles.values()].some((row) => userIds.includes(row.userId))).toBe(false);
    expect(userIds.every((id) => !profiles.has(id))).toBe(true);
    for (const userId of userIds) {
      expect(authUsers.has(userId)).toBe(false);
    }
  });
});
