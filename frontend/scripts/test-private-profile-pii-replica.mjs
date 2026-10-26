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
  const ownerKey = await derive(owner); assert.ok(ownerKey);
  const wrongField = IbeCiphertext.encrypt(verification, IbeIdentity.fromBytes(bytes.encode(`${subject}\u001femail`)), bytes.encode('Not a display name'), IbeSeed.random());
  assert.throws(() => wrongField.decrypt(ownerKey), 'A display-name key cannot unlock another personal field');
  const foreignVerification = DerivedPublicKey.deserialize(Uint8Array.from(await club.actor.cycles_balance().then(() => verification.publicKeyBytes())));
  // Encrypting to a different subject is sufficient to prove identity binding;
  // no synthetic or mainnet key material is introduced into the replica.
  const wrongSubject = IbeCiphertext.encrypt(foreignVerification, IbeIdentity.fromBytes(bytes.encode(`${outsider.toText()}\u001f${field}`)), bytes.encode(name), IbeSeed.random());
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
  console.log('PASS: live club removal/re-grant, club grant revocation and original-key ciphertext/denial persistence across PII upgrade. Previously acquired keys cannot be recalled; these checks assert fresh requests only. No live changes or privacy cutover.');
} finally { await pic?.tearDown(); await server.stop(); }