// Disposable real-service cryptography checks only. No mainnet hosts or keys.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { DerivedPublicKey, EncryptedVetKey, TransportSecretKey, IbeCiphertext, IbeIdentity, IbeSeed } from '@icp-sdk/vetkeys';
import { idlFactory as piiIdl } from '../src/lab/bindings/pii_access_control/declarations/pii_access_control.did.js';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';

const root = resolve(import.meta.dirname, '../..');
const piiWasm = process.env.PRIVATE_PROFILE_PII_WASM || resolve(root, 'backend/pii_access_control/.mops/.build/pii_access_control.wasm');
const clubWasm = process.env.PRIVATE_PROFILE_CLUB_WASM || resolve(root, 'backend/club_domain/.mops/.build/club_domain.wasm');
const p = n => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const governor = p(1), owner = p(2), reader = p(3), staff = p(4), outsider = p(5), ordinary = p(6);
const subject = owner.toText(), field = 'display_name', clubId = 'private-name-club';
const bytes = new TextEncoder(), name = 'Paul Cranwell';
const input = bytes.encode(`${subject}\u001f${field}`);
const ok = reply => { assert.ok('Ok' in reply, reply.Err); return reply.Ok; };
const arg = IDL.encode([IDL.Principal], [governor]);
const server = await PocketIcServer.start();
let pic;
try {
  pic = await PocketIc.create(server.getUrl(), { fiduciary: { state: { type: 'new' } } });
  const club = await pic.setupCanister({ idlFactory: clubIdl, wasm: clubWasm, sender: governor, controllers: [governor], arg });
  const pii = await pic.setupCanister({ idlFactory: piiIdl, wasm: piiWasm, sender: governor, controllers: [governor], arg,
    environmentVariables: [{ name: 'VETKD_KEY_NAME', value: 'key_1' }] });
  const as = who => { pii.actor.setPrincipal(who); return pii.actor; };
  club.actor.setPrincipal(governor);
  ok(await club.actor.create_club(clubId, 'Private names', 'private-names', [], []));
  ok(await club.actor.add_role_grant(staff, clubId, 'club_admin', []));
  ok(await club.actor.add_role_grant(ordinary, clubId, 'member', []));
  as(governor); ok(await pii.actor.set_club_domain_canister(club.canisterId));
  const verification = DerivedPublicKey.deserialize(Uint8Array.from(await pii.actor.pii_vetkey_verification_key()));
  const cipher = IbeCiphertext.encrypt(verification, IbeIdentity.fromBytes(input), bytes.encode(name), IbeSeed.random()).serialize();
  assert.notDeepEqual(Array.from(cipher), Array.from(bytes.encode(name)));
  ok(await as(owner).register_pii(subject, field, cipher, owner));

  const ciphertext = async who => ok(await as(who).get_encrypted_pii_batch([subject], field, 'profile_display', 'Local private-name acceptance'));
  const derive = async who => {
    const transport = TransportSecretKey.random();
    const entries = ok(await as(who).get_encrypted_pii_vetkeys_batch([subject], field, transport.publicKeyBytes()));
    assert.equal(entries.length, 1, 'Key results stay index-aligned');
    const encrypted = entries[0]?.[0];
    if (!encrypted) return null;
    return EncryptedVetKey.deserialize(Uint8Array.from(encrypted)).decryptAndVerify(transport, verification, input);
  };
  const decrypt = async who => {
    const rows = await ciphertext(who);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].pii_id, subject); assert.equal(rows[0].field_id, field);
    const key = await derive(who); assert.ok(key);
    assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(IbeCiphertext.deserialize(Uint8Array.from(rows[0].ciphertext)).decrypt(key)), name);
  };
  const denied = async who => {
    assert.deepEqual(await ciphertext(who), [], 'Unauthorized caller receives no ciphertext');
    assert.equal(await derive(who), null, 'Unauthorized caller receives no fresh key');
  };
  await decrypt(owner); await denied(outsider); await denied(reader);
  // The real optional contact-email contract uses its existing private field;
  // display-name grants must never unlock it, and empty encryption clears it.
  const emailField='contact_email';
  const emailInput=bytes.encode(`${subject}\u001f${emailField}`);
  const readEmail=async(who)=>{
    const rows=ok(await as(who).get_encrypted_pii_batch([subject],emailField,'read_contact_email','Local own-email acceptance'));
    const transport=TransportSecretKey.random();
    const keys=ok(await as(who).get_encrypted_pii_vetkeys_batch([subject],emailField,transport.publicKeyBytes()));
    if(!rows.length){assert.equal(keys[0]?.length,0);return null;}
    const encrypted=keys[0]?.[0];assert.ok(encrypted);
    const key=EncryptedVetKey.deserialize(Uint8Array.from(encrypted)).decryptAndVerify(transport,verification,emailInput);
    return new TextDecoder().decode(IbeCiphertext.deserialize(Uint8Array.from(rows[0].ciphertext)).decrypt(key));
  };
  const saveEmail=async(value)=>ok(await as(owner).register_pii(subject,emailField,IbeCiphertext.encrypt(verification,IbeIdentity.fromBytes(emailInput),bytes.encode(value),IbeSeed.random()).serialize(),owner));
  await saveEmail('paul@example.test');
  assert.equal(await readEmail(owner),'paul@example.test');
  assert.equal(await readEmail(reader),null);
  assert.equal(await readEmail(staff),null);
  assert.equal(await readEmail(ordinary),null);
  await saveEmail('');assert.equal(await readEmail(owner),'','Explicit clear decrypts to empty under the original private field');
  console.log('PASS: real owner-only contact-email encryption, decryption, reader/member denial and verified empty clear. No delivery sent.');
  const ownerKey = await derive(owner); assert.ok(ownerKey);
  const wrongField = IbeCiphertext.encrypt(verification, IbeIdentity.fromBytes(bytes.encode(`${subject}\u001femail`)), bytes.encode('Not a display name'), IbeSeed.random());
  assert.throws(() => wrongField.decrypt(ownerKey), 'A display-name key cannot unlock another personal field');
  // Encrypting to a different subject is sufficient to prove identity binding;
  // no synthetic or mainnet key material is introduced into the replica.
  const wrongSubject = IbeCiphertext.encrypt(verification, IbeIdentity.fromBytes(bytes.encode(`${outsider.toText()}\u001f${field}`)), bytes.encode(name), IbeSeed.random());
  assert.throws(() => wrongSubject.decrypt(ownerKey), 'The key is bound to the original subject');
  assert.ok('Err' in await as(owner).get_encrypted_pii_batch(Array(101).fill(subject), field, 'profile_display', 'Bound test'));
  assert.ok('Err' in await as(owner).get_encrypted_pii_vetkeys_batch(Array(26).fill(subject), field, TransportSecretKey.random().publicKeyBytes()));
  await assert.rejects(() => as(Principal.anonymous()).get_encrypted_pii_batch([subject], field, 'profile_display', 'Anonymous test'));
  await assert.rejects(() => as(Principal.anonymous()).get_encrypted_pii_vetkeys_batch([subject], field, TransportSecretKey.random().publicKeyBytes()));
  assert.ok('Err' in await as(outsider).register_pii(subject, field, cipher, outsider), 'Other users cannot overwrite an owned name');
  assert.ok('Err' in await as(outsider).grant_pii_read(subject, field, outsider), 'A caller cannot grant itself access');
  ok(await as(owner).grant_pii_read(subject, field, reader));
  await decrypt(reader);
  ok(await as(owner).revoke_pii_read(subject, field, reader));
  await denied(reader);
  ok(await as(owner).grant_pii_read_club(subject, field, clubId));
  await decrypt(staff); await denied(outsider);
  // Despite the historical staff method name, the actual authority accepts
  // any current club role. Exercise that existing rule, never widen grants.
  await decrypt(ordinary);
  assert.equal(await readEmail(ordinary),null,'A display-name club grant does not disclose personal email');
  await pic.stopCanister({ canisterId: club.canisterId, sender: governor });
  await denied(staff);
  await pic.startCanister({ canisterId: club.canisterId, sender: governor });
  await decrypt(staff);
  console.log('PASS: real SDK encryption/decryption; owner and explicit reader; unrelated/overwrite/self-grant refusal; explicit revocation; exact club role audiences including ordinary members.');
  club.actor.setPrincipal(governor); ok(await club.actor.remove_member(clubId, staff));
  await denied(staff);
  ok(await club.actor.restore_member(clubId, staff));
  ok(await club.actor.add_role_grant(staff, clubId, 'club_admin', []));
  await decrypt(staff);
  ok(await as(owner).revoke_pii_read_club(subject, field, clubId));
  await denied(staff); await denied(ordinary);
  await pic.upgradeCanister({ canisterId: pii.canisterId, wasm: piiWasm, sender: governor, arg,
    upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  await decrypt(owner); await denied(reader); await denied(staff); await denied(outsider);
  if (process.env.PRIVATE_PROFILE_CLUB_RELAY_WASM) {
    const relayIdl = ({ IDL }) => IDL.Service({
      read_has_club_staff_role: IDL.Func([IDL.Principal, IDL.Text], [IDL.Bool], []),
      hold_on: IDL.Func([IDL.Nat], [], []), release: IDL.Func([], [], []),
      progress: IDL.Func([], [IDL.Nat, IDL.Nat, IDL.Bool], ['query']),
    });
    const relay = await pic.setupCanister({ idlFactory: relayIdl,
      wasm: process.env.PRIVATE_PROFILE_CLUB_RELAY_WASM, sender: governor, controllers: [governor],
      arg: IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal], [governor, club.canisterId, pii.canisterId]) });
    ok(await as(governor).set_club_domain_canister(relay.canisterId));
    const signature = piiIdl({ IDL })._fields.find(([method]) => method === 'get_encrypted_pii_vetkeys_batch')?.[1];
    assert.ok(signature);
    const hold = async (at, caller) => {
      relay.actor.setPrincipal(governor); await relay.actor.hold_on(BigInt(at));
      const pending = await pic.client.submitCall({ canisterId: pii.canisterId, sender: caller,
        method: 'get_encrypted_pii_vetkeys_batch',
        payload: new Uint8Array(IDL.encode(signature.argTypes, [[subject], field, TransportSecretKey.random().publicKeyBytes()])) });
      let observed = false;
      for (let step = 0; step < 80; step++) {
        await pic.tick(1); const progress = await relay.actor.progress();
        if (progress[1] === BigInt(at) && !progress[2]) { observed = true; break; }
      }
      assert.ok(observed, `Real PII authorization reply ${at} must be held`);
      return async () => { await relay.actor.release(); return IDL.decode(signature.retTypes, (await pic.client.awaitCall(pending)).body)[0]; };
    };
    for (const at of [1, 2]) {
      ok(await as(owner).grant_pii_read_club(subject, field, clubId));
      const finish = await hold(at, staff);
      ok(await as(owner).revoke_pii_read_club(subject, field, clubId));
      assert.ok('Err' in await finish(), `Revoked club grant at reply ${at} must withhold the derived key`);
      await denied(staff);
      ok(await as(owner).grant_pii_read_club(subject, field, clubId));
      await decrypt(staff);
      ok(await as(owner).revoke_pii_read_club(subject, field, clubId));
    }
    ok(await as(owner).grant_pii_read_club(subject, field, clubId));
    const finishMembership = await hold(1, staff);
    club.actor.setPrincipal(governor); ok(await club.actor.remove_member(clubId, staff));
    assert.ok('Err' in await finishMembership(), 'Removal after the opening reply invalidates the final audience');
    await denied(staff);
    ok(await club.actor.restore_member(clubId, staff));
    ok(await club.actor.add_role_grant(staff, clubId, 'club_admin', []));
    await decrypt(staff);
    for (const at of [1, 2]) {
      const finishAuthority = await hold(at, staff);
      ok(await as(governor).set_club_domain_canister(club.canisterId));
      assert.ok('Err' in await finishAuthority(), `Changed PII club authority at reply ${at} must withhold keys`);
      ok(await as(governor).set_club_domain_canister(relay.canisterId));
      await decrypt(staff);
    }
    ok(await as(owner).revoke_pii_read_club(subject, field, clubId));
    // Keep a club grant only to create a real held authorization await; the
    // unrelated explicit reader never gets membership through this fixture.
    ok(await as(owner).grant_pii_read_club(subject, field, clubId));
    ok(await as(owner).grant_pii_read(subject, field, reader));
    const finishReader = await hold(2, reader);
    ok(await as(owner).revoke_pii_read(subject, field, reader));
    assert.ok('Err' in await finishReader(), 'Explicit reader revocation while final reply is held withholds its key');
    await denied(reader);
    ok(await as(owner).revoke_pii_read_club(subject, field, clubId));
    ok(await as(governor).set_club_domain_canister(club.canisterId));
    console.log('PASS: actual first/final PII authorization replies held; club/explicit grant revocation and authority drift withhold keys; membership removal between audience checks denies; authorized retries decrypt with original SDK authority.');
  }
  console.log('PASS: live club removal/re-grant, club grant revocation and original-key ciphertext/denial persistence across PII upgrade. Previously acquired keys cannot be recalled; these checks assert fresh requests only. No live changes or privacy cutover.');
} finally { await pic?.tearDown(); await server.stop(); }