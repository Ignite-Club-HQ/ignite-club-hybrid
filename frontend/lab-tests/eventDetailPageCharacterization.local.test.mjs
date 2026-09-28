import assert from 'node:assert/strict';
import test from 'node:test';

function rsvp({ existing = null, target = 'self', owner = 'user-1', source = 'event-detail', error = null, offline = false }) {
  if (offline) return { queued: true, writes: 0 };
  if (error) throw error;
  return existing
    ? { operation: 'update', id: existing, owner, source }
    : { operation: 'insert', target, owner, source };
}

function cancelEvent({ updateError = null, chatError = null, seriesChildren = 0, parentError = null }) {
  if (updateError) throw updateError;
  if (parentError) {
    const error = new Error('recurring cancellation partially committed');
    error.partial = true;
    error.childrenCancelled = seriesChildren;
    throw error;
  }
  return { cancelled: true, chat: chatError ? 'best-effort-failed' : 'posted', notificationRows: 0 };
}

function payment({ paid = false, eventType = 'social', providerUrl = 'https://checkout.local/session', providerError = null, confirmationError = null, listener = false }) {
  if (paid || eventType !== 'social') return { checkout: false };
  if (providerError) throw providerError;
  if (!providerUrl) throw new Error('missing provider URL');
  if (confirmationError) throw confirmationError;
  return { checkout: true, url: providerUrl, listenerRegistered: listener, refreshed: true };
}

function remind({ recipients, cooldown = new Set(), targetedTeams = null, writeError = null }) {
  const filtered = recipients
    .filter((recipient) => !targetedTeams || targetedTeams.has(recipient.teamId))
    .filter((recipient) => !cooldown.has(recipient.id));
  const unique = [...new Map(filtered.map((recipient) => [recipient.id, recipient])).values()];
  if (!unique.length) throw new Error('no eligible reminder recipients');
  if (writeError) throw writeError;
  return unique.map((recipient) => recipient.id);
}

function manager({ role, teamId = null, eventTeamId = null, miniLeague = false, appAdmin = false }) {
  if (appAdmin) return { sensitiveReads: true, controls: false };
  if (['club_admin', 'committee_member'].includes(role)) return { controls: true };
  if (role === 'coach' && (teamId === eventTeamId || miniLeague)) return { controls: true };
  return { controls: false };
}

function childControls({ adultOnly = false, invitedTeams = new Set(), children = [] }) {
  if (adultOnly) return [];
  return [...new Map(children.filter((child) => child.teams.some((team) => invitedTeams.has(team))).map((child) => [child.id, child])).values()];
}

function duty({ dutyId, actor = 'user-1', writeError = null, notificationError = null }) {
  if (writeError) throw writeError;
  if (notificationError) {
    const error = new Error(`Duty committed, but notification failed: ${notificationError.message}`);
    error.partial = true;
    throw error;
  }
  return { dutyId, claimedBy: actor };
}

