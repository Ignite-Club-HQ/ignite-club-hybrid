/** Operator-only original-key authorization preparation. This is NOT a move
 * gate: authenticated deployment/provenance and held fences must be proved by
 * the caller, and live encrypted moves stay blocked. Never changes crypto IDs. */
export type MediaKeyAuthority = { authority: string | null; revision: bigint; moveId: string };
export type MediaKeyBinding = { deploymentId: string; registryRevision: string; clubId: string; moveId: string;
  originalPiiCanister: string; destinationClubCanister: string };
export type MediaKeyReceipt = MediaKeyBinding & { before: MediaKeyAuthority; state: 'intent' | 'acknowledged'; after?: MediaKeyAuthority };
export type MediaKeyPreparationDeps = {
  /** Authenticate complete registry, original ciphertext provenance and held
   * source/destination/media fences; throw on any missing or changed proof. */
  verify(binding: MediaKeyBinding): Promise<void>;
  read(): Promise<MediaKeyAuthority>;
  set(authority: string, moveId: string, expectedRevision: bigint): Promise<MediaKeyAuthority>;
  load(): Promise<MediaKeyReceipt | null>;
  /** Durable under an exclusive operator lock, before returning. */
  save(receipt: MediaKeyReceipt): Promise<void>;
};
const same = (a: MediaKeyAuthority, b: MediaKeyAuthority) => a.authority === b.authority && a.revision === b.revision && a.moveId === b.moveId;
const valid = (a: MediaKeyAuthority) => a.revision >= 0n && (a.authority === null || a.authority.length > 0);
export function mediaKeyAuthorityPreparation(binding: MediaKeyBinding, d: MediaKeyPreparationDeps) {
  if (Object.values(binding).some(v => !v) || binding.originalPiiCanister === binding.destinationClubCanister)
    throw new Error('Invalid original media authority binding');
  return async () => {
    await d.verify(binding);
    let receipt = await d.load();
    if (receipt && Object.entries(binding).some(([key, value]) => receipt[key as keyof MediaKeyBinding] !== value))
      throw new Error('Media authority receipt belongs to another move');
    if (!receipt) {
      const before = await d.read(); if (!valid(before)) throw new Error('Invalid media authority receipt');
      receipt = { ...binding, before, state: 'intent' };
      await d.save(structuredClone(receipt)); // Never mutate before durable intent.
    }
    if (!valid(receipt.before)) throw new Error('Invalid media authority receipt');
    const expected = { authority: binding.destinationClubCanister, revision: receipt.before.revision + 1n, moveId: binding.moveId };
    if (receipt.state === 'acknowledged' && (!receipt.after || !same(receipt.after, expected)))
      throw new Error('Invalid media authority acknowledgement');
    const current = await d.read();
    if (receipt.state === 'acknowledged' || same(current, expected)) {
      if (!same(current, expected)) throw new Error('Media authority changed; retain fences');
    } else {
      if (!same(current, receipt.before)) throw new Error('Unknown media authority change; retain fences');
      await d.verify(binding); // Proof must still hold immediately before CAS.
      const result = await d.set(binding.destinationClubCanister, binding.moveId, receipt.before.revision);
      if (!same(result, expected)) throw new Error('Media authority acknowledgement mismatch; retain fences');
    }
    await d.verify(binding);
    if (!same(await d.read(), expected)) throw new Error('Media authority changed; retain fences');
    receipt.state = 'acknowledged'; receipt.after = expected;
    await d.save(structuredClone(receipt));
    return structuredClone(receipt);
  };
}