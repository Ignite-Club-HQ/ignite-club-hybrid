/**
 * Local, synthetic-database equivalent of all 22 exported
 * `event-groups-rls.test.ts` cases, using
 * `src/lab/rls/eventGroupsAccessModel.ts` - a faithful port of the
 * complete, self-contained `event_groups`/`event_group_players`
 * authorization and invariant subsystem (see that module's doc comment
 * for exact migration citations). Unlike `role-surface-access-matrix`,
 * none of this file's assertions depend on the undocumented `has_role`
 * helper, so every case here is fully represented (no boundary cases).
 *
 * Each case below builds its own self-contained fixture rather than
 * replaying the bundle's single shared, sequentially-mutated live
 * fixture, to keep every assertion independently verifiable; where a
 * case's intent specifically requires pre-existing state (for example
 * the unique-assignment conflict cases), that state is seeded explicitly
 * within the test instead of relying on incidental ordering from earlier
 * cases.
 */
import { describe, it, expect } from 'vitest';
import {
  SyntheticEventGroupsDb,
  RlsError,
  type EventRow,
  type MiniLeagueRow,
  type MiniLeaguePlayerRow,
  type TeamRow,
  type UserRoleRow,
} from '../src/lab/rls/eventGroupsAccessModel';

const clubA = 'club-a';
const clubB = 'club-b';

function buildFixture() {
  const db = new SyntheticEventGroupsDb();
  db.roles = [
    { userId: 'admin-a', role: 'club_admin', clubId: clubA, teamId: null },
    { userId: 'member-a', role: 'player', clubId: clubA, teamId: null },
    { userId: 'outsider-b', role: 'club_admin', clubId: clubB, teamId: null },
    { userId: 'committee', role: 'committee_member', clubId: clubA, teamId: null },
    { userId: 'coach', role: 'coach', clubId: clubA, teamId: null },
    { userId: 'app-admin', role: 'app_admin', clubId: null, teamId: null },
  ] satisfies UserRoleRow[];
  db.teams = [] satisfies TeamRow[];
  const leagueA: MiniLeagueRow = { id: 'league-a', clubId: clubA };
  const leagueB: MiniLeagueRow = { id: 'league-b', clubId: clubB };
  db.miniLeagues = [leagueA, leagueB];
  const eventA: EventRow = { id: 'event-a', clubId: clubA, miniLeagueId: leagueA.id };
  const eventB: EventRow = { id: 'event-b', clubId: clubB, miniLeagueId: leagueB.id };
  db.events = [eventA, eventB];
  const playerA: MiniLeaguePlayerRow = { id: 'player-a', miniLeagueId: leagueA.id };
  const playerA2: MiniLeaguePlayerRow = { id: 'player-a2', miniLeagueId: leagueA.id };
  const playerB: MiniLeaguePlayerRow = { id: 'player-b', miniLeagueId: leagueB.id };
  db.miniLeaguePlayers = [playerA, playerA2, playerB];
  const groupA = db.insertGroup('admin-a', eventA.id, 'Synthetic Match One', { displayOrder: 1 });
  db.insertAssignment('admin-a', groupA.id, playerA.id, 'a');
  return { db, eventA, eventB, groupA, playerA, playerA2, playerB };
}

