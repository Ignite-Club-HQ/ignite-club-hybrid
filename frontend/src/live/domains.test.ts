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
const identity = {} as Identity;
describe('dev-only domain protected reads', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.unstubAllEnvs();
    mocks.createLiveActor.mockResolvedValue({ actor: mocks.actor, canisterId: 'canister' });
  });
  it('keeps remote actors identical even in development', async () => {
    vi.stubEnv('DEV', true);
    const connection = await connectLiveVaultDomain(target('https://icp-api.io'), identity);
    expect(connection.actor).toBe(mocks.actor);
  });
  it('keeps published actors identical even with a loopback target', async () => {
    vi.stubEnv('DEV', false);
    const connection = await connectLiveVaultDomain(target('http://localhost:4943'), identity);
    expect(connection.actor).toBe(mocks.actor);
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