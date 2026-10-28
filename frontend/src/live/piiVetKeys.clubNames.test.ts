import { beforeEach, expect, it, vi } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import type { FeatureBackendContext } from './featureRouter';
const mocks = vi.hoisted(() => ({ derive: vi.fn(), load: vi.fn(), store: vi.fn(), decrypt: vi.fn() }));
vi.mock('./domains', () => ({ connectLivePiiAccessControl: async (target: {canisterIds: {pii_access_control: string}}) => ({canisterId: Principal.fromText(target.canisterIds.pii_access_control), actor: {pii_vetkey_verification_key: async () => [1], get_private_profile_club_name_vetkey: mocks.derive}}) }));
vi.mock('./deviceMediaCache', () => ({loadStoredClubKey: mocks.load, storeClubKey: mocks.store, forgetStoredClubKey: vi.fn(), clearDeviceMediaCaches: vi.fn(), clearDeviceCachedPhotos: vi.fn(), clearStoredDeviceKeys: vi.fn()}));
vi.mock('./mediaDecrypt', () => ({clearIcpPhotoResolutionCache: vi.fn()}));
vi.mock('@icp-sdk/vetkeys', () => ({DerivedPublicKey: {deserialize: () => 'public'}, EncryptedVetKey: {deserialize: () => ({decryptAndVerify: mocks.decrypt})}, TransportSecretKey: {random: () => ({publicKeyBytes: () => new Uint8Array(48)})}, VetKey: {deserialize: () => ({serialize: () => new Uint8Array([8])})}, IbeCiphertext: {}, IbeIdentity: {}, IbeSeed: {}}));
import {fetchClubNameVetKey, clearPiiVetKeyCache} from './piiVetKeys';
const authority = Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai');
const ctx = {identity: {getPrincipal: () => Principal.fromText('ryjl3-tyaaa-aaaaa-aaaba-cai')}, target: {host: 'https://icp-api.io', canisterIds: {pii_access_control: authority.toText()}}} as FeatureBackendContext;
const scope = {kind: 'club' as const, authority, resource: 'club-1', profile_revision: 0n};
beforeEach(() => {clearPiiVetKeyCache(); vi.clearAllMocks(); mocks.load.mockReturnValue(null); mocks.derive.mockResolvedValue({Ok: [1]}); mocks.decrypt.mockReturnValue({serialize: () => new Uint8Array([8])});});
it('coalesces the whole team and later refresh into one club derivation', async () => {
  await Promise.all([fetchClubNameVetKey(ctx, ['one'], scope, () => {}), fetchClubNameVetKey(ctx, ['two'], scope, () => {})]);
  await fetchClubNameVetKey(ctx, ['three'], scope, () => {});
  expect(mocks.derive).toHaveBeenCalledOnce();
  expect(mocks.store).toHaveBeenCalledOnce();
});
it('keeps club, account and original PII key scopes separate', async () => {
  await fetchClubNameVetKey(ctx, ['one'], scope, () => {});
  await fetchClubNameVetKey(ctx, ['one'], {...scope, resource: 'club-2'}, () => {});
  await fetchClubNameVetKey({...ctx, identity: {getPrincipal: () => authority}} as FeatureBackendContext, ['one'], scope, () => {});
  await fetchClubNameVetKey({...ctx, target: {...ctx.target, canisterIds: {pii_access_control: 'r7inp-6aaaa-aaaaa-aaabq-cai'}}}, ['one'], scope, () => {});
  expect(mocks.derive).toHaveBeenCalledTimes(4);
});
it('reuses a stored key without a paid derivation', async () => {
  mocks.load.mockReturnValue(new Uint8Array([8]));
  await fetchClubNameVetKey(ctx, ['one'], scope, () => {});
  expect(mocks.derive).not.toHaveBeenCalled();
});
it('does not persist a late key after request retirement', async () => {
  let active = true;
  mocks.derive.mockImplementation(async () => {active = false; return {Ok: [1]};});
  await expect(fetchClubNameVetKey(ctx, ['one'], scope, () => {if (!active) throw Error('retired');})).rejects.toThrow('retired');
  expect(mocks.store).not.toHaveBeenCalled();
});
it('never gives a family or email audience the shared names key', async () => {
  await expect(fetchClubNameVetKey(ctx, ['one'], {...scope, kind: 'family'}, () => {})).rejects.toThrow('audience');
  expect(mocks.derive).not.toHaveBeenCalled();
});
it('cache clearing fences a held key even if the caller guard has not retired', async () => {
  let release: (value: unknown) => void = () => {};
  mocks.derive.mockImplementation(() => new Promise(resolve => {release = resolve;}));
  const pending = fetchClubNameVetKey(ctx, ['one'], scope, () => {});
  const rejected = expect(pending).rejects.toThrow('context changed');
  await vi.waitFor(() => expect(mocks.derive).toHaveBeenCalledOnce());
  clearPiiVetKeyCache(); release({Ok: [1]});
  await rejected;
  expect(mocks.store).not.toHaveBeenCalled();
});