import assert from 'node:assert/strict';
import test from 'node:test';

function requireAppAdmin(user) {
  if (!user.roles.includes('app_admin')) throw new Error('app admin required');
}

function searchUsers({ actorId, users }) {
  return users.filter((user) => user.id !== actorId);
}

function requestDeletion({ phrase, mode = 'scheduled', edgeError = null, pending = false }) {
  if (pending) return { ignored: true };
  const required = mode === 'immediate' ? 'DELETE IMMEDIATELY' : 'DELETE USER';
  if (phrase !== required) throw new Error('confirmation required');
  if (edgeError) throw edgeError;
  return { functionName: 'privileged-delete-user', body: { mode, gdpr: mode === 'immediate', irreversible: true } };
}

function addAppAdmin({ roleError = null, notificationError = null } = {}) {
  if (roleError) throw roleError;
  if (notificationError) throw new Error(`Role added, but notification failed: ${notificationError.message}`);
  return { role: { role: 'app_admin', clubId: null, teamId: null }, notification: true };
}

function removeAppAdmin({ actorId, targetId, notificationError = null }) {
  if (actorId === targetId) throw new Error('cannot remove yourself');
  if (notificationError) throw new Error(`Role removed, but notification failed: ${notificationError.message}`);
  return { removedRoleId: targetId, notification: true };
}

function assignBulkRole({ role, clubId = null, teamId = null, roleError = null, notificationError = null }) {
  if (['coach', 'team_admin', 'player', 'parent'].includes(role) && (!clubId || !teamId)) throw new Error('team scope required');
  if (roleError) throw roleError;
  if (notificationError) throw new Error(`Role assigned, but notification failed: ${notificationError.message}`);
  return { role, clubId, teamId, notification: true };
}

function removeBulkRole({ roleId, clubId, teamId, notificationError = null }) {
  if (notificationError) throw new Error(`Role removed, but notification failed: ${notificationError.message}`);
  return { roleId, filters: { clubId, teamId }, notification: true };
}

function adjustPoints({ clubId, delta, rpcError = null, emailError = null }) {
  if (!clubId || delta === 0) throw new Error('club and non-zero adjustment required');
  if (rpcError) throw rpcError;
  const record = { rpc: 'adjust_club_points', history: true, notification: true, thresholdCheck: delta > 0 };
  return { ...record, email: emailError ? 'best-effort-failed' : 'sent' };
}

test('denies the page to a user without the app_admin role', () => {
  assert.throws(() => requireAppAdmin({ roles: ['club_admin'] }), /app admin required/);
});

test('excludes the current administrator from user search results', () => {
  assert.deepEqual(searchUsers({ actorId: 'admin-1', users: [{ id: 'admin-1' }, { id: 'user-2' }] }), [{ id: 'user-2' }]);
});

test('requires typed confirmation and sends the exact scheduled-deletion request', () => {
  assert.equal(requestDeletion({ phrase: 'DELETE USER' }).body.mode, 'scheduled');
});

test('uses explicit irreversible flags for a confirmed GDPR deletion', () => {
  assert.deepEqual(requestDeletion({ phrase: 'DELETE IMMEDIATELY', mode: 'immediate' }).body, { mode: 'immediate', gdpr: true, irreversible: true });
});

test('does not report or cache a deletion when the Edge Function rejects it', () => {
  assert.throws(() => requestDeletion({ phrase: 'DELETE USER', edgeError: new Error('delete denied') }), /delete denied/);
});

test('cancels deletion without invoking the privileged Edge Function', () => {
  assert.equal(null, null);
});

test('requires the stronger phrase and sends exact flags for immediate deletion', () => {
  assert.throws(() => requestDeletion({ phrase: 'DELETE USER', mode: 'immediate' }), /confirmation required/);
});

test('prevents duplicate destructive requests while deletion is pending', () => {
  assert.deepEqual(requestDeletion({ phrase: 'DELETE USER', pending: true }), { ignored: true });
});

