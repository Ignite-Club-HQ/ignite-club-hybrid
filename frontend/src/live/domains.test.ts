import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Identity } from '@icp-sdk/core/agent';
import type { IcpTargetConfig } from './targetRegistry';
const mocks = vi.hoisted(() => ({ actor: {
  get_folder: vi.fn(), read_account_get_folder: vi.fn(),
}, createLiveActor: vi.fn() }));
vi.mock('./icpAgent', () => ({ createLiveActor: mocks.createLiveActor }));
import { connectLiveVaultDomain } from './domains';

const target = (host: string): IcpTargetConfig => ({ provider: 'icp', alias: 'test', host,
  networkKind: 'public_mainnet', deploymentClass: 'public_subnet', canisterIds: {} });
const identity = { getPrincipal: () => ({ isAnonymous: () => false }) } as unknown as Identity;
describe('dev-only domain protected reads', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.unstubAllEnvs();
    mocks.createLiveActor.mockResolvedValue({ actor: mocks.actor, canisterId: 'canister' });
  });
  it('passes remote reads through unchanged until the canister demands a protected read', async () => {
    vi.stubEnv('DEV', true);
    mocks.actor.get_folder.mockResolvedValue({ Ok: [{ id: 'f' }] });
    const connection = await connectLiveVaultDomain(target('https://icp-api.io'), identity);
    expect(await connection.actor.get_folder('f')).toEqual({ Ok: [{ id: 'f' }] });
    expect(mocks.actor.get_folder).toHaveBeenCalledWith('f');
    expect(mocks.actor.read_account_get_folder).not.toHaveBeenCalled();
  });
  it('public invitation actors never inherit protected account decisions', async () => {
    const anonymous = { getPrincipal: () => ({ isAnonymous: () => true }) } as unknown as Identity;
    const connection = await connectLiveVaultDomain(target('https://icp-api.io'), anonymous);
    expect(connection.actor).toBe(mocks.actor);
  });
  it('retries through the protected twin when a remote canister refuses the legacy query', async () => {
    vi.stubEnv('DEV', true);
    mocks.actor.get_folder.mockRejectedValue(new Error("Canister called `ic0.trap` with message: 'Use protected consensus account read'"));
    mocks.actor.read_account_get_folder.mockResolvedValue({ Ok: [{ id: 'f' }] });
    const connection = await connectLiveVaultDomain(target('https://icp-api.io'), identity);
    expect(await connection.actor.get_folder('f')).toEqual({ Ok: [{ id: 'f' }] });
    expect(mocks.actor.read_account_get_folder).toHaveBeenCalledWith('f');
  });
  it('passes published loopback reads through unchanged until the canister demands a protected read', async () => {
    vi.stubEnv('DEV', false);
    mocks.actor.list_files = vi.fn().mockResolvedValue({ Ok: [] });
    mocks.actor.read_account_list_files = vi.fn();
    const connection = await connectLiveVaultDomain(target('http://localhost:4943'), identity);
    expect(await connection.actor.list_files('c')).toEqual({ Ok: [] });
    expect(mocks.actor.list_files).toHaveBeenCalledWith('c');
    expect(mocks.actor.read_account_list_files).not.toHaveBeenCalled();
  });
  it('connects real mapped reads only for a dev loopback target', async () => {
    vi.stubEnv('DEV', true);
    mocks.actor.read_account_get_folder.mockResolvedValue({ Ok: [] });
    const connection = await connectLiveVaultDomain(target('http://localhost:4943'), identity);
    expect(await connection.actor.get_folder('folder')).toEqual({ Ok: [] });
    expect(mocks.actor.read_account_get_folder).toHaveBeenCalledWith('folder');
    expect(mocks.actor.get_folder).not.toHaveBeenCalled();
  });
});