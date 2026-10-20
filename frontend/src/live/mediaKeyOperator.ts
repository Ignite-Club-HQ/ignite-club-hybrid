/** Operator-only composition. All reads must use governor-authenticated update
 * actors on the approved deployment; never mount this in ordinary app startup.
 * Missing provenance/permissions keeps encrypted moves blocked. */
import { mediaKeyAuthorityPreparation, mediaKeyAuthorityRestoration, type MediaKeyAuthority, type MediaKeyBinding, type MediaKeyReceipt } from './mediaKeyAuthorityPreparation';
import type { Transfer } from './groupTransfer';

type PrincipalLike = { toText(): string };
type Result<T> = { Ok: T } | { Err: string };
export type OriginalMediaKeyActor = {
  read_club_media_authority(club: string): Promise<Result<{ authority: [] | [PrincipalLike]; revision: bigint; move_id: string }>>;
  set_club_media_authority(club: string, authority: [] | [PrincipalLike], move: string, revision: bigint): Promise<Result<{ authority: [] | [PrincipalLike]; revision: bigint; move_id: string }>>;
  pii_vetkey_verification_key(): Promise<Uint8Array | number[]>;
};
export type MediaKeyOperatorProof = {
  deploymentId: string; registryRevision: string; clubId: string; moveId: string;
  originalPiiCanister: string; destinationClubCanister: string;
  assignmentGroup: string; sourceGroup: string; destinationGroup: string;
  completeRegistry: boolean; metadataComplete: boolean; provenanceComplete: boolean;
  originalKeyAttested: boolean; privateFilePermissionsVerified: boolean;
  sourceFenced: boolean; destinationFenced: boolean; originalPiiFenced: boolean; storesFenced: boolean;
  pendingUploads: number; sharedQuotaReady: boolean;
};
const unwrap = <T>(r: Result<T>) => { if ('Err' in r) throw new Error(r.Err); return r.Ok; };
const normalize = (r: { authority: [] | [PrincipalLike]; revision: bigint; move_id: string }): MediaKeyAuthority =>
  ({ authority: r.authority[0]?.toText() ?? null, revision: r.revision, moveId: r.move_id });
const keyHex = (v: Uint8Array | number[]) => [...v].map(b => b.toString(16).padStart(2, '0')).join('');

export function createMediaKeyOperator(binding: MediaKeyBinding, d: {
  originalActor: OriginalMediaKeyActor;
  principal(id: string): PrincipalLike;
  /** Public verification key attested BEFORE the first key-pinning upgrade.
   * Do not learn this baseline from the possibly already changed actor. */
  attestedPublicKeyHex: string;
  readProof(): Promise<MediaKeyOperatorProof>;
  loadTransfer(): Promise<Transfer>;
  load(): Promise<MediaKeyReceipt | null>;
  save(receipt: MediaKeyReceipt): Promise<void>;
}) {
  if (!/^[a-f0-9]{192}$/.test(d.attestedPublicKeyHex)) throw new Error('Attested original vetKD public key required');
  const verify = async (assignment: 'source' | 'destination') => {
    const p = await d.readProof();
    if (Object.entries(binding).some(([k, v]) => p[k as keyof MediaKeyBinding] !== v) ||
        !p.sourceGroup || !p.destinationGroup || p.sourceGroup === p.destinationGroup ||
        p.assignmentGroup !== (assignment === 'source' ? p.sourceGroup : p.destinationGroup) ||
        !p.completeRegistry || !p.metadataComplete || !p.provenanceComplete || !p.originalKeyAttested ||
        !p.privateFilePermissionsVerified || !p.sourceFenced || !p.destinationFenced || !p.originalPiiFenced ||
        !p.storesFenced || p.pendingUploads !== 0 || !p.sharedQuotaReady)
      throw new Error('Incomplete or changed original photo authority proof; retain fences');
    if (keyHex(await d.originalActor.pii_vetkey_verification_key()) !== d.attestedPublicKeyHex)
      throw new Error('Original vetKD public key changed; retain fences');
    return p;
  };
  const checkTransfer = (t: Transfer, p: MediaKeyOperatorProof) => {
    if (t.clubId !== binding.clubId || t.fromGroup !== p.sourceGroup || t.toGroup !== p.destinationGroup)
      throw new Error('Transfer belongs to another photo authority binding');
  };
  const deps = {
    verify: async () => { await verify('source'); },
    read: async () => normalize(unwrap(await d.originalActor.read_club_media_authority(binding.clubId))),
    set: async (authority: string | null, move: string, revision: bigint) => normalize(unwrap(
      await d.originalActor.set_club_media_authority(binding.clubId, authority === null ? [] : [d.principal(authority)], move, revision))),
    load: d.load, save: d.save,
  };
  const prepare = mediaKeyAuthorityPreparation(binding, deps);
  const restore = mediaKeyAuthorityRestoration(binding, { ...deps, verifyAbort: async () => {
    const t = await d.loadTransfer(); const p = await verify('source'); checkTransfer(t, p);
    if (t.phase !== 'aborted') throw new Error('Durable abort required before photo authority restoration');
  } });
  return {
    async prepareCutover(t: Transfer) {
      const p = await verify('source'); checkTransfer(t, p);
      if (t.phase !== 'verified') throw new Error('Verified transfer required before photo authority preparation');
      await prepare();
    },
    async beforeAbortUnlock(t: Transfer) {
      if (t.phase !== 'aborted') throw new Error('Abort must precede photo authority unlock');
      const durable = await d.loadTransfer(); const p = await verify('source'); checkTransfer(t, p); checkTransfer(durable, p);
      if (durable.phase !== 'aborted') throw new Error('Durable abort required');
      // If preparation never started, no key mutation may have occurred.
      // Require a receipt rather than guessing it is safe to release.
      await restore();
    },
    async verifyReleased(t: Transfer) {
      const p = await verify('destination'); checkTransfer(t, p);
      if (t.phase !== 'cutover' && t.phase !== 'released') throw new Error('Cutover required before photo authority release');
      const receipt = await d.load(); const state = await deps.read();
      if (!receipt || Object.entries(binding).some(([k, v]) => receipt[k as keyof MediaKeyBinding] !== v) ||
          receipt.state !== 'acknowledged' || !receipt.after || state.authority !== binding.destinationClubCanister ||
          state.moveId !== binding.moveId || state.revision !== receipt.before.revision + 1n ||
          receipt.after.authority !== state.authority || receipt.after.revision !== state.revision || receipt.after.moveId !== state.moveId)
        throw new Error('Destination photo authority not durably confirmed; retain fences');
    },
  };
}