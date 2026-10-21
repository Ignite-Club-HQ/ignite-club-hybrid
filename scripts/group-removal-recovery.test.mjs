import test from 'node:test';
import assert from 'node:assert/strict';
import { checkpointGroup, restoreGroup, resumeGroup, recoveryBinding } from './group-removal-recovery.mjs';
const inventory = { deploymentId: 'isolated', network: 'pocketic', host: 'https://isolated.invalid', revision: 7n, authority: 'identity',
  participants: ['events','queue','blob','identity'].map(id => ({ id, domain: id, group: 'g2', subnet: 'local', module: 'a'.repeat(64) })) };
function fixture() {
  const calls = [], statuses = new Map(inventory.participants.map(p => [p.id,'running'])); let saved;
  const journal = { save: async value => { saved = structuredClone(value); }, read: async () => structuredClone(saved) };
  const adapter = {
    readAuthenticatedInventory: async () => inventory, verifyExclusiveControllerFence: async () => true,
    status: async id => statuses.get(id), stop: async id => { calls.push(`stop:${id}`); statuses.set(id,'stopped'); },
    start: async id => { calls.push(`start:${id}`); statuses.set(id,'running'); },
    readDecodedHistory: async () => ({ generation: 3n, subjects: ['removed'], pending: ['claimed-send'], quota: 11n }),
    verifyCompleteDecodedHistory: async () => true, readIndependentAnchor: async () => ({ revision: 3n }),
    verifyHistoryAgainstAnchor: async () => true, verifyRestoredDecodedHistory: async () => true,
    takeSnapshot: async id => { calls.push(`take:${id}`); return 'abcd'; }, loadSnapshot: async id => { calls.push(`load:${id}`); },
  };
  return { adapter, journal, statuses, calls };
}
test('whole inventory stays stopped until complete restore and approved authority-first resume', async () => {
  const f=fixture(); const cp=await checkpointGroup(inventory,f.adapter,f.journal);
  assert.deepEqual(f.calls.slice(0,4),['stop:events','stop:queue','stop:blob','stop:identity']);
  assert.equal(cp.snapshots.length,4); assert.ok([...f.statuses.values()].every(x=>x==='stopped'));
  await restoreGroup(inventory,cp,f.adapter,f.journal); f.calls.length=0;
  await resumeGroup(inventory,cp,f.adapter,f.journal,{binding:cp.binding,approved:true});
  assert.deepEqual(f.calls,['start:identity','start:events','start:queue','start:blob']);
});
test('inventory omission refuses before stopping', async () => {
  const f=fixture(); await assert.rejects(checkpointGroup({...inventory,participants:inventory.participants.slice(1)},f.adapter,f.journal),/inventory changed/);
  assert.deepEqual(f.calls,[]);
});
test('unknown snapshot outcome retains durable pending intent and prevents replay', async () => {
  const f=fixture(); f.adapter.takeSnapshot=async()=>{throw Error('Reply lost')};
  await assert.rejects(checkpointGroup(inventory,f.adapter,f.journal),/Reply lost/);
  assert.equal((await f.journal.read()).pending.kind,'take');
  await assert.rejects(checkpointGroup(inventory,f.adapter,f.journal),/reconciliation/);
  assert.ok([...f.statuses.values()].every(x=>x==='stopped'));
});
test('independent anchor advancement rejects old checkpoint before any load', async () => {
  const f=fixture(), cp=await checkpointGroup(inventory,f.adapter,f.journal); f.calls.length=0;
  f.adapter.readIndependentAnchor=async()=>({revision:4n});
  await assert.rejects(restoreGroup(inventory,cp,f.adapter,f.journal),/Rollback/);
  assert.equal(f.calls.some(x=>x.startsWith('load:')),false);
});
test('partial or duplicated snapshots refuse without mutation', async () => {
  const f=fixture(),cp=await checkpointGroup(inventory,f.adapter,f.journal);f.calls.length=0;
  await assert.rejects(restoreGroup(inventory,{...cp,snapshots:cp.snapshots.slice(1)},f.adapter,f.journal),/Incomplete/);
  await assert.rejects(restoreGroup(inventory,{...cp,snapshots:[cp.snapshots[0],...cp.snapshots.slice(0,3)]},f.adapter,f.journal),/Invalid/);
  assert.deepEqual(f.calls,[]);
});
test('semantic history mismatch leaves all services stopped after restore', async () => {
  const f=fixture(),cp=await checkpointGroup(inventory,f.adapter,f.journal);
  f.adapter.verifyRestoredDecodedHistory=async()=>false;
  await assert.rejects(restoreGroup(inventory,cp,f.adapter,f.journal),/history or ledgers/);
  assert.ok([...f.statuses.values()].every(x=>x==='stopped'));
});
test('failed resume refences the complete inventory and keeps pending start', async () => {
  const f=fixture(),cp=await checkpointGroup(inventory,f.adapter,f.journal);await restoreGroup(inventory,cp,f.adapter,f.journal);
  const start=f.adapter.start;f.adapter.start=async id=>{if(id==='queue')throw Error('Start reply lost');await start(id)};
  await assert.rejects(resumeGroup(inventory,cp,f.adapter,f.journal,{binding:cp.binding,approved:true}),/Start reply lost/);
  assert.ok([...f.statuses.values()].every(x=>x==='stopped'));
  assert.equal((await f.journal.read()).pending.id,'queue');
});
test('journal failure prevents external mutations and cannot silently unlock', async () => {
  const f=fixture();f.journal.save=async()=>{throw Error('Disk failed')};
  await assert.rejects(checkpointGroup(inventory,f.adapter,f.journal),/Disk failed/);assert.deepEqual(f.calls,[]);
});
test('approval binds exact revision and complete inventory', async () => {
  const f=fixture(),cp=await checkpointGroup(inventory,f.adapter,f.journal);await restoreGroup(inventory,cp,f.adapter,f.journal);f.calls.length=0;
  await assert.rejects(resumeGroup(inventory,cp,f.adapter,f.journal,{binding:recoveryBinding({...inventory,revision:8n}),approved:true}),/approval/);
  assert.deepEqual(f.calls,[]);
});