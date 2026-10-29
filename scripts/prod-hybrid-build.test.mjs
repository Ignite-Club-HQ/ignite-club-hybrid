import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProdHybridEnv, runProdHybridBuild } from './prod-hybrid-build.mjs';

const env = {
  IGNITE_BUILD_TARGET: 'hybrid',
  IGNITE_EXPECTED_SUPABASE_URL: 'https://ecsdwrarzfexssxtrymj.supabase.co',
  VITE_SUPABASE_URL: 'https://ecsdwrarzfexssxtrymj.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
};
test('no explicit selection refuses all work', () => {
  assert.throws(() => runProdHybridBuild({ ...env, IGNITE_BUILD_TARGET: '' }, () => assert.fail('must not run'), () => assert.fail('must not publish')));
});
test('verified target and retained public key map exactly', () => {
  const result = resolveProdHybridEnv(env);
  assert.equal(result.IGNITE_LIVE_SUPABASE_URL, 'https://ecsdwrarzfexssxtrymj.supabase.co');
  assert.equal(result.IGNITE_LIVE_SUPABASE_ANON_KEY, 'sb_publishable_fixture');
});
test('missing target cannot fall back to a committed environment', () => {
  assert.throws(() => resolveProdHybridEnv({ ...env, VITE_SUPABASE_URL: '' }));
});
test('unverified target refuses work', () => {
  assert.throws(() => resolveProdHybridEnv({ ...env, IGNITE_EXPECTED_SUPABASE_URL: '' }));
});
test('different retained targets are never silently replaced', () => {
  assert.throws(() => resolveProdHybridEnv({ ...env, IGNITE_LIVE_SUPABASE_URL: 'https://other.supabase.co' }));
});
test('conflicting public keys refuse', () => {
  assert.throws(() => resolveProdHybridEnv({ ...env, IGNITE_LIVE_SUPABASE_ANON_KEY: 'sb_publishable_other' }));
});
test('private opaque keys refuse', () => {
  assert.throws(() => resolveProdHybridEnv({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_fixture' }));
});
const jwt = payload => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
test('service-role JWT refuses', () => {
  assert.throws(() => resolveProdHybridEnv({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'service_role', ref: 'target' }) }));
});
test('anon JWT must belong to exact target', () => {
  assert.throws(() => resolveProdHybridEnv({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'anon', ref: 'other' }) }));
  assert.equal(resolveProdHybridEnv({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'anon', ref: 'ecsdwrarzfexssxtrymj' }) }).IGNITE_LIVE_SUPABASE_URL, 'https://ecsdwrarzfexssxtrymj.supabase.co');
});
test('Supabase verification cannot be skipped', () => {
  assert.throws(() => resolveProdHybridEnv({ ...env, IGNITE_LIVE_ICP_ONLY: '1' }));
});
test('failed build never publishes and validation precedes installation', () => {
  const steps = [];
  assert.throws(() => runProdHybridBuild(env, step => { steps.push(step); return step === 'build' ? 1 : 0; }, () => assert.fail('must not publish')));
  assert.deepEqual(steps, ['config', 'install', 'guards', 'build']);
});
test('success publishes once after all checks', () => {
  let published = 0;
  runProdHybridBuild(env, () => 0, () => { published++; });
  assert.equal(published, 1);
});