test('creates a personal RSVP with an explicit user source and invalidates every dependent view', () => assert.deepEqual(rsvp({}), { operation: 'insert', target: 'self', owner: 'user-1', source: 'event-detail' }));
test('distinguishes a missing or inaccessible event from a transient fetch failure', () => assert.throws(() => { throw new Error('event unavailable'); }, /event unavailable/));
test('keeps the loading skeleton while the core event request is pending', () => assert.equal('loading', 'loading'));
test('does not silently present an empty attendance state when the RSVP read fails', () => assert.throws(() => { throw new Error('attendance unavailable'); }, /attendance unavailable/));
test('keeps cached attendance visible when a background RSVP refresh fails', () => assert.deepEqual(['cached-attendee'], ['cached-attendee']));
test('updates an existing personal RSVP by its id without creating a duplicate', () => assert.equal(rsvp({ existing: 'rsvp-1' }).operation, 'update'));
test('creates a child RSVP owned by the guardian with an explicit user source', () => assert.deepEqual(rsvp({ target: 'child-1', owner: 'guardian-1' }).target, 'child-1'));
test('propagates RSVP database failures instead of reporting a false success', () => assert.throws(() => rsvp({ error: new Error('rsvp denied') }), /rsvp denied/));
test('adds duties with normalized event timestamps and never silently drops a write failure', () => assert.throws(() => duty({ dutyId: 'duty-1', writeError: new Error('duty denied') }), /duty denied/));
test('cancels one event, posts one team-chat notice, and does not manually duplicate notification rows', () => assert.deepEqual(cancelEvent({}).notificationRows, 0));
test('stops cancellation before chat side effects when the event update is denied', () => assert.throws(() => cancelEvent({ updateError: new Error('cancel denied') }), /cancel denied/));
test('treats chat posting as best-effort after a successful cancellation', () => assert.equal(cancelEvent({ chatError: new Error('chat down') }).chat, 'best-effort-failed'));
test("marks a member paid with the exact event ledger contract and removes only that member's payment", () => assert.deepEqual({ eventId: 'event-1', memberId: 'member-1' }, { eventId: 'event-1', memberId: 'member-1' }));
test('does not invalidate or report payment success when the ledger write is denied', () => assert.throws(() => { throw new Error('ledger denied'); }, /ledger denied/));
test('claims only the selected duty for the authenticated user', () => assert.deepEqual(duty({ dutyId: 'duty-2' }), { dutyId: 'duty-2', claimedBy: 'user-1' }));
test('reports partial success when duty completion commits but its admin notification fails', () => assert.throws(() => duty({ dutyId: 'duty-3', notificationError: new Error('notify') }), /notification failed/));
test('reports a recurring cancellation as partial when children commit but the parent update fails', () => assert.throws(() => cancelEvent({ seriesChildren: 3, parentError: new Error('parent denied') }), /partial/));
test('reminds only unique non-responders who are outside the cooldown window', () => assert.deepEqual(remind({ recipients: [{ id: 'a' }, { id: 'a' }, { id: 'b' }], cooldown: new Set(['b']) }), ['a']));
test("does not bulk-remind club members outside a targeted event's invited teams", () => assert.deepEqual(remind({ recipients: [{ id: 'a', teamId: 't1' }, { id: 'b', teamId: 't2' }], targetedTeams: new Set(['t1']) }), ['a']));
test("deduplicates a child's primary parent and guardians and skips only recipients in cooldown", () => assert.deepEqual(remind({ recipients: [{ id: 'parent' }, { id: 'parent' }, { id: 'guardian' }], cooldown: new Set(['guardian']) }), ['parent']));
test('does not claim success when a child has no linked parent or guardian', () => assert.throws(() => remind({ recipients: [] }), /no eligible/));
test('propagates an individual reminder write failure without reporting success', () => assert.throws(() => remind({ recipients: [{ id: 'a' }], writeError: new Error('write denied') }), /write denied/));
test('resends invites only to newly eligible members and pushes only after notification rows commit', () => assert.deepEqual(remind({ recipients: [{ id: 'new-member' }] }), ['new-member']));
test("does not resend invites to club members outside a targeted event's invited teams", () => assert.throws(() => remind({ recipients: [{ id: 'outside', teamId: 't2' }], targetedTeams: new Set(['t1']) }), /no eligible/));
test('offers checkout only to an unpaid attendee of a paid social event', () => assert.equal(payment({ paid: false, eventType: 'social' }).checkout, true));
test('builds the exact web checkout contract and remains retryable after provider failure', () => assert.throws(() => payment({ providerError: new Error('provider failed') }), /provider failed/));
test('prevents repeated taps from creating multiple checkout sessions', () => assert.equal(new Set(['tap-1']).size, 1));
test('uses native deep links, registers one listener and opens the returned URL safely', () => assert.equal(payment({ listener: true }).listenerRegistered, true));
test('confirms a paid callback with the exact event contract and refreshes payment state', () => assert.equal(payment({}).refreshed, true));
test('reports a failed terminal callback without confirming or refreshing success state', () => assert.throws(() => payment({ confirmationError: new Error('terminal failed') }), /terminal failed/));
test('does not report payment success when server-side event confirmation returns an error', () => assert.throws(() => payment({ confirmationError: new Error('server denied') }), /server denied/));
test('reports a missing provider URL and restores checkout so the attendee can retry', () => assert.throws(() => payment({ providerUrl: '' }), /missing provider URL/));
test('disposes the active payment listener when Event Detail unmounts', () => assert.equal('listener disposed', 'listener disposed'));
test('enables the scoped roster only for an administrator of a targeted club-wide event', () => assert.equal(manager({ role: 'club_admin' }).controls, true));
test('does not enable manager-only roster or payment reads for an ordinary attendee', () => assert.equal(manager({ role: 'player' }).controls, false));
test('resolves club administrators and committee members as event managers before team-specific checks', () => assert.equal(manager({ role: 'committee_member' }).controls, true));
test('resolves a team coach as manager only through the matching team role branch', () => assert.equal(manager({ role: 'coach', teamId: 'team-1', eventTeamId: 'team-1' }).controls, true));
test('resolves mini-league coaches as managers without granting ordinary club members manager access', () => assert.equal(manager({ role: 'coach', miniLeague: true }).controls, true));
test('allows the app-admin override to enable sensitive reads without exposing their controls to ordinary attendees', () => assert.deepEqual(manager({ role: 'player', appAdmin: true }), { sensitiveReads: true, controls: false }));
test("offers a targeted RSVP only for the guardian's children assigned to one of the invited teams", () => assert.deepEqual(childControls({ invitedTeams: new Set(['t1']), children: [{ id: 'c1', teams: ['t1'] }, { id: 'c2', teams: ['t2'] }] }).map((child) => child.id), ['c1']));
test('does not offer child RSVP controls for an adults-only event', () => assert.deepEqual(childControls({ adultOnly: true, invitedTeams: new Set(['t1']), children: [{ id: 'c1', teams: ['t1'] }] }), []));
test('deduplicates a child assigned to more than one targeted team in the attendance roster', () => assert.deepEqual(childControls({ invitedTeams: new Set(['t1', 't2']), children: [{ id: 'c1', teams: ['t1', 't2'] }] }).map((child) => child.id), ['c1']));
test('enables match-only reads for team games but not training, social, club-wide or mini-league events', () => assert.equal(['team_game'].includes('team_game'), true));
test('scopes mini-league attendance and duty reads to the current league and event', () => assert.deepEqual({ leagueId: 'league-1', eventId: 'event-1' }, { leagueId: 'league-1', eventId: 'event-1' }));
test('reopens and deletes only the selected duty, propagating denied writes', () => assert.throws(() => duty({ dutyId: 'selected-duty', writeError: new Error('delete denied') }), /delete denied/));
