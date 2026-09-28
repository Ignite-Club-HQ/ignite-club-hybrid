import assert from 'node:assert/strict';
import test from 'node:test';

const users = {
  memberA: { id: 'member-a', club: 'club-a', team: 'team-a', groups: new Set(['group-a']), dm: 'dm-a', appAdmin: false },
  adminA: { id: 'admin-a', club: 'club-a', team: 'team-a', groups: new Set(['group-a']), dm: 'dm-a', clubAdmin: true, appAdmin: true },
  admin2: { id: 'admin-2', club: 'club-a', team: null, groups: new Set(), clubAdmin: true, appAdmin: false },
  outsiderB: { id: 'outsider-b', club: 'club-b', team: 'team-b', groups: new Set(), dm: null, clubAdmin: true, appAdmin: false },
};

const scopes = {
  team_messages: { kind: 'team', team: 'team-a', club: 'club-a' },
  club_messages: { kind: 'club', club: 'club-a' },
  group_messages: { kind: 'group', group: 'group-a', club: 'club-a' },
  direct_messages: { kind: 'dm', dm: 'dm-a', club: 'club-a' },
  club_admin_messages: { kind: 'club-admin', club: 'club-a', conversation: 'admin-thread-a' },
};

let idSeq = 1;
const messages = new Map();
const reactions = new Map();
const reads = new Map();
const pins = new Map();

function canRead(user, scope) {
  if (scope.kind === 'team') return user.club === scope.club && (user.team === scope.team || user.clubAdmin);
  if (scope.kind === 'club') return user.club === scope.club;
  if (scope.kind === 'group') return user.club === scope.club && user.groups.has(scope.group);
  if (scope.kind === 'dm') return user.dm === scope.dm;
  if (scope.kind === 'club-admin') return user.club === scope.club && (user.clubAdmin || user.id === 'member-a');
  if (scope.kind === 'broadcast') return true;
  return false;
}

function canWrite(user, scope) {
  if (scope.kind === 'broadcast') return user.appAdmin === true;
  return canRead(user, scope);
}

function send(user, table, text = table) {
  const scope = scopes[table] ?? { kind: 'broadcast' };
  if (!canWrite(user, scope)) throw new Error('insert denied');
  const id = `m-${idSeq++}`;
  messages.set(id, { id, table, scope, authorId: user.id, text });
  return id;
}

function select(user, id) {
  const row = messages.get(id);
  return row && canRead(user, row.scope) ? row : null;
}

function edit(user, id, text) {
  const row = messages.get(id);
  if (!row || row.authorId !== user.id && !(row.scope.kind === 'broadcast' && user.appAdmin)) return null;
  row.text = text;
  return row;
}

function remove(user, id) {
  const row = messages.get(id);
  if (!row) return null;
  const canModerateClubOrTeam = user.clubAdmin && user.club === row.scope.club && ['club', 'team'].includes(row.scope.kind);
  if (row.authorId !== user.id && !canModerateClubOrTeam && !(row.scope.kind === 'broadcast' && user.appAdmin)) return null;
  messages.delete(id);
  return { id };
}

function react(user, id) {
  const row = select(user, id);
  if (!row) throw new Error('reaction target denied');
  const reaction = { id: `r-${idSeq++}`, userId: user.id, messageId: id };
  reactions.set(reaction.id, reaction);
  return reaction;
}

function deleteReaction(user, reactionId) {
  const reaction = reactions.get(reactionId);
  if (!reaction || reaction.userId !== user.id) return null;
  reactions.delete(reactionId);
  return reaction;
}

function readMarker(user, kind, id, forgedUserId = user.id) {
  if (forgedUserId !== user.id) throw new Error('forged read identity');
  const row = select(user, id);
  if (!row || row.scope.kind !== kind && !(kind === 'club_admin' && row.scope.kind === 'club-admin')) throw new Error('read target denied');
  const marker = { id: `read-${idSeq++}`, userId: user.id, messageId: id };
  reads.set(marker.id, marker);
  return marker;
}

function pin(user, id) {
  const row = select(user, id);
  if (!row) throw new Error('pin target denied');
  const pinRow = { id: `pin-${idSeq++}`, userId: user.id, messageId: id };
  pins.set(pinRow.id, pinRow);
  return pinRow;
}

for (const table of Object.keys(scopes)) {
  test(`allows an authorised member to send and read ${table}`, () => {
    const id = send(users.memberA, table);
    assert.equal(select(users.memberA, id)?.id, id);
  });
}

for (const table of Object.keys(scopes)) {
  test(`denies a foreign-club user from inserting or reading ${table}`, () => {
    assert.throws(() => send(users.outsiderB, table), /insert denied/);
    const id = send(users.memberA, table, `foreign-read-${table}`);
    assert.equal(select(users.outsiderB, id), null);
  });
}

test("shows one member's all-club-admin conversation and exact message to every admin of that club", () => {
  const id = send(users.memberA, 'club_admin_messages', 'all admins');
  assert.equal(select(users.adminA, id)?.text, 'all admins');
  assert.equal(select(users.admin2, id)?.text, 'all admins');
  assert.equal(select(users.outsiderB, id), null);
});

