/**
 * Local equivalent of the exported
 * `processEventNotifications.characterization.test.ts` suite.
 *
 * Characterization / regression tests for the event-notification audience
 * resolution fail-closed contract.
 *
 * Defect: when the authoritative `events` lookup (restricted_to_roles /
 * target_team_ids) errored, the code logged and continued with an empty
 * event row, so a targeted or role-restricted event degraded into an
 * unrestricted club-wide fan-out. A transient read failure could therefore
 * notify unrelated club members.
 *
 * Required behaviour: fail closed — throw AudienceResolutionError, create no
 * notification rows and no push-delivery jobs, and return a sanitised,
 * retriable non-2xx response.
 *
 * Exercises a faithful local port of the pure, dependency-free
 * `process-event-notifications/{recipients,fanout,dedupe,testFakeSupabase}.ts`
 * modules — no Deno runtime or hosted Supabase involved.
 */
import { describe, it, expect } from 'vitest';
import {
  AudienceResolutionError,
  resolveRecipients,
} from '../src/lab/eventNotifications/recipients';
import {
  batchInsertNotifications,
  buildNotificationRows,
  buildPushPayload,
} from '../src/lab/eventNotifications/fanout';
import { buildDedupeKey, changeVersion } from '../src/lab/eventNotifications/dedupe';
import { FakeSupabase } from '../src/lab/eventNotifications/testFakeSupabase';

const CLUB = 'club-1';
const TEAM = 'team-a';
const OTHER_TEAM = 'team-b';
const CREATOR = 'user-creator';
const EVENT = 'event-1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

function roles(rows: Array<[string, string, string | null]>) {
  return rows.map(([user_id, role, team_id]) => ({
    user_id,
    role,
    team_id,
    club_id: CLUB,
  }));
}

/**
 * Mirrors the fan-out control flow of
 * `supabase/functions/process-event-notifications/index.ts` for the
 * `event_created` action: resolve audience → enqueue. The real handler can't
 * be imported under Vitest (it calls `Deno.serve` and imports from esm.sh),
 * so this harness reproduces the exact guard being tested.
 */
async function runCreateFanout(db: any) {
  const rpcCalls: Array<{ fn: string; rows: any[] }> = [];
  const supabase = {
    ...db,
    from: db.from.bind(db),
    rpc: (fn: string, args: any) => {
      rpcCalls.push({ fn, rows: args?.p_rows ?? [] });
      return Promise.resolve({
        data: (args?.p_rows ?? []).map(() => ({ created: true, queued: true })),
        error: null,
      });
    },
  };

  let recipients: string[] = [];
  try {
    recipients = await resolveRecipients(supabase, EVENT, CLUB, null, null, CREATOR);
  } catch (e) {
    if (e instanceof AudienceResolutionError) {
      return {
        rpcCalls,
        response: new Response(
          JSON.stringify({ error: 'event_audience_lookup_failed' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        ),
      };
    }
    throw e;
  }

  if (recipients.length > 0) {
    await supabase.rpc('enqueue_event_push_v2', {
      p_url: `/events/${EVENT}`,
      p_rows: recipients.map((user_id) => ({ user_id })),
    });
  }
  return {
    rpcCalls,
    recipients,
    response: new Response(JSON.stringify({ expected: recipients.length }), { status: 200 }),
  };
}

describe('event audience resolution — fail closed', () => {
  it('fails closed instead of notifying the whole club when event audience lookup fails', async () => {
    const db = new FakeSupabase({
      user_roles: roles([
        ['u1', 'player', TEAM],
        ['u2', 'coach', OTHER_TEAM],
        ['admin1', 'club_admin', null],
      ]),
      events: [{ id: EVENT, restricted_to_roles: ['coach'], target_team_ids: [TEAM] }],
    });
    db.errors.events = { code: '57014', message: 'canceling statement due to statement timeout' };

    await expect(
      resolveRecipients(db, EVENT, CLUB, null, null, CREATOR),
    ).rejects.toBeInstanceOf(AudienceResolutionError);
  });

  it('produces zero recipients, no notification insert and no enqueue RPC', async () => {
    const db = new FakeSupabase({
      user_roles: roles([['u1', 'player', TEAM], ['admin1', 'club_admin', null]]),
      events: [{ id: EVENT, restricted_to_roles: null, target_team_ids: [TEAM] }],
    });
    db.errors.events = { code: 'PGRST301', message: 'JWT expired' };

    const { rpcCalls, response } = await runCreateFanout(db);
    expect(rpcCalls).toHaveLength(0);
    expect(db.inserts).toHaveLength(0);
    expect(response.status).toBe(500);
  });

  it('returns a sanitised retriable error that does not reveal the database failure', async () => {
    const db = new FakeSupabase({
      user_roles: roles([['u1', 'player', TEAM]]),
      events: [{ id: EVENT, restricted_to_roles: ['coach'], target_team_ids: null }],
    });
    db.errors.events = {
      code: '42501',
      message: 'permission denied for table events at https://db.internal/postgres',
    };

    const { response } = await runCreateFanout(db);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: 'event_audience_lookup_failed' });
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/permission denied/i);
    expect(raw).not.toMatch(/https?:\/\//);
    expect(raw).not.toMatch(/42501/);
    expect(raw).not.toMatch(/select|table/i);
  });
});

