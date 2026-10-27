import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {admissionBytes,verifyAdmissionArtifact} from './private-name-approval-delivery.mjs';
import {deliverGovernedNameApproval} from './private-name-governed-delivery.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
  const keys=generateKeyPairSync('ed25519'),planHash='a'.repeat(64);
  const body={kind:'ignite-private-name-preparation-admission-v2',approval_id:'owner-event',identity:'identity',operator:'operator',request:{operation_id:'names:club-name-preparation-owner',generation:'1',inventory_digest:Array(32).fill(1)},plan_hash:planHash,rows:[{account_id:'account',subject:'person',sink:'pii',source_digest:Array(32).fill(2),ciphertext:[3,4],clubs:[{club:'club',ciphertext:[5,6]}]}]};
  const approval={body,signature:sign(null,admissionBytes(body),keys.privateKey).toString('hex')},artifact=Buffer.from(JSON.stringify(approval));
  const binding={artifactHash:hash(artifact),planHash,identityId:'identity',operator:'operator',approvalId:'owner-event',approverKey:keys.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex'),targetModule:'b'.repeat(64),artifactCommit:'c'.repeat(40),canonicalPrincipal:v=>v};
  const receipt=verifyAdmissionArtifact(artifact,binding).receipt;
  let events=[],current=null,submits=0,appends=0,lostAppend='',lostSubmit=false,held=true,complete=true;
  const sequence=[];
  const transport={storeBinding:'f'.repeat(64),assertStore:async()=>held,
    readStream:async p=>({...p,complete,events:structuredClone(events)}),
    appendEvent:async p=>{
      if(p.expectedPrevious!==(events.at(-1)?.hash??'0'.repeat(64)))throw Error('Service predecessor CAS conflict');
      events.push(structuredClone(p.event));appends++;sequence.push(p.event.journal.phase);
      if(lostAppend===p.event.journal.phase){lostAppend='';throw Error('Lost committed append');}
      return {hash:p.event.hash};
    }};
  const deps={receiptTransport:transport,assertTarget:async()=>true,readWindow:async()=>({request:body.request,phase:'Fencing'}),readApproval:async()=>current,
    submitApproval:async()=>{submits++;sequence.push('submit');current=receipt;if(lostSubmit){lostSubmit=false;throw Error('Lost committed approval');}}};
  const run=(action='deliver',patch={})=>deliverGovernedNameApproval({artifact,binding,action,...patch},deps);
  return {run,deps,transport,artifact,binding,receipt,sequence,events:()=>events,submits:()=>submits,appends:()=>appends,
    retained:v=>{current=v;},loseAppend:p=>{lostAppend=p;},loseSubmit:()=>{lostSubmit=true;},deny:()=>{held=false;},incomplete:()=>{complete=false;},replace:v=>{events=v;}};
}
test('governed delivery retains two immutable events around one submission',async()=>{
  const f=fixture(),r=await f.run();assert.equal(r.submitted,true);assert.equal(f.submits(),1);assert.deepEqual(f.sequence,['unknown','submit','verified']);assert.equal(f.events().length,2);
  await f.run('reconcile');assert.equal(f.submits(),1);assert.equal(f.appends(),2);
});
test('existing exact backend approval adopts empty stream without submitting',async()=>{
  const f=fixture();f.retained(f.receipt);const r=await f.run('reconcile');assert.equal(r.submitted,false);assert.equal(f.submits(),0);assert.deepEqual(f.sequence,['unknown','verified']);
});
test('lost first append leaves unknown intent and never submits or replays',async()=>{
  const f=fixture();f.loseAppend('unknown');await assert.rejects(f.run(),/Lost committed append/);
  for(const action of ['deliver','reconcile'])await assert.rejects(f.run(action),/without replay/);
  assert.equal(f.submits(),0);assert.equal(f.appends(),1);assert.equal(f.events()[0].journal.phase,'unknown');
});
test('lost approval reply recovers via exact receipt without another submission',async()=>{
  const f=fixture();f.loseSubmit();await assert.rejects(f.run(),/Lost committed approval/);const r=await f.run('reconcile');assert.equal(r.submitted,false);assert.equal(f.submits(),1);assert.equal(f.appends(),2);
});
test('lost verified append is read back after restart without another append',async()=>{
  const f=fixture();f.loseAppend('verified');await assert.rejects(f.run(),/Lost committed append/);await f.run('reconcile');assert.equal(f.submits(),1);assert.equal(f.appends(),2);
});
test('same preparation cannot escape unknown lock through a new artifact pin',async()=>{
  const f=fixture();f.loseSubmit();await assert.rejects(f.run());const artifact=Buffer.from(JSON.stringify(JSON.parse(f.artifact.toString()),null,2));
  await assert.rejects(f.run('deliver',{artifact,binding:{...f.binding,artifactHash:hash(artifact)}}),/intent differs/);assert.equal(f.submits(),1);
});
test('unverified or incomplete storage refuses before canister submission',async()=>{
  for(const change of ['deny','incomplete']){const f=fixture();f[change]();await assert.rejects(f.run(),/changed|complete/);assert.equal(f.submits(),0);assert.equal(f.appends(),0);}
});
test('wrong canister receipt cannot complete retained intent',async()=>{
  const f=fixture();f.loseSubmit();await assert.rejects(f.run());f.retained({...f.receipt,approval_id:'different'});await assert.rejects(f.run('reconcile'),/Different retained/);assert.equal(f.events().length,1);
});
test('two deliveries racing from empty predecessor admit at most one submission',async()=>{
  const f=fixture(),read=f.transport.readStream;let arrived=0,release;
  const barrier=new Promise(resolve=>{release=resolve;});
  f.transport.readStream=async p=>{const reply=await read(p);if(++arrived<=2){if(arrived===2)release();await barrier;}return reply;};
  const result=await Promise.allSettled([f.run(),f.run()]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.submits(),1);assert.equal(f.appends(),2);
});
test('client that observes identical intent during claim is recovery-only',async()=>{
  const f=fixture(),read=f.transport.readStream,append=f.transport.appendEvent;let reads=0,claimed;
  const firstClaim=new Promise(resolve=>{claimed=resolve;});
  f.transport.appendEvent=async p=>{const r=await append(p);if(p.event.sequence===1)claimed();return r;};
  // Both initial reads see absence, but the second claim read waits until
  // the first client has retained its intent. Its no-op append must not submit.
  f.transport.readStream=async p=>{const index=++reads;if(index===4)await firstClaim;return read(p);};
  const result=await Promise.allSettled([f.run(),f.run()]);assert.equal(f.submits(),1);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
});