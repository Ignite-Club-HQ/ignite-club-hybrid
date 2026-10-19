import { describe, expect, it } from 'vitest';
import { mergeMemberships } from './membershipMerge';

describe('membership discovery merge', () => {
  it('retains both groups and removes duplicate grants and team ids', () => {
    const a = { roles: [{ role: 'parent', club_id: 'a', team_id: 't1' }], teamIds: ['t1'], clubIds: ['a'],
      clubAdminClubIds: [], leagueAdminClubIds: [], miniLeagueIds: ['l1'], isAppAdmin: false };
    const b = { ...a, roles: [...a.roles, { role: 'coach', club_id: 'b', team_id: 't2' }],
      teamIds: ['t1', 't2'], clubIds: ['b'], clubAdminClubIds: ['b'], miniLeagueIds: ['l2'], isAppAdmin: true };
    expect(mergeMemberships([a, b])).toEqual({ roles: b.roles, teamIds: ['t1', 't2'], clubIds: ['a', 'b'],
      clubAdminClubIds: ['b'], leagueAdminClubIds: [], miniLeagueIds: ['l1', 'l2'], isAppAdmin: true });
  });
  it('refuses missing discovery results', () => {
    expect(() => mergeMemberships([])).toThrow('no results');
  });
});