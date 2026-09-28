import { Ed25519KeyIdentity } from '@icp-sdk/core/identity';
import { AnonymousIdentity } from '@icp-sdk/core/agent';

// PUBLIC TEST SEEDS. Anyone can impersonate these personas. Local synthetic data ONLY.
// No production login, credential persistence, OAuth, or Internet Identity connection.
export const personas = ['governor', 'club_admin', 'app_admin', 'member', 'team_member', 'parent', 'guardian', 'excluded_member', 'excluded_admin', 'outsider', 'other_admin', 'identity-link-target', 'anonymous'];
export function syntheticIdentity(name) {
  const index = personas.indexOf(name);
  if (index < 0) throw new Error('Unknown synthetic identity');
  return name === 'anonymous' ? new AnonymousIdentity() : Ed25519KeyIdentity.generate(new Uint8Array(32).fill(index + 1));
}
export const CLUB_A = '00000000-0000-4000-8000-000000000001';
export const CLUB_B = '00000000-0000-4000-8000-000000000002';
export function syntheticAcl() {
  const team = '00000000-0000-4000-8000-000000000003';
  const child = '00000000-0000-4000-8000-000000000004';
  const user = name => syntheticIdentity(name).getPrincipal();
  const role = (name, role, club = CLUB_A, team = null) => ({ user: user(name), role, club: club ? [club] : [], team: team ? [team] : [] });
  return {
    clubs: [CLUB_A, CLUB_B], teams: [{ id: team, club: CLUB_A }],
    roles: [role('club_admin','club_admin'), role('app_admin','app_admin',null), role('member','player'), role('team_member','coach',null,team), role('excluded_member','player'), role('excluded_admin','club_admin'), role('other_admin','club_admin',CLUB_B)],
    children: [{ id: child, parent: [user('parent')], teams: [team] }],
    guardians: [{ child, user: user('guardian') }],
    exclusions: [{ user: user('excluded_member'), club: CLUB_A }, { user: user('excluded_admin'), club: CLUB_A }],
  };
}
