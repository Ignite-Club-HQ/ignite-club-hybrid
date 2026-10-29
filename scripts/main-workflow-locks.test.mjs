import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowsJob, isMainPermanentlyBlocked, jobGate } from './main-workflow-locks.mjs';
test('main has zero jobs without explicit enablement', () => {
  for (const event of ['push', 'schedule', 'pull_request', 'workflow_dispatch']) assert.equal(allowsJob({ref:'refs/heads/main',event}), false);
});
test('only manually enabled main jobs run, never automatic triggers', () => {
  assert.equal(allowsJob({ref:'refs/heads/main',event:'workflow_dispatch',enabled:true,individual:true}), true);
  assert.equal(allowsJob({ref:'refs/heads/main',event:'push',enabled:true,individual:true}), false);
  assert.equal(allowsJob({ref:'refs/heads/main',event:'workflow_dispatch',enabled:true}), false);
});
test('review branch and main pull requests cannot execute jobs', () => {
  assert.equal(allowsJob({ref:'refs/heads/integration-hybrid',event:'workflow_dispatch',enabled:true,individual:true}), false);
  assert.equal(allowsJob({ref:'refs/pull/1/merge',base:'main',event:'pull_request',enabled:true,individual:true}), false);
});
test('production branch behavior is preserved, never enabled from main', () => {
  assert.equal(allowsJob({ref:'refs/heads/prod',event:'push',blocked:true}), true);
  assert.equal(allowsJob({ref:'refs/pull/1/merge',base:'prod',event:'pull_request',blocked:true}), true);
  assert.equal(allowsJob({ref:'refs/heads/main',event:'workflow_dispatch',enabled:true,individual:true,blocked:true}), false);
});
test('source workflows remain unchanged and unsafe database jobs stay blocked', () => {
  assert.equal(allowsJob({repository:'Ignite-Club-HQ/ignite-club-hybrid',ref:'refs/heads/main',event:'push'}), true);
  assert.equal(isMainPermanentlyBlocked('backup.yml','SUPABASE_DB_PASSWORD: secret'), true);
  assert.equal(isMainPermanentlyBlocked('promote-to-prod.yml','PROD_REF: anything'), true);
  assert.equal(isMainPermanentlyBlocked('deploy-dev-function.yml','DEV_REF: ecsdwrarzfexssxtrymj'), false);
  assert.match(jobGate('test.yml',''), /IGNITE_MAIN_WORKFLOWS_ENABLED/);
});