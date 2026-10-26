import { describe, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ assignments: vi.fn(), scope: vi.fn() }));
vi.mock('@/live/contentRouting', () => ({ readContentInScope: async (ctx: unknown, feature: string, scope: unknown, call: (ctx: unknown) => unknown) => {
  m.scope(feature, scope); return call(ctx);
} }));
vi.mock('@/live/features/events', () => ({ listLiveChildTeamAssignments: m.assignments }));
import { readTeamChildRows, teamRoleRows } from './teamRosterReads';
import type { FeatureBackendContext } from '@/live/featureRouter';
describe('independent team membership reads', () => {
  it('returns authorized children without requiring adult profiles or private keys', async () => {
    m.assignments.mockResolvedValueOnce([{ child_id: 'child-9' }]);
    const ctx = {} as FeatureBackendContext;
    const rows = await readTeamChildRows(ctx, 'club-2', 'team-9');
    expect(m.scope).toHaveBeenCalledWith('events', { clubId: 'club-2' });
    expect(m.assignments).toHaveBeenCalledWith(ctx, 'club-2', 'team-9');
    expect(rows.map(row => row.child_id)).toEqual(['child-9']);
  });
  it('preserves denied child reads rather than certifying an empty roster', async () => {
    m.assignments.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(readTeamChildRows({} as FeatureBackendContext, 'club-2', 'team-9')).rejects.toThrow('Forbidden');
  });
  it('normalizes principal roles immediately without any profile lookup', () => {
    expect(teamRoleRows([{ account_id: 'principal:abc', role: 'coach' }, { account_id: 'uuid', role: 'parent' }]))
      .toEqual([{ id: 'abc:coach', user_id: 'abc', role: 'coach', profiles: null }, { id: 'uuid:parent', user_id: 'uuid', role: 'parent', profiles: null }]);
  });
});