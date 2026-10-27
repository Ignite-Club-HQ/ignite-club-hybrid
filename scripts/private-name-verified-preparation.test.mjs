import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareVerifiedPrivateNameArtifact} from './private-name-verified-preparation.mjs';
import {encryptName} from './convert-private-names.mjs';
import {MasterPublicKey} from '../frontend/node_modules/@icp-sdk/vetkeys/dist/lib/index.es.js';
// Early refusals require neither a mainnet key nor any key derivation.
const input=()=>({identityId:'identity',operator:'operator',deploymentHash:'a'.repeat(64),inventoryHash:'b'.repeat(64),historyRevision:'1',sinks:[{id:'pii',publicKey:[1]}],rows:[{accountId:'a',subject:'person',sink:'pii',name:'Paul Cranwell',clubs:['club']}]});
const accounts=()=>({request:{operation_id:'names:club-name-preparation-test',generation:1n,inventory_digest:Array(32).fill(1)},revision:'1',rows:[{accountId:'a',principals:['person'],version:'1',status:'Active',sourceDigest:Array(32).fill(2),profile:{display_name:'Paul Cranwell'},originalAuthority:{kind:'Unresolved'}}]});
test('missing account coverage cannot return an approval-ready artifact',async()=>{await assert.rejects(prepareVerifiedPrivateNameArtifact(input(),{accounts:undefined}),/Complete authenticated/);});
test('unverified baseline or management exclusion refuses before resolving or decrypting',async()=>{let calls=0;await assert.rejects(prepareVerifiedPrivateNameArtifact(input(),{accounts:accounts(),assertEvidence:async()=>false,resolveAuthority:async()=>{calls++;},decryptCiphertext:async()=>{calls++;}}),/Verified baseline/);assert.equal(calls,0);});
test('malformed public keys refuse before any authority or crypto adapter',async()=>{let calls=0;await assert.rejects(prepareVerifiedPrivateNameArtifact(input(),{accounts:accounts(),assertEvidence:async()=>true,resolveAuthority:async()=>{calls++;},decryptCiphertext:async()=>{calls++;}}),/Invalid original PII public key/);assert.equal(calls,0);});
async function existingFixture(){
  const i=input();i.sinks[0].publicKey=Array.from(MasterPublicKey.productionKey().deriveCanisterKey(Uint8Array.of(1)).deriveSubKey(new TextEncoder().encode('ignite-pii-v1')).publicKeyBytes());
  const a=accounts();a.rows[0].principals=['other-alias','person'];a.rows[0].profile.display_name='pii-display-name:v1:pii:person';a.rows[0].originalAuthority={kind:'Existing',sink:'pii',subject:'person'};
  const ciphertext=Array.from(await encryptName(i.sinks[0].publicKey,'person','Paul Cranwell'));
  const original={subject:'person',field:'display_name',master_key_id:'vetkey-ibe-v1',ciphertext};
  const calls=[];let held=true;
  const deps={accounts:a,assertEvidence:async()=>held,resolveAuthority:async()=>({sink:'pii',subject:'person'}),readOriginal:async t=>{calls.push(t);return structuredClone(original);},decryptCiphertext:async()=>'Paul Cranwell'};
  return {i,deps,original,calls,deny:()=>{held=false;}};
}
test('existing nonfirst alias name preserves exact original bytes and closing readback',async()=>{
  const f=await existingFixture(),artifact=await prepareVerifiedPrivateNameArtifact(f.i,f.deps);
  assert.deepEqual(artifact.body.rows[0].ciphertext,f.original.ciphertext);assert.deepEqual(f.calls,[{sink:'pii',subject:'person'},{sink:'pii',subject:'person'}]);assert.equal(artifact.body.rows[0].clubs.length,1);
});
test('new ciphertext validation cannot substitute for authoritative existing plaintext',async()=>{
  const f=await existingFixture();f.deps.decryptCiphertext=async()=>'Different person';await assert.rejects(prepareVerifiedPrivateNameArtifact(f.i,f.deps),/differs from authoritative original/);assert.equal(f.calls.length,1);
});
test('existing names require exact bounded original record and authorized decryption',async()=>{
  for(const change of ['missing','refused','wrongSubject','wrongField','wrongScheme','malformed','invalidCiphertext','decrypt']){
    const f=await existingFixture();
    if(change==='missing')delete f.deps.readOriginal;
    if(change==='refused')f.deps.readOriginal=async()=>{throw Error('Refused source');};
    if(change==='wrongSubject')f.original.subject='other-alias';
    if(change==='wrongField')f.original.field='contact_email';
    if(change==='wrongScheme')f.original.master_key_id='vetkey-club-names-v1:club';
    if(change==='malformed')f.original.ciphertext=[256];
    if(change==='invalidCiphertext')f.original.ciphertext=[1];
    if(change==='decrypt')f.deps.decryptCiphertext=async()=>{throw Error('Denied key');};
    await assert.rejects(prepareVerifiedPrivateNameArtifact(f.i,f.deps),/reader required|Refused source|original ciphertext required|decryption refused/);
  }
});
test('evidence loss during original read or decrypt refuses preparation',async()=>{
  for(const step of ['readOriginal','decryptCiphertext']){const f=await existingFixture(),run=f.deps[step];f.deps[step]=async t=>{const r=await run(t);f.deny();return r;};await assert.rejects(prepareVerifiedPrivateNameArtifact(f.i,f.deps),/Verified baseline/);}
});
test('closing original-generation drift refuses despite correct initial plaintext',async()=>{
  const f=await existingFixture(),read=f.deps.readOriginal;let count=0;f.deps.readOriginal=async t=>{const r=await read(t);if(++count===2)r.ciphertext=[...r.ciphertext,0];return r;};await assert.rejects(prepareVerifiedPrivateNameArtifact(f.i,f.deps),/changed during preparation/);
});