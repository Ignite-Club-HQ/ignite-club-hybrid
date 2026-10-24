import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliverClaim } from './icp-email-delivery.mjs';
import { webcrypto, generateKeyPairSync, createHash } from 'node:crypto';
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
test('encrypted official invite binds token-scoped hashes and cannot supply arbitrary content', async () => {
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  process.env.ICP_EMAIL_PRIVATE_KEY=privateKey.export({type:'pkcs8',format:'pem'});
  process.env.ICP_EMAIL_APP_URL='https://app.example.invalid';
  const resource='opaque-token',code='12345678',to='member@example.invalid';
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const aes=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);
  const iv=webcrypto.getRandomValues(new Uint8Array(12));
  const key=await webcrypto.subtle.importKey('jwk',publicKey.export({format:'jwk'}),{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
  const ciphertext=await webcrypto.subtle.encrypt({name:'AES-GCM',iv},aes,new TextEncoder().encode(JSON.stringify({resource,to,code,subject:'attacker text',text:'untrusted content'})));
  const wrapped=await webcrypto.subtle.encrypt({name:'RSA-OAEP'},key,await webcrypto.subtle.exportKey('raw',aes));
  const envelope=JSON.stringify({v:1,key:Buffer.from(wrapped).toString('base64'),iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(ciphertext).toString('base64')});
  const encrypted={job:{id:'job',kind:'official',resource,attempt:1n,ciphertext:envelope},to:hash(`${resource}:${to}`),body:hash(`${resource}:${code}`),subject:'Authorized invitation'};
  let sent;
  assert.equal(await deliverClaim({finish_email_job:async()=>({Ok:null})},encrypted,async payload=>{sent=payload;return {ok:true,id:'receipt'};}),'sent');
  assert.equal(sent.subject,'Authorized invitation');assert.ok(!sent.text.includes('untrusted content'));assert.ok(sent.text.includes('Verification code: 12345678'));
  let sends=0;
  await deliverClaim({finish_email_job:async()=>({Ok:null})},{...encrypted,to:hash('foreign-address')},async()=>{sends++;return {ok:true,id:'receipt'};});
  assert.equal(sends,0);
  delete process.env.ICP_EMAIL_PRIVATE_KEY;delete process.env.ICP_EMAIL_APP_URL;
});