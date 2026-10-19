// Real local vetKD/IBE rehearsal; never deploys or authorizes live club moves.
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { DerivedPublicKey, EncryptedVetKey, TransportSecretKey, IbeCiphertext, IbeIdentity, IbeSeed } from '@icp-sdk/vetkeys';
import { idlFactory as piiIdl } from '../src/lab/bindings/pii_access_control/declarations/pii_access_control.did.js';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const governor = Principal.fromUint8Array(Uint8Array.from([1, 1]));
const member = Principal.fromUint8Array(Uint8Array.from([2, 1]));
const stale = Principal.fromUint8Array(Uint8Array.from([3, 1]));
const stranger = Principal.fromUint8Array(Uint8Array.from([4, 1]));
const ok = r => { assert.ok('Ok' in r, JSON.stringify(r, (_, v) => typeof v === 'bigint' ? String(v) : v)); return r.Ok; };
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl(), { fiduciary: { state: { type: 'new' } } });
  const setup = (idlFactory, domain) => pic.setupCanister({ idlFactory,
    wasm: resolve(root, `backend/${domain}/.mops/.build/${domain}.wasm`),
    sender: governor, controllers: [governor], environmentVariables: domain === 'pii_access_control' ? [{ name: 'VETKD_KEY_NAME', value: 'key_1' }] : [], arg: IDL.encode([IDL.Principal], [governor]) });
  const source = await setup(clubIdl, 'club_domain');
  const target = await setup(clubIdl, 'club_domain');
  for (const c of [source, target]) {
    c.actor.setPrincipal(governor);
    ok(await c.actor.create_club('moving', 'Moving club', 'moving', [], []));
    ok(await c.actor.add_role_grant(member, 'moving', 'player', []));
  }
  ok(await source.actor.add_role_grant(stale, 'moving', 'player', []));
  ok(await source.actor.create_club('bystander', 'Bystander', 'bystander', [], []));
  ok(await source.actor.add_role_grant(stale, 'bystander', 'player', []));
  const original = await setup(piiIdl, 'pii_access_control');
  const a = original.actor; a.setPrincipal(governor);
  ok(await a.set_club_domain_canister(source.canisterId));
  const identity = new TextEncoder().encode('clubmedia:moving\u001fblob');
  const verificationBytes = Uint8Array.from(await a.pii_vetkey_verification_key());
  const verification = DerivedPublicKey.deserialize(verificationBytes);
  const plaintext = new TextEncoder().encode('Existing encrypted club photo');
  const ciphertext = IbeCiphertext.encrypt(verification, IbeIdentity.fromBytes(identity), plaintext, IbeSeed.random()).serialize();
  const decrypt = async user => {
    a.setPrincipal(user); const transport = TransportSecretKey.random();
    const bytes = ok(await a.get_club_media_vetkey('moving', transport.publicKeyBytes()));
    const key = EncryptedVetKey.deserialize(Uint8Array.from(bytes)).decryptAndVerify(transport, verification, identity);
    assert.deepEqual(IbeCiphertext.deserialize(ciphertext).decrypt(key), plaintext);
  };
  const denied = async user => {
    a.setPrincipal(user);
    const result = await a.get_club_media_vetkey('moving', TransportSecretKey.random().publicKeyBytes()).catch(error => ({ Err: String(error) }));
    assert.ok('Err' in result);
  };
  await decrypt(member); await decrypt(stale); await denied(stranger);
  // Real private-file identity: club membership must not imply owner access.
  const privatePath = 'clubs/moving/vault/private-file';
  const privateIdentity = new TextEncoder().encode(privatePath + '\u001fblob');
  const privateCipher = IbeCiphertext.encrypt(verification, IbeIdentity.fromBytes(privateIdentity), plaintext, IbeSeed.random()).serialize();
  a.setPrincipal(governor); ok(await a.register_pii(privatePath, 'blob', [...privateCipher], member));
  const privateRead = async (user, expected) => {
    a.setPrincipal(user); const transport = TransportSecretKey.random();
    const result = ok(await a.get_encrypted_pii_vetkeys_batch([privatePath], 'blob', transport.publicKeyBytes()));
    assert.equal(result[0].length, expected ? 1 : 0);
    if (expected) {
      const key = EncryptedVetKey.deserialize(Uint8Array.from(result[0][0])).decryptAndVerify(transport, verification, privateIdentity);
      assert.deepEqual(IbeCiphertext.deserialize(privateCipher).decrypt(key), plaintext);
    }
  };
  await privateRead(member, true); await privateRead(stale, false); await privateRead(stranger, false);
  a.setPrincipal(stranger);
  assert.ok('Err' in await a.add_guardian_relationship(stranger, privatePath), 'self-claimed guardian cannot unlock private files');
  assert.ok('Err' in await a.register_pii(privatePath, 'blob', [1], stranger), 'a different caller cannot overwrite the original owner record');
  await privateRead(member, true);
  a.setPrincipal(member); ok(await a.grant_pii_read(privatePath, 'blob', stale));
  await privateRead(stale, true);
  a.setPrincipal(member); ok(await a.revoke_pii_read(privatePath, 'blob', stale));
  await privateRead(stale, false);
  a.setPrincipal(member); ok(await a.grant_pii_read_club(privatePath, 'blob', 'moving'));
  await privateRead(stale, true);
  a.setPrincipal(member); ok(await a.revoke_pii_read_club(privatePath, 'blob', 'moving'));
  await privateRead(stale, false);
  source.actor.setPrincipal(member); const child = ok(await source.actor.create_own_child());
  a.setPrincipal(governor); ok(await a.register_pii(child.id, 'name', [1, 2], governor));
  a.setPrincipal(member); ok(await a.add_guardian_relationship(member, child.id));
  const guardianRead = async expected => {
    a.setPrincipal(member);
    const result = ok(await a.get_encrypted_pii_vetkeys_batch([child.id], 'name', TransportSecretKey.random().publicKeyBytes()));
    assert.equal(result[0].length, expected ? 1 : 0);
  };
  await guardianRead(true);
  assert.deepEqual(await a.my_guardian_children(), [child.id]);
  source.actor.setPrincipal(member); ok(await source.actor.delete_own_child(child.id));
  await guardianRead(false); // stored mirror cannot outlive verified relationship
  assert.deepEqual(await a.my_guardian_children(), []);
  // Deterministic suspended calls, not a timing-dependent Promise.all race.
  const deferred = pic.createDeferredActor(piiIdl, original.canisterId);
  deferred.setPrincipal(member);
  const rejectedRace = await deferred.get_club_media_vetkey('moving', TransportSecretKey.random().publicKeyBytes());
  await pic.tick(1);
  a.setPrincipal(stranger); assert.ok('Err' in await a.purge_club_snapshot('moving'));
  assert.ok('Err' in await a.import_club_snapshot('moving', []));
  assert.ok('Ok' in await rejectedRace(), 'rejected non-governor calls do not mutate epochs or interrupt key reads');
  const pendingPrivate = await deferred.get_encrypted_pii_vetkeys_batch([privatePath], 'blob', TransportSecretKey.random().publicKeyBytes());
  await pic.tick(1);
  a.setPrincipal(member); ok(await a.revoke_pii_read(privatePath, 'blob', stale));
  assert.ok('Err' in await pendingPrivate(), 'permission mutation invalidates suspended private-key derivation');
  const pendingShared = await deferred.get_club_media_vetkey('moving', TransportSecretKey.random().publicKeyBytes());
  await pic.tick(1);
  a.setPrincipal(governor); ok(await a.set_transfer_fence('moving', true));
  ok(await a.set_transfer_fence('moving', false));
  assert.ok('Err' in await pendingShared(), 'even a fence acquired and released during an await invalidates the key');
  await decrypt(member);
  const pendingAuthority = await deferred.get_club_media_vetkey('moving', TransportSecretKey.random().publicKeyBytes());
  await pic.tick(1);
  a.setPrincipal(governor); ok(await a.set_transfer_fence('moving', true));
  const raceAuthority = ok(await a.set_club_media_authority('moving', [target.canisterId], 'race-forward', 0n));
  const raceRestore = ok(await a.set_club_media_authority('moving', [], 'race-restore', raceAuthority.revision));
  ok(await a.set_transfer_fence('moving', false));
  assert.ok('Err' in await pendingAuthority(), 'authority changed and restored during an await still invalidates the key');
  assert.equal(raceRestore.revision, 2n); await decrypt(member);
  a.setPrincipal(stranger);
  assert.ok('Err' in await a.register_pii('clubmedia:moving', 'blob', [1], stranger), 'generic records cannot capture the shared photo identity');
  assert.ok('Err' in await a.register_pii('clubmedia:moving\u001fblob', '', [1], stranger));
  assert.ok('Err' in await a.register_pii('ordinary\u001falias', 'blob', [1], stranger));
  assert.ok('Err' in await a.get_encrypted_pii_vetkeys_batch(['clubmedia:moving'], 'blob', TransportSecretKey.random().publicKeyBytes()), 'generic relay cannot derive the shared photo key');
  a.setPrincipal(member);
  assert.ok('Err' in await a.set_club_media_authority('moving', [target.canisterId], 'move-1', 0n));
  assert.ok('Err' in await a.read_club_media_authority('moving'));
  a.setPrincipal(governor);
  assert.ok('Err' in await a.set_club_media_authority('moving', [target.canisterId], 'move-1', 0n), 'must be fenced');
  ok(await a.set_transfer_fence('moving', true));
  assert.ok('Err' in await a.set_club_media_authority('moving', [Principal.anonymous()], 'move-1', 0n));
  const receipt = ok(await a.set_club_media_authority('moving', [target.canisterId], 'move-1', raceRestore.revision));
  assert.equal(receipt.revision, 3n);
  assert.ok('Err' in await a.set_club_media_authority('moving', [target.canisterId], 'move-1', 0n));
  await denied(member);
  a.setPrincipal(governor); ok(await a.set_transfer_fence('moving', false));
  await decrypt(member); await denied(stale); await denied(stranger);
  // A private file keeps the ORIGINAL crypto key while its pre-existing
  // staff entitlement follows verified destination roles, not old mirrors.
  a.setPrincipal(member); ok(await a.grant_pii_read_club(privatePath, 'blob', 'moving'));
  target.actor.setPrincipal(governor); ok(await target.actor.add_role_grant(stranger, 'moving', 'coach', []));
  await privateRead(stranger, true); await privateRead(stale, false);
  a.setPrincipal(governor); ok(await a.set_transfer_fence('moving', true));
  ok(await a.purge_club_snapshot('moving')); ok(await a.set_transfer_fence('moving', false));
  await privateRead(stranger, true); // source metadata purge retains original grant
  target.actor.setPrincipal(governor); ok(await target.actor.remove_member('moving', stranger));
  await privateRead(stranger, false); await privateRead(member, true);
  a.setPrincipal(stale);
  assert.ok('Ok' in await a.get_club_media_vetkey('bystander', TransportSecretKey.random().publicKeyBytes()), 'other club keeps original authority');
  await pic.upgradeCanister({ canisterId: original.canisterId,
    wasm: resolve(root, 'backend/pii_access_control/.mops/.build/pii_access_control.wasm'), sender: governor,
    arg: IDL.encode([IDL.Principal], [governor]), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  a.setPrincipal(governor); assert.deepEqual(ok(await a.read_club_media_authority('moving')), receipt);
  assert.deepEqual(Uint8Array.from(await a.pii_vetkey_verification_key()), verificationBytes);
  await pic.updateCanisterSettings({ canisterId: original.canisterId, sender: governor,
    environmentVariables: [{ name: 'VETKD_KEY_NAME', value: 'test_key_1' }] });
  await pic.upgradeCanister({ canisterId: original.canisterId,
    wasm: resolve(root, 'backend/pii_access_control/.mops/.build/pii_access_control.wasm'), sender: governor,
    arg: IDL.encode([IDL.Principal], [governor]), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  assert.deepEqual(Uint8Array.from(await a.pii_vetkey_verification_key()), verificationBytes, 'environment changes cannot replace the pinned key');
  await decrypt(member); await denied(stale);
  target.actor.setPrincipal(governor); ok(await target.actor.remove_member('moving', member));
  await denied(member); // source still has this member; no stale fallback
  a.setPrincipal(governor); ok(await a.set_transfer_fence('moving', true));
  const unavailable = await pic.createCanister({ sender: governor, controllers: [governor] });
  const broken = ok(await a.set_club_media_authority('moving', [unavailable], 'move-2', receipt.revision));
  ok(await a.set_transfer_fence('moving', false)); await denied(stale);
  a.setPrincipal(governor); ok(await a.set_transfer_fence('moving', true));
  const aborted = ok(await a.set_club_media_authority('moving', [], 'abort-2', broken.revision));
  assert.equal(aborted.revision, 5n);
  assert.ok('Err' in await a.set_club_media_authority('moving', [target.canisterId], 'old-replay', 0n));
  ok(await a.set_transfer_fence('moving', false)); await decrypt(stale);
  console.log('PASS: original ciphertext decrypts before/after authority change and EOP upgrade; destination removal, stale source, stranger, fences, CAS, unavailable authority, abort tombstone and bystander checks pass. Not live-move acceptance.');
} finally { if (pic) await pic.tearDown(); await server.stop(); }