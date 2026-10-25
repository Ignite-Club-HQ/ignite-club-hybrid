import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn(), label: vi.fn(), scope: vi.fn(), oldRead: vi.fn() }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: async (_: string, branches: any, scope: unknown) => {
  mocks.scope(scope);
  return branches.icp({ target: {}, identity: {} });
} }));
vi.mock('@/live/features/club', () => ({ listLivePendingInvitesByClub: mocks.list, getLivePendingInviteLabel: mocks.label }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.oldRead } }));
import { readIcpTeamPendingInvites } from './teamPendingInvites';

describe('team pending invitation reads', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.label.mockResolvedValue(['Alex']); });
  it('retains pending and resent exact-team invitations without reading old email data', async () => {
    mocks.list.mockResolvedValue(['pending', 'resent', 'accepted', 'revoked'].map((status, i) => ({
      id: String(i), team_id: ['hawks'], role: ['parent'], status, created_at_ms: 1000n, email: 'do-not-display@example.invalid',
    })).concat([{ id: 'other', team_id: ['other-team'], role: ['coach'], status: 'pending', created_at_ms: 1000n }]));
    const rows = await readIcpTeamPendingInvites('club', 'hawks');
    expect(rows.map(row => row.id)).toEqual(['0', '1']);
    expect(rows[0]).toMatchObject({ invited_label: 'Alex', role: 'parent', status: 'pending' });
    expect(rows[0]).not.toHaveProperty('invited_email');
    expect(mocks.scope).toHaveBeenCalledWith({ clubId: 'club' });
    expect(mocks.oldRead).not.toHaveBeenCalled();
  });
  it('propagates authorization failures rather than reporting no invitations', async () => {
    mocks.list.mockRejectedValue(new Error('Invite manager required'));
    await expect(readIcpTeamPendingInvites('club', 'hawks')).rejects.toThrow('Invite manager required');
    expect(mocks.label).not.toHaveBeenCalled();
  });
});