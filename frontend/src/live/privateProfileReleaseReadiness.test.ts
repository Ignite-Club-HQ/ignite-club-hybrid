import { describe, expect, it } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { GROUP_DOMAINS } from './groupRouting';
import { checkPrivateProfileReleaseReadiness } from './privateProfileReleaseReadiness';
const principal = (n: number) => Principal.fromUint8Array(Uint8Array.from([n, 1]));
function fixture() {
  const subnet = principal(100);
  const groups = ['g1', 'g2'].map((id, g) => ({ id, target_alias: 'mainnet', domains: GROUP_DOMAINS.map((domain, i) => ({ domain, canister: principal(i + g * 20 + 1) })) }));
  const snapshot = { revision: 8n, groups, placements: groups.map(g => ({ group_id: g.id, deployment_id: 'ignite', deployment_revision: 3n, host: 'https://icp-api.io', network_kind: 'public_mainnet', primary_subnet: subnet, approved_subnets: [subnet], additional_subnets_enabled: false, domains: g.domains.map(d => ({ ...d, subnet })) })) };
  const originalClubAuthority = groups[0].domains.find(d => d.domain === 'club_domain')?.canister.toText() ?? '';
  const keys = groups.map(g => ({ groupId: g.id, authority: g.domains.find(d => d.domain === 'pii_access_control')?.canister.toText() ?? '', originalPublicKeyHex: 'ab12', observedPublicKeyHex: 'ab12' }));
  return { snapshot, binding: { targetAlias: 'mainnet', deploymentId: 'ignite', deploymentRevision: 3n, host: 'https://icp-api.io', networkKind: 'public_mainnet', registryRevision: 8n, requiredClubAuthorities: [originalClubAuthority] }, originalClubAuthority, expectedGroupIds: ['g1', 'g2'], keys, subjects: [{ subject: 'person', originalAuthority: keys[0].authority }], receipts: [{ subject: 'person', authority: keys[0].authority, outcome: 'confirmed' as 'confirmed' | 'unknown', encryptedReadbackVerified: true }] };
}
describe('offline privacy release readiness', () => {
  it('checks complete evidence without authorizing any activation', () => {
    expect(checkPrivateProfileReleaseReadiness(fixture())).toEqual({ groupCount: 2, verifiedSubjectCount: 1, activationAuthorized: false });
  });
  it('refuses a partial registered group inventory', () => {
    const input = fixture(); input.expectedGroupIds.push('g3');
    expect(() => checkPrivateProfileReleaseReadiness(input)).toThrow('Every registered group');
  });
  it('requires original Group 1 even when a replacement inventory validates', () => {
    const input = fixture(); input.originalClubAuthority = principal(90).toText();
    expect(() => checkPrivateProfileReleaseReadiness(input)).toThrow('Original Group 1');
  });
  it('rejects key replacement and incomplete key evidence', () => {
    const input = fixture(); input.keys[0].observedPublicKeyHex = 'abcd';
    expect(() => checkPrivateProfileReleaseReadiness(input)).toThrow('key preservation');
    const incomplete = fixture(); incomplete.keys.pop();
    expect(() => checkPrivateProfileReleaseReadiness(incomplete)).toThrow('Complete original key');
  });
  it('retains unknown conversion locks even with an encrypted readback claim', () => {
    const input = fixture(); input.receipts[0].outcome = 'unknown';
    expect(() => checkPrivateProfileReleaseReadiness(input)).toThrow('remains locked');
  });
  it('refuses a receipt under another valid group’s key authority', () => {
    const input = fixture(); input.receipts[0].authority = input.keys[1].authority;
    expect(() => checkPrivateProfileReleaseReadiness(input)).toThrow('remains locked');
  });
  it('refuses missing and mismatched subject receipts', () => {
    const input = fixture(); input.receipts[0].subject = 'other';
    expect(() => checkPrivateProfileReleaseReadiness(input)).toThrow('remains locked');
    const missing = fixture(); missing.receipts = [];
    expect(() => checkPrivateProfileReleaseReadiness(missing)).toThrow('Exact conversion');
  });
});