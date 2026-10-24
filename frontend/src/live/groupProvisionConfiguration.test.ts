import { describe, expect, it, vi } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { configureProvisionGroup, groupConfigurationPlan } from './groupProvisionConfiguration';
import { PER_GROUP_DOMAINS, runProvision, type Provision, type ProvisionAdapter } from './groupProvisioner';

const id = (n: number) => Principal.fromUint8Array(Uint8Array.from([n, 1])).toText();
const globals = { identityAccess: id(90), pushWorker: id(91), mediaBlobStore: id(96) };
const initial = (): Provision => ({ id: 'p', groupId: 'new', deploymentId: 'local', subnetId: id(80), phase: 'installed', expectedRevision: 1n,
  canisters: Object.fromEntries(PER_GROUP_DOMAINS.map((d, i) => [d, id(i + 1)])), installedDomains: [...PER_GROUP_DOMAINS] });
const world = () => {
  let saved = initial();
  const checkpoint = async (p: Provision) => { saved = structuredClone(p); };
  const transport = { verifyGovernor: vi.fn(async () => {}), call: vi.fn(async () => ({ Ok: null })) };
  return { saved: () => saved, checkpoint, transport };
};

describe('closed-group reciprocal configuration', () => {
  it('every planned setting has the exact update signature in current domain contracts', async () => {
    const contracts = import.meta.glob('../lab/bindings/*/declarations/*.did.js');
    for (const operation of groupConfigurationPlan(initial(), globals)) {
      const load = contracts[`../lab/bindings/${operation.domain}/declarations/${operation.domain}.did.js`];
      if (!load) throw new Error(`Missing contract ${operation.domain}`);
      const module = await load() as { idlFactory(input: { IDL: typeof IDL }): IDL.ServiceClass };
      const method = module.idlFactory({ IDL })._fields.find(([name]) => name === operation.method)?.[1];
      if (!method) throw new Error(`Missing method ${operation.domain}.${operation.method}`);
      expect(method.annotations).not.toContain('query');
      expect(() => IDL.encode(method.argTypes, operation.args)).not.toThrow();
    }
  });
  it('wires club/chat/PII/competition/league and queue ownership without prototype identity admission', async () => {
    const p = initial(), plan = groupConfigurationPlan(p, globals);
    const find = (domain: string, method: string) => plan.find(op => op.domain === domain && op.method === method);
    expect(find('messaging_domain', 'set_club_domain_canister')?.args[0]).toEqual(Principal.fromText(p.canisters.club_domain ?? ''));
    expect(find('notification_queue', 'set_messaging_domain_canister')?.args[0]).toEqual(Principal.fromText(p.canisters.messaging_domain ?? ''));
    expect(find('notification_queue', 'set_identity_access_canister')?.args[0]).toEqual(Principal.fromText(globals.identityAccess));
    expect(find('notification_queue', 'grant_worker')?.args[0]).toEqual(Principal.fromText(globals.pushWorker));
    expect(find('media_blob_store', 'set_club_domain_canister')?.args[0]).toEqual(Principal.fromText(p.canisters.club_domain ?? ''));
    expect(find('club_domain', 'register_media_quota_store')?.args[0]).toEqual(Principal.fromText(globals.mediaBlobStore));
    expect(find('media_metadata', 'set_gallery_authorities')?.args).toEqual([Principal.fromText(p.canisters.club_domain ?? ''), Principal.fromText(p.canisters.vault_domain ?? '')]);
    expect(find('vault_domain', 'set_gallery_media_authority')?.args[0]).toEqual(Principal.fromText(p.canisters.media_metadata ?? ''));
    expect(find('timer_jobs', 'grant_worker')?.args[0]).toEqual(Principal.fromText(globals.pushWorker));
    expect(find('competition_domain', 'set_participant_club_authorities')?.args[0]).toEqual([Principal.fromText(p.canisters.club_domain ?? '')]);
    expect(plan.some(op => op.method === 'set_identity_authority' || op.method === 'set_account_authorities')).toBe(false);
  });
  it('persists each mutation intent then receipt and does not repeat acknowledged configuration', async () => {
    const w = world();
    w.transport.call = vi.fn(async (_id, method) => {
      expect(w.saved().pending?.kind).toBe('configure');
      expect(w.saved().pending?.operation).toContain(method);
      return { Ok: null };
    });
    await configureProvisionGroup(initial(), w.checkpoint, w.transport, id(92), globals);
    const count = groupConfigurationPlan(initial(), globals).length;
    expect(w.transport.call).toHaveBeenCalledTimes(count);
    expect(w.saved().configuration?.completed).toHaveLength(count);
    await configureProvisionGroup(w.saved(), w.checkpoint, w.transport, id(92), globals);
    expect(w.transport.call).toHaveBeenCalledTimes(count);
    expect(w.transport.verifyGovernor).toHaveBeenCalledTimes((PER_GROUP_DOMAINS.length + 1) * 2 + count);
  });
  it('retains the exact unresolved setting on lost reply and refuses replay', async () => {
    const w = world(); w.transport.call = vi.fn(async () => { throw new Error('committed reply lost'); });
    await expect(configureProvisionGroup(initial(), w.checkpoint, w.transport, id(92), globals)).rejects.toThrow('reply lost');
    expect(w.saved().pending).toEqual({ kind: 'configure', operation: 'media_blob_store.set_club_domain_canister' });
    await expect(configureProvisionGroup(w.saved(), w.checkpoint, w.transport, id(92), globals)).rejects.toThrow('Unresolved');
    expect(w.transport.call).toHaveBeenCalledTimes(1);
  });
  it('retains unresolved intent on acknowledgement disk failure', async () => {
    const w = world();
    const save = async (p: Provision) => { if (p.configuration?.completed.length) throw new Error('disk failed'); await w.checkpoint(p); };
    await expect(configureProvisionGroup(initial(), save, w.transport, id(92), globals)).rejects.toThrow('disk failed');
    expect(w.saved().pending?.kind).toBe('configure');
    expect(w.transport.call).toHaveBeenCalledTimes(1);
  });
  it('rejects changed governor/global/inventory bindings and invalid receipts before calls', async () => {
    const w = world(); await configureProvisionGroup(initial(), w.checkpoint, w.transport, id(92), globals);
    w.transport.call.mockClear();
    await expect(configureProvisionGroup(w.saved(), w.checkpoint, w.transport, id(93), globals)).rejects.toThrow('binding changed');
    await expect(configureProvisionGroup(w.saved(), w.checkpoint, w.transport, id(92), { ...globals, pushWorker: id(94) })).rejects.toThrow('binding changed');
    const saved = w.saved();
    await expect(configureProvisionGroup({ ...saved, canisters: { ...saved.canisters, events_domain: id(95) } }, w.checkpoint, w.transport, id(92), globals)).rejects.toThrow('binding changed');
    await expect(configureProvisionGroup({ ...saved, configuration: { binding: saved.configuration?.binding ?? '', completed: ['unknown'] } }, w.checkpoint, w.transport, id(92), globals)).rejects.toThrow('receipts');
    expect(w.transport.call).not.toHaveBeenCalled();
  });
  it('fails before settings when governor control cannot be verified', async () => {
    const w = world(); w.transport.verifyGovernor.mockRejectedValue(new Error('governor unavailable'));
    await expect(configureProvisionGroup(initial(), w.checkpoint, w.transport, id(92), globals)).rejects.toThrow('governor unavailable');
    expect(w.transport.call).not.toHaveBeenCalled();
  });
  it('executor configures before health and returns registered closed without calling enable', async () => {
    const w = world(), order: string[] = [];
    const adapter: ProvisionAdapter = { createCanister: vi.fn(), install: vi.fn(),
      configure: async (p, checkpoint) => { order.push('configure'); await configureProvisionGroup(p, checkpoint, w.transport, id(92), globals); },
      healthy: async () => { order.push('health'); return true; }, readRegistryRevision: async () => 1n,
      registerGroup: async () => { order.push('register'); }, enableGroup: vi.fn(), save: w.checkpoint };
    const result = await runProvision(initial(), adapter, { stopAfterRegistration: true });
    expect(result.phase).toBe('registered'); expect(order[0]).toBe('configure'); expect(order.at(-1)).toBe('register');
    expect(adapter.enableGroup).not.toHaveBeenCalled();
    await runProvision(result, adapter, { stopAfterRegistration: true });
    expect(w.transport.call).toHaveBeenCalledTimes(groupConfigurationPlan(initial(), globals).length);
    expect(adapter.enableGroup).not.toHaveBeenCalled();
  });
  it('executor never runs health or registration after configuration refusal', async () => {
    const w = world(); w.transport.call = vi.fn(async () => ({ Err: 'forbidden' }));
    const adapter: ProvisionAdapter = { createCanister: vi.fn(), install: vi.fn(),
      configure: (p, checkpoint) => configureProvisionGroup(p, checkpoint, w.transport, id(92), globals),
      healthy: vi.fn(), readRegistryRevision: vi.fn(), registerGroup: vi.fn(), enableGroup: vi.fn(), save: w.checkpoint };
    const result = await runProvision(initial(), adapter, { stopAfterRegistration: true });
    expect(result.pending?.operation).toBe('media_blob_store.set_club_domain_canister');
    expect(adapter.healthy).not.toHaveBeenCalled(); expect(adapter.registerGroup).not.toHaveBeenCalled(); expect(adapter.enableGroup).not.toHaveBeenCalled();
  });
});