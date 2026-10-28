import { describe, expect, it, vi } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { adaptLocalAccountReads, adaptRemoteAccountReads, isLoopbackRehearsalHost } from './accountReadAdapter.mjs';
import { idlFactory as vaultIdl } from '../lab/bindings/vault_domain/declarations/vault_domain.did.js';
import { idlFactory as chatIdl } from '../lab/bindings/messaging_domain/declarations/messaging_domain.did.js';

describe('local protected read adapter', () => {
  it('validates every generated service before exposing exact-signature twins', () => {
    const contracts = import.meta.glob<{ idlFactory: (args: { IDL: typeof IDL }) => IDL.ServiceClass }>('../lab/bindings/*/declarations/*.did.js', { eager: true });
    expect(Object.keys(contracts).length).toBeGreaterThanOrEqual(12);
    for (const [path, contract] of Object.entries(contracts)) {
      expect(() => adaptLocalAccountReads({}, contract.idlFactory({ IDL }), 'http://localhost:4943'), path).not.toThrow();
    }
  });
  it('never admits remote, malformed or credential-bearing hosts', () => {
    for (const host of ['https://icp-api.io', 'https://localhost.example.com', 'file://localhost', 'http://user@localhost', 'invalid']) {
      expect(isLoopbackRehearsalHost(host)).toBe(false);
    }
    for (const host of ['http://localhost:4943', 'http://127.0.0.1:4943', 'http://[::1]:4943']) expect(isLoopbackRehearsalHost(host)).toBe(true);
  });
  it('uses actual exact-signature single/batch twins without rewriting results', async () => {
    const single = { Ok: [{ id: 'f' }] };
    const batch = { Ok: [{ id: 'one' }, { id: 'two' }] };
    const actor = { get_folder: vi.fn(), list_files: vi.fn(),
      read_account_get_folder: vi.fn().mockResolvedValue(single),
      read_account_list_files: vi.fn().mockResolvedValue(batch), create_folder: vi.fn().mockResolvedValue('write') };
    const wrapped = adaptLocalAccountReads(actor, vaultIdl({ IDL }), 'http://localhost:4943');
    expect(await wrapped.get_folder('f')).toBe(single);
    expect(await wrapped.list_files('f')).toBe(batch);
    expect(actor.read_account_get_folder).toHaveBeenCalledWith('f');
    expect(actor.read_account_list_files).toHaveBeenCalledWith('f');
    expect(actor.get_folder).not.toHaveBeenCalled(); expect(actor.list_files).not.toHaveBeenCalled();
    await wrapped.create_folder('once'); expect(actor.create_folder).toHaveBeenCalledTimes(1);
  });
  it('does not fall back or retry when protected reads deny or are missing', async () => {
    const legacy = vi.fn(); const blocked = vi.fn().mockRejectedValue(new Error('Denied'));
    const wrapped = adaptLocalAccountReads({ get_folder: legacy, read_account_get_folder: blocked }, vaultIdl({ IDL }), 'http://localhost:4943');
    await expect(wrapped.get_folder()).rejects.toThrow('Denied');
    expect(blocked).toHaveBeenCalledTimes(1); expect(legacy).not.toHaveBeenCalled();
    const missing = adaptLocalAccountReads({ get_folder: legacy }, vaultIdl({ IDL }), 'http://localhost:4943');
    expect(() => missing.get_folder()).toThrow('Missing protected read');
    expect(legacy).not.toHaveBeenCalled();
  });
  it('refuses changed argument or result signatures', () => {
    const wrong = IDL.Service({ get: IDL.Func([IDL.Text], [IDL.Text], ['query']), read_account_get: IDL.Func([IDL.Nat], [IDL.Text], []) });
    expect(() => adaptLocalAccountReads({}, wrong, 'http://localhost')).toThrow('Incompatible');
  });
  it('opens a chat through its exact protected twin and preserves bundled polls', async () => {
    const result = { Ok: { page: { messages: [], next_sequence: [], latest_sequence: 0n }, reactions: [], pins: [], polls: [{ poll: { id: 'poll-chat-1' }, counts: [1, 0], total_votes: 1 }] } };
    const actor = { open_conversation: vi.fn(), read_account_open_conversation: vi.fn().mockResolvedValue(result) };
    const wrapped = adaptLocalAccountReads(actor, chatIdl({ IDL }), 'http://localhost:4943');
    expect(await wrapped.open_conversation('chat', 25)).toBe(result);
    expect(actor.read_account_open_conversation).toHaveBeenCalledWith('chat', 25);
    expect(actor.open_conversation).not.toHaveBeenCalled();
  });
});