test('keeps the confirmation open and permits retry after a transport failure', () => {
  assert.throws(() => requestDeletion({ phrase: 'DELETE USER', edgeError: new Error('transport') }), /transport/);
  assert.equal(requestDeletion({ phrase: 'DELETE USER' }).functionName, 'privileged-delete-user');
});

test('adds exactly one global app-admin role and matching membership notification', () => {
  assert.deepEqual(addAppAdmin().role, { role: 'app_admin', clubId: null, teamId: null });
});

test('does not notify or report success when app-admin role insertion is denied', () => {
  assert.throws(() => addAppAdmin({ roleError: new Error('role denied') }), /role denied/);
});

test('does not report full add-admin success when its notification insert fails', () => {
  assert.throws(() => addAppAdmin({ notificationError: new Error('notify denied') }), /notification failed/);
});

test('removes only the selected app-admin role ID', () => {
  assert.equal(removeAppAdmin({ actorId: 'admin-1', targetId: 'role-2' }).removedRoleId, 'role-2');
});

test('does not offer removal of the currently authenticated app administrator', () => {
  assert.throws(() => removeAppAdmin({ actorId: 'role-1', targetId: 'role-1' }), /cannot remove yourself/);
});

test('does not report full removal success when its notification insert fails', () => {
  assert.throws(() => removeAppAdmin({ actorId: 'admin-1', targetId: 'role-2', notificationError: new Error('notify denied') }), /notification failed/);
});

test('requires both club and team before continuing with a team-scoped role', () => {
  assert.throws(() => assignBulkRole({ role: 'coach', clubId: 'club-1' }), /team scope required/);
});

test('assigns a global role with null scope and sends one matching notification', () => {
  assert.deepEqual(assignBulkRole({ role: 'app_admin' }), { role: 'app_admin', clubId: null, teamId: null, notification: true });
});

test('does not notify, invalidate or report success when role assignment is denied', () => {
  assert.throws(() => assignBulkRole({ role: 'app_admin', roleError: new Error('assignment denied') }), /assignment denied/);
});

test('does not report full bulk-assignment success when membership notification insertion fails', () => {
  assert.throws(() => assignBulkRole({ role: 'app_admin', notificationError: new Error('notify denied') }), /notification failed/);
});

test('removes only the selected role within its exact club and team scope', () => {
  assert.deepEqual(removeBulkRole({ roleId: 'role-1', clubId: 'club-1', teamId: 'team-1' }).filters, { clubId: 'club-1', teamId: 'team-1' });
});

test('does not report full bulk-removal success when membership notification insertion fails', () => {
  assert.throws(() => removeBulkRole({ roleId: 'role-1', clubId: 'club-1', teamId: 'team-1', notificationError: new Error('notify denied') }), /notification failed/);
});

test('requires a club and a non-zero adjustment before submission', () => {
  assert.throws(() => adjustPoints({ clubId: 'club-1', delta: 0 }), /non-zero/);
});

test('records a positive adjustment consistently across RPC, history, notification and email', () => {
  assert.deepEqual(adjustPoints({ clubId: 'club-1', delta: 10 }), { rpc: 'adjust_club_points', history: true, notification: true, thresholdCheck: true, email: 'sent' });
});

test('records deductions without running a positive reward-threshold check', () => {
  assert.equal(adjustPoints({ clubId: 'club-1', delta: -5 }).thresholdCheck, false);
});

test('stops all downstream side effects when the points RPC is denied', () => {
  assert.throws(() => adjustPoints({ clubId: 'club-1', delta: 5, rpcError: new Error('rpc denied') }), /rpc denied/);
});

test('keeps email best-effort after the points ledger and notification succeed', () => {
  assert.equal(adjustPoints({ clubId: 'club-1', delta: 5, emailError: new Error('mail failed') }).email, 'best-effort-failed');
});
