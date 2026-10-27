// Disposable canisters only; no deployment identity, real members or rehearsal flags.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { DerivedPublicKey, EncryptedVetKey, IbeCiphertext, IbeIdentity, IbeSeed, TransportSecretKey } from '@icp-sdk/vetkeys';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import { idlFactory as piiIdl } from '../src/lab/bindings/pii_access_control/declarations/pii_access_control.did.js';
const root=resolve(import.meta.dirname,'../..');
const p=n=>Principal.fromUint8Array(Uint8Array.of(n,1));
const governor=p(1), owner=p(2), outsider=p(3);
const ok=r=>{if('Err' in r) throw Error(r.Err); return r.Ok;};
const server=await PocketIcServer.start();
let pic;
try {
  pic=await PocketIc.create(server.getUrl(),{fiduciary:{state:{type:'new'}}});
  const identity=await pic.setupCanister({idlFactory:identityIdl,wasm:resolve(root,'target/wasm32-unknown-unknown/release/identity_access.wasm'),sender:governor,controllers:[governor],arg:IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}])});
  const pii=await pic.setupCanister({idlFactory:piiIdl,wasm:resolve(root,'backend/pii_access_control/.mops/.build/pii_access_control.wasm'),sender:governor,controllers:[governor],arg:IDL.encode([IDL.Principal],[governor]),environmentVariables:[{name:'VETKD_KEY_NAME',value:'key_1'}]});
  identity.actor.setPrincipal(owner); ok(await identity.actor.register_account());
  assert.ok('Err' in await identity.actor.read_secure_name_authority());
  await pic.updateCanisterSettings({canisterId:identity.canisterId,sender:governor,environmentVariables:[{name:'IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE',value:'1'},{name:'IGNITE_SECURE_ADULT_NAME_PII',value:pii.canisterId.toText()}]});
  await pic.updateCanisterSettings({canisterId:pii.canisterId,sender:governor,environmentVariables:[{name:'VETKD_KEY_NAME',value:'key_1'},{name:'IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE',value:'1'},{name:'IGNITE_SECURE_ADULT_NAME_IDENTITY',value:identity.canisterId.toText()}]});
  // Motoko transient settings reload on upgrade; preserve stable ciphertext state.
  await pic.upgradeCanister({canisterId:pii.canisterId,sender:governor,wasm:resolve(root,'backend/pii_access_control/.mops/.build/pii_access_control.wasm'),arg:IDL.encode([IDL.Principal],[governor]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
  assert.equal(ok(await identity.actor.read_secure_name_authority()).toText(),pii.canisterId.toText());
  assert.ok('Err' in await identity.actor.set_profile('Readable test name',[]));
  const subject=owner.toText(), reference=`pii-display-name:v1:${pii.canisterId}:${owner}`;
  assert.ok('Err' in await identity.actor.set_profile(reference,[]),'No profile publication without saved ciphertext');
  pii.actor.setPrincipal(owner);
  const publicKey=DerivedPublicKey.deserialize(Uint8Array.from(await pii.actor.pii_vetkey_verification_key()));
  const encoder=new TextEncoder(), input=encoder.encode(`${subject}\u001fdisplay_name`);
  let previous;
  for(const name of ['Secure test adult','Updated secure adult']) {
    const ciphertext=IbeCiphertext.encrypt(publicKey,IbeIdentity.fromBytes(input),encoder.encode(name),IbeSeed.random()).serialize();
    ok(await pii.actor.register_pii(subject,'display_name',ciphertext,owner));
    const rows=ok(await pii.actor.get_encrypted_pii_batch([subject],'display_name','profile_display','Isolated secure-save acceptance'));
    assert.equal(rows.length,1); assert.deepEqual(Array.from(rows[0].ciphertext),Array.from(ciphertext));
    assert.ok(!Buffer.from(ciphertext).includes(Buffer.from(name)));
    if(previous) assert.notDeepEqual(Array.from(ciphertext),previous);
    previous=Array.from(ciphertext);
    const transport=TransportSecretKey.random();
    const keys=ok(await pii.actor.get_encrypted_pii_vetkeys_batch([subject],'display_name',transport.publicKeyBytes()));
    assert.ok(keys[0]?.[0]);
    const key=EncryptedVetKey.deserialize(Uint8Array.from(keys[0][0])).decryptAndVerify(transport,publicKey,input);
    assert.equal(new TextDecoder().decode(IbeCiphertext.deserialize(ciphertext).decrypt(key)),name);
    const saved=ok(await identity.actor.set_profile(reference,[]));
    assert.equal(saved.display_name,reference); assert.equal(ok(await identity.actor.get_profile()).display_name,reference);
  }
  pii.actor.setPrincipal(outsider);
  assert.deepEqual(ok(await pii.actor.get_encrypted_pii_batch([subject],'display_name','profile_display','Outsider denial')),[]);
  const denied=ok(await pii.actor.get_encrypted_pii_vetkeys_batch([subject],'display_name',TransportSecretKey.random().publicKeyBytes()));
  assert.equal(denied[0].length,0);
  assert.ok('Err' in await pii.actor.verify_secure_profile_name(owner));
  assert.ok('Err' in await identity.actor.set_profile('Readable downgrade',[]));
  assert.ok('Err' in await identity.actor.set_profile(`pii-display-name:v1:${pii.canisterId}:${outsider}`,[]));
  // Dedicated release must not expose bulk conversion or guardian search.
  identity.actor.setPrincipal(governor);
  assert.ok('Err' in await identity.actor.list_profiles_for_conversion([],1));
  console.log('PASS: production-only gate, encrypted create/edit and SDK decrypt, opaque identity readback, plaintext/missing-record/downgrade/alias refusal, outsider ciphertext/key denial; no rehearsal activation or live account changes.');
} finally {await pic?.tearDown(); await server.stop();}