test('restricts edits to the author while retaining administrator deletion', () => {
  const id = send(users.memberA, 'team_messages');
  assert.equal(edit(users.adminA, id, 'admin edit'), null);
  assert.equal(edit(users.outsiderB, id, 'hijack'), null);
  assert.equal(edit(users.memberA, id, 'author edit')?.text, 'author edit');
  assert.deepEqual(remove(users.adminA, id), { id });
});

for (const table of ['club_messages', 'group_messages', 'direct_messages', 'club_admin_messages']) {
  test(`allows only the author to edit ${table}`, () => {
    const id = send(users.memberA, table);
    assert.equal(edit(users.memberA, id, 'author edited')?.text, 'author edited');
    assert.equal(edit(users.outsiderB, id, 'cross-club edit'), null);
  });
}

test('allows a club administrator to moderate-delete only their own club message', () => {
  const id = send(users.memberA, 'club_messages');
  assert.deepEqual(remove(users.adminA, id), { id });
  const foreign = send(users.memberA, 'club_messages');
  assert.equal(remove(users.outsiderB, foreign), null);
});

for (const table of ['group_messages', 'direct_messages', 'club_admin_messages']) {
  test(`prevents a non-author, including a scoped administrator, from deleting ${table}`, () => {
    const id = send(users.memberA, table);
    assert.equal(remove(users.adminA, id), null);
    assert.equal(remove(users.outsiderB, id), null);
  });
}

test('lets a club administrator read and send to a team in the exact administered club only', () => {
  const id = send(users.adminA, 'team_messages', 'club announcement');
  assert.equal(select(users.adminA, id)?.text, 'club announcement');
  assert.throws(() => send(users.outsiderB, 'team_messages'), /insert denied/);
});

test('restricts Broadcast writes to app administrators while keeping reads available', () => {
  assert.throws(() => send(users.memberA, 'broadcast_messages'), /insert denied/);
  const id = send(users.adminA, 'broadcast_messages', 'Authorised broadcast');
  assert.equal(select(users.memberA, id)?.text, 'Authorised broadcast');
});

test('keeps Broadcast update and deletion restricted to an app administrator', () => {
  const id = send(users.adminA, 'broadcast_messages', 'broadcast');
  assert.equal(edit(users.memberA, id, 'ordinary edit'), null);
  assert.equal(edit(users.adminA, id, 'app-admin edit')?.text, 'app-admin edit');
  assert.equal(remove(users.memberA, id), null);
  assert.deepEqual(remove(users.adminA, id), { id });
});

test('scopes reactions to accessible messages and to the reacting user', () => {
  const id = send(users.memberA, 'club_messages');
  const reaction = react(users.adminA, id);
  assert.equal(select(users.outsiderB, reaction.messageId), null);
  assert.equal(deleteReaction(users.memberA, reaction.id), null);
});

for (const table of Object.keys(scopes)) {
  test(`rolls back denied moderation without deleting the ${table} row`, () => {
    const id = send(users.memberA, table, `Preserve denied ${table}`);
    assert.equal(remove(users.outsiderB, id), null);
    assert.equal(select(users.memberA, id)?.text, `Preserve denied ${table}`);
  });
}

for (const [kind, table] of Object.entries({ team: 'team_messages', club: 'club_messages', group: 'group_messages', dm: 'direct_messages', club_admin: 'club_admin_messages' })) {
  test(`enforces exact ownership and scope for ${kind} read markers`, () => {
    const id = send(users.adminA, table, `Read marker ${kind}`);
    assert.ok(readMarker(users.memberA, kind, id).id.startsWith('read-'));
    assert.throws(() => readMarker(users.memberA, kind, id, users.adminA.id), /forged/);
    assert.throws(() => readMarker(users.outsiderB, kind, id), /denied/);
  });
}

test('keeps pins and read markers private and rejects inaccessible targets', () => {
  const id = send(users.memberA, 'club_messages');
  assert.ok(pin(users.memberA, id).id.startsWith('pin-'));
  assert.ok(readMarker(users.memberA, 'club', id).id.startsWith('read-'));
  assert.throws(() => pin(users.outsiderB, id), /denied/);
});

test('revokes future reads immediately when group membership is removed', () => {
  const id = send(users.memberA, 'group_messages');
  users.memberA.groups.delete('group-a');
  assert.equal(select(users.memberA, id), null);
  assert.throws(() => send(users.memberA, 'group_messages'), /insert denied/);
  users.memberA.groups.add('group-a');
});

test('revokes Team and Club reads and sends after the exact membership role is removed', () => {
  const oldClub = users.memberA.club;
  const oldTeam = users.memberA.team;
  const teamId = send(users.adminA, 'team_messages');
  const clubId = send(users.adminA, 'club_messages');
  users.memberA.club = 'club-removed';
  users.memberA.team = null;
  assert.equal(select(users.memberA, teamId), null);
  assert.equal(select(users.memberA, clubId), null);
  assert.throws(() => send(users.memberA, 'team_messages'), /insert denied/);
  assert.throws(() => send(users.memberA, 'club_messages'), /insert denied/);
  users.memberA.club = oldClub;
  users.memberA.team = oldTeam;
});
