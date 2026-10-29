import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertMainDevOnly, assertMainMergeTarget } from './prod-main-dev-policy.mjs';
test('only main is a permitted final merge destination', () => {
  assert.doesNotThrow(() => assertMainMergeTarget('main'));
  assert.throws(() => assertMainMergeTarget('prod'));
  assert.throws(() => assertMainMergeTarget('hybrid'));
});
test('the pictured DEV database is permitted', () => {
  assert.doesNotThrow(() => assertMainDevOnly({ VITE_SUPABASE_URL: 'https://ecsdwrarzfexssxtrymj.supabase.co', VITE_SUPABASE_PROJECT_ID: 'ecsdwrarzfexssxtrymj', GITHUB_REF_NAME: 'main' }));
});
test('production database is refused before any work', () => {
  assert.throws(() => assertMainDevOnly({ VITE_SUPABASE_URL: 'https://yabcfiuntwqjwvschnji.supabase.co' }));
});
test('production branch is refused across CI branch signals', () => {
  for (const key of ['GITHUB_REF_NAME', 'GITHUB_HEAD_REF', 'GITHUB_BASE_REF', 'BRANCH', 'CM_BRANCH']) assert.throws(() => assertMainDevOnly({ [key]: 'prod' }));
  assert.throws(() => assertMainDevOnly({ GITHUB_REF: 'refs/heads/prod' }));
});
test('production hosting and native contexts refuse', () => {
  assert.throws(() => assertMainDevOnly({ CONTEXT: 'production' }));
  assert.throws(() => assertMainDevOnly({ LOVABLE_ENV: 'prod' }));
});
test('the current hybrid database is not the main DEV target', () => {
  assert.throws(() => assertMainDevOnly({ SUPABASE_URL: 'https://cdrxmelhysdqrccttsjg.supabase.co' }));
});