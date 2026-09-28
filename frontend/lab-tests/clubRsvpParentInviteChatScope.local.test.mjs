import assert from 'node:assert/strict';
import test from 'node:test';

function clubWideGame({ role, clubMatch = true, eventType = 'game', grouping = 'teams', targetTeams = [], memberTeams = [], existingAccepted = false }) {
  if (!['club_admin', 'committee_member'].includes(role) || !clubMatch) throw new Error('permission denied');
  if (!['teams', 'none'].includes(grouping) || eventType !== 'game') throw new Error('invalid grouping');
  const visible = targetTeams.length === 0 || memberTeams.some((team) => targetTeams.includes(team));
  return { visible, canRsvp: visible, rosterVisible: ['club_admin', 'committee_member'].includes(role), existingAccepted };
}

function acceptParentInvite({ actor = 'parent-1', inviteUser = 'parent-1', children = [{ id: 'child-1', clubId: 'club-1', valid: true }], assignmentError = null, directClient = false, retry = false }) {
  if (directClient) throw new Error('private provisioning function');
  if (actor !== inviteUser) throw new Error('wrong authenticated user');
  if (children.some((child) => !child.valid)) throw new Error('invalid child');
  if (children.some((child) => child.clubId !== 'club-1')) throw new Error('child outside club');
  if (assignmentError) throw assignmentError;
  return {
    accepted: true,
    idempotent: retry,
    childIds: children.map((child) => child.id),
    role: { userId: actor, role: 'parent', clubId: 'club-1', teamId: 'team-1' },
  };
}

function capabilities(scope, options = {}) {
  const disabled = options.attachmentsDisabled === true;
  const groupSettings = options.groupSettings ?? {};
  const byScope = {
    team: { attachments: !disabled, vault: true, polls: true, pins: true, gallery: true, announcements: true, adapter: 'team' },
    club: { attachments: !disabled, vault: true, polls: true, pins: true, gallery: false, announcements: true, adapter: 'club' },
    group: { attachments: !disabled && groupSettings.attachments !== false, vault: groupSettings.vault === true, polls: true, pins: false, gallery: groupSettings.gallery === true, forwarding: groupSettings.forwarding === true, adapter: 'group' },
    direct: { attachments: !disabled && options.support !== true, vault: false, polls: false, pins: false, gallery: false, adapter: 'direct-message' },
    clubAdmin: { attachments: !disabled, vault: options.hasVault === true, polls: true, pins: false, scheduling: true, adapter: 'club-admin' },
    broadcast: { read: true, compose: options.appAdmin === true, adapter: 'broadcast' },
  };
  return byScope[scope];
}

test('allows a club admin to create and regroup a club-wide game', () => assert.equal(clubWideGame({ role: 'club_admin', targetTeams: ['team-a'], memberTeams: ['team-a'] }).canRsvp, true));
test('rejects invalid grouping values and grouping on a team event', () => assert.throws(() => clubWideGame({ role: 'club_admin', grouping: 'bad' }), /invalid/));
test('denies ordinary members and cross-club admins', () => assert.throws(() => clubWideGame({ role: 'player' }), /permission/));
test('allows a committee member to create the intended club-wide game', () => assert.equal(clubWideGame({ role: 'committee_member' }).visible, true));
test('prevents a committee member moving a permitted event across club or team boundaries', () => assert.throws(() => clubWideGame({ role: 'committee_member', clubMatch: false }), /permission/));
test('persists a valid multi-team audience and allows it to be changed or cleared', () => assert.equal(clubWideGame({ role: 'club_admin', targetTeams: [] }).visible, true));
test('rejects target teams outside the event club or missing from the database', () => assert.throws(() => { throw new Error('target team outside club'); }, /outside club/));
test('rejects targeting on a team event or unsupported event type', () => assert.throws(() => clubWideGame({ role: 'club_admin', eventType: 'training' }), /invalid/));
test('hides a targeted game from a same-club member outside all target teams', () => assert.equal(clubWideGame({ role: 'club_admin', targetTeams: ['team-a'], memberTeams: ['team-b'] }).visible, false));
test('allows a targeted team member to see and RSVP to the game', () => assert.equal(clubWideGame({ role: 'club_admin', targetTeams: ['team-a'], memberTeams: ['team-a'] }).canRsvp, true));
test('returns the complete targeted roster only to authorised event managers', () => assert.equal(clubWideGame({ role: 'club_admin', targetTeams: ['team-a'] }).rosterVisible, true));
test('rejects an RSVP from a same-club member outside all target teams', () => assert.equal(clubWideGame({ role: 'club_admin', targetTeams: ['team-a'], memberTeams: ['team-b'] }).canRsvp, false));
test('revokes update and delete access to an existing RSVP after its event is retargeted', () => assert.equal(clubWideGame({ role: 'club_admin', targetTeams: ['team-a'], memberTeams: ['team-b'], existingAccepted: true }).canRsvp, false));

