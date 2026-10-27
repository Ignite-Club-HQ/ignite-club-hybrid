import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupEnvironment, requireCleanupWiring, activateCleanupSettings, requireCleanupGithubProtection } from './private-name-cleanup-release-policy.mjs';
test('cleanup release refuses unprotected source and deployment settings',()=>{
  assert.throws(()=>requireCleanupGithubProtection({can_admins_bypass:true,protection_rules:[],deployment_branch_policy:null},{}));
  const env={can_admins_bypass:false,protection_rules:[{type:'required_reviewers',reviewers:[{id:1}]}],deployment_branch_policy:{custom_branch_policies:true}};
  const branch={enforce_admins:{enabled:true},allow_force_pushes:{enabled:false},allow_deletions:{enabled:false},required_pull_request_reviews:{required_approving_review_count:1}};
  assert.doesNotThrow(()=>requireCleanupGithubProtection(env,branch));
  assert.throws(()=>requireCleanupGithubProtection(env,{...branch,allow_force_pushes:{enabled:true}}));
});
test('cleanup approval preserves existing settings and enables only cleanup',()=>{
  const env=[{name:'VETKD_KEY_NAME',value:'key_1'},{name:'CUSTOM_SETTING',value:'preserve'}];
  for(const service of ['identity_access','club_domain','pii_access_control']) {
    const result=cleanupEnvironment(env,service);
    assert.equal(result.find(r=>r.name==='IGNITE_PRIVATE_NAME_CLEANUP_RELEASE').value,'1');
    for(const row of env)assert.deepEqual(result.find(r=>r.name===row.name),row);
    assert.equal(result.some(r=>r.name.includes('REHEARSAL')),false);
  }
  assert.equal(env.length,2);
});
test('unrelated rehearsal, duplicate settings and foreign targets fail closed',()=>{
  for(const name of ['IGNITE_PRIVATE_PROFILE_READS_REHEARSAL','IGNITE_PRIVATE_NAME_WRITER_REHEARSAL'])assert.throws(()=>cleanupEnvironment([{name,value:'1'}],'club_domain'));
  // The live account admission release switch (historical LOCAL_REHEARSAL name) is preserved, not mistaken for a rehearsal.
  assert.equal(cleanupEnvironment([{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'}],'club_domain').find(r=>r.name==='IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL')?.value,'1');
  assert.throws(()=>cleanupEnvironment([{name:'x',value:'1'},{name:'x',value:'2'}],'club_domain'));
  assert.throws(()=>cleanupEnvironment([],'shard_router'));
});
test('cleanup refuses legacy empty identity wiring',()=>{
  assert.throws(()=>requireCleanupWiring('club_domain',[['identity_access','']],'identity'));
  assert.doesNotThrow(()=>requireCleanupWiring('club_domain',[['identity_access','identity']],'identity'));
});
test('lost committed activation reads back without repeating settings mutation',async()=>{
  const steps=[{phase:'ready',oldSettingsHash:'old',newSettingsHash:'new'}];let hash='old',writes=0;
  const transport={gate:async()=>{},observe:async()=>({rawSettingsHash:hash}),persist:async()=>{},update:async()=>{writes++;hash='new';throw Error('lost reply');}};
  await assert.rejects(activateCleanupSettings(steps,transport),/lost reply/);
  assert.equal(steps[0].phase,'pending');
  await activateCleanupSettings(steps,transport);
  assert.equal(writes,1);assert.equal(steps[0].phase,'complete');
});
test('unknown absent activation stays locked without retry',async()=>{
  let writes=0;const steps=[{phase:'pending',oldSettingsHash:'old',newSettingsHash:'new'}];
  await assert.rejects(activateCleanupSettings(steps,{gate:async()=>{},observe:async()=>({rawSettingsHash:'old'}),persist:async()=>{},update:async()=>{writes++;}}),/without replay/);
  assert.equal(writes,0);assert.equal(steps[0].phase,'pending');
});