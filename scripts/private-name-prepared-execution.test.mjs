import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preparePrivateNameArtifact} from './private-name-plan-artifact.mjs';
import {executePreparedPrivateNamePlan} from './private-name-prepared-execution.mjs';
import {CONFIRM_CONVERT,CONFIRM_RECOVER} from './convert-private-names.mjs';
import {openPreparedExecutionJournal} from './private-name-execution-journal.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function setup(){
  const artifact=await preparePrivateNameArtifact({identityId:'identity',operator:'governor',deploymentHash:'a'.repeat(64),inventoryHash:'b'.repeat(64),historyRevision:'7',sinks:[{id:'pii',publicKey:[1]}],rows:[{accountId:'a1',subject:'person1',name:'Paul',sink:'pii',clubs:['c1','c2']},{accountId:'a2',subject:'person2',name:'Other',sink:'pii',clubs:[]}]},{encryptName:async(_k,p)=>p==='person1'?[2]:[3],encryptClubName:async(_k,c)=>c==='c1'?[4]:[5]});
  const entries=new Map(), originals=new Map(), clubs=new Map(), writes=[], order=[];
  const profiles=[{account_id:'a1',principals:['person1'],display_name:'Paul'},{account_id:'a2',principals:['person2'],display_name:'Other'}];
  const journal={ids:()=>[...entries.keys()],get:id=>entries.get(id),put:(id,v)=>entries.set(id,structuredClone(v))};
  const pii={readOriginal:async p=>originals.get(p),writeOriginal:async(p,ct)=>{writes.push(`original:${p}`);originals.set(p,{subject:p,field:'display_name',ciphertext:ct});},readClub:async(p,c)=>clubs.get(`${p}:${c}`),writeClub:async(p,c,ct)=>{writes.push(`club:${c}`);clubs.set(`${p}:${c}`,{subject:p,club:c,master_key_id:`vetkey-club-names-v1:${c}`,ciphertext:ct});}};
  const state={phase:'Writing',sinks:['pii'],writers:['identity'],opened:[],sealed:[],completed:[]};
  const deps={journal,piiBySink:new Map([['pii',pii]]),assertExecution:async()=>true,readBinding:async()=>({...artifact.body}),decryptName:async row=>row.accountId==='a1'?'Paul':'Other',identity:{listProfiles:async()=>structuredClone(profiles),readProfile:async id=>structuredClone(profiles.find(p=>p.account_id===id)),publishReference:async(id,ref)=>{writes.push(`profile:${id}`);profiles.find(p=>p.account_id===id).display_name=ref;}},coordinator:{begin:async()=>{order.push('begin');return structuredClone(state);},close:async()=>{order.push('close');state.phase='Closing';return structuredClone(state);},advance:async()=>{order.push('advance');if(state.phase==='Closing')state.phase='Releasing';else state.phase='Done';return structuredClone(state);},read:async()=>structuredClone(state)}};
  const lock={held:false,complete:0};
  deps.executionLock={enter:async()=>{lock.held=true;return true;},assertHeld:async()=>lock.held,complete:async()=>{lock.held=false;lock.complete++;}};
  const request={artifact,expectedHash:artifact.hash,approval:{action:'convert',plan:artifact.hash,approvalScope:'names',confirmation:CONFIRM_CONVERT}};
  return {request,deps,entries,originals,clubs,writes,order,profiles,state,pii,lock};
}
test('saved original and club ciphertext executes in order then verifies before release',async()=>{
  const s=await setup();const report=await executePreparedPrivateNamePlan(s.request,s.deps);
  assert.equal(report.converted,2);assert.equal(report.phase,'Done');
  assert.deepEqual(s.writes,['original:person1','club:c1','club:c2','profile:a1','original:person2','profile:a2']);
  assert.deepEqual(s.originals.get('person1').ciphertext,[2]);assert.deepEqual(s.clubs.get('person1:c2').ciphertext,[5]);
  assert.equal(JSON.stringify([...s.entries]).includes('Paul'),false);assert.deepEqual(s.order,['begin','close','advance','advance']);
});
test('fresh Fencing and Opening advances precede conversion; release still follows verification',async()=>{
  const s=await setup();s.state.phase='Fencing';
  s.deps.coordinator.advance=async()=>{
    s.order.push(`advance:${s.state.phase}`);
    if(s.state.phase==='Fencing')s.state.phase='Opening';
    else if(s.state.phase==='Opening')s.state.phase='Writing';
    else if(s.state.phase==='Closing')s.state.phase='Releasing';
    else if(s.state.phase==='Releasing')s.state.phase='Done';
    return structuredClone(s.state);
  };
  await executePreparedPrivateNamePlan(s.request,s.deps);
  assert.deepEqual(s.order,['begin','advance:Fencing','advance:Opening','close','advance:Closing','advance:Releasing']);
  assert.equal(s.writes.length,6);assert.equal(s.state.phase,'Done');
});
test('saved disk receipts survive restart and settle a committed lost reply without replay',async()=>{
  const s=await setup(),directory=mkdtempSync(join(tmpdir(),'name-execution-'));
  const open=()=>openPreparedExecutionJournal(join(directory,'receipts'),{artifact:s.request.artifact,expectedHash:s.request.expectedHash,assertHeld:()=>true});
  let journal=open();s.deps.journal=journal;
  const write=s.pii.writeClub;let first=true;
  s.pii.writeClub=async(...args)=>{await write(...args);if(first){first=false;throw Error('lost disk-run reply');}};
  try {
    await assert.rejects(executePreparedPrivateNamePlan(s.request,s.deps),/lost disk-run reply/);
    assert.equal(journal.get('club:a1:c1').phase,'unknown');journal.close();
    journal=open();s.deps.journal=journal;
    s.request.approval.action='recover';s.request.approval.confirmation=CONFIRM_RECOVER;
    await executePreparedPrivateNamePlan(s.request,s.deps);
    assert.equal(s.writes.filter(w=>w==='club:c1').length,1);
    assert.equal(journal.get('club:a1:c1').phase,'verified');assert.equal(s.state.phase,'Done');
  } finally {journal.close();rmSync(directory,{recursive:true,force:true});}
});
test('restart with saved unknown absent write does not retry or release the retained window',async()=>{
  const s=await setup(),directory=mkdtempSync(join(tmpdir(),'name-unknown-'));
  const open=()=>openPreparedExecutionJournal(join(directory,'receipts'),{artifact:s.request.artifact,expectedHash:s.request.expectedHash,assertHeld:()=>true});
  let journal=open(),attempts=0;s.deps.journal=journal;
  s.pii.writeOriginal=async()=>{attempts++;throw Error('unknown uncommitted');};
  try {
    await assert.rejects(executePreparedPrivateNamePlan(s.request,s.deps),/unknown uncommitted/);journal.close();
    journal=open();s.deps.journal=journal;s.request.approval.action='recover';s.request.approval.confirmation=CONFIRM_RECOVER;
    await assert.rejects(executePreparedPrivateNamePlan(s.request,s.deps),/no replay/);
    assert.equal(attempts,1);assert.equal(s.state.phase,'Writing');assert.equal(s.order.includes('close'),false);
    assert.equal(s.lock.held,true);assert.equal(journal.get('original:a1').phase,'unknown');
  } finally {journal.close();rmSync(directory,{recursive:true,force:true});}
});
test('partial conversion recovery retains the full original plan and never rewrites completed rows',async()=>{
  const s=await setup();let failed=true;const original=s.pii.writeOriginal;
  s.pii.writeOriginal=async(p,ct)=>{if(p==='person2'&&failed){failed=false;await original(p,ct);throw Error('lost reply');}return original(p,ct);};
  await assert.rejects(executePreparedPrivateNamePlan(s.request,s.deps),/lost reply/);assert.equal(s.state.phase,'Writing');assert.equal(s.order.includes('close'),false);
  s.request.approval.action='recover';s.request.approval.confirmation=CONFIRM_RECOVER;
  const report=await executePreparedPrivateNamePlan(s.request,s.deps);assert.equal(report.converted,2);assert.equal(s.writes.filter(w=>w==='original:person2').length,1);assert.equal(s.writes.filter(w=>w==='profile:a1').length,1);
});
test('unknown absent write remains locked without replay or closing',async()=>{
  const s=await setup();let attempts=0;s.pii.writeOriginal=async()=>{attempts++;throw Error('lost');};
  await assert.rejects(executePreparedPrivateNamePlan(s.request,s.deps),/lost/);
  await assert.rejects(executePreparedPrivateNamePlan(s.request,s.deps),/no replay/);assert.equal(attempts,1);assert.equal(s.order.includes('close'),false);assert.equal(s.lock.held,true);assert.equal(s.lock.complete,0);
});
test('club write lost reply resolves exact bytes without another write',async()=>{
  const s=await setup();const original=s.pii.writeClub;let failed=true;
  s.pii.writeClub=async(p,c,ct)=>{await original(p,c,ct);if(failed){failed=false;throw Error('lost club');}};
  await assert.rejects(executePreparedPrivateNamePlan(s.request,s.deps),/lost club/);
  await executePreparedPrivateNamePlan(s.request,s.deps);assert.equal(s.writes.filter(w=>w==='club:c1').length,1);
});
test('profile publication lost reply resolves reference without replay',async()=>{
  const s=await setup();const original=s.deps.identity.publishReference;let failed=true;
  s.deps.identity.publishReference=async(...args)=>{await original(...args);if(failed){failed=false;throw Error('lost profile');}};
  await assert.rejects(executePreparedPrivateNamePlan(s.request,s.deps),/lost profile/);
  await executePreparedPrivateNamePlan(s.request,s.deps);assert.equal(s.writes.filter(w=>w==='profile:a1').length,1);assert.equal(s.entries.get('profile:a1').phase,'verified');
});
test('wrong approval, missing actor and foreign journals stop before mutation',async()=>{
  for(const kind of ['approval','actor','journal']){const s=await setup();if(kind==='approval')s.request.approval.plan='c'.repeat(64);if(kind==='actor')s.deps.piiBySink.clear();if(kind==='journal')s.entries.set('foreign',{phase:'verified'});
    await assert.rejects(executePreparedPrivateNamePlan(s.request,s.deps));assert.equal(s.writes.length,0);assert.equal(s.order.length,0);}
});
test('last account source drift prevents any first-account writes',async()=>{
  const s=await setup();s.profiles[1].display_name='Changed';await assert.rejects(executePreparedPrivateNamePlan(s.request,s.deps),/source name changed/);assert.equal(s.writes.length,0);assert.equal(s.order.length,0);
});
test('converted reference with missing club ciphertext stops whole recovery',async()=>{
  const s=await setup();await executePreparedPrivateNamePlan(s.request,s.deps);s.clubs.delete('person1:c1');const count=s.writes.length;
  await assert.rejects(executePreparedPrivateNamePlan(s.request,s.deps),/record binding changed/);assert.equal(s.writes.length,count);
});
test('journal corruption cannot substitute prepared bytes',async()=>{
  const s=await setup();await executePreparedPrivateNamePlan(s.request,s.deps);s.entries.get('original:a1').ciphertext=[99];const count=s.writes.length;
  await assert.rejects(executePreparedPrivateNamePlan(s.request,s.deps),/journal binding changed/);assert.equal(s.writes.length,count);
});
test('unverified intent persistence prevents external write',async()=>{
  const s=await setup();s.deps.journal.put=()=>{};await assert.rejects(executePreparedPrivateNamePlan(s.request,s.deps),/intent readback mismatch/);assert.equal(s.writes.length,0);
});
test('fence refusal at any stage prevents release',async()=>{
  const s=await setup();const original=s.pii.writeClub;s.pii.writeClub=async(...args)=>{await original(...args);s.deps.assertExecution=async()=>false;};
  await assert.rejects(executePreparedPrivateNamePlan(s.request,s.deps),/fence\/approval required/);assert.equal(s.order.includes('close'),false);assert.equal(s.entries.get('club:a1:c1').phase,'unknown');
});
test('final readback mismatch retains the Writing window',async()=>{
  const s=await setup();const publish=s.deps.identity.publishReference;s.deps.identity.publishReference=async(id,ref)=>{await publish(id,ref);if(id==='a2')s.originals.get('person1').ciphertext=[99];};
  await assert.rejects(executePreparedPrivateNamePlan(s.request,s.deps),/ciphertext mismatch/);assert.equal(s.order.includes('close'),false);
});

