import { accountAuthoritiesFromRegistry, type AccountRegistryBinding, type AccountRegistrySnapshot } from './accountAuthorityRegistry';

export type PrivateNameKeyEvidence = {
  groupId: string; authority: string; originalPublicKeyHex: string; observedPublicKeyHex: string;
};
export type PrivateNameConversionReceipt = {
  subject: string; authority: string; encryptedReadbackVerified: boolean;
  outcome: 'confirmed' | 'pending' | 'unknown';
};

/** Offline readiness only. Caller-supplied evidence cannot approve deployment,
 * conversion or deletion; this module has no transports, writes or activation. */
export function checkPrivateProfileReleaseReadiness(input: {
  snapshot: AccountRegistrySnapshot; binding: AccountRegistryBinding;
  expectedGroupIds: readonly string[]; originalClubAuthority: string;
  keys: readonly PrivateNameKeyEvidence[];
  subjects: readonly { subject: string; originalAuthority: string }[]; receipts: readonly PrivateNameConversionReceipt[];
}) {
  const groups = accountAuthoritiesFromRegistry(input.snapshot, input.binding);
  const expected = [...input.expectedGroupIds].sort();
  if (!expected.length || new Set(expected).size !== expected.length
    || JSON.stringify(groups.map(g => g.groupId).sort()) !== JSON.stringify(expected)) throw new Error('Every registered group must be included.');
  if (!input.binding.requiredClubAuthorities.includes(input.originalClubAuthority)
    || !groups.some(g => g.clubDomain === input.originalClubAuthority)) throw new Error('Original Group 1 authority is required.');
  if (input.keys.length !== groups.length || new Set(input.keys.map(key => key.groupId)).size !== groups.length) throw new Error('Complete original key evidence is required.');
  for (const group of input.snapshot.groups) {
    const pii = group.domains.find(d => d.domain === 'pii_access_control')?.canister.toText();
    const key = input.keys.find(key => key.groupId === group.id);
    if (!key || key.authority !== pii || !/^(?:[0-9a-f]{2})+$/.test(key.originalPublicKeyHex)
      || key.originalPublicKeyHex !== key.observedPublicKeyHex) throw new Error('Original PII key preservation is unverified.');
  }
  const subjects = new Map(input.subjects.map(row => [row.subject, row.originalAuthority]));
  if (subjects.size !== input.subjects.length || input.subjects.some(row => !row.subject.trim() || !row.originalAuthority)
    || input.receipts.length !== subjects.size || new Set(input.receipts.map(row => row.subject)).size !== subjects.size) throw new Error('Exact conversion inventory and readback are required.');
  const authorities = new Set(input.keys.map(key => key.authority));
  for (const receipt of input.receipts) {
    if (subjects.get(receipt.subject) !== receipt.authority || !authorities.has(receipt.authority)
      || receipt.outcome !== 'confirmed' || !receipt.encryptedReadbackVerified) throw new Error('Unconfirmed conversion remains locked.');
  }
  return { groupCount: groups.length, verifiedSubjectCount: subjects.size, activationAuthorized: false as const };
}