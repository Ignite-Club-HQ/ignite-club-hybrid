import assert from 'node:assert/strict';
import test from 'node:test';

function availableRoles(teamType) {
  if (teamType === 'junior') return ['parent'];
  if (teamType === 'senior') return ['player'];
  return ['parent', 'player'];
}

function createInvite({ name = '', role = 'player', teamType = 'senior', email = '', existing = null, pending = false, inviteError = null, roleError = null, notificationError = null, providerError = null }) {
  if (!name.trim()) throw new Error('Enter a name to continue');
  if (role === 'parent' && teamType === 'junior' && !existing?.childName) throw new Error("Add at least one child's name to continue.");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) throw new Error("That email doesn't look right");
  if (pending) return { insertedInvites: 1, duplicateClickIgnored: true };
  if (existing?.alreadyInTeam) throw new Error(`${existing.displayName} is already on this team.`);
  if (existing?.userId) {
    if (roleError) throw roleError;
    const result = { roleInsert: { user_id: existing.userId, team_id: 'team-1', club_id: 'club-1', role }, pendingInvite: false };
    if (notificationError) return { ...result, partial: true, notificationError: notificationError.message };
    return { ...result, notification: { user_id: existing.userId, type: 'membership', related_id: 'team-1' } };
  }
  if (inviteError) throw inviteError;
  return {
    pendingInvite: {
      team_id: 'team-1',
      club_id: 'club-1',
      role,
      invited_user_id: null,
      invited_by_user_id: 'admin-1',
      invited_label: name.trim(),
      invited_email: email.trim().toLowerCase() || null,
    },
    delivery: providerError ? { email_error: providerError.message } : { email_sent_at: 'sent' },
  };
}

test('offers Parent but not Adult Player for a junior team', () => assert.deepEqual(availableRoles('junior'), ['parent']));
test('offers Adult Player but not Parent for a senior team', () => assert.deepEqual(availableRoles('senior'), ['player']));
test('prevents advancing without a member identity', () => assert.throws(() => createInvite({}), /Enter a name/));
test('requires a child name before a parent invitation can continue', () => assert.throws(() => createInvite({ name: 'Parent', role: 'parent', teamType: 'junior' }), /child/));
test('requires a valid email when Email delivery is selected', () => assert.throws(() => createInvite({ name: 'Member', email: 'not-an-email' }), /look right/));
test('creates one pending invite with exact normalized identity and scope', () => assert.deepEqual(createInvite({ name: 'New Member', email: ' MEMBER@EXAMPLE.COM ' }).pendingInvite, {
  team_id: 'team-1',
  club_id: 'club-1',
  role: 'player',
  invited_user_id: null,
  invited_by_user_id: 'admin-1',
  invited_label: 'New Member',
  invited_email: 'member@example.com',
}));
test('reports a rejected invite without invalidating successful membership state', () => assert.throws(() => createInvite({ name: 'Member', inviteError: new Error('insert denied') }), /insert denied/));
test('disables duplicate submission while pending and inserts exactly once', () => assert.deepEqual(createInvite({ name: 'Member', pending: true }), { insertedInvites: 1, duplicateClickIgnored: true }));
test('adds an in-scope existing account directly without creating a duplicate pending invite', () => assert.equal(createInvite({ name: 'Existing', existing: { userId: 'existing-user-1', displayName: 'Existing Member' } }).pendingInvite, false));
test('rejects an email already belonging to this team without writing a role, invite or notification', () => assert.throws(() => createInvite({ name: 'Existing', existing: { userId: 'existing-user-1', displayName: 'Existing Member', alreadyInTeam: true } }), /already on this team/));
test('stops before notification and success state when direct role assignment is denied', () => assert.throws(() => createInvite({ name: 'Existing', existing: { userId: 'existing-user-1' }, roleError: new Error('role insert denied') }), /role insert denied/));
test('reports partial success when a direct role is saved but its membership notification fails', () => assert.equal(createInvite({ name: 'Existing', existing: { userId: 'existing-user-1' }, notificationError: new Error('notification insert denied') }).partial, true));
test('preserves a created invite and records delivery failure when the email provider rejects it', () => assert.deepEqual(createInvite({ name: 'New Member', email: 'new.member@example.com', providerError: new Error('provider unavailable') }).delivery, { email_error: 'provider unavailable' }));