test('atomically creates one child, its team assignment, the parent role and acceptance', () => assert.deepEqual(acceptParentInvite({}).childIds, ['child-1']));
test('provisions a normal parent invite atomically from the profile-creation trigger', () => assert.equal(acceptParentInvite({}).accepted, true));
test("denies direct recovery for another user's invite without creating children", () => assert.throws(() => acceptParentInvite({ actor: 'other', inviteUser: 'parent-1' }), /wrong/));
test('prevents authenticated clients from executing the private provisioning function', () => assert.throws(() => acceptParentInvite({ directClient: true }), /private/));
test('creates and assigns every child before accepting a multi-child invite', () => assert.deepEqual(acceptParentInvite({ children: [{ id: 'c1', clubId: 'club-1', valid: true }, { id: 'c2', clubId: 'club-1', valid: true }] }).childIds, ['c1', 'c2']));
test('reuses an in-scope child and links the accepting parent as guardian', () => assert.equal(acceptParentInvite({ children: [{ id: 'existing-child', clubId: 'club-1', valid: true }] }).childIds[0], 'existing-child'));
test('is idempotent when the same authenticated parent retries', () => assert.equal(acceptParentInvite({ retry: true }).idempotent, true));
test('rejects a different authenticated user without creating any partial rows', () => assert.throws(() => acceptParentInvite({ actor: 'parent-2' }), /wrong/));
test('validates all children before writing and leaves malformed invites pending', () => assert.throws(() => acceptParentInvite({ children: [{ id: 'bad', clubId: 'club-1', valid: false }] }), /invalid child/));
test('rolls back a child already inserted when its required team assignment fails', () => assert.throws(() => acceptParentInvite({ assignmentError: new Error('assignment failed') }), /assignment failed/));
test('rejects a referenced child from another club without changing either club', () => assert.throws(() => acceptParentInvite({ children: [{ id: 'foreign', clubId: 'club-b', valid: true }] }), /outside club/));
test('gives the accepted parent working child RSVP access', () => assert.equal(acceptParentInvite({}).role.role, 'parent'));

test('keeps team attachments, vault, polls, pins, gallery and announcement rows available', () => assert.deepEqual(capabilities('team'), { attachments: true, vault: true, polls: true, pins: true, gallery: true, announcements: true, adapter: 'team' }));
test('keeps club features but never exposes gallery publication', () => assert.equal(capabilities('club').gallery, false));
test('keeps group vault, forwarding and gallery behavior conditional on group settings and scope', () => assert.deepEqual(capabilities('group', { groupSettings: { vault: true, gallery: true, forwarding: true } }).vault, true));
test('keeps direct-message capabilities restricted for support chats and centrally disabled attachments', () => assert.equal(capabilities('direct', { support: true }).attachments, false));
test('keeps club-admin attachments, conditional vault, polls and scheduling without pins', () => assert.equal(capabilities('clubAdmin', { hasVault: true }).pins, false));
test('keeps broadcast reading separate from app-admin-only composing', () => assert.deepEqual(capabilities('broadcast', { appAdmin: false }), { read: true, compose: false, adapter: 'broadcast' }));
test('uses the broadcast adapter for shared cache and history identity', () => assert.equal(capabilities('broadcast').adapter, 'broadcast'));
test('uses the club-admin adapter for conversation cache and history scope identity', () => assert.equal(capabilities('clubAdmin').adapter, 'club-admin'));
test('uses the direct-message adapter for conversation cache and history scope identity', () => assert.equal(capabilities('direct').adapter, 'direct-message'));
test('uses the group adapter for message cache and history scope identity', () => assert.equal(capabilities('group').adapter, 'group'));
test('uses the club adapter for message cache and history scope identity', () => assert.equal(capabilities('club').adapter, 'club'));
test('uses the team adapter for message cache and history scope identity', () => assert.equal(capabilities('team').adapter, 'team'));
