import { describe, expect, it, vi } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { adaptLocalAccountReads, isLoopbackRehearsalHost } from './accountReadAdapter.mjs';
import { idlFactory as vaultIdl } from '../lab/bindings/vault_domain/declarations/vault_domain.did.js';

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
});