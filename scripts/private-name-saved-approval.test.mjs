import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {preparePrivateNameArtifact} from './private-name-plan-artifact.mjs';
import {prepareSignedNameApproval,verifySavedNameApproval,saveSignedNameApproval,readSavedNameApproval} from './private-name-saved-approval.mjs';
import {executeSavedApprovedNamePlan} from './private-name-approved-execution.mjs';
async function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'name-approval-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const keys=generateKeyPairSync('ed25519');const publicKey=keys.publicKey.export({type:'spki',format:'pem'});
  const artifact=await preparePrivateNameArtifact({identityId:'identity',operator:'governor',deploymentHash:'a'.repeat(64),inventoryHash:'b'.repeat(64),historyRevision:'7',sinks:[{id:'pii',publicKey:[1]}],rows:[{accountId:'a',subject:'person',sink:'pii',name:'Private Name',clubs:[]}]},{encryptName:async()=>[2],encryptClubName:async()=>[3]});
  const binding={artifact,expectedHash:artifact.hash,approver:'Paul',approvalId:'explicit-event-1',action:'convert',publicKey};
  const envelope=await prepareSignedNameApproval(binding,{publicKey,signApprovedEvent:async(_body,bytes)=>sign(null,bytes,keys.privateKey)});
  return {binding,envelope,path:join(dir,'approval'),keys};
}
test('signed approval persists and reopens exact plan without plaintext or key material',async t=>{
  const s=await fixture(t);assert.equal(saveSignedNameApproval(s.path,s.envelope,s.binding).approvalId,'explicit-event-1');
  assert.equal(readSavedNameApproval(s.path,s.binding).approvalScope,'names');assert.equal(readFileSync(s.path,'utf8').includes('Private Name'),false);
  assert.deepEqual(saveSignedNameApproval(s.path,s.envelope,s.binding),readSavedNameApproval(s.path,s.binding));
});
test('forged signature, different event/approver and recovery substitution are refused',async t=>{
  const s=await fixture(t);
  assert.throws(()=>verifySavedNameApproval({...s.envelope,signature:'0'.repeat(128)},s.binding),/signature/);
  for(const change of [{approvalId:'other'},{approver:'someone'},{action:'recover'}])assert.throws(()=>verifySavedNameApproval(s.envelope,{...s.binding,...change}),/binding/);
  const other=generateKeyPairSync('ed25519');assert.throws(()=>verifySavedNameApproval(s.envelope,{...s.binding,publicKey:other.publicKey.export({type:'spki',format:'pem'})}),/signature/);
});
test('corrupt or interrupted saved approval never overwrites original file',async t=>{
  const s=await fixture(t);for(const content of ['', '{partial']){
    writeFileSync(s.path,content,{mode:0o600});assert.throws(()=>saveSignedNameApproval(s.path,s.envelope,s.binding));assert.equal(readFileSync(s.path,'utf8'),content);
  }
});
test('plaintext/extra envelope properties are rejected',async t=>{
  const s=await fixture(t);assert.throws(()=>verifySavedNameApproval({...s.envelope,body:{...s.envelope.body,name:'Private Name'}},s.binding),/Strict/);
});
test('invalid saved approval blocks execution before lock or network activity',async t=>{
  const s=await fixture(t);writeFileSync(s.path,'invalid',{mode:0o600});let entered=false;
  await assert.rejects(executeSavedApprovedNamePlan({artifact:s.binding.artifact,expectedHash:s.binding.expectedHash,approvalPath:s.path,approvalBinding:s.binding},{executionLock:{enter:async()=>{entered=true;}}}));
  assert.equal(entered,false);
});
test('saved approval deletion during lock entry stops before any authority reads',async t=>{
  const s=await fixture(t);saveSignedNameApproval(s.path,s.envelope,s.binding);let reads=0;
  await assert.rejects(executeSavedApprovedNamePlan({artifact:s.binding.artifact,expectedHash:s.binding.expectedHash,approvalPath:s.path,approvalBinding:s.binding},{
    assertExecution:async()=>true,journal:{ids:()=>[],get:()=>undefined},piiBySink:new Map([['pii',{}]]),coordinator:{},
    executionLock:{enter:async()=>{rmSync(s.path);return true;},assertHeld:async()=>true},identity:{listProfiles:async()=>{reads++;return [];}}
  }),/ENOENT/);assert.equal(reads,0);
});