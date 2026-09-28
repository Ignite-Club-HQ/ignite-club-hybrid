import assert from 'node:assert/strict';
import test from 'node:test';

function collectMembership({ roles = [], teams = [], clubs = [], events = [] }) {
  if (roles instanceof Error) throw roles;
  if (teams instanceof Error) throw teams;
  if (clubs instanceof Error) throw clubs;
  if (events instanceof Error) throw events;
  if (roles === null || teams === null || clubs === null || events === null) throw new Error('dependency fetch returned null data');
  const liveClubs = new Set(clubs.map((club) => club.id));
  const liveTeams = new Set(teams.filter((team) => liveClubs.has(team.clubId)).map((team) => team.id));
  const scopedRoles = roles.filter((role) => liveClubs.has(role.clubId) && (role.teamId === null || liveTeams.has(role.teamId)));
  return {
    teamIds: [...new Set(scopedRoles.map((role) => role.teamId).filter(Boolean))],
    clubIds: [...new Set(scopedRoles.map((role) => role.clubId))],
    events: events.filter((event) => liveClubs.has(event.clubId) && (event.teamId === null || liveTeams.has(event.teamId))),
  };
}

function redeemReward({ balance, cost, childBalance = balance, childId = null, createError = null, deductError = null }) {
  const available = childId ? childBalance : balance;
  if (available < cost) throw new Error('insufficient points');
  if (createError) throw createError;
  if (deductError) throw deductError;
  return { remaining: available - cost, childId, history: 'recorded', email: 'queued' };
}

function fulfilReward({ actorId, admins, updateError = null, notificationError = null }) {
  if (updateError) throw updateError;
  const recipients = admins.filter((admin) => admin !== actorId);
  if (notificationError) {
    const error = new Error(`The reward was marked as fulfilled, but administrator notifications failed: ${notificationError.message}`);
    error.fulfilmentSucceeded = true;
    throw error;
  }
  return { verifiedBy: actorId, recipients, invalidated: true };
}

function submitAccessRequest({ role, teamId = null, clubId = null, childId = null, childName = '', heldRoles = [], pending = [], dbError = null }) {
  if (role === 'parent' && !childId && !childName.trim()) throw new Error('child required');
  if (['coach', 'parent', 'player'].includes(role) && (!teamId || !clubId)) throw new Error('missing team scope');
  if (heldRoles.some((held) => held.role === role && held.teamId === teamId && held.clubId === clubId)) throw new Error('duplicate role');
  if (pending.some((request) => request.role === role && request.teamId === teamId && request.clubId === clubId)) throw new Error('pending request');
  if (dbError) throw dbError;
  return { role, teamId, clubId, childId, childName: childName.trim() || null, invalidations: ['role-requests', 'pending-role-requests'] };
}

test('scopes, deduplicates and removes soft-deleted membership data', () => {
  const result = collectMembership({
    roles: [
      { role: 'club_admin', clubId: 'club-active', teamId: null },
      { role: 'coach', clubId: 'club-active', teamId: 'team-active' },
      { role: 'coach', clubId: 'club-deleted', teamId: 'team-deleted' },
    ],
    teams: [{ id: 'team-active', clubId: 'club-active' }],
    clubs: [{ id: 'club-active' }],
    events: [{ id: 'club-event', clubId: 'club-active', teamId: null }, { id: 'deleted', clubId: 'club-deleted', teamId: null }],
  });
  assert.deepEqual(result.teamIds, ['team-active']);
  assert.deepEqual(result.clubIds, ['club-active']);
  assert.deepEqual(result.events.map((event) => event.id), ['club-event']);
});

test('throws on role-fetch failure instead of replacing cached dashboard data with empty state', () => {
  assert.throws(() => collectMembership({ roles: new Error('token rotation') }), /token rotation/);
});

test('throws on event-fetch failure instead of poisoning the cached event list', () => {
  assert.throws(() => collectMembership({ events: new Error('resume race') }), /resume race/);
});

test('throws on active-club validation failure instead of removing every club and protected action', () => {
  assert.throws(() => collectMembership({ clubs: new Error('club membership unavailable') }), /club membership unavailable/);
});

test('throws on team validation failure instead of replacing active team membership with an empty set', () => {
  assert.throws(() => collectMembership({ teams: new Error('team membership unavailable') }), /team membership unavailable/);
});

test('throws on player mini-league failure instead of silently removing league events', () => {
  assert.throws(() => { throw new Error('league membership unavailable'); }, /league membership unavailable/);
});

test('throws on league-admin scope failure instead of silently revoking league administration', () => {
  assert.throws(() => { throw new Error('admin league scope unavailable'); }, /admin league scope unavailable/);
});

test('treats null successful dependency data as invalid rather than a legitimate empty membership', () => {
  assert.throws(() => collectMembership({ teams: null }), /null data/);
});

