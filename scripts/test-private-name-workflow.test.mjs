import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateNameTestEnvironment, NAME_TEST_CANISTERS, runPrivateNameAcceptance } from './test-private-name-workflow.mjs';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
test('release acceptance compiles production identity with rehearsal disabled and runs club display fixture',()=>{
  const calls=[];
  runPrivateNameAcceptance({run:(executable,args,options)=>{
    calls.push({executable,args,env:{...options.env}});
    return {status:0,stdout:args[0]==='sources'?'--package core /tmp/core':''};
  }});
  const call=calls.find(c=>c.args.includes('src/live/privateClubNameDisplays.replica.test.tsx'));
  assert.ok(call);
  assert.equal(call.env.IGNITE_CLUB_DISPLAY_REPLICA,'1');
  assert.equal(call.env.IGNITE_PRIVATE_PROFILE_READS_REHEARSAL,undefined);
  const index=calls.indexOf(call),build=calls[index-1];
  assert.equal(build.executable,'cargo');
  assert.equal(build.env.IGNITE_PRIVATE_PROFILE_READS_REHEARSAL,undefined);
  assert.equal(build.args.includes('identity_access'),true);
});
test('failed acceptance retains a failed report, deletes fixture signing key and never runs later steps', () => {
  const directory = mkdtempSync(join(tmpdir(), 'name-workflow-rule-'));
  const reportPath = join(directory, 'report.json');
  let calls = 0, signer;
  try {
    assert.throws(() => runPrivateNameAcceptance({ reportPath, run: (_executable, _args, options) => {
      calls++; signer = options.env.PRIVATE_NAME_FIXTURE_SIGNER;
      assert.equal(existsSync(signer), true);
      return { status: 1 };
    } }), /no production action/);
    assert.equal(calls, 1); assert.equal(existsSync(signer), false);
    const report = JSON.parse(readFileSync(reportPath));
    assert.equal(report.passed, false); assert.equal(report.productionChanged, false);
    assert.equal(report.deploymentAuthorized, false); assert.equal(report.conversionAuthorized, false);
    assert.equal(report.steps.length, 1); assert.equal(report.steps[0].passed, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});