test('unfinished Closing or Releasing windows cannot advance to sink release',async()=>{
  for(const phase of ['Closing','Releasing','Done']){
    const s=await setup();s.state.phase=phase;
    await assert.rejects(executePreparedPrivateNamePlan(s.request,s.deps),/closing window retained/);
    assert.deepEqual(s.order,['begin']);assert.equal(s.writes.length,0);assert.equal(s.lock.held,true);
  }
});
test('exclusive lock refusal prevents all reads and mutations',async()=>{
  const s=await setup();s.deps.executionLock.enter=async()=>false;s.deps.identity.listProfiles=async()=>{throw Error('must not read');};
  await assert.rejects(executePreparedPrivateNamePlan(s.request,s.deps),/Exclusive prepared execution lock/);assert.equal(s.writes.length,0);assert.equal(s.order.length,0);
});
test('successful exact reconciliation completes the lock only after release',async()=>{
  const s=await setup();await executePreparedPrivateNamePlan(s.request,s.deps);assert.equal(s.state.phase,'Done');assert.equal(s.lock.held,false);assert.equal(s.lock.complete,1);
});

test('drift between writer sealing and sink release stops the next advance',async()=>{
  const s=await setup();const advance=s.deps.coordinator.advance;
  s.deps.coordinator.advance=async(...args)=>{const result=await advance(...args);if(result.phase==='Releasing')s.clubs.delete('person1:c1');return result;};
  await assert.rejects(executePreparedPrivateNamePlan(s.request,s.deps),/record binding changed/);
  assert.equal(s.state.phase,'Releasing');assert.equal(s.order.filter(x=>x==='advance').length,1);assert.equal(s.lock.held,true);assert.equal(s.lock.complete,0);
});