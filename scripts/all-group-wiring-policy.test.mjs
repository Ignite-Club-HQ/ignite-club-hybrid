import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyClubLifecycleDisabled, validateClubIdentityWiring } from './all-group-wiring-policy.mjs';
import { digest } from './all-group-upgrade-policy.mjs';
const identity = 'mq2sj-fiaaa-aaaal-qxlqa-cai';
const g1 = {groupId:'g1',name:'club_domain',canisterId:'mzzzv-taaaa-aaaal-qxlrq-cai'};
const legacyRows = [['club_domain',g1.canisterId],['identity_access','']];
test('pinned original Group 1 preserves one explicit empty legacy authority without altering rows', () => {
  const before = digest(legacyRows);
  validateClubIdentityWiring(g1,legacyRows,identity,legacyClubLifecycleDisabled([]));
  assert.equal(digest(legacyRows),before);
  assert.equal(legacyRows[1][1],'');
});
test('Group 2 and future groups still require the exact shared identity singleton', () => {
  for (const groupId of ['g2','g3','g99']) {
    const target = {...g1,groupId,canisterId:'other-club-cai'};
    assert.throws(()=>validateClubIdentityWiring(target,legacyRows,identity,true));
    validateClubIdentityWiring(target,[['identity_access',identity]],identity,false);
  }
});
test('wrong principals, missing rows, duplicate rows and unpinned targets refuse legacy compatibility', () => {
  for (const rows of [[],[['identity_access','other-identity-cai']],[['identity_access',''],['identity_access',identity]],[['identity_access',identity],['identity_access',identity]]]) {
    assert.throws(()=>validateClubIdentityWiring(g1,rows,identity,true));
  }
  assert.throws(()=>validateClubIdentityWiring({...g1,canisterId:'other-club-cai'},legacyRows,identity,true));
  assert.throws(()=>validateClubIdentityWiring(g1,legacyRows,'other-identity-cai',true));
  assert.throws(()=>validateClubIdentityWiring({...g1,name:'notification_queue'},legacyRows,identity,true));
});
test('any admission, deletion, identity or creator-placement binding blocks empty legacy wiring', () => {
  for (const name of ['IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL','IGNITE_ACCOUNT_SERVICE_IDENTITY','IGNITE_BOUND_DELETION_RELEASE','IGNITE_NEW_CLUB_PLACEMENT_ROUTER','IGNITE_NEW_CLUB_PLACEMENT_GROUP','IGNITE_NEW_CLUB_PLACEMENT_TARGET']) {
    for (const value of ['1','unknown','']) {
      const disabled = legacyClubLifecycleDisabled([{name,value}]);
      assert.equal(disabled,false);
      assert.throws(()=>validateClubIdentityWiring(g1,legacyRows,identity,disabled));
    }
  }
});
test('missing environment evidence and duplicate switches cannot qualify as disabled', () => {
  assert.equal(legacyClubLifecycleDisabled(undefined),false);
  assert.equal(legacyClubLifecycleDisabled([{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'0'},{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'0'}]),false);
  assert.equal(legacyClubLifecycleDisabled([{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'0'},{name:'IGNITE_BOUND_DELETION_RELEASE',value:'0'}]),true);
});
test('exact authority remains valid without legacy compatibility and raw row changes remain detectable', () => {
  validateClubIdentityWiring(g1,[['identity_access',identity]],identity,false);
  assert.notEqual(digest(legacyRows),digest([['club_domain',g1.canisterId],['identity_access',identity]]));
  assert.throws(()=>validateClubIdentityWiring(g1,legacyRows,identity,false));
});