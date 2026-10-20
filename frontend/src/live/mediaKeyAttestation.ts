/** Read-only pre-upgrade key attestation. Public verification material only;
 * never requests/decrypts a vetKey or changes canister configuration. */
type PrincipalLike = { toText(): string };
export type MediaKeyAttestation = { deploymentId: string; canisterId: string; moduleHash: string;
  keyName: 'key_1' | 'test_key_1'; context: 'ignite-pii-v1'; publicKeyHex: string };
const hex = (bytes: Uint8Array | number[]) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
export async function attestOriginalMediaKey(binding: { deploymentId: string; canister: PrincipalLike }, d: {
  /** Authenticated management status; callers must control the original canister. */
  readModuleHash(): Promise<string>;
  originalVerificationKey(): Promise<Uint8Array | number[]>;
  /** Real management vetkd_public_key, not a caller-supplied key catalogue. */
  vetkdPublicKey(args: { canister_id: [PrincipalLike]; context: Uint8Array;
    key_id: { curve: { bls12_381_g2: null }; name: string } }): Promise<{ public_key: Uint8Array | number[] }>;
  /** Sync under the same exclusive deployment lock, before any upgrade. */
  save(receipt: MediaKeyAttestation): Promise<void>;
}) {
  if (!binding.deploymentId || !binding.canister.toText()) throw new Error('Original deployment binding required');
  const moduleHash = await d.readModuleHash();
  if (!/^[a-f0-9]{64}$/.test(moduleHash)) throw new Error('Authenticated original module hash required');
  const original = hex(await d.originalVerificationKey());
  if (!/^[a-f0-9]{192}$/.test(original)) throw new Error('Invalid original vetKD public key');
  const matches: MediaKeyAttestation['keyName'][] = [];
  for (const name of ['key_1', 'test_key_1'] as const) {
    const reply = await d.vetkdPublicKey({ canister_id: [binding.canister], context: new TextEncoder().encode('ignite-pii-v1'),
      key_id: { curve: { bls12_381_g2: null }, name } });
    if (hex(reply.public_key) === original) matches.push(name);
  }
  if (matches.length !== 1) throw new Error('Original vetKD key name is ambiguous or unknown; upgrade blocked');
  const keyName = matches[0];
  if (!keyName) throw new Error('Original vetKD key name missing');
  if (await d.readModuleHash() !== moduleHash || hex(await d.originalVerificationKey()) !== original)
    throw new Error('Original canister changed during key attestation; upgrade blocked');
  const receipt: MediaKeyAttestation = { deploymentId: binding.deploymentId, canisterId: binding.canister.toText(),
    moduleHash, keyName, context: 'ignite-pii-v1', publicKeyHex: original };
  await d.save(receipt);
  return receipt;
}