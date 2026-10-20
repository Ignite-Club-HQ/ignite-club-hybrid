import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MasterPublicKey } from '@icp-sdk/vetkeys';
import { Principal } from '@icp-sdk/core/principal';
import { configuredMainnetPhotoKey } from './media-key-mainnet.mjs';
import { attestDeployKey, verifyDeployKey } from './media-key-deploy-rules.mjs';

const binding = { deploymentId: 'mainnet', environment: 'ic', canisterId: 'iui5p-aaaaa-aaaal-qxllq-cai', keyName: 'key_1', host: 'https://icp-api.io', governor: 'g' };
test('mainnet expected key is derived without ingress management calls', async () => {
  const key = configuredMainnetPhotoKey(binding);
  assert.match(key, /^[a-f0-9]{192}$/);
  let saved;
  const d = { status: async () => ({ moduleHash: 'a'.repeat(64), controllers: ['g'] }), originalKey: async () => key, configuredKey: async () => configuredMainnetPhotoKey(binding), save: async r => { saved = r; } };
  const receipt = await attestDeployKey(binding, d);
  assert.equal(saved.publicKeyHex, key);
  await verifyDeployKey(binding, receipt, d);
});
test('expected key is bound to original canister and photo context', () => {
  const key = configuredMainnetPhotoKey(binding);
  assert.notEqual(key, configuredMainnetPhotoKey({ ...binding, canisterId: 'aaaaa-aa' }));
  const wrongContext = MasterPublicKey.productionKey().deriveCanisterKey(Principal.fromText(binding.canisterId).toUint8Array()).deriveSubKey(new TextEncoder().encode('wrong-context')).publicKeyBytes();
  assert.notEqual(key, Buffer.from(wrongContext).toString('hex'));
});
test('foreign deployment and unsupported key source fail closed', () => {
  for (const change of [{ deploymentId: 'engine' }, { environment: 'local' }, { keyName: 'test_key_1' }]) {
    assert.throws(() => configuredMainnetPhotoKey({ ...binding, ...change }), /requires mainnet/);
  }
});