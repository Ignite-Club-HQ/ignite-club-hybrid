import { MasterPublicKey } from '@icp-sdk/vetkeys';
import { Principal } from '@icp-sdk/core/principal';

/** Public-only derivation; other networks require their own verified source. */
export function configuredMainnetPhotoKey({ deploymentId, environment, canisterId, keyName }) {
  if (deploymentId !== 'mainnet' || environment !== 'ic' || keyName !== 'key_1') {
    throw new Error('Canonical mainnet photo-key derivation requires mainnet/ic/key_1; other targets need their own verified key source');
  }
  return Buffer.from(MasterPublicKey.productionKey()
    .deriveCanisterKey(Principal.fromText(canisterId).toUint8Array())
    .deriveSubKey(new TextEncoder().encode('ignite-pii-v1'))
    .publicKeyBytes()).toString('hex');
}