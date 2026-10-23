import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverRejectedLookup, rejectionEvidence, REJECTED_RELEASE } from './membership-lookup-recovery.mjs';
import { PINNED, digest } from './membership-lookup-release-policy.mjs';

const rejection = 'Error: --wasm-memory-persistence only applies to Motoko canisters with enhanced orthogonal persistence (EOP). The target canister is not an EOP canister.\nUpgrade reply failed or unknown; pending journal retained, no automatic replay';
const run = { id: 42, head_sha: REJECTED_RELEASE, conclusion: 'failure', path: '.github/workflows/release-membership-lookup.yml' };
function fixture() {
  const targets = ['identity_access', 'club_domain', 'club_domain'].map((name, i) => ({ name, groupId: ['shared','g1','g2'][i], canisterId: [PINNED.identity,PINNED.g1,PINNED.g2][i], subnetId:'subnet', newHash: i === 0 ? '8e7a12c109b049042ec17f083926952c11416694bf0e4784aa96aa5aed810861' : '533cc770a6fe19fe52fa7efc59857032999ff96f3294385f1f8892ecedb3b2bd' }));
  const binding = { release:REJECTED_RELEASE, targets, governor:'gov', registryRevision:'7' };
  const journal = { binding, complete:false, ready:false, fill:{g1:false,g2:false}, steps:targets.map((t,i)=>({...t,oldHash:'c'.repeat(64),settingsHash:'d'.repeat(64),phase:i===0?'pending':'ready'})) };
  return { journal, binding:{...binding,release:'f'.repeat(40)} };
}
function transport(extra={}) {
  return { evidence:async()=>rejectionEvidence(run,rejection), gate:async()=>{}, observe:async s=>({moduleHash:s.oldHash,settingsHash:s.settingsHash}), persist:async()=>{}, ...extra };
}
test('known CLI refusal recovers only after two full sweeps and durable receipt',async()=>{
  const {journal,binding}=fixture(), before=digest(journal);let reads=0,persisted;
  const result=await recoverRejectedLookup(journal,binding,transport({observe:async s=>{reads++;return {moduleHash:s.oldHash,settingsHash:s.settingsHash};},persist:async j=>{persisted=structuredClone(j);}}));
  assert.equal(reads,6);assert.equal(result.steps[0].phase,'ready');assert.equal(digest(journal),before);
  assert.equal(result.recovery.original.steps[0].phase,'pending');assert.equal(result.recovery.originalDigest,before);
  assert.deepEqual(persisted,result);
});
test('generic failed or wrong-release logs cannot authorize replay',()=>{
  for(const r of [{...run,head_sha:'a'.repeat(40)},{...run,conclusion:'success'},{...run,path:'other.yml'}])assert.throws(()=>rejectionEvidence(r,rejection));
  assert.throws(()=>rejectionEvidence(run,'timeout'));
});
test('changed artifacts, registry, started source, or configuration cannot rebind',async()=>{
  for(const mutate of [f=>f.binding.registryRevision='8',f=>f.binding.targets= f.binding.targets.map(t=>({...t,newHash:'e'.repeat(64)})),f=>f.journal.steps[1].phase='pending',f=>f.journal.configuration={},f=>f.journal.fill.g1=true]){
    const f=fixture();mutate(f);let persisted=false;
    await assert.rejects(()=>recoverRejectedLookup(f.journal,f.binding,transport({persist:async()=>{persisted=true;}})));
    assert.equal(persisted,false);
  }
});
test('unknown, installed, changed settings and unavailable readbacks retain pending',async()=>{
  for(const observe of [async s=>({moduleHash:s.newHash,settingsHash:s.settingsHash}),async s=>({moduleHash:s.oldHash,settingsHash:'e'.repeat(64)}),async()=>{throw new Error('unavailable');}]){
    const {journal,binding}=fixture();let persisted=false;
    await assert.rejects(()=>recoverRejectedLookup(journal,binding,transport({observe,persist:async()=>{persisted=true;}})));
    assert.equal(journal.steps[0].phase,'pending');assert.equal(persisted,false);
  }
});
test('second-sweep drift, routing drift and receipt failure stop recovery',async()=>{
  for(const mode of ['second','gate','persist']){
    const {journal,binding}=fixture();let reads=0;
    await assert.rejects(()=>recoverRejectedLookup(journal,binding,transport({
      observe:async s=>({moduleHash:++reads>3&&mode==='second'?'e'.repeat(64):s.oldHash,settingsHash:s.settingsHash}),
      gate:async()=>{if(mode==='gate')throw new Error('routing drift');},
      persist:async()=>{if(mode==='persist')throw new Error('unknown receipt');},
    })));
    assert.equal(journal.steps[0].phase,'pending');
  }
});