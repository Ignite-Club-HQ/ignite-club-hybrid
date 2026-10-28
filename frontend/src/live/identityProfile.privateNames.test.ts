import { beforeEach, expect, it, vi } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import type { Identity } from '@icp-sdk/core/agent';
import type { IcpTargetConfig } from './targetRegistry';

const mocks = vi.hoisted(() => ({ authority: vi.fn(), get: vi.fn(), set: vi.fn(), dispose: vi.fn(), cache: vi.fn(), rehearsal: vi.fn(), prepare: vi.fn(), refresh: vi.fn(), hydrate: vi.fn(), grants: vi.fn(), evidence: vi.fn(), resolve: vi.fn(), confirm: vi.fn() }));
vi.mock('./privateProfileEvidence', () => ({ readPrivateProfileEvidence: mocks.evidence }));
vi.mock('./privateProfileAuthority', () => ({ createLivePrivateProfileAuthorityResolver: () => mocks.resolve }));
vi.mock('./identityAccess', () => ({ isLiveIdentityAccessConfigured: () => true, connectLiveIdentityAccessClientWithIdentity: async () => ({ client: { readSecureNameAuthority: mocks.authority, getProfile: mocks.get, setProfile: mocks.set, dispose: mocks.dispose } }) }));
vi.mock('./identityProfileCache', () => ({ cacheIcpIdentityProfile: mocks.cache, getCachedIcpIdentityProfile: () => null }));
vi.mock('./privateProfileSearchMode', () => ({ privateProfileSearchRehearsalEnabled: mocks.rehearsal }));
vi.mock('./privateProfileNames', () => ({ preparePrivateOwnProfileName: mocks.prepare, refreshPrivateOwnClubNames: mocks.refresh, hydratePrivateProfileNames: mocks.hydrate, privateProfileNameReference: (authority: string, subject: string) => `pii-display-name:v1:${authority}:${subject}` }));
vi.mock('./features/membership', () => ({ getLiveMyRoleGrants: mocks.grants }));
import { saveIcpIdentityProfile } from './identityProfile';
import { retirePrivateProfileSession } from './privateProfileSession';