describe('local RLS: event-group and player-assignment isolation', () => {
  it("lets a club member read only their club's event groups and assignments", () => {
    const { db, eventA, groupA, playerA } = buildFixture();
    expect(db.canRead('member-a', eventA.id)).toBe(true);
    expect(db.groups.filter((g) => g.eventId === eventA.id)).toEqual([groupA]);
    expect(db.assignments.filter((a) => a.eventId === eventA.id)).toEqual([
      { id: expect.any(String), groupId: groupA.id, eventId: eventA.id, playerId: playerA.id, team: 'a' },
    ]);
  });

  it("does not expose another club's groups or player assignments", () => {
    const { db, eventA } = buildFixture();
    expect(db.canRead('outsider-b', eventA.id)).toBe(false);
  });

  it('prevents an ordinary member creating, changing or deleting groups', () => {
    const { db, eventA, groupA } = buildFixture();
    expect(() => db.insertGroup('member-a', eventA.id, 'Member-created match')).toThrow(RlsError);
    expect(db.updateGroup('member-a', groupA.id, { name: 'Member edit' })).toEqual([]);
    expect(db.deleteGroup('member-a', groupA.id)).toEqual([]);
  });

  it('allows the owning club administrator to create and manage a scoped group', () => {
    const { db, eventA } = buildFixture();
    const created = db.insertGroup('admin-a', eventA.id, 'Admin-created match', { displayOrder: 2 });
    const updated = db.updateGroup('admin-a', created.id, { pitchName: 'North' });
    expect(updated[0]?.pitchName).toBe('North');
    const removed = db.deleteGroup('admin-a', created.id);
    expect(removed).toEqual([{ ...created, pitchName: 'North' }]);
  });

  it.each([
    ['committee member', 'committee'],
    ['league coach', 'coach'],
    ['application administrator', 'app-admin'],
  ])('allows the %s shown management controls by EventDetailPage to create a match', (_label, userId) => {
    const { db, eventA } = buildFixture();
    expect(() => db.insertGroup(userId, eventA.id, `Role contract ${userId}`)).not.toThrow();
  });

  it("prevents another club administrator managing this club's group", () => {
    const { db, groupA } = buildFixture();
    expect(db.updateGroup('outsider-b', groupA.id, { name: 'Cross-club edit' })).toEqual([]);
  });

  it('rejects assigning a player from another club or mini-league', () => {
    const { db, groupA, playerB } = buildFixture();
    expect(() => db.insertAssignment('admin-a', groupA.id, playerB.id, 'b')).toThrow(RlsError);
  });

  it('rejects duplicate assignment of the same player to the same match', () => {
    const { db, groupA, playerA } = buildFixture();
    try {
      db.insertAssignment('admin-a', groupA.id, playerA.id, 'b');
      throw new Error('expected insertAssignment to throw');
    } catch (error) {
      expect((error as Error & { code?: string }).code).toBe('23505');
    }
  });

  it('rolls an atomic cross-match swap back when a destination player is out of scope', () => {
    const { db, eventA, groupA, playerA, playerB } = buildFixture();
    const secondGroup = db.insertGroup('admin-a', eventA.id, 'Atomic swap destination');
    // Seeded directly (mirrors the bundle's `service.from(...).insert(...)`
    // service-role bypass used purely to stage foreign-scope fixture data).
    db.assignments.push({ id: 'seed-1', groupId: secondGroup.id, eventId: eventA.id, playerId: playerB.id, team: 'b' });
    expect(() =>
      db.swapEventGroupPlayers('admin-a', playerA.id, groupA.id, 'a', playerB.id, secondGroup.id, 'b'),
    ).toThrow();
    expect(db.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupId: groupA.id, playerId: playerA.id, team: 'a' }),
        expect.objectContaining({ groupId: secondGroup.id, playerId: playerB.id, team: 'b' }),
      ]),
    );
  });

  it('moves a player between matches atomically and rejects invalid teams', () => {
    const { db, eventA, groupA, playerA } = buildFixture();
    const destination = db.insertGroup('admin-a', eventA.id, 'Move destination');
    db.moveEventGroupPlayer('admin-a', playerA.id, groupA.id, destination.id, 'b');
    expect(db.assignments.find((a) => a.playerId === playerA.id)).toMatchObject({ groupId: destination.id, team: 'b' });

    expect(() => db.moveEventGroupPlayer('admin-a', playerA.id, destination.id, groupA.id, 'invalid')).toThrow();
    expect(db.assignments.find((a) => a.playerId === playerA.id)).toMatchObject({ groupId: destination.id, team: 'b' });

    db.moveEventGroupPlayer('admin-a', playerA.id, destination.id, groupA.id, 'a');
    expect(db.assignments.find((a) => a.playerId === playerA.id)).toMatchObject({ groupId: groupA.id, team: 'a' });
  });

  it("denies an ordinary member's move and preserves the source assignment", () => {
    const { db, eventA, groupA, playerA } = buildFixture();
    const destination = db.insertGroup('admin-a', eventA.id, 'Denied move target');
    expect(() => db.moveEventGroupPlayer('member-a', playerA.id, groupA.id, destination.id, 'b')).toThrow();
    expect(db.assignments.find((a) => a.playerId === playerA.id)).toMatchObject({ groupId: groupA.id, team: 'a' });
  });

  it('swaps two valid players across matches and swaps two teams within one match', () => {
    const { db, eventA, groupA, playerA, playerA2 } = buildFixture();
    const second = db.insertGroup('admin-a', eventA.id, 'Swap target');
    db.insertAssignment('admin-a', second.id, playerA2.id, 'b');

    // Cross-match swap: each player moves to the other's group and team.
    db.swapEventGroupPlayers('admin-a', playerA.id, groupA.id, 'a', playerA2.id, second.id, 'b');
    expect(db.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupId: second.id, playerId: playerA.id, team: 'b' }),
        expect.objectContaining({ groupId: groupA.id, playerId: playerA2.id, team: 'a' }),
      ]),
    );

    // Co-locate both players in `second`, then swap their teams within one
    // match (group is unchanged for both, only the team letters flip).
    db.moveEventGroupPlayer('admin-a', playerA2.id, groupA.id, second.id, 'a');
    db.swapEventGroupPlayers('admin-a', playerA.id, second.id, 'b', playerA2.id, second.id, 'a');
    expect(db.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupId: second.id, playerId: playerA.id, team: 'a' }),
        expect.objectContaining({ groupId: second.id, playerId: playerA2.id, team: 'b' }),
      ]),
    );
  });

  it('rolls a swap back when its second source assignment is missing', () => {
    const { db, groupA, playerA, playerA2 } = buildFixture();
    const before = db.assignments.find((a) => a.playerId === playerA.id);
    expect(() =>
      db.swapEventGroupPlayers('admin-a', playerA.id, groupA.id, 'a', playerA2.id, 'nonexistent-group', 'b'),
    ).toThrow();
    expect(db.assignments.find((a) => a.playerId === playerA.id)).toEqual(before);
  });

  it('creates a complete replacement payload and its assignments atomically', () => {
    const { db, eventA } = buildFixture();
    const freshPlayer: MiniLeaguePlayerRow = { id: 'player-fresh', miniLeagueId: 'league-a' };
    db.miniLeaguePlayers.push(freshPlayer);
    const ids = db.replaceEventGroups(
      'admin-a',
      eventA.id,
      [
        {
          name: 'Generated Match',
          pitchName: 'Pitch 3',
          displayOrder: 3,
          players: [{ playerId: freshPlayer.id, team: 'b' }],
        },
      ],
      false,
    );
    expect(ids).toHaveLength(1);
    expect(db.assignments.find((a) => a.groupId === ids[0])).toMatchObject({ playerId: freshPlayer.id, team: 'b' });
  });

  it('denies replacement by an ordinary member without deleting existing groups', () => {
    const { db, eventA } = buildFixture();
    const before = db.groups.filter((g) => g.eventId === eventA.id);
    expect(() =>
      db.replaceEventGroups('member-a', eventA.id, [{ name: 'Unauthorized replacement', players: [] }], true),
    ).toThrow();
    expect(db.groups.filter((g) => g.eventId === eventA.id)).toEqual(before);
  });

  it.each([
    ['invalid team', (p: { playerA2: string }) => [{ name: 'Invalid team', players: [{ playerId: p.playerA2, team: 'x' }] }]],
    ['foreign player', (p: { playerB: string }) => [{ name: 'Foreign player', players: [{ playerId: p.playerB, team: 'a' }] }]],
  ])('rolls the entire replacement back for an %s payload', (_label, template) => {
    const { db, eventA, playerA2, playerB } = buildFixture();
    const before = db.groups.filter((g) => g.eventId === eventA.id);
    const payload = template({ playerA2: playerA2.id, playerB: playerB.id });
    expect(() => db.replaceEventGroups('admin-a', eventA.id, payload, true)).toThrow();
    expect(db.groups.filter((g) => g.eventId === eventA.id)).toEqual(before);
  });

  it('rejects malformed replacement input without changing existing groups', () => {
    const { db, eventA } = buildFixture();
    const before = db.groups.filter((g) => g.eventId === eventA.id);
    expect(() => db.replaceEventGroups('admin-a', eventA.id, { not: 'an array' }, true)).toThrow();
    expect(db.groups.filter((g) => g.eventId === eventA.id)).toEqual(before);
  });

  it('rejects the same player appearing in multiple generated matches', () => {
    const { db, eventA, playerA2 } = buildFixture();
    const before = db.groups.filter((g) => g.eventId === eventA.id);
    expect(() =>
      db.replaceEventGroups(
        'admin-a',
        eventA.id,
        [
          { name: 'Duplicate A', players: [{ playerId: playerA2.id, team: 'a' }] },
          { name: 'Duplicate B', players: [{ playerId: playerA2.id, team: 'b' }] },
        ],
        false,
      ),
    ).toThrow();
    expect(db.groups.filter((g) => g.eventId === eventA.id)).toEqual(before);
  });

  it('cascades assignments when an authorized administrator deletes a group', () => {
    const { db, eventA } = buildFixture();
    const freshPlayer: MiniLeaguePlayerRow = { id: 'player-cascade', miniLeagueId: 'league-a' };
    db.miniLeaguePlayers.push(freshPlayer);
    const temporary = db.insertGroup('admin-a', eventA.id, 'Temporary match');
    const assignment = db.insertAssignment('admin-a', temporary.id, freshPlayer.id, 'a');
    const removed = db.deleteGroup('admin-a', temporary.id);
    expect(removed).toEqual([temporary]);
    expect(db.assignments.find((a) => a.id === assignment.id)).toBeUndefined();
  });
});
