// Real two-group club revocation; no global account/admission prototype flags.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { DerivedPublicKey, EncryptedVetKey, TransportSecretKey, IbeCiphertext, IbeIdentity, IbeSeed } from '@icp-sdk/vetkeys';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as piiIdl } from '../src/lab/bindings/pii_access_control/declarations/pii_access_control.did.js';
import { idlFactory as blobIdl } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';
const p = n => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const governor = p(1), removed = p(2), retained = p(3);
const ok = r => { assert.ok('Ok' in r, String(r.Err)); return r.Ok; };
const deny = async call => { let denied = false; try { const r = await call(); denied = !!r && 'Err' in r; } catch { denied = true; } assert.ok(denied, 'Expected club-specific denial'); };
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl(), { fiduciary: { state: { type: 'new' } } });
  const groups = [];
  for (const id of ['club-a', 'club-b']) {
    const setup = (idlFactory, wasm, environmentVariables = []) => pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor], environmentVariables, arg: IDL.encode([IDL.Principal], [governor]) });
    const club = await setup(clubIdl, process.env.CLUB_DOMAIN_WASM);
    const pii = await setup(piiIdl, process.env.PII_ACCESS_CONTROL_WASM, [{ name: 'VETKD_KEY_NAME', value: 'key_1' }]);
    const blob = await setup(blobIdl, process.env.MEDIA_BLOB_STORE_WASM, [{ name: 'GOVERNOR_PRINCIPAL', value: governor.toText() }]);
    for (const s of [club, pii, blob]) s.actor.setPrincipal(governor);
    ok(await club.actor.create_club(id, id, id, [], []));
    for (const user of [removed, retained]) ok(await club.actor.add_role_grant(user, id, 'player', []));
    ok(await pii.actor.set_club_domain_canister(club.canisterId));
    ok(await blob.actor.set_club_domain_canister(club.canisterId));
    const pub = await pii.actor.pii_vetkey_verification_key();
    const verification = DerivedPublicKey.deserialize(Uint8Array.from(pub));
    const identity = new TextEncoder().encode(`clubmedia:${id}\u001fblob`);
    const plain = new TextEncoder().encode(`Private photo ${id}`);
    const cipher = IbeCiphertext.encrypt(verification, IbeIdentity.fromBytes(identity), plain, IbeSeed.random()).serialize();
    const path = `clubs/${id}/gallery/control.jpg`;
    const start = async (user, suffix) => { blob.actor.setPrincipal(user); const upload = ok(await blob.actor.begin_upload(`clubs/${id}/gallery/${suffix}.jpg`, 'image/jpeg', BigInt(cipher.length), 1)); ok(await blob.actor.put_chunk(upload, 0, cipher)); return upload; };
    const read = async user => { pii.actor.setPrincipal(user); const transport = TransportSecretKey.random(); const encrypted = ok(await pii.actor.get_club_media_vetkey(id, transport.publicKeyBytes())); const key = EncryptedVetKey.deserialize(Uint8Array.from(encrypted)).decryptAndVerify(transport, verification, identity); const response = await blob.actor.http_request({ url: `/${path}`, method: 'GET', headers: [], body: new Uint8Array() }); assert.equal(response.status_code, 200); assert.deepEqual(IbeCiphertext.deserialize(Uint8Array.from(response.body)).decrypt(key), plain); };
    const control = await start(removed, 'control'); ok(await blob.actor.finalize_upload(control));
    await read(removed); await read(retained);
    groups.push({ id, club, pii, blob, read, start });
  }
  const [a, b] = groups;
  const relayIdl = ({ IDL }) => IDL.Service({ hold: IDL.Func([], [], []), release: IDL.Func([], [], []), progress: IDL.Func([], [IDL.Bool], ['query']), read_has_club_membership: IDL.Func([IDL.Principal, IDL.Text], [IDL.Bool], []) });
  const relay = await pic.setupCanister({ idlFactory: relayIdl, wasm: process.env.CLUB_REVOCATION_RELAY_WASM, sender: governor, controllers: [governor], arg: IDL.encode([IDL.Principal], [a.club.canisterId]) });
  a.pii.actor.setPrincipal(governor); ok(await a.pii.actor.set_club_domain_canister(relay.canisterId));
  await relay.actor.hold();
  const transport = TransportSecretKey.random();
  const signature = piiIdl({ IDL })._fields.find(([name]) => name === 'get_club_media_vetkey')?.[1];
  assert.ok(signature);
  const heldKey = await pic.client.submitCall({ canisterId: a.pii.canisterId, sender: removed, method: 'get_club_media_vetkey', payload: new Uint8Array(IDL.encode(signature.argTypes, [a.id, transport.publicKeyBytes()])) });
  let observed = false;
  for (let n = 0; n < 60; n++) { await pic.tick(1); if (await relay.actor.progress()) { observed = true; break; } }
  assert.ok(observed, 'Real membership reply must be held before removal');
  const pending = await a.start(removed, 'interrupted');
  a.club.actor.setPrincipal(governor); ok(await a.club.actor.remove_member(a.id, removed));
  await relay.actor.release();
  const reply = await pic.client.awaitCall(heldKey);
  assert.ok('Err' in IDL.decode(signature.retTypes, reply.body)[0], 'Stale permitting membership reply must not yield a fresh photo key');
  a.pii.actor.setPrincipal(governor); ok(await a.pii.actor.set_club_domain_canister(a.club.canisterId));
  await deny(() => a.read(removed));
  a.blob.actor.setPrincipal(removed);
  await deny(() => a.blob.actor.put_chunk(pending, 0, new Uint8Array([1])));
  await deny(() => a.blob.actor.finalize_upload(pending));
  await deny(() => a.start(removed, 'after-removal'));
  // Real inter-service original-human call: membership check is not caller-role based.
  a.club.actor.setPrincipal(a.pii.canisterId);
  assert.equal(await a.club.actor.read_has_club_membership(removed, a.id), false);
  assert.equal(await a.club.actor.read_has_club_membership(retained, a.id), true);
  await a.read(retained); const kept = await a.start(retained, 'retained'); ok(await a.blob.actor.finalize_upload(kept));
  await b.read(removed); const other = await b.start(removed, 'other-club'); ok(await b.blob.actor.finalize_upload(other));
  // An unavailable club authority denies fresh access, not a shared fallback.
  await pic.stopCanister({ canisterId: a.club.canisterId, sender: governor });
  await deny(() => a.read(retained)); await deny(() => a.start(retained, 'authority-outage'));
  await b.read(removed);
  await pic.startCanister({ canisterId: a.club.canisterId, sender: governor });
  await a.read(retained);
  // Clearing the roster marker does not silently restore previously revoked roles.
  a.club.actor.setPrincipal(governor); ok(await a.club.actor.restore_member(a.id, removed));
  await deny(() => a.read(removed)); await deny(() => a.start(removed, 'marker-cleared'));
  // Upgrade persistence without snapshot rollback: cached keys are not revoked.
  await pic.upgradeCanister({ canisterId: a.club.canisterId, wasm: process.env.CLUB_DOMAIN_WASM, sender: governor, upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }, arg: IDL.encode([IDL.Principal], [governor]) });
  await deny(() => a.read(removed)); await a.read(retained); await b.read(removed);
  console.log('PASS: actual two-group photo decrypt, club-only key/chunk/finalize/new-upload denial, pending upload interruption, original-human delegated denial, retained members, other-club uploads, authority outage, marker restore and upgrade persistence. No live services or global account flags.');
} finally { if (pic) await pic.tearDown(); await server.stop(); }