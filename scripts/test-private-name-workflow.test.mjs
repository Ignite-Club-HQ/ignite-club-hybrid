import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateNameTestEnvironment, NAME_TEST_CANISTERS } from './test-private-name-workflow.mjs';

test('isolated acceptance never inherits production credentials or production signer configuration', () => {
  const env = privateNameTestEnvironment({ PATH: '/tools', HOME: '/home/test', DEPLOYER_PEM: 'must-not-pass', GH_TOKEN: 'must-not-pass', DEPLOY_IDENTITY_PEM: 'must-not-pass', IGNITE_PRIVATE_NAME_APPROVER_PUBLIC_KEY: 'production', SUPABASE_SERVICE_ROLE_KEY: 'must-not-pass' }, 'a'.repeat(64), '/tmp/fixture.pem');
  assert.equal(env.PATH, '/tools');
  assert.equal(env.DEPLOYER_PEM, undefined); assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.DEPLOY_IDENTITY_PEM, undefined); assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(env.IGNITE_PRIVATE_NAME_APPROVER_PUBLIC_KEY, 'a'.repeat(64));
  assert.equal(env.PRIVATE_NAME_FIXTURE_SIGNER, '/tmp/fixture.pem');
  assert.equal(env.IGNITE_NAME_EDIT_REPLICA, '1');
});
test('acceptance builds exactly the six required disposable Motoko services', () => {
  assert.deepEqual(NAME_TEST_CANISTERS, ['club_domain', 'messaging_domain', 'competition_domain', 'mini_league_domain', 'pii_access_control', 'media_blob_store']);
});
test('missing disposable signer refuses before compilation', () => {
  assert.throws(() => privateNameTestEnvironment({}, 'production', '/tmp/key'), /Disposable signer/);
  assert.throws(() => privateNameTestEnvironment({}, 'a'.repeat(64), ''), /Disposable signer/);
});