describe('event audience resolution — unchanged behaviour', () => {
  it.each([19, 20, 21, 30, 31, 200, 201, 501])(
    'does not truncate a %i-member team audience',
    async (count) => {
      const db = new FakeSupabase({
        user_roles: roles(Array.from({ length: count }, (_, i) => [
          `user-${String(i).padStart(4, '0')}`,
          'player',
          TEAM,
        ])),
      });
      const ids = await resolveRecipients(db, EVENT, CLUB, TEAM, null, CREATOR);
      expect(ids).toHaveLength(count);
      expect(new Set(ids)).toHaveLength(count);
    },
  );

  it('a genuinely unrestricted club-wide event still reaches all eligible club members', async () => {
    const db = new FakeSupabase({
      user_roles: roles([
        ['u1', 'player', TEAM],
        ['u2', 'club_admin', null],
        [CREATOR, 'club_admin', null],
      ]),
      events: [{ id: EVENT, restricted_to_roles: null, target_team_ids: null }],
    });
    const { recipients, rpcCalls } = await runCreateFanout(db);
    expect([...(recipients ?? [])].sort()).toEqual(['u1', 'u2']);
    expect(rpcCalls).toHaveLength(1);
  });

  it('role-restricted club-wide events still reach only their roles plus club admins', async () => {
    const db = new FakeSupabase({
      user_roles: roles([
        ['coach1', 'coach', TEAM],
        ['player1', 'player', TEAM],
        ['admin1', 'club_admin', null],
      ]),
      events: [{ id: EVENT, restricted_to_roles: ['coach'], target_team_ids: null }],
    });
    const ids = await resolveRecipients(db, EVENT, CLUB, null, null, CREATOR);
    expect([...ids].sort()).toEqual(['admin1', 'coach1']);
  });

  it('targeted club-wide events still reach only targeted teams, admins and guardians', async () => {
    const db = new FakeSupabase({
      user_roles: roles([
        ['t1u1', 'player', TEAM],
        ['untargeted', 'player', 'team-c'],
        ['admin1', 'club_admin', null],
      ]),
      child_team_assignments: [{ team_id: TEAM, child_id: 'child-1' }],
      child_guardians: [{ child_id: 'child-1', guardian_id: 'guardian-1' }],
      events: [{ id: EVENT, restricted_to_roles: null, target_team_ids: [TEAM] }],
    });
    const ids = await resolveRecipients(db, EVENT, CLUB, null, null, CREATOR);
    expect([...ids].sort()).toEqual(['admin1', 'guardian-1', 't1u1']);
  });

  it('deduplicates a targeted recipient found as member, admin, and guardian', async () => {
    const db = new FakeSupabase({
      user_roles: roles([
        ['multi-role', 'player', TEAM],
        ['multi-role', 'club_admin', null],
        ['other', 'coach', OTHER_TEAM],
        ['outside', 'player', 'team-c'],
      ]),
      child_team_assignments: [{ team_id: TEAM, child_id: 'child-1' }],
      child_guardians: [{ child_id: 'child-1', guardian_id: 'multi-role' }],
      events: [{ id: EVENT, restricted_to_roles: null, target_team_ids: [TEAM, OTHER_TEAM] }],
    });
    const ids = await resolveRecipients(db, EVENT, CLUB, null, null, CREATOR);
    expect([...ids].sort()).toEqual(['multi-role', 'other']);
  });

  it('excludes the creator through targeted membership, admin, and guardian paths', async () => {
    const db = new FakeSupabase({
      user_roles: roles([
        [CREATOR, 'player', TEAM],
        [CREATOR, 'club_admin', null],
        ['member', 'player', TEAM],
      ]),
      child_team_assignments: [{ team_id: TEAM, child_id: 'child-1' }],
      child_guardians: [{ child_id: 'child-1', guardian_id: CREATOR }],
      events: [{ id: EVENT, restricted_to_roles: null, target_team_ids: [TEAM] }],
    });
    await expect(resolveRecipients(db, EVENT, CLUB, null, null, CREATOR)).resolves.toEqual(['member']);
  });

  it('paginates a targeted multi-team audience deterministically', async () => {
    const db = new FakeSupabase({
      user_roles: roles(Array.from({ length: 451 }, (_, i) => [
        `user-${String(i).padStart(4, '0')}`,
        'player',
        i % 2 ? TEAM : OTHER_TEAM,
      ])),
      child_team_assignments: [],
      events: [{ id: EVENT, restricted_to_roles: null, target_team_ids: [TEAM, OTHER_TEAM] }],
    });
    const ids = await resolveRecipients(db, EVENT, CLUB, null, null, CREATOR);
    expect(ids).toHaveLength(451);
    expect(db.queries
      .filter((q) => q.table === 'user_roles' && q.filters.some((f) => f[0] === 'in' && f[1] === 'team_id'))
      .map((q) => q.range)).toEqual([[0, 199], [200, 399], [400, 599]]);
  });

  it('chunks guardian resolution above 200 children without duplicate delivery', async () => {
    const assignments = Array.from({ length: 205 }, (_, i) => ({ team_id: TEAM, child_id: `child-${i}` }));
    const db = new FakeSupabase({
      user_roles: [],
      child_team_assignments: assignments,
      child_guardians: assignments.flatMap((row, i) => [
        { child_id: row.child_id, guardian_id: `guardian-${i}` },
        ...([0, 204].includes(i) ? [{ child_id: row.child_id, guardian_id: 'shared' }] : []),
      ]),
      events: [{ id: EVENT, restricted_to_roles: null, target_team_ids: [TEAM] }],
    });
    const ids = await resolveRecipients(db, EVENT, CLUB, null, null, CREATOR);
    expect(ids).toHaveLength(206);
    expect(ids.filter((id) => id === 'shared')).toHaveLength(1);
    // The first 200-child chunk yields 201 guardian rows (including the
    // shared guardian), so it correctly needs a second result page. The
    // remaining five children are queried as a separate child-id chunk.
    const guardianRanges = db.queries
      .filter((q) => q.table === 'child_guardians')
      .map((q) => q.range);
    expect(guardianRanges).toHaveLength(3);
    expect(guardianRanges.filter((range) => range?.[0] === 0 && range?.[1] === 199)).toHaveLength(2);
    expect(guardianRanges.filter((range) => range?.[0] === 200 && range?.[1] === 399)).toHaveLength(1);
  });

  it('ordinary team events never touch the events table and are unaffected', async () => {
    const db = new FakeSupabase({
      user_roles: roles([
        ['u1', 'player', TEAM],
        ['u2', 'parent', TEAM],
        ['u9', 'player', OTHER_TEAM],
      ]),
    });
    db.errors.events = { code: '57014', message: 'timeout' };
    const ids = await resolveRecipients(db, EVENT, CLUB, TEAM, null, CREATOR);
    expect([...ids].sort()).toEqual(['u1', 'u2']);
    expect(db.queries.some((q: any) => q.table === 'events')).toBe(false);
  });

  it('mini-league events are unaffected by events-table failures', async () => {
    const db = new FakeSupabase({
      mini_league_players: [{ mini_league_id: 'ml-1', parent_user_id: 'p1' }],
      mini_league_admins: [{ mini_league_id: 'ml-1', user_id: 'a1' }],
      user_roles: [{ user_id: 'la1', role: 'league_admin', club_id: CLUB, team_id: null }],
    });
    db.errors.events = { code: '57014', message: 'timeout' };
    const ids = await resolveRecipients(db, EVENT, CLUB, null, 'ml-1', CREATOR);
    expect([...ids].sort()).toEqual(['a1', 'la1', 'p1']);
  });
});

