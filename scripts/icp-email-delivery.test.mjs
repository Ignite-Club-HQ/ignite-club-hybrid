import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliverClaim } from './icp-email-delivery.mjs';
const claim = { job: { id: 'opaque-job', attempt: 1n, ciphertext: '' }, to: 'test@example.invalid', subject: 'Test', body: 'Body', token: '' };
test('successful provider response records the exact on-chain receipt', async () => {
  const calls=[];
  const outcome=await deliverClaim({ finish_email_job: async (...args) => { calls.push(args); return { Ok:null }; } },claim,async (_,key)=> { assert.equal(key,'ignite:opaque-job'); return {ok:true,id:'provider-1'}; });
  assert.equal(outcome,'sent'); assert.deepEqual(calls,[['opaque-job',1n,'sent','provider-1']]);
});
test('unknown provider write remains locked instead of retrying', async () => {
  let receipt;
  await deliverClaim({finish_email_job:async(...args)=> {receipt=args;return {Ok:null};}},claim,async()=> {throw new Error('connection lost');});
  assert.deepEqual(receipt,['opaque-job',1n,'unknown','']);
});