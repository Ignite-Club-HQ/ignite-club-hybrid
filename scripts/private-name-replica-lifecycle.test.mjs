import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcileNameReplicaLifecycle,reconcileRemovedMemberNames,removeMemberAndReconcileNames} from './private-name-replica-lifecycle.mjs';
const plan=action=>({operationId:'names:test',action,targets:[{sink:'original-g1',subject:'alias-1',club:'club-g2',ciphertext:[1,2],...(action==='refresh'?{originalCiphertext:[8,1]}:{})},{sink:'original-g2',subject:'alias-2',club:'club-g2',ciphertext:[3,4],...(action==='refresh'?{originalCiphertext:[8,2]}:{})}]});
function fixture(action){let journal=null,held=true,writes=0,lost=false;const states=new Map(action==='purge'?[['alias-1',{ciphertext:[1,2],scheme:'vetkey-club-names-v1:club-g2'}],['alias-2',{ciphertext:[3,4],scheme:'vetkey-club-names-v1:club-g2'}]]:[]);const mutate=async t=>{writes++;assert.equal((journal.lifecycle??journal).receipts.some(r=>r.phase==='unknown'),true);if(action==='purge')states.delete(t.subject);else states.set(t.subject,{ciphertext:t.ciphertext,scheme:`vetkey-club-names-v1:${t.club}`});if(lost){lost=false;throw Error('Lost committed reply');}};return {deps:{assertEvidence:async()=>held,readJournal:async()=>structuredClone(journal),persistJournal:async j=>{journal=structuredClone(j);},readState:async t=>structuredClone(states.get(t.subject)??null),writeSavedReplica:mutate,purgeExactReplica:mutate},states,lose:()=>{lost=true;},deny:()=>{held=false;},writes:()=>writes,journal:()=>journal};}
test('cross-authority alias purge requires exact acknowledgements for every target',async()=>{const f=fixture('purge');assert.deepEqual(await reconcileNameReplicaLifecycle(plan('purge'),f.deps),{completed:2,action:'purge'});assert.equal(f.states.size,0);assert.equal(f.writes(),2);});
test('refresh saved bytes across authorities and retain committed unknown without replay',async()=>{const f=fixture('refresh');f.lose();await assert.rejects(reconcileNameReplicaLifecycle(plan('refresh'),f.deps),/Lost committed/);assert.equal(f.journal().receipts[0].phase,'unknown');assert.equal(f.writes(),1);await reconcileNameReplicaLifecycle(plan('refresh'),f.deps);assert.equal(f.writes(),2);});
test('lost purge acknowledgement recovers from exact absence without replay',async()=>{const f=fixture('purge');f.lose();await assert.rejects(reconcileNameReplicaLifecycle(plan('purge'),f.deps));await reconcileNameReplicaLifecycle(plan('purge'),f.deps);assert.equal(f.writes(),2);});
test('unknown uncommitted write stays locked and never retried',async()=>{const f=fixture('refresh');f.deps.writeSavedReplica=async()=>{throw Error('unknown');};await assert.rejects(reconcileNameReplicaLifecycle(plan('refresh'),f.deps));await assert.rejects(reconcileNameReplicaLifecycle(plan('refresh'),f.deps),/never replay/);assert.equal(f.journal().receipts[0].phase,'unknown');});
test('foreign journal and duplicate targets cannot redirect cleanup',async()=>{const f=fixture('purge');f.lose();await assert.rejects(reconcileNameReplicaLifecycle(plan('purge'),f.deps));const changed=plan('purge');changed.targets[0].sink='foreign';await assert.rejects(reconcileNameReplicaLifecycle(changed,f.deps),/journal differs/);await assert.rejects(reconcileNameReplicaLifecycle({...plan('purge'),targets:[plan('purge').targets[0],plan('purge').targets[0]]},f.deps),/Duplicate/);});
test('denied authority or missing durable readback prevents mutations',async()=>{const f=fixture('purge');f.deny();await assert.rejects(reconcileNameReplicaLifecycle(plan('purge'),f.deps),/evidence required/);assert.equal(f.writes(),0);const g=fixture('purge');g.deps.persistJournal=async()=>{};await assert.rejects(reconcileNameReplicaLifecycle(plan('purge'),g.deps),/readback required/);assert.equal(g.writes(),0);});
test('changed previously acknowledged replica prevents completion',async()=>{const f=fixture('refresh');await reconcileNameReplicaLifecycle(plan('refresh'),f.deps);f.states.set('alias-1',{scheme:'vetkey-club-names-v1:club-g2',ciphertext:[9]});await assert.rejects(reconcileNameReplicaLifecycle(plan('refresh'),f.deps),/never replay/);assert.equal(f.writes(),2);});
test('plaintext target properties cannot enter durable lifecycle receipts',async()=>{const f=fixture('refresh'),p=plan('refresh');p.targets[0].name='Paul Cranwell';await assert.rejects(reconcileNameReplicaLifecycle(p,f.deps),/target required/);assert.equal(f.journal(),null);assert.equal(f.writes(),0);});
test('purge refuses a newer replica before persisting or deleting it',async()=>{const f=fixture('purge');f.states.set('alias-1',{scheme:'vetkey-club-names-v1:club-g2',ciphertext:[9]});await assert.rejects(reconcileNameReplicaLifecycle(plan('purge'),f.deps),/Replica changed/);assert.equal(f.writes(),0);assert.equal(f.journal(),null);});
test('refresh recovery cannot substitute another original name generation',async()=>{const f=fixture('refresh');f.lose();await assert.rejects(reconcileNameReplicaLifecycle(plan('refresh'),f.deps));const changed=plan('refresh');changed.targets[0].originalCiphertext=[9];await assert.rejects(reconcileNameReplicaLifecycle(changed,f.deps),/journal differs/);assert.equal(f.writes(),1);});
test('top-level plaintext never enters the retained lifecycle journal',async()=>{const f=fixture('refresh');await assert.rejects(reconcileNameReplicaLifecycle({...plan('refresh'),name:'Paul Cranwell'},f.deps),/dependencies/);assert.equal(f.journal(),null);assert.equal(f.writes(),0);});
const removedAccounts=[{accountId:'account',principals:['alias-1','alias-2']}];
test('removed-member cleanup verifies every alias and reuses exact recoverable purge',async()=>{
  const f=fixture('purge'),seen=new Set();const result=await reconcileRemovedMemberNames(plan('purge'),{...f.deps,accounts:removedAccounts,readMembership:async t=>{seen.add(t.subject);return false;}});
  assert.deepEqual(result,{completed:2,action:'purge'});assert.deepEqual([...seen],['alias-1','alias-2']);assert.equal(f.writes(),2);
});
test('remaining role on any alias or unverified membership blocks removal cleanup',async()=>{
  for(const reply of [true,undefined,null]){const f=fixture('purge');await assert.rejects(reconcileRemovedMemberNames(plan('purge'),{...f.deps,accounts:removedAccounts,readMembership:async t=>t.subject==='alias-2'?reply:false}),/still has membership/);assert.equal(f.writes(),0);}
});
test('membership restored during cleanup stops before another purge',async()=>{
  const f=fixture('purge');let restored=false;const purge=f.deps.purgeExactReplica;f.deps.purgeExactReplica=async t=>{await purge(t);restored=true;};
  await assert.rejects(reconcileRemovedMemberNames(plan('purge'),{...f.deps,accounts:removedAccounts,readMembership:async()=>restored}),/still has membership/);assert.equal(f.writes(),1);assert.equal(f.journal().receipts[0].phase,'unknown');
});
test('lost removed-member purge reply recovers by readback without replay',async()=>{
  const f=fixture('purge');f.lose();const deps={...f.deps,accounts:removedAccounts,readMembership:async()=>false};await assert.rejects(reconcileRemovedMemberNames(plan('purge'),deps),/Lost committed/);await reconcileRemovedMemberNames(plan('purge'),deps);assert.equal(f.writes(),2);
});
function removalFixture(){
  const f=fixture('purge'),members=new Set(['alias-1','alias-2']);let removals=0,lost=false;
  return {...f,members,removals:()=>removals,loseRemoval:()=>{lost=true;},deps:{...f.deps,accounts:removedAccounts,
    readMembership:async t=>members.has(t.subject),removeMember:async t=>{assert.equal(f.journal().receipts.some(r=>r.phase==='unknown'),true);removals++;members.delete(t.subject);if(lost){lost=false;throw Error('Lost committed removal reply');}},
  }};
}
test('authorized removal commits every account alias before exact name cleanup',async()=>{
  const f=removalFixture();assert.deepEqual(await removeMemberAndReconcileNames(plan('purge'),f.deps),{completed:2,action:'purge'});assert.equal(f.removals(),2);assert.equal(f.writes(),2);assert.equal(f.members.size,0);assert.equal(f.journal().lifecycle.receipts.every(r=>r.phase==='verified'),true);
});
test('lost committed removal recovers by membership readback without repeating removal',async()=>{
  const f=removalFixture();f.loseRemoval();await assert.rejects(removeMemberAndReconcileNames(plan('purge'),f.deps),/Lost committed removal/);assert.equal(f.writes(),0);assert.equal(f.removals(),1);await removeMemberAndReconcileNames(plan('purge'),f.deps);assert.equal(f.removals(),2);assert.equal(f.writes(),2);
});
test('unknown uncommitted removal never repeats or starts name cleanup',async()=>{
  const f=removalFixture();let calls=0;f.deps.removeMember=async()=>{calls++;throw Error('unknown removal');};await assert.rejects(removeMemberAndReconcileNames(plan('purge'),f.deps),/unknown removal/);await assert.rejects(removeMemberAndReconcileNames(plan('purge'),f.deps),/never replay/);assert.equal(calls,1);assert.equal(f.writes(),0);
});
test('combined removal retains lost purge and resumes without repeating either write',async()=>{
  const f=removalFixture();f.lose();await assert.rejects(removeMemberAndReconcileNames(plan('purge'),f.deps),/Lost committed/);assert.equal(f.journal().lifecycle.receipts[0].phase,'unknown');await removeMemberAndReconcileNames(plan('purge'),f.deps);assert.equal(f.removals(),2);assert.equal(f.writes(),2);
});
test('denied removal, unverified membership and nondurable intent never purge names',async()=>{
  for(const mode of ['denied','unverified','disk']){const f=removalFixture();if(mode==='denied')f.deps.removeMember=async()=>{throw Error('Club admin required');};if(mode==='unverified')f.deps.readMembership=async()=>undefined;if(mode==='disk')f.deps.persistJournal=async()=>{};await assert.rejects(removeMemberAndReconcileNames(plan('purge'),f.deps));assert.equal(f.removals(),0);assert.equal(f.writes(),0);}
});
test('rejoined alias blocks combined cleanup and never repeats an acknowledged removal',async()=>{
  const f=removalFixture();f.lose();await assert.rejects(removeMemberAndReconcileNames(plan('purge'),f.deps));f.members.add('alias-1');await assert.rejects(removeMemberAndReconcileNames(plan('purge'),f.deps),/never replay/);assert.equal(f.removals(),2);assert.equal(f.writes(),1);
});
test('foreign, mixed-club or plaintext removal plans refuse before any mutation',async()=>{
  for(const alter of [p=>{p.targets[1].club='other-club';},p=>{p.targets[0].subject='foreign';},p=>{p.targets[0].name='Personal name';}]){const f=removalFixture(),p=plan('purge');alter(p);await assert.rejects(removeMemberAndReconcileNames(p,f.deps));assert.equal(f.removals(),0);assert.equal(f.writes(),0);assert.equal(f.journal(),null);}
});
test('changed saved replica blocks membership removal as well as name purge',async()=>{
  const f=removalFixture();f.states.set('alias-1',{scheme:'vetkey-club-names-v1:club-g2',ciphertext:[9]});await assert.rejects(removeMemberAndReconcileNames(plan('purge'),f.deps),/Replica changed/);assert.equal(f.removals(),0);assert.equal(f.writes(),0);
});