describe('event audience resolution — high-scale and read-failure safety', () => {
  it('does not silently truncate a mini-league audience above the PostgREST row cap', async () => {
    const parentCount = 1_205;
    const db = new FakeSupabase({
      mini_league_players: Array.from({ length: parentCount }, (_, i) => ({
        mini_league_id: 'ml-large',
        parent_user_id: `parent-${String(i).padStart(4, '0')}`,
      })),
      mini_league_admins: [{ mini_league_id: 'ml-large', user_id: 'league-admin' }],
      user_roles: [],
    });

    const ids = await resolveRecipients(db, EVENT, CLUB, null, 'ml-large', CREATOR);
    expect(ids).toHaveLength(parentCount + 1);
    expect(new Set(ids)).toHaveLength(parentCount + 1);
    expect(ids).toContain('parent-1204');
    expect(ids).toContain('league-admin');
  });

  it('does not silently truncate guardian discovery above the PostgREST row cap', async () => {
    const childCount = 1_205;
    const assignments = Array.from({ length: childCount }, (_, i) => ({
      team_id: TEAM,
      child_id: `child-${String(i).padStart(4, '0')}`,
    }));
    const db = new FakeSupabase({
      user_roles: [],
      child_team_assignments: assignments,
      child_guardians: assignments.map((assignment, i) => ({
        child_id: assignment.child_id,
        guardian_id: `guardian-${String(i).padStart(4, '0')}`,
      })),
      events: [{ id: EVENT, restricted_to_roles: null, target_team_ids: [TEAM] }],
    });

    const ids = await resolveRecipients(db, EVENT, CLUB, null, null, CREATOR);
    expect(ids).toHaveLength(childCount);
    expect(new Set(ids)).toHaveLength(childCount);
    expect(ids).toContain('guardian-1204');
  });

  it.each([
    ['team membership', 'user_roles', TEAM, null],
    ['mini-league membership', 'mini_league_players', null, 'ml-1'],
    ['targeted child assignments', 'child_team_assignments', null, null],
    ['targeted guardian relationships', 'child_guardians', null, null],
  ] as const)(
    'fails closed when the %s read fails',
    async (_label, failedTable, teamId, miniLeagueId) => {
      const db = new FakeSupabase({
        user_roles: roles([['member', 'player', TEAM]]),
        mini_league_players: [{ mini_league_id: 'ml-1', parent_user_id: 'parent' }],
        mini_league_admins: [],
        child_team_assignments: [{ team_id: TEAM, child_id: 'child' }],
        child_guardians: [{ child_id: 'child', guardian_id: 'guardian' }],
        events: [{ id: EVENT, restricted_to_roles: null, target_team_ids: [TEAM] }],
      });
      db.errors[failedTable] = { code: '57014', message: 'synthetic read timeout' };

      await expect(
        resolveRecipients(db, EVENT, CLUB, teamId, miniLeagueId, CREATOR),
      ).rejects.toBeInstanceOf(AudienceResolutionError);
    },
  );
});

