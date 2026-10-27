import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {admissionBytes,verifyAdmissionArtifact,deliverNameApproval,deliverNameApprovalUsingCanisterReceipt} from './private-name-approval-delivery.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(preparation=false){
  const keys=generateKeyPairSync('ed25519'),planHash='a'.repeat(64);
  const body={kind:'ignite-private-name-admission-v1',approval_id:'explicit-owner-event',identity:'identity',operator:'operator',request:{operation_id:`names:club-name-conversion-${planHash}`,generation:'9007199254740993',inventory_digest:Array(32).fill(1)},plan_hash:planHash,rows:[{account_id:'account',subject:'person',sink:'pii',source_digest:Array(32).fill(2),ciphertext:[3,4],clubs:[{club:'club',ciphertext:[5,6]}]}]};
  if(preparation){body.kind='ignite-private-name-preparation-admission-v2';body.request.operation_id='names:club-name-preparation-owner-request';}
  const approval={body,signature:sign(null,admissionBytes(body),keys.privateKey).toString('hex')},artifact=Buffer.from(JSON.stringify(approval));
  const binding={artifactHash:hash(artifact),planHash,identityId:'identity',operator:'operator',approvalId:body.approval_id,approverKey:keys.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex'),targetModule:'b'.repeat(64),artifactCommit:'c'.repeat(40),canonicalPrincipal:v=>v};
  const receipt=verifyAdmissionArtifact(artifact,binding).receipt;
  let journal=null,retained=null,calls=0;
  const events=[];
  const deps={assertTarget:async()=>true,readWindow:async()=>({request:body.request,phase:'Fencing'}),readApproval:async()=>retained,readJournal:async()=>journal,persistJournal:async j=>{const created=journal===null;events.push(j.phase);journal=structuredClone(j);return {created};},submitApproval:async()=>{events.push('submit');calls++;retained=receipt;}};
  return {artifact,binding,body,approval,receipt,deps,events,get journal(){return journal;},get calls(){return calls;},set retained(v){retained=v;},set journal(v){journal=v;}};
}
test('original exact-row owner signature verifies with lossless generation and body/signature receipt',()=>{
  const f=fixture(),v=verifyAdmissionArtifact(f.artifact,f.binding);assert.equal(v.receipt.request.generation,'9007199254740993');assert.equal(v.receipt.signed_digest.length,32);
  assert.equal(Buffer.from(v.receipt.signed_digest).toString('hex'),hash(Buffer.concat([admissionBytes(f.body),Buffer.from(f.approval.signature,'hex')])));
});
test('old saved JSON envelope cannot be converted into backend admission',()=>{
  const f=fixture(),artifact=Buffer.from(JSON.stringify({body:{kind:'private-name-signed-approval-v1'},signature:f.approval.signature}));assert.throws(()=>verifyAdmissionArtifact(artifact,{...f.binding,artifactHash:hash(artifact)}),/Strict/);
});
test('changed bytes, event, target, operator, key and signed row are refused before transport',async()=>{
  const f=fixture();
  for(const patch of [{artifactHash:'d'.repeat(64)},{identityId:'other'},{operator:'other'},{approvalId:'other'},{approverKey:'0'.repeat(64)}])assert.throws(()=>verifyAdmissionArtifact(f.artifact,{...f.binding,...patch}));
  const a=structuredClone(f.approval);a.body.rows[0].ciphertext=[9];const artifact=Buffer.from(JSON.stringify(a));
  await assert.rejects(deliverNameApproval({artifact,binding:{...f.binding,artifactHash:hash(artifact)},action:'deliver'},f.deps),/signature/);assert.equal(f.calls,0);
});
test('delivery persists unknown intent before its single mutation then verifies retained exact approval',async()=>{
  const f=fixture(),r=await deliverNameApproval({...f,action:'deliver'},f.deps);assert.equal(r.phase,'verified');assert.equal(f.calls,1);assert.deepEqual(f.events,['unknown','submit','verified']);
});
test('lost committed reply reconciles exact retained receipt without resubmission',async()=>{
  const f=fixture(),submit=f.deps.submitApproval;f.deps.submitApproval=async()=>{await submit();throw Error('lost reply');};
  await assert.rejects(deliverNameApproval({...f,action:'deliver'},f.deps),/lost reply/);assert.equal(f.journal.phase,'unknown');
  const result=await deliverNameApproval({...f,action:'reconcile'},f.deps);assert.equal(result.submitted,false);assert.equal(f.calls,1);assert.equal(f.journal.phase,'verified');
});
test('unknown absent outcome retains intent and never replays, even with deliver selected',async()=>{
  const f=fixture();f.deps.submitApproval=async()=>{throw Error('unknown');};await assert.rejects(deliverNameApproval({...f,action:'deliver'},f.deps));
  for(const action of ['deliver','reconcile'])await assert.rejects(deliverNameApproval({...f,action},f.deps),/without replay/);assert.equal(f.journal.phase,'unknown');
});
test('journal sync/readback failure prevents submission',async()=>{
  const f=fixture();f.deps.persistJournal=async()=>{throw Error('durability refused');};await assert.rejects(deliverNameApproval({...f,action:'deliver'},f.deps),/durability/);assert.equal(f.calls,0);
  f.deps.persistJournal=async()=>({created:true});await assert.rejects(deliverNameApproval({...f,action:'deliver'},f.deps),/readback/);assert.equal(f.calls,0);
});
test('wrong window, changed target and different retained approval never mutate',async()=>{
  for(const change of ['window','target','retained']){const f=fixture();if(change==='window')f.deps.readWindow=async()=>({request:{...f.body.request,generation:'2'},phase:'Fencing'});if(change==='target')f.deps.assertTarget=async()=>false;if(change==='retained')f.retained={...f.receipt,approval_id:'other'};
    await assert.rejects(deliverNameApproval({...f,action:'deliver'},f.deps));assert.equal(f.calls,0);}
});
test('reconcile with no previous delivery cannot authorize submission',async()=>{
  const f=fixture();await assert.rejects(deliverNameApproval({...f,action:'reconcile'},f.deps),/without replay/);assert.equal(f.calls,0);
});
test('protected workflow uses existing governor and original artifact only, with no conversion actions',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/deliver-private-name-approval.yml',import.meta.url),'utf8');
  assert.match(workflow,/environment: private-name-approval-delivery/);assert.match(workflow,/group: ignite-mainnet-governor-deployment/);assert.match(workflow,/cancel-in-progress: false/);assert.match(workflow,/secrets.DEPLOYER_PEM/);assert.match(workflow,/if: always\(\)/);
  const runner=readFileSync(new URL('../frontend/scripts/deliver-private-name-approval.ts',import.meta.url),'utf8');
  assert.doesNotMatch(runner,/actor\.(begin_private|advance_private|close_private|write_approved|publish_approved)/);assert.match(runner,/actor\.approve_private_name_conversion/);assert.match(runner,/read_private_name_conversion_approval/);
});
test('changed artifact pin cannot bypass a retained delivery for the same operation',async()=>{
  const f=fixture();f.deps.submitApproval=async()=>{throw Error('unknown');};await assert.rejects(deliverNameApproval({...f,action:'deliver'},f.deps));
  const artifact=Buffer.from(JSON.stringify(f.approval,null,2));
  await assert.rejects(deliverNameApproval({artifact,binding:{...f.binding,artifactHash:hash(artifact)},action:'deliver'},f.deps),/intent differs/);assert.equal(f.journal.phase,'unknown');
});
test('approved artifact ingress budget refuses oversized payloads before parsing or transport',()=>{
  const f=fixture(),raw=Buffer.alloc(1500001);assert.throws(()=>verifyAdmissionArtifact(raw,{...f.binding,artifactHash:hash(raw)}),/bounded/);
});
test('signed preparation delivery preserves independent lock identity instead of rebuilding it from plan hash',async()=>{
  const f=fixture(true),v=verifyAdmissionArtifact(f.artifact,f.binding);assert.equal(v.operationId,'club-name-preparation-owner-request');
  const result=await deliverNameApproval({...f,action:'deliver'},f.deps);assert.equal(result.operationId,v.operationId);assert.equal(f.calls,1);assert.equal(f.journal.phase,'verified');
});
test('changed preparation identity or v1 signature cannot authorize an independent lock',()=>{
  const f=fixture(true);for(const change of [b=>{b.request.operation_id='names:club-name-preparation-other';},b=>{b.kind='ignite-private-name-admission-v1';}]){const a=structuredClone(f.approval);change(a.body);const raw=Buffer.from(JSON.stringify(a));assert.throws(()=>verifyAdmissionArtifact(raw,{...f.binding,artifactHash:hash(raw)}));}
});
test('lost preparation approval reply reconciles without resubmission',async()=>{
  const f=fixture(true),submit=f.deps.submitApproval;f.deps.submitApproval=async()=>{await submit();throw Error('lost preparation reply');};await assert.rejects(deliverNameApproval({...f,action:'deliver'},f.deps));assert.equal(f.journal.phase,'unknown');await deliverNameApproval({...f,action:'reconcile'},f.deps);assert.equal(f.calls,1);
});
test('only explicit exclusive first-intent acknowledgement permits submission',async()=>{
  for(const acknowledgement of [undefined,null,{},true,{created:false},{created:1}]){
    const f=fixture(),persist=f.deps.persistJournal;f.deps.persistJournal=async j=>{await persist(j);return acknowledgement;};
    await assert.rejects(deliverNameApproval({...f,action:'deliver'},f.deps),/not exclusively claimed/);assert.equal(f.calls,0);assert.equal(f.journal.phase,'unknown');
  }
});
test('existing immutable canister approval needs no extra receipt store',async()=>{
  const f=fixture(true);const deps={...f.deps,assertImmutableAdmission:async()=>true};
  const first=await deliverNameApprovalUsingCanisterReceipt({...f,action:'deliver'},deps);assert.equal(first.submitted,true);assert.equal(f.calls,1);assert.equal(f.journal,null);
  const next=await deliverNameApprovalUsingCanisterReceipt({...f,action:'reconcile'},deps);assert.equal(next.submitted,false);assert.equal(f.calls,1);
});
test('receipt-only delivery loses committed reply then reconciles without another submission',async()=>{
  const f=fixture(true),submit=f.deps.submitApproval;f.deps.submitApproval=async()=>{await submit();throw Error('lost reply');};const deps={...f.deps,assertImmutableAdmission:async()=>true};
  await assert.rejects(deliverNameApprovalUsingCanisterReceipt({...f,action:'deliver'},deps),/lost reply/);
  await deliverNameApprovalUsingCanisterReceipt({...f,action:'reconcile'},deps);assert.equal(f.calls,1);
});
test('receipt-only reconciliation is read-only even with authoritative absence',async()=>{
  const f=fixture(true);await assert.rejects(deliverNameApprovalUsingCanisterReceipt({...f,action:'reconcile'},{...f.deps,assertImmutableAdmission:async()=>true}),/never submits/);assert.equal(f.calls,0);
});
test('receipt-only path requires verified synchronous immutable admission and exact target',async()=>{
  for(const change of ['missing','denied','target']){const f=fixture(true),deps={...f.deps,assertImmutableAdmission:async()=>true};if(change==='missing')delete deps.assertImmutableAdmission;if(change==='denied')deps.assertImmutableAdmission=async()=>false;if(change==='target')deps.assertTarget=async()=>false;
    await assert.rejects(deliverNameApprovalUsingCanisterReceipt({...f,action:'deliver'},deps),/Verified immutable/);assert.equal(f.calls,0);}
});
test('receipt-only path refuses competing approval and late unsigned window',async()=>{
  for(const change of ['conflict','late']){const f=fixture(true);if(change==='conflict')f.retained={...f.receipt,approval_id:'other'};else f.deps.readWindow=async()=>({request:f.body.request,phase:'Writing'});
    await assert.rejects(deliverNameApprovalUsingCanisterReceipt({...f,action:'deliver'},{...f.deps,assertImmutableAdmission:async()=>true}),/Different retained|before conversion/);assert.equal(f.calls,0);}
});
test('receipt-only unknown uncommitted outcome never retries automatically',async()=>{
  const f=fixture(true);let calls=0;f.deps.submitApproval=async()=>{calls++;throw Error('unknown');};
  await assert.rejects(deliverNameApprovalUsingCanisterReceipt({...f,action:'deliver'},{...f.deps,assertImmutableAdmission:async()=>true}),/unknown/);assert.equal(calls,1);
});