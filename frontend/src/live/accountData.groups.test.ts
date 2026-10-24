import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Identity } from '@icp-sdk/core/agent';
import type { IcpTargetConfig } from './targetRegistry';
const state = vi.hoisted(() => ({ active: true, registry: vi.fn(), dispose: vi.fn(), erase: vi.fn(),
  revoke: vi.fn(), purge: vi.fn(), validate: vi.fn(), order: [] as string[], targets: [] as unknown[] }));
vi.mock('./groupActivation', () => ({ SHIPPED_GATES: {}, activationStatus: () => ({ active: state.active }) }));
vi.mock('./generalActivation', () => ({ routingActive: async () => state.active, generalRoutingStatus: async () => ({ active: state.active, missing: [] }), cachedGeneralRoutingActive: () => state.active, clearGeneralRoutingCache: () => {} }));
vi.mock('./groupSessionLive', () => ({ openLiveGroupReadSession: async () => {
  const targets = await state.registry();
  return { dispose: state.dispose, readEveryGroup: async () => targets, assertRegistryUnchanged: state.validate };
} }));
vi.mock('./identityAccess', () => ({ isLiveIdentityAccessConfigured: () => true,
  connectLiveIdentityAccessClientWithIdentity: async () => ({ client: {
    whoami: async () => ({ id: 'own-account' }), eraseAccount: state.erase, dispose: vi.fn(),
  } }),
}));
vi.mock('./domains', () => {
  const connect = (domain: string) => async (target: IcpTargetConfig) => ({ actor: {
    erase_my_membership: () => state.revoke(target.canisterIds[domain]),
    purge_my_data: () => state.purge(domain, target.canisterIds[domain]),
    prepare_my_broadcast_erasure: async () => ({ Ok: null }),
    check_my_broadcast_erasure: async () => ({ Ok: null }),
    purge_my_broadcast_data: async () => ({ Ok: 0 }),
  } });
  return { connectLiveClubDomain: connect('club_domain'), connectLiveVaultDomain: connect('vault_domain'),
    connectLiveEventsDomain: connect('events_domain'), connectLiveMessagingDomain: connect('messaging_domain'), connectLiveCompetitionDomain: connect('competition_domain'), connectLiveNotificationQueue: connect('notification_queue') };
});
import { eraseMyIcpAccount } from './accountData';
const target = (prefix: string) => ({ alias: 'mainnet', host: 'https://icp-api.io', networkKind: 'public_mainnet',
  canisterIds: Object.fromEntries(['club_domain', 'vault_domain', 'events_domain', 'messaging_domain', 'competition_domain', 'notification_queue'].map(d => [d, `${prefix}-${d}`])) }) as IcpTargetConfig;
const identity = {} as Identity;
beforeEach(() => {
  vi.clearAllMocks(); state.active = true; state.order = [];
  state.validate.mockResolvedValue(undefined);
  state.registry.mockResolvedValue([target('a'), target('b')]);
  state.revoke.mockImplementation(async id => { state.order.push(`revoke:${id}`); return { Ok: null }; });
  state.purge.mockImplementation(async (domain, id) => { state.order.push(`purge:${id}`); return { Ok: 1 }; });
  state.erase.mockImplementation(async () => { state.order.push('erase-identity'); });
});
describe('account erasure across all registered groups', () => {
  it('revokes every authority before purging and erases the shared identity last', async () => {
    await eraseMyIcpAccount(identity, target('shared'));
    expect(state.revoke.mock.calls.map(c => c[0])).toEqual(['shared-club_domain', 'a-club_domain', 'b-club_domain']);
    expect(state.purge).toHaveBeenCalledTimes(15);
    expect(state.order.slice(0, 3)).toEqual(['revoke:shared-club_domain', 'revoke:a-club_domain', 'revoke:b-club_domain']);
    expect(state.order.at(-1)).toBe('erase-identity');
    expect(state.dispose).toHaveBeenCalledTimes(1);
  });
  it('performs no destructive action when registry discovery fails', async () => {
    state.registry.mockRejectedValue(new Error('Group unavailable'));
    await expect(eraseMyIcpAccount(identity, target('shared'))).rejects.toThrow('Group unavailable');
    expect(state.revoke).not.toHaveBeenCalled(); expect(state.erase).not.toHaveBeenCalled();
  });
  it('validates missing group participants before removing any membership', async () => {
    const incomplete = target('b'); delete incomplete.canisterIds.vault_domain;
    state.registry.mockResolvedValue([incomplete]);
    await expect(eraseMyIcpAccount(identity, target('shared'))).rejects.toThrow('requires vault_domain');
    expect(state.revoke).not.toHaveBeenCalled(); expect(state.erase).not.toHaveBeenCalled();
  });
  it('preserves identity and skips purges if any group refuses membership removal', async () => {
    state.revoke.mockResolvedValueOnce({ Ok: null }).mockResolvedValueOnce({ Err: 'Removal denied' });
    await expect(eraseMyIcpAccount(identity, target('shared'))).rejects.toThrow('Removal denied');
    expect(state.purge).not.toHaveBeenCalled(); expect(state.erase).not.toHaveBeenCalled();
  });
  it('calls shared authorities only once when also present in the group registry', async () => {
    state.registry.mockResolvedValue([target('shared'), target('b')]);
    await eraseMyIcpAccount(identity, target('shared'));
    expect(state.revoke).toHaveBeenCalledTimes(2); expect(state.purge).toHaveBeenCalledTimes(10);
  });
  it('continues other purges but retains identity when one group cleanup fails', async () => {
    state.purge.mockImplementation(async (domain, id) => {
      if (id === 'b-messaging_domain') return { Err: 'Busy' }; return { Ok: 1 };
    });
    await expect(eraseMyIcpAccount(identity, target('shared'))).rejects.toThrow('Account deletion is incomplete: messaging');
    expect(state.purge).toHaveBeenCalledTimes(15); expect(state.erase).not.toHaveBeenCalled();
    expect(state.dispose).toHaveBeenCalledTimes(1);
  });
  it('does not query group discovery while scaling is off', async () => {
    state.active = false;
    await eraseMyIcpAccount(identity, target('shared'));
    expect(state.registry).not.toHaveBeenCalled(); expect(state.revoke).toHaveBeenCalledTimes(1);
  });
  it('stops shared erasure on registry drift during a tolerated content purge', async () => {
    state.purge.mockImplementation(async () => {
      state.validate.mockRejectedValue(new Error('Group registry changed'));
      return { Ok: 1 };
    });
    await expect(eraseMyIcpAccount(identity, target('shared'))).rejects.toThrow('registry changed');
    expect(state.erase).not.toHaveBeenCalled(); expect(state.dispose).toHaveBeenCalledOnce();
  });
});