import { describe, expect, it, vi } from 'vitest';
import { createMediaKeyOperator, type MediaKeyOperatorProof } from './mediaKeyOperator';
import type { MediaKeyReceipt } from './mediaKeyAuthorityPreparation';
import type { Transfer } from './groupTransfer';
function fixture() {
  const binding = { deploymentId: 'd', registryRevision: '7', clubId: 'c', moveId: 'm', originalPiiCanister: 'pii', destinationClubCanister: 'target' };
  const proof: MediaKeyOperatorProof = { ...binding, assignmentGroup: 'a', sourceGroup: 'a', destinationGroup: 'b', completeRegistry: true,
    metadataComplete: true, provenanceComplete: true, originalKeyAttested: true, privateFilePermissionsVerified: true,
    sourceFenced: true, destinationFenced: true, originalPiiFenced: true, storesFenced: true, pendingUploads: 0, sharedQuotaReady: true };
  let receipt: MediaKeyReceipt | null = null;
  let state = { authority: [] as [] | [{ toText(): string }], revision: 0n, move_id: '' };
  const t: Transfer = { clubId: 'c', fromGroup: 'a', toGroup: 'b', registryRevision: 7n, phase: 'verified', log: [] };
  const actor = { read_club_media_authority: vi.fn(async () => ({ Ok: state })),
    set_club_media_authority: vi.fn(async (_club: string, authority: typeof state.authority, move_id: string, revision: bigint) => {
      if (revision !== state.revision) throw new Error('CAS');
      state = { authority, revision: revision + 1n, move_id }; return { Ok: state };
    }), pii_vetkey_verification_key: vi.fn(async () => new Uint8Array(96).fill(1)) };
  const d = { originalActor: actor, principal: (id: string) => ({ toText: () => id }), attestedPublicKeyHex: '01'.repeat(96),
    readProof: async () => ({ ...proof }), loadTransfer: async () => ({ ...t }), load: async () => structuredClone(receipt),
    save: async (r: MediaKeyReceipt) => { receipt = structuredClone(r); } };
  return { binding, proof, t, actor, d, operator: createMediaKeyOperator(binding, d) };
}
describe('original key operator composition', () => {
  it('prepares the original actor, verifies destination and restores before abort unlock', async () => {
    const f = fixture(); await f.operator.prepareCutover(f.t);
    expect(f.actor.set_club_media_authority).toHaveBeenCalledWith('c', [{ toText: expect.any(Function) }], 'm', 0n);
    f.proof.assignmentGroup = 'b'; f.t.phase = 'cutover'; await f.operator.verifyReleased(f.t);
    f.proof.assignmentGroup = 'a'; f.t.phase = 'aborted'; await f.operator.beforeAbortUnlock(f.t);
    expect(f.actor.set_club_media_authority).toHaveBeenLastCalledWith('c', [], 'm', 1n);
  });
  it.each(['completeRegistry', 'metadataComplete', 'provenanceComplete', 'originalKeyAttested', 'privateFilePermissionsVerified',
    'sourceFenced', 'destinationFenced', 'originalPiiFenced', 'storesFenced', 'sharedQuotaReady'] as const)('refuses missing %s without CAS', async key => {
    const f = fixture(); f.proof[key] = false;
    await expect(f.operator.prepareCutover(f.t)).rejects.toThrow('proof'); expect(f.actor.set_club_media_authority).not.toHaveBeenCalled();
  });
  it('refuses a changed original verification key', async () => {
    const f = fixture(); f.actor.pii_vetkey_verification_key.mockResolvedValue(new Uint8Array(96).fill(2));
    await expect(f.operator.prepareCutover(f.t)).rejects.toThrow('key changed'); expect(f.actor.set_club_media_authority).not.toHaveBeenCalled();
  });
  it('does not restore until the abort is durably read back', async () => {
    const f = fixture(); await f.operator.prepareCutover(f.t);
    await expect(f.operator.beforeAbortUnlock({ ...f.t, phase: 'aborted' })).rejects.toThrow('Durable abort');
    expect(f.actor.set_club_media_authority).toHaveBeenCalledTimes(1);
  });
  it('rejects destination release before assignment cutover', async () => {
    const f = fixture(); await f.operator.prepareCutover(f.t);
    await expect(f.operator.verifyReleased({ ...f.t, phase: 'cutover' })).rejects.toThrow('proof');
  });
  it('rejects pending uploads and a foreign transfer', async () => {
    const f = fixture(); f.proof.pendingUploads = 1; await expect(f.operator.prepareCutover(f.t)).rejects.toThrow('proof');
    f.proof.pendingUploads = 0; await expect(f.operator.prepareCutover({ ...f.t, clubId: 'other' })).rejects.toThrow('another');
  });
});