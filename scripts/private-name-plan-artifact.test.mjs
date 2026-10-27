import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync, existsSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preparePrivateNameArtifact, verifyPrivateNameArtifact, savePrivateNameArtifact, readPrivateNameArtifact, reconcilePrivateNameRecovery, claimPrivateNameArtifactLock, MAX_ARTIFACT_BYTES } from './private-name-plan-artifact.mjs';

const args = () => ({ identityId: 'identity', operator: 'governor', deploymentHash: 'a'.repeat(64), inventoryHash: 'b'.repeat(64), historyRevision: '9007199254740993', sinks: [{id: 'pii-1', publicKey: [8,9]}], rows: [{accountId: 'account-1', subject: 'person-1', sink: 'pii-1', name: 'Paul Cranwell', clubs: ['club-1', 'club-2']}, {accountId: 'account-2', subject: 'person-2', sink: 'pii-1', name: 'Other adult', clubs: []}] });
const encryption = { encryptName: async (_k, subject) => subject === 'person-1' ? [1,2] : [3,4], encryptClubName: async (_k, club) => club === 'club-1' ? [5,6] : [7,8] };
const create = () => preparePrivateNameArtifact(args(), encryption);
const binding = body => ({identityId: body.identityId, operator: body.operator, deploymentHash: body.deploymentHash, inventoryHash: body.inventoryHash, sinks: body.sinks});
const profiles = () => args().rows.map(r => ({ account_id: r.accountId, principals: [r.subject], display_name: r.name }));
const resume = (body, overrides = {}) => reconcilePrivateNameRecovery(body, {profiles: profiles(), binding: binding(body), decryptName: async row => args().rows.find(r => r.accountId === row.accountId)?.name, readCiphertext: async (row, club) => club === null ? row.ciphertext : row.clubs.find(c => c.id === club)?.ciphertext, ...overrides});