const subject = Principal.fromUint8Array(Uint8Array.of(3, 1)).toText();
const sink = 'rrkah-fqaaa-aaaaa-aaaaq-cai';
const identity = { getPrincipal: () => Principal.fromText(subject) } as Identity;
const target = { alias: 'test', host: 'http://localhost:4943', canisterIds: { pii_access_control: sink, identity_access: sink } } as IcpTargetConfig;
const reference = `pii-display-name:v1:${sink}:${subject}`;
beforeEach(() => {
  vi.resetAllMocks(); mocks.rehearsal.mockReturnValue(true);
  mocks.authority.mockResolvedValue(Principal.fromText(sink));
  mocks.get.mockResolvedValue({ display_name: reference }); mocks.hydrate.mockResolvedValue([{ display_name: 'Before' }]);
  mocks.prepare.mockResolvedValue(reference); mocks.grants.mockResolvedValue([{ club: ['club-1'] }]);
  mocks.refresh.mockImplementation(async (_ctx, _name, discover) => { await discover(); });
  mocks.set.mockImplementation(async name => ({ display_name: name, avatar_ref: [] }));
});
it('shared converted-name saves maintain copies and never replace the reference with plaintext', async () => {
  const result = await saveIcpIdentityProfile(identity, subject, { displayName: 'After' }, target);
  expect(mocks.prepare).toHaveBeenCalledOnce(); expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(mocks.set).toHaveBeenCalledWith(reference, undefined); expect(result.displayName).toBe('After');
  expect(mocks.cache.mock.calls[0][1].displayName).toBe('After'); expect(result.privateNameMaintained).toBe(true);
});
it('avatar-only saves preserve the reference without another name encryption or key-copy write', async () => {
  await saveIcpIdentityProfile(identity, subject, { displayName: 'Before', avatarRef: 'avatar' }, target);
  expect(mocks.set).toHaveBeenCalledWith(reference, 'avatar'); expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
});
it('unknown copy update never publishes or caches a completed profile save', async () => {
  mocks.refresh.mockRejectedValue(Error('Unknown copy reply'));
  await expect(saveIcpIdentityProfile(identity, subject, { displayName: 'After' }, target)).rejects.toThrow('Unknown copy reply');
  expect(mocks.refresh).toHaveBeenCalledOnce(); expect(mocks.set).not.toHaveBeenCalled(); expect(mocks.cache).not.toHaveBeenCalled(); expect(mocks.dispose).toHaveBeenCalledOnce();
});
it('foreign original authority refuses before any profile or private-name mutation', async () => {
  mocks.get.mockResolvedValue({ display_name: `pii-display-name:v1:foreign:${subject}` });
  await expect(saveIcpIdentityProfile(identity, subject, { displayName: 'After' }, target)).rejects.toThrow('authority');
  expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.set).not.toHaveBeenCalled();
});
it('production saves publish only a verified encrypted reference without enabling rehearsal or membership writes', async () => {
  mocks.rehearsal.mockReturnValue(false);
  await saveIcpIdentityProfile(identity, subject, { displayName: 'After' }, { ...target, host: 'https://icp-api.io' });
  expect(mocks.authority).toHaveBeenCalledOnce(); expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.set).toHaveBeenCalledWith(reference, undefined); expect(mocks.prepare).toHaveBeenCalledOnce();
  expect(mocks.refresh).not.toHaveBeenCalled(); expect(mocks.grants).not.toHaveBeenCalled(); expect(mocks.cache.mock.calls[0][1].displayName).toBe('After');
});
it('unreleased production saving never falls back to plaintext or a PII side copy', async () => {
  mocks.rehearsal.mockReturnValue(false); mocks.authority.mockRejectedValue(Error('Secure personal-name saving is not released'));
  await expect(saveIcpIdentityProfile(identity, subject, { displayName: 'After' }, target)).rejects.toThrow('not released');
  expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.set).not.toHaveBeenCalled(); expect(mocks.cache).not.toHaveBeenCalled();
});
it('operator authority drift refuses before any encrypted or identity write', async () => {
  mocks.rehearsal.mockReturnValue(false); mocks.authority.mockResolvedValue(Principal.fromText('ryjl3-tyaaa-aaaaa-aaaba-cai'));
  await expect(saveIcpIdentityProfile(identity, subject, { displayName: 'After' }, target)).rejects.toThrow('authority');
  expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.set).not.toHaveBeenCalled();
});
it('failed encrypted readback never publishes a profile or success cache', async () => {
  mocks.rehearsal.mockReturnValue(false); mocks.prepare.mockRejectedValue(Error('Private profile readback was not confirmed'));
  await expect(saveIcpIdentityProfile(identity, subject, { displayName: 'After' }, target)).rejects.toThrow('readback');
  expect(mocks.set).not.toHaveBeenCalled(); expect(mocks.cache).not.toHaveBeenCalled();
});
it('a mismatched profile account refuses before contacting the name authority', async () => {
  mocks.rehearsal.mockReturnValue(false);
  await expect(saveIcpIdentityProfile(identity, sink, { displayName: 'After' }, target)).rejects.toThrow('account');
  expect(mocks.authority).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.set).not.toHaveBeenCalled();
});
it('session retirement after read prevents every save mutation', async () => {
  mocks.get.mockImplementation(async () => { retirePrivateProfileSession(); return { display_name: reference }; });
  await expect(saveIcpIdentityProfile(identity, subject, { displayName: 'After' }, target)).rejects.toThrow('session retired');
  expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.set).not.toHaveBeenCalled();
});
it('verified foreign originals save only at their original PII route and preserve the reference', async () => {
  const foreign = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
  const foreignReference = `pii-display-name:v1:${foreign}:${subject}`;
  const routed = { identity, target: { ...target, canisterIds: { ...target.canisterIds, pii_access_control: foreign } } };
  mocks.get.mockResolvedValue({ display_name: foreignReference }); mocks.evidence.mockResolvedValue({ verified: true });
  mocks.resolve.mockResolvedValue({ context: routed, confirm: mocks.confirm }); mocks.prepare.mockResolvedValue(foreignReference);
  await saveIcpIdentityProfile(identity, subject, { displayName: 'After' }, target);
  expect(mocks.prepare).toHaveBeenCalledWith(routed, 'After'); expect(mocks.set).toHaveBeenCalledWith(foreignReference, undefined); expect(mocks.confirm).toHaveBeenCalledTimes(3);
});
it('missing foreign evidence or changed closing authority prevents name/profile writes', async () => {
  const foreign = 'ryjl3-tyaaa-aaaaa-aaaba-cai'; mocks.get.mockResolvedValue({ display_name: `pii-display-name:v1:${foreign}:${subject}` });
  await expect(saveIcpIdentityProfile(identity, subject, { displayName: 'After' }, target)).rejects.toThrow('evidence'); expect(mocks.prepare).not.toHaveBeenCalled();
  mocks.evidence.mockResolvedValue({ verified: true }); mocks.resolve.mockResolvedValue({ context: { identity, target: { ...target, canisterIds: { ...target.canisterIds, pii_access_control: foreign } } }, confirm: mocks.confirm }); mocks.confirm.mockRejectedValue(Error('Authority drift'));
  await expect(saveIcpIdentityProfile(identity, subject, { displayName: 'After' }, target)).rejects.toThrow('Authority drift'); expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.set).not.toHaveBeenCalled();
});