describe('event notification fan-out and idempotency', () => {
  it('builds one in-app row per recipient without creating RSVP state', () => {
    const rows = buildNotificationRows(['u1', 'u2'], 'event_invite', 'Carnival', EVENT);
    expect(rows).toEqual([
      { user_id: 'u1', type: 'event_invite', message: 'Carnival', related_id: EVENT, skip_push: true },
      { user_id: 'u2', type: 'event_invite', message: 'Carnival', related_id: EVENT, skip_push: true },
    ]);
    expect(rows.every((row) => !('rsvp' in row))).toBe(true);
  });

  it('inserts 1,100 recipients in complete 500/500/100 batches', async () => {
    const db = new FakeSupabase({ notifications: [] });
    const recipients = Array.from({ length: 1100 }, (_, i) => `u${i}`);
    await expect(batchInsertNotifications(db, recipients, 'event_invite', 'Carnival', EVENT))
      .resolves.toEqual(expect.objectContaining({ inserted: 1100 }));
    expect(db.inserts.map((write) => write.rows.length)).toEqual([500, 500, 100]);
  });

  it('performs no database operation for an empty audience', async () => {
    const db = new FakeSupabase({ notifications: [] });
    await expect(batchInsertNotifications(db, [], 'event_invite', 'Carnival', EVENT))
      .resolves.toEqual({ inserted: 0, ids: [] });
    expect(db.inserts).toEqual([]);
  });

  it('does not count rejected notification batches as delivered', async () => {
    const db = new FakeSupabase({ notifications: [] });
    db.errors.notifications = { code: '42501', message: 'denied' };
    const recipients = Array.from({ length: 501 }, (_, i) => `u${i}`);
    await expect(batchInsertNotifications(db, recipients, 'event_invite', 'Carnival', EVENT))
      .resolves.toEqual({ inserted: 0, ids: [] });
    expect(db.inserts.map((write) => write.rows.length)).toEqual([500, 1]);
  });

  it('continues independent batches and reports only rows actually committed after a middle-batch failure', async () => {
    const db = new FakeSupabase({ notifications: [] });
    db.writeErrors.notifications = [
      null,
      { code: '57014', message: 'synthetic middle-batch timeout' },
      null,
    ];
    const recipients = Array.from({ length: 1_100 }, (_, i) => `u${i}`);

    const result = await batchInsertNotifications(
      db,
      recipients,
      'event_invite',
      'Carnival',
      EVENT,
    );

    expect(db.inserts.map((write) => write.rows.length)).toEqual([500, 500, 100]);
    expect(result.inserted).toBe(600);
    expect(result.ids).toHaveLength(600);
    expect(db.tables.notifications).toHaveLength(600);
  });

  it('gives retries the same invite/cancellation identity but versions distinct edits', async () => {
    expect(buildDedupeKey({ notificationType: 'event_invite', eventId: EVENT, userId: 'u1' }))
      .toBe(`event_invite:${EVENT}:u1`);
    expect(buildDedupeKey({ notificationType: 'event_cancelled', eventId: EVENT, userId: 'u1' }))
      .toBe(`event_cancelled:${EVENT}:u1`);
    const first = await changeVersion([{ field: 'date', old: '2026-08-01', new: '2026-08-02' }]);
    const retry = await changeVersion([{ field: 'date', old: '2026-08-01', new: '2026-08-02' }]);
    const later = await changeVersion([{ field: 'date', old: '2026-08-02', new: '2026-08-03' }]);
    expect(retry).toBe(first);
    expect(later).not.toBe(first);
  });

  it('keeps change identity stable when database changed-field order differs', async () => {
    const a = await changeVersion([
      { field: 'location', old: 'A', new: 'B' },
      { field: 'date', old: '1', new: '2' },
    ]);
    const b = await changeVersion([
      { field: 'date', old: '1', new: '2' },
      { field: 'location', old: 'A', new: 'B' },
    ]);
    expect(a).toBe(b);
  });

  it('builds a push payload tied to the notification row and event route', () => {
    expect(buildPushPayload({
      userId: 'u1',
      body: 'Carnival',
      url: `/events/${EVENT}`,
      notificationId: 'notification-1',
      notificationType: 'event_invite',
    })).toEqual({
      userId: 'u1',
      title: 'Ignite',
      body: 'Carnival',
      url: `/events/${EVENT}`,
      notificationId: 'notification-1',
      tag: 'event_invite-notification-1',
      notificationType: 'event_invite',
    });
  });
});
