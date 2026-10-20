/** Operator-only original-key authorization preparation. This is NOT a move
 * gate: authenticated deployment/provenance and held fences must be proved by
 * the caller, and live encrypted moves stay blocked. Never changes crypto IDs. */
export type MediaKeyAuthority = { authority: string | null; revision: bigint; moveId: string };
export type MediaKeyBinding = { deploymentId: string; registryRevision: string; clubId: string; moveId: string;
  originalPiiCanister: string; destinationClubCanister: string };
export type MediaKeyReceipt = MediaKeyBinding & { before: MediaKeyAuthority; state: 'intent' | 'acknowledged' | 'restore-intent' | 'restored'; after?: MediaKeyAuthority; restored?: MediaKeyAuthority };
export type MediaKeyPreparationDeps = {
  /** Authenticate complete registry, original ciphertext provenance and held
   * source/destination/media fences; throw on any missing or changed proof. */
  verify(binding: MediaKeyBinding): Promise<void>;
  read(): Promise<MediaKeyAuthority>;
  set(authority: string | null, moveId: string, expectedRevision: bigint): Promise<MediaKeyAuthority>;
  load(): Promise<MediaKeyReceipt | null>;
  /** Durable under an exclusive operator lock, before returning. */
  save(receipt: MediaKeyReceipt): Promise<void>;
};
const same = (a: MediaKeyAuthority, b: MediaKeyAuthority) => a.authority === b.authority && a.revision === b.revision && a.moveId === b.moveId;
const valid = (a: MediaKeyAuthority) => a && typeof a.revision === 'bigint' && a.revision >= 0n &&
  typeof a.moveId === 'string' && (a.authority === null || typeof a.authority === 'string' && a.authority.length > 0);
function validateBinding(binding: MediaKeyBinding) {
  if (Object.values(binding).some(v => typeof v !== 'string' || !v || v.includes('\u001f')) ||
      binding.clubId.includes('/') || binding.clubId.length > 64 || binding.moveId.length > 128 ||
      binding.originalPiiCanister === binding.destinationClubCanister)
    throw new Error('Invalid original media authority binding');
}
function validateReceipt(receipt: MediaKeyReceipt, binding: MediaKeyBinding) {
  if (Object.entries(binding).some(([key, value]) => receipt[key as keyof MediaKeyBinding] !== value))
    throw new Error('Media authority receipt belongs to another move');
  if (!['intent', 'acknowledged', 'restore-intent', 'restored'].includes(receipt.state) || !valid(receipt.before))
    throw new Error('Invalid media authority receipt');
  const expected = { authority: binding.destinationClubCanister, revision: receipt.before.revision + 1n, moveId: binding.moveId };
  if (receipt.after && (!valid(receipt.after) || !same(receipt.after, expected)) ||
      receipt.state === 'acknowledged' && !receipt.after)
    throw new Error('Invalid media authority acknowledgement');
  if (receipt.state === 'restored' && (!receipt.restored || !valid(receipt.restored)))
    throw new Error('Invalid media authority restoration');
}
export function mediaKeyAuthorityPreparation(binding: MediaKeyBinding, d: MediaKeyPreparationDeps) {
  validateBinding(binding);
  return async () => {
    await d.verify(binding);
    let receipt = await d.load();
    if (receipt) {
      validateReceipt(receipt, binding);
      if (receipt.state === 'restore-intent' || receipt.state === 'restored') throw new Error('Media authority restoration started; retain fences');
    }
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

/** Only callable after a DURABLE abort, with fresh consensus proof that the
 * source still owns placement and all relevant fences remain held. Never
 * releases locks; a null original override restores the original default. */
export function mediaKeyAuthorityRestoration(binding: MediaKeyBinding, d: MediaKeyPreparationDeps & {
  verifyAbort(binding: MediaKeyBinding): Promise<void>;
}) {
  validateBinding(binding);
  return async () => {
    await d.verifyAbort(binding);
    const receipt = await d.load();
    if (!receipt) throw new Error('Media authority receipt required for abort recovery');
    validateReceipt(receipt, binding);
    const destination = { authority: binding.destinationClubCanister, revision: receipt.before.revision + 1n, moveId: binding.moveId };
    const restored = { authority: receipt.before.authority, revision: destination.revision + 1n, moveId: binding.moveId };
    const current = await d.read();
    if (receipt.state === 'restored') {
      const recorded = receipt.restored;
      if (!recorded || !(same(recorded, receipt.before) || same(recorded, restored)) || !same(current, recorded))
        throw new Error('Media authority changed after restoration; retain fences');
    } else {
      if (receipt.state !== 'restore-intent') {
        if (!same(current, destination) && !(receipt.state === 'intent' && same(current, receipt.before)))
          throw new Error('Unknown media authority change; retain fences');
        receipt.state = 'restore-intent';
        // Store exact intended outcome, including a no-change abort. This
        // distinguishes a lost restore response from an unexecuted forward CAS.
        receipt.restored = same(current, receipt.before) ? receipt.before : restored;
        await d.save(structuredClone(receipt));
      }
      const target = receipt.restored;
      if (!target || !(same(target, receipt.before) || same(target, restored)))
        throw new Error('Invalid media authority restore intent');
      if (!same(current, target)) {
        if (!same(target, restored) || !same(current, destination))
          throw new Error('Unknown media authority change; retain fences');
        await d.verifyAbort(binding);
        const result = await d.set(target.authority, binding.moveId, destination.revision);
        if (!same(result, target)) throw new Error('Media authority restore mismatch; retain fences');
      }
    }
    await d.verifyAbort(binding);
    if (!receipt.restored || !same(await d.read(), receipt.restored)) throw new Error('Media authority restore not confirmed; retain fences');
    receipt.state = 'restored';
    await d.save(structuredClone(receipt));
    return structuredClone(receipt);
  };
}