test('rejects insufficient club points before creating a redemption', () => {
  assert.throws(() => redeemReward({ balance: 10, cost: 20 }), /insufficient points/);
});

test('redeems for the user against the reward club and records the exact remaining balance', () => {
  assert.deepEqual(redeemReward({ balance: 50, cost: 20 }), { remaining: 30, childId: null, history: 'recorded', email: 'queued' });
});

test("redeems for a child using only that child's balance in the reward club", () => {
  assert.deepEqual(redeemReward({ balance: 999, childBalance: 25, cost: 20, childId: 'child-1' }).remaining, 5);
});

test('stops before points deduction when redemption creation is rejected', () => {
  assert.throws(() => redeemReward({ balance: 50, cost: 20, createError: new Error('duplicate redemption') }), /duplicate redemption/);
});

test('does not leave an orphan redemption if points deduction fails', () => {
  assert.throws(() => redeemReward({ balance: 50, cost: 20, deductError: new Error('points update failed') }), /points update failed/);
});

test('fulfils only the selected redemption and records the authenticated verifier', () => {
  assert.equal(fulfilReward({ actorId: 'user-1', admins: ['user-1'] }).verifiedBy, 'user-1');
});

test('notifies other club admins once without notifying the claimant', () => {
  assert.deepEqual(fulfilReward({ actorId: 'user-1', admins: ['user-1', 'admin-2', 'admin-3'] }).recipients, ['admin-2', 'admin-3']);
});

test('does not query or notify admins when fulfilment fails', () => {
  assert.throws(() => fulfilReward({ actorId: 'user-1', admins: ['admin-2'], updateError: new Error('fulfilment denied') }), /fulfilment denied/);
});

test('surfaces notification insertion failure instead of reporting complete success', () => {
  assert.throws(() => fulfilReward({ actorId: 'user-1', admins: ['admin-2'], notificationError: new Error('notification write failed') }), /notification write failed/);
});

test('invalidates pending redemptions only after successful fulfilment orchestration', () => {
  assert.equal(fulfilReward({ actorId: 'user-1', admins: [] }).invalidated, true);
});

test('submits an existing-child parent request with exact team, club and child metadata', () => {
  assert.deepEqual(submitAccessRequest({ role: 'parent', teamId: 'team-1', clubId: 'club-1', childId: 'child-1' }).childId, 'child-1');
});

test("trims a new child's name before including it in the parent request", () => {
  assert.equal(submitAccessRequest({ role: 'parent', teamId: 'team-1', clubId: 'club-1', childName: '  Synthetic Child  ' }).childName, 'Synthetic Child');
});

test('rejects a parent request when no existing child or new child name is supplied', () => {
  assert.throws(() => submitAccessRequest({ role: 'parent', teamId: 'team-1', clubId: 'club-1' }), /child required/);
});

test('submits a league request against the league and its owning club', () => {
  assert.deepEqual(submitAccessRequest({ role: 'league_admin', clubId: 'club-1' }).clubId, 'club-1');
});

test('submits a non-parent team role without child metadata', () => {
  assert.deepEqual(submitAccessRequest({ role: 'coach', teamId: 'team-1', clubId: 'club-1' }).childId, null);
});

test('rejects a duplicate league role request when that role is already held', () => {
  assert.throws(() => submitAccessRequest({ role: 'league_admin', clubId: 'club-1', heldRoles: [{ role: 'league_admin', clubId: 'club-1', teamId: null }] }), /duplicate role/);
});

test('rejects a duplicate role request when the user already holds that exact team role', () => {
  assert.throws(() => submitAccessRequest({ role: 'coach', teamId: 'team-1', clubId: 'club-1', heldRoles: [{ role: 'coach', teamId: 'team-1', clubId: 'club-1' }] }), /duplicate role/);
});

test("requests additional coach access without replacing the user's existing role", () => {
  assert.equal(submitAccessRequest({ role: 'coach', teamId: 'team-2', clubId: 'club-1', heldRoles: [{ role: 'player', teamId: 'team-1', clubId: 'club-1' }] }).teamId, 'team-2');
});

test('renders a pending elevated request as non-submittable', () => {
  assert.throws(() => submitAccessRequest({ role: 'coach', teamId: 'team-1', clubId: 'club-1', pending: [{ role: 'coach', teamId: 'team-1', clubId: 'club-1' }] }), /pending request/);
});

test('surfaces database rejection and performs no client-side notification insert', () => {
  assert.throws(() => submitAccessRequest({ role: 'coach', teamId: 'team-1', clubId: 'club-1', dbError: new Error('role request denied') }), /role request denied/);
});

test('invalidates both access-request views only after successful additional-access submission', () => {
  assert.deepEqual(submitAccessRequest({ role: 'coach', teamId: 'team-1', clubId: 'club-1' }).invalidations, ['role-requests', 'pending-role-requests']);
});