test('approved artifact contains ciphertext only and preserves exact clubs and big revisions', async () => {
  const artifact = await create();
  assert.equal(artifact.body.historyRevision, '9007199254740993');
  assert.equal(JSON.stringify(artifact).includes('Paul Cranwell'), false);
  assert.deepEqual(artifact.body.rows[0].clubs.map(c => c.id), ['club-1','club-2']);
  assert.deepEqual(artifact.body.rows[1].clubs, []);
});
test('missing club inventory cannot silently become no memberships', async () => {
  const input = args(); delete input.rows[0].clubs;
  await assert.rejects(preparePrivateNameArtifact(input, encryption), /Complete exact/);
});
test('approval binds club copies, original keys, operator and deployment', async () => {
  const artifact = await create();
  for (const mutate of [b => {b.rows[0].clubs.pop();}, b => {b.sinks[0].publicKey[0]++;}, b => {b.operator = 'other';}, b => {b.deploymentHash = 'c'.repeat(64);}, b => {b.rows[0].ciphertext[0]++;}]) {
    const changed = structuredClone(artifact); mutate(changed.body);
    assert.throws(() => verifyPrivateNameArtifact(changed, artifact.hash), /changed/);
  }
});
test('plaintext and unknown properties are rejected even if supplied by a caller', async () => {
  const artifact = await create(); artifact.body.rows[0].name = 'Paul Cranwell';
  assert.throws(() => verifyPrivateNameArtifact(artifact, artifact.hash), /Invalid distinct/);
});
test('exclusive artifact save is idempotent only for original approved bytes', async () => {
  const path = join(mkdtempSync(join(tmpdir(),'name-plan-')), 'plan.json');
  const artifact = await create();
  savePrivateNameArtifact(path, artifact, artifact.hash);
  const before = readFileSync(path,'utf8');
  savePrivateNameArtifact(path, artifact, artifact.hash);
  assert.equal(readFileSync(path,'utf8'), before);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(readPrivateNameArtifact(path,artifact.hash),artifact.body);
  const other = await preparePrivateNameArtifact({...args(), operator: 'other'},encryption);
  assert.throws(() => savePrivateNameArtifact(path,other,other.hash), /changed/);
  assert.equal(readFileSync(path,'utf8'),before);
});
test('interrupted corrupt artifact is retained without overwrite', async () => {
  const path = join(mkdtempSync(join(tmpdir(),'name-plan-')), 'plan.json');
  writeFileSync(path,'{"body":');
  const artifact = await create();
  assert.throws(() => savePrivateNameArtifact(path,artifact,artifact.hash));
  assert.equal(readFileSync(path,'utf8'),'{"body":');
});
test('partial conversion resumes original encrypted rows, not a smaller new plan', async () => {
  const artifact = await create(), live = profiles();
  live[0].display_name = 'pii-display-name:v1:pii-1:person-1';
  let decrypts = 0;
  const pending = await resume(artifact.body, {profiles: live, decryptName: async () => {decrypts++; return 'Other adult';}});
  assert.deepEqual(pending.map(r => r.accountId),['account-2']);
  assert.equal(decrypts,1);
  assert.deepEqual(pending[0].ciphertext,[3,4]);
  assert.equal(verifyPrivateNameArtifact(artifact,artifact.hash).rows.length,2);
});
test('all converted rows require no source decryptions', async () => {
  const {body} = await create();
  const live = body.rows.map(r => ({account_id: r.accountId, principals: [r.subject], display_name: `pii-display-name:v1:${r.sink}:${r.subject}`}));
  assert.deepEqual(await resume(body,{profiles: live, decryptName: async () => {throw Error('must not unlock');}}),[]);
});
test('changed source name cannot be resumed from old ciphertext', async () => {
  const {body} = await create(), live = profiles(); live[0].display_name = 'Changed';
  await assert.rejects(resume(body,{profiles: live}), /source name changed/);
});
test('foreign converted reference, removed account and duplicate profiles stop recovery', async () => {
  const {body} = await create(), live = profiles(); live[0].display_name = 'pii-display-name:v1:foreign:person-1';
  await assert.rejects(resume(body,{profiles:live}),/reference changed/);
  await assert.rejects(resume(body,{profiles:profiles().slice(1)}),/inventory changed/);
  await assert.rejects(resume(body,{profiles:[profiles()[0],profiles()[0]]}),/Duplicate/);
});
test('subject relinking and deployment/inventory/key drift stop before decryption', async () => {
  const {body} = await create(); let decrypts = 0;
  for (const key of ['identityId','operator','deploymentHash','inventoryHash','sinks']) {
    const changed = binding(body); changed[key] = key === 'sinks' ? [{id:'pii-1',publicKey:[0]}] : 'different';
    await assert.rejects(resume(body,{binding:changed,decryptName:async()=>{decrypts++;}}),/changed/);
  }
  const live = profiles(); live[0].principals = ['different'];
  await assert.rejects(resume(body,{profiles:live,decryptName:async()=>{decrypts++;}}),/subject binding changed/);
  assert.equal(decrypts,0);
});
test('decryption refusal cannot yield a partial work list', async () => {
  const {body} = await create(); let calls = 0;
  await assert.rejects(resume(body,{decryptName:async()=>{calls++; if(calls === 2) throw Error('Denied'); return 'Paul Cranwell';}}),/Denied/);
  assert.equal(calls,2);
});
test('unknown work retains exclusive lock and cannot start a second executor', async () => {
  const path = join(mkdtempSync(join(tmpdir(),'name-plan-')), 'execution.lock');
  const {hash} = await create(); const lock = claimPrivateNameArtifactLock(path,hash);
  assert.throws(()=>claimPrivateNameArtifactLock(path,hash),/EEXIST/);
  assert.equal(existsSync(path),true);
  lock.complete(); assert.equal(existsSync(path),false);
});
test('wrong retained lock cannot be removed by completion', async () => {
  const path = join(mkdtempSync(join(tmpdir(),'name-plan-')), 'execution.lock');
  const {hash} = await create(); const lock = claimPrivateNameArtifactLock(path,hash);
  writeFileSync(path,'other');
  assert.throws(()=>lock.complete(),/changed/);
  assert.equal(existsSync(path),true);
});

test('already published references cannot hide missing original or club ciphertext', async () => {
  const {body} = await create(), live = profiles(); live[0].display_name = 'pii-display-name:v1:pii-1:person-1';
  await assert.rejects(resume(body,{profiles:live,readCiphertext:undefined}),/readback required/);
  await assert.rejects(resume(body,{profiles:live,readCiphertext:async()=>[99]}),/original ciphertext mismatch/);
  await assert.rejects(resume(body,{profiles:live,readCiphertext:async(row,club)=>club===null ? row.ciphertext : []}),/club ciphertext mismatch/);
});
test('oversized saved artifacts fail before JSON parsing', async () => {
  const path = join(mkdtempSync(join(tmpdir(),'name-plan-')), 'plan.json');
  writeFileSync(path,''); truncateSync(path,MAX_ARTIFACT_BYTES+1);
  await assert.rejects(async()=>readPrivateNameArtifact(path,'a'.repeat(64)),/byte budget/);
});
test('invalid full inventory refuses before encryption adapters run', async () => {
  let calls=0; const adapters={encryptName:async()=>{calls++;return [1];},encryptClubName:async()=>{calls++;return [2];}};
  for (const mutate of [a=>a.sinks.push(a.sinks[0]),a=>{a.sinks[0].publicKey=[];},a=>{a.rows[1].subject='bad/subject';},a=>{a.rows[1].clubs=['bad/club'];},a=>{a.rows[1].name='x'.repeat(4097);}]) {
    const input=args(); mutate(input); await assert.rejects(preparePrivateNameArtifact(input,adapters));
  }
  assert.equal(calls,0);
});