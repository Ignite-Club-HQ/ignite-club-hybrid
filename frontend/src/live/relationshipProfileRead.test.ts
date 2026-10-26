import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import type { FeatureBackendContext } from './featureRouter';
const state = vi.hoisted(() => ({ read: vi.fn(), evidence: vi.fn(), resolver: vi.fn(), rehearsal: true, shared: undefined as unknown }));
vi.mock('./featureRouter', () => ({ withFeatureBackend: async (_feature: string, providers: any) => providers.icp(state.shared) }));
vi.mock('./privateProfileSearchMode', () => ({ privateProfileSearchRehearsalEnabled: () => state.rehearsal }));
vi.mock('./features/identityAccessClient', () => ({ listLiveProfilesByIds: state.read }));
vi.mock('./privateProfileEvidence', () => ({ readPrivateProfileEvidence: state.evidence }));
vi.mock('./privateProfileAuthority', () => ({ createLivePrivateProfileAuthorityResolver: () => state.resolver }));
import { readRelationshipProfiles } from './relationshipProfileRead';
const identity = { getPrincipal: () => Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai') };
function context() {
  return { identity, target: { alias: 'g2', host: 'https://icp-api.io', networkKind: 'public_mainnet', canisterIds: {
    club_domain: 'ryjl3-tyaaa-aaaaa-aaaba-cai', competition_domain: 'r7inp-6aaaa-aaaaa-aaabq-cai', mini_league_domain: 'renrk-eyaaa-aaaaa-aaada-cai', messaging_domain: 'rkp4c-7iaaa-aaaaa-aaaca-cai',
  } } } as unknown as FeatureBackendContext;
}
beforeEach(() => { vi.resetAllMocks(); state.rehearsal = true; state.shared = context(); state.read.mockResolvedValue([]); });
describe('relationship-scoped private display reads', () => {
  it.each(['club', 'family', 'competition', 'league', 'direct', 'broadcast', 'competition_admin'] as const)('threads exact %s authority without creating grants', async kind => {
    const ctx = context();
    await readRelationshipProfiles(ctx, ['person'], { kind, resource: 'exact-resource' });
    const options = state.read.mock.calls[0][2];
    const domain = kind === 'competition' ? 'competition_domain' : kind === 'league' ? 'mini_league_domain' : ['direct', 'broadcast', 'competition_admin'].includes(kind) ? 'messaging_domain' : 'club_domain';
    expect(options.audience).toEqual({ kind, resource: 'exact-resource', authority: Principal.fromText(ctx.target.canisterIds[domain]), profile_revision: 0n });
    expect(state.evidence).not.toHaveBeenCalled();
  });
  it('requires independent original-authority evidence before resolving an encrypted name', async () => {
    state.read.mockImplementation(async (_ctx, _ids, options) => { await options.resolveAuthority('original'); return []; });
    await expect(readRelationshipProfiles(context(), ['person'], { kind: 'family', resource: 'child' })).rejects.toThrow('deployment evidence');
    expect(state.resolver).not.toHaveBeenCalled();
  });
  it('rejects owner target replacement during a shared read', async () => {
    const ctx = context();
    state.read.mockImplementation(async () => { ctx.target.alias = 'foreign'; return []; });
    await expect(readRelationshipProfiles(ctx, ['person'], { kind: 'league', resource: 'league' })).rejects.toThrow('changed');
  });
  it('refuses a suspended audience instead of returning a certified empty list', async () => {
    state.read.mockRejectedValue(new Error('Private-name relationship denied'));
    await expect(readRelationshipProfiles(context(), ['person'], { kind: 'competition', resource: 'cup' })).rejects.toThrow('denied');
  });
  it('preserves the hosted legacy read while rehearsal is off', async () => {
    state.rehearsal = false;
    await readRelationshipProfiles(context(), ['person'], { kind: 'club', resource: 'club' });
    expect(state.read).toHaveBeenCalledWith(state.shared, ['person']);
    expect(state.evidence).not.toHaveBeenCalled();
  });
});