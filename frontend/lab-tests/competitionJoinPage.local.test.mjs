import assert from 'node:assert/strict';
import test from 'node:test';

function tokenStatus(token, status = 'valid') {
  if (!token) return { screen: 'missing token', backendCalls: 0 };
  if (status === 'disabled') return { screen: 'organiser has disabled this join link', backendCalls: 1 };
  if (status === 'archived') return { screen: 'competition has been archived', backendCalls: 1 };
  if (status === 'unknown') return { screen: "join link isn't recognised", backendCalls: 1 };
  return { screen: 'join competition', backendCalls: 1 };
}

function authRedirect(token) {
  const next = `/competitions/join?token=${token}`;
  return { sessionStorage: next, url: `/auth?mode=signup&next=${encodeURIComponent(next)}&redirect=${encodeURIComponent(next)}` };
}

function eligibleTeams(userId, roles) {
  return roles.filter((role) => role.user_id === userId && ['team_admin', 'coach'].includes(role.role)).map((role) => role.team_id);
}

function joinCompetition({ token, teamId, divisionId = null, entered = [], error = null }) {
  if (entered.some((entry) => entry.team_id === teamId && entry.status === 'accepted')) return { alreadyEntered: true };
  if (error) {
    const messages = {
      not_team_admin: "You don't have admin rights for that team.",
      invalid_token: 'This join link is no longer valid.',
      team_not_found: 'That team could not be found.',
      auth_required: 'Please sign in first.',
    };
    throw new Error(messages[error] ?? error);
  }
  return { rpc: 'join_competition_with_token', args: { p_token: token, p_team_id: teamId, p_division_id: divisionId } };
}

test('rejects a missing token without making any backend request', () => assert.deepEqual(tokenStatus(''), { screen: 'missing token', backendCalls: 0 }));
test('shows a safe explanation for a disabled token', () => assert.match(tokenStatus('join-token', 'disabled').screen, /disabled/));
test('shows a safe explanation for an archived token', () => assert.match(tokenStatus('join-token', 'archived').screen, /archived/));
test('shows a safe explanation for an unknown token', () => assert.match(tokenStatus('join-token', 'unknown').screen, /recognised/));
test('preserves the join URL and sends a signed-out visitor to authentication', () => {
  const redirect = authRedirect('join-token');
  assert.equal(redirect.sessionStorage, '/competitions/join?token=join-token');
  assert.match(redirect.url, /^\/auth\?mode=signup/);
});
test('loads only teams administered by the signed-in user', () => assert.deepEqual(eligibleTeams('user-1', [{ user_id: 'user-1', role: 'team_admin', team_id: 'team-1' }, { user_id: 'user-2', role: 'team_admin', team_id: 'team-2' }]), ['team-1']));
test('auto-selects the sole eligible team and joins with a null division', () => assert.deepEqual(joinCompetition({ token: 'join-token', teamId: 'team-1' }).args, { p_token: 'join-token', p_team_id: 'team-1', p_division_id: null }));
test('does not offer another mutation when every administered team is already entered', () => assert.deepEqual(joinCompetition({ token: 'join-token', teamId: 'team-1', entered: [{ team_id: 'team-1', status: 'accepted' }] }), { alreadyEntered: true }));
test('does not treat a rejected or removed entry as currently entered', () => assert.equal(joinCompetition({ token: 'join-token', teamId: 'team-1', entered: [{ team_id: 'team-1', status: 'rejected' }, { team_id: 'team-1', status: 'removed' }] }).rpc, 'join_competition_with_token'));
test('maps the not_team_admin mutation failure to an actionable message', () => assert.throws(() => joinCompetition({ token: 'join-token', teamId: 'team-1', error: 'not_team_admin' }), /admin rights/));
test('maps the invalid_token mutation failure to an actionable message', () => assert.throws(() => joinCompetition({ token: 'join-token', teamId: 'team-1', error: 'invalid_token' }), /no longer valid/));
test('maps the team_not_found mutation failure to an actionable message', () => assert.throws(() => joinCompetition({ token: 'join-token', teamId: 'team-1', error: 'team_not_found' }), /could not be found/));
test('maps the auth_required mutation failure to an actionable message', () => assert.throws(() => joinCompetition({ token: 'join-token', teamId: 'team-1', error: 'auth_required' }), /sign in/));
