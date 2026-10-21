import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryBinding } from './group-removal-recovery.mjs';
import { verifyGroupRelease } from './group-release-verification.mjs';
const inventory={deploymentId:'isolated',network:'pocketic',host:'https://isolated.invalid',revision:7n,authority:'identity',participants:
 ['events','identity'].map(id=>({id,domain:id,group:'g2',subnet:'local',module:'a'.repeat(64)}))};
const binding=recoveryBinding(inventory);
const fixture=()=>({readAuthenticatedInventory:async()=>inventory,verifyExclusiveControllerFence:async()=>true,
 readServiceReleaseEvidence:async p=>({canister:p.id,module:p.module,subnet:p.subnet,binding,rehearsalEnabled:false,productionProtocolVerified:true,authorityMirrorVerified:true,pendingWorkSettled:true}),
 verifyIndependentHistoryRecovery:async()=>true,verifyAllServiceInterruptionAcceptance:async()=>true,verifySignedInDeviceAcceptance:async()=>true});
test('read-only complete verification never grants opening',async()=>{const r=await verifyGroupRelease(inventory,fixture(),{binding,approved:true});assert.equal(r.ready,true);assert.equal(r.authorizesOpening,false)});
test('rehearsal wiring and unreleased production protocol fail closed',async()=>{const f=fixture(),read=f.readServiceReleaseEvidence;f.readServiceReleaseEvidence=async p=>({...await read(p),rehearsalEnabled:true,productionProtocolVerified:false});const r=await verifyGroupRelease(inventory,f,{binding,approved:true});assert.equal(r.ready,false);assert.equal(r.problems.length,4)});
test('missing one service or unresolved work prevents release readiness',async()=>{const f=fixture(),read=f.readServiceReleaseEvidence;f.readServiceReleaseEvidence=async p=>{if(p.id==='identity')throw Error('Unavailable');return {...await read(p),pendingWorkSettled:false}};const r=await verifyGroupRelease(inventory,f,{binding,approved:true});assert.equal(r.ready,false);assert.equal(r.problems.length,2)});
test('wrong approved revision cannot pass and does not mutate anything',async()=>{const r=await verifyGroupRelease(inventory,fixture(),{binding:recoveryBinding({...inventory,revision:8n}),approved:true});assert.equal(r.ready,false);assert.ok(r.problems.includes('Exact inventory and revision approval missing'))});
test('missing full recovery or device acceptance stays a blocker',async()=>{const f=fixture();f.verifyIndependentHistoryRecovery=async()=>false;f.verifySignedInDeviceAcceptance=async()=>false;const r=await verifyGroupRelease(inventory,f,{binding,approved:true});assert.equal(r.ready,false);assert.equal(r.problems.length,2)});