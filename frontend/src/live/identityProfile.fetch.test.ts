import { beforeEach, expect, it, vi } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import type { Identity } from '@icp-sdk/core/agent';
import type { IcpTargetConfig } from './targetRegistry';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), get: vi.fn(), roles: vi.fn(), dispose: vi.fn(), cache: vi.fn(), unlock: vi.fn() }));
vi.mock('./identityAccess', () => ({ isLiveIdentityAccessConfigured: () => true, connectLiveIdentityAccessClientWithIdentity: mocks.connect }));
vi.mock('./identityProfileCache', () => ({ cacheIcpIdentityProfile: mocks.cache }));
vi.mock('./privateProfileNames', () => ({ readPrivateOwnProfileName: mocks.unlock }));
import { fetchIcpIdentityProfile } from './identityProfile';

const principal = Principal.fromUint8Array(Uint8Array.of(3, 1)).toText();
const identity = { getPrincipal: () => Principal.fromText(principal) } as Identity;
const authority = 'rrkah-fqaaa-aaaaa-aaaaq-cai';
const target = { alias: 'test', host: 'https://icp-api.io', canisterIds: { identity_access: authority, pii_access_control: authority } } as IcpTargetConfig;
const reference = `pii-display-name:v1:${authority}:${principal}`;
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mocks.connect.mockResolvedValue({ client: { getProfile: mocks.get, myRoles: mocks.roles, dispose: mocks.dispose } });
  mocks.get.mockResolvedValue({ display_name: reference, avatar_ref: [] });
  mocks.roles.mockResolvedValue([]);
  mocks.unlock.mockResolvedValue('Saved name');
});
it('reopens a saved encrypted profile without persisting its decrypted name', async () => {
  const result = await fetchIcpIdentityProfile(identity, principal, target);
  expect(result.displayName).toBe('Saved name'); expect(result.profileMissing).toBe(false);
  expect(mocks.unlock).toHaveBeenCalledWith({ identity, target }, reference);
  // The unlocked own name is cached on device so app resume shows it instantly.
  expect(mocks.cache).toHaveBeenCalledWith(principal, result);
});
it('never reads or caches a profile for a different signed-in caller', async () => {
  await expect(fetchIcpIdentityProfile(identity, authority, target)).rejects.toThrow('signed-in identity');
  expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.cache).not.toHaveBeenCalled();
});
it('an unlock refusal is retryable failure, not a missing profile', async () => {
  mocks.unlock.mockRejectedValue(Error('Private display name unlock timed out.'));
  await expect(fetchIcpIdentityProfile(identity, principal, target)).rejects.toThrow('timed out');
  expect(mocks.cache).not.toHaveBeenCalled(); expect(mocks.dispose).toHaveBeenCalledOnce();
});
it('only a genuinely absent server profile is reported missing', async () => {
  mocks.get.mockResolvedValue(null);
  expect((await fetchIcpIdentityProfile(identity, principal, target)).profileMissing).toBe(true);
  expect(mocks.unlock).not.toHaveBeenCalled();
});it('starts the guarded name read alongside the profile read once the reference is known', async () => {
  await fetchIcpIdentityProfile(identity, principal, target);
  mocks.unlock.mockClear();
  let unlockStarted!: () => void;
  const started = new Promise<void>((resolve) => { unlockStarted = resolve; });
  mocks.get.mockImplementation(async () => { await started; return { display_name: reference, avatar_ref: [] }; });
  mocks.unlock.mockImplementation(async () => { unlockStarted(); return 'Saved name'; });
  const result = await fetchIcpIdentityProfile(identity, principal, target);
  expect(result.displayName).toBe('Saved name');
  expect(mocks.unlock).toHaveBeenCalledOnce();
});
it('ignores a stale reference hint and reads the confirmed reference', async () => {
  const stale = `pii-display-name:v1:${authority}:stale`;
  localStorage.setItem(`ignite_icp_private_name_ref:${target.host}|${principal}`, stale);
  mocks.unlock.mockImplementation(async (_ctx: unknown, ref: string) => ref === reference ? 'New name' : 'Old name');
  expect((await fetchIcpIdentityProfile(identity, principal, target)).displayName).toBe('New name');
});