describe('remote protected read fallback', () => {
  const trap = () => new Error("Canister called `ic0.trap` with message: 'Use protected consensus account read'");

  it('keeps the fast legacy query when the canister does not refuse it', async () => {
    const legacy = vi.fn().mockResolvedValue('fast');
    const twin = vi.fn().mockResolvedValue('slow');
    const wrapped = adaptRemoteAccountReads({ get_folder: legacy, read_account_get_folder: twin }, vaultIdl({ IDL }), 'aaaaa-aa');
    expect(await wrapped.get_folder('f')).toBe('fast');
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(twin).not.toHaveBeenCalled();
  });

  it('retries through the exact-signature twin only when the canister demands it, then goes straight to the twin', async () => {
    const legacy = vi.fn().mockRejectedValue(trap());
    const twin = vi.fn().mockResolvedValue('protected');
    const wrapped = adaptRemoteAccountReads({ get_folder: legacy, read_account_get_folder: twin }, vaultIdl({ IDL }), 'bbbbb-bb');
    expect(await wrapped.get_folder('f')).toBe('protected');
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(twin).toHaveBeenCalledWith('f');
    // Decision is remembered per canister+method: no more trapped queries.
    legacy.mockClear();
    expect(await wrapped.get_folder('g')).toBe('protected');
    expect(legacy).not.toHaveBeenCalled();
    expect(twin).toHaveBeenCalledTimes(2);
  });

  it('propagates unrelated errors without retrying', async () => {
    const legacy = vi.fn().mockRejectedValue(new Error('Club admin required'));
    const twin = vi.fn();
    const wrapped = adaptRemoteAccountReads({ get_folder: legacy, read_account_get_folder: twin }, vaultIdl({ IDL }), 'ccccc-cc');
    await expect(wrapped.get_folder('f')).rejects.toThrow('Club admin required');
    expect(twin).not.toHaveBeenCalled();
  });

  it('leaves methods without an exact twin and writes untouched', async () => {
    const legacy = vi.fn().mockRejectedValue(trap());
    const write = vi.fn().mockResolvedValue('done');
    const wrapped = adaptRemoteAccountReads({ get_club_media_bytes: legacy, create_folder: write }, vaultIdl({ IDL }), 'ddddd-dd');
    await expect(wrapped.get_club_media_bytes('c')).rejects.toThrow('protected consensus account read');
    expect(await wrapped.create_folder('n')).toBe('done');
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('scopes the twin decision to the canister that demanded it', async () => {
    const legacyA = vi.fn().mockRejectedValue(trap());
    const twinA = vi.fn().mockResolvedValue('protected');
    const legacyB = vi.fn().mockResolvedValue('fast');
    const twinB = vi.fn();
    const a = adaptRemoteAccountReads({ list_files: legacyA, read_account_list_files: twinA }, vaultIdl({ IDL }), 'eeeee-ee');
    const b = adaptRemoteAccountReads({ list_files: legacyB, read_account_list_files: twinB }, vaultIdl({ IDL }), 'fffff-ff');
    expect(await a.list_files('c')).toBe('protected');
    expect(await b.list_files('c')).toBe('fast');
    expect(twinB).not.toHaveBeenCalled();
  });

  it('keeps the twin decision on the device so the next launch skips the refused query', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
    vi.resetModules();
    const first = await import('./accountReadAdapter.mjs');
    const legacy = vi.fn().mockRejectedValue(trap());
    const twin = vi.fn().mockResolvedValue('protected');
    const wrapped = first.adaptRemoteAccountReads({ get_folder: legacy, read_account_get_folder: twin }, vaultIdl({ IDL }), 'ggggg-gg');
    await wrapped.get_folder('f');
    expect(legacy).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(store.get('ignite_protected_read_decisions_v1') ?? '[]');
    expect(saved).toContain('ggggg-gg|get_folder');
    // A fresh module load (next app launch) goes straight to the twin.
    vi.resetModules();
    const fresh = await import('./accountReadAdapter.mjs');
    const legacy2 = vi.fn().mockRejectedValue(trap());
    const twin2 = vi.fn().mockResolvedValue('protected');
    const again = fresh.adaptRemoteAccountReads({ get_folder: legacy2, read_account_get_folder: twin2 }, vaultIdl({ IDL }), 'ggggg-gg');
    expect(await again.get_folder('f')).toBe('protected');
    expect(legacy2).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});