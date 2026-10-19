// Compile a hash-pinned old actor, encrypt BEFORE upgrade, decrypt AFTER it.
// Never deploys; not a substitute for attesting the live module/key name.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { DerivedPublicKey, EncryptedVetKey, TransportSecretKey, IbeCiphertext, IbeIdentity, IbeSeed } from '@icp-sdk/vetkeys';
import { idlFactory as piiIdl } from '../src/lab/bindings/pii_access_control/declarations/pii_access_control.did.js';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const domain = resolve(root, 'backend/pii_access_control');
const fixture = resolve(domain, 'tests/fixtures/pre-authority');
const manifest = JSON.parse(readFileSync(resolve(fixture, 'manifest.json'), 'utf8'));
for (const [path, expected] of Object.entries(manifest.sha256))
  assert.equal(createHash('sha256').update(readFileSync(resolve(fixture, path))).digest('hex'), expected, `Frozen fixture changed: ${path}`);
mkdirSync(resolve(domain, '.mops/.build'), { recursive: true });
const legacyWasm = resolve(domain, '.mops/.build/pre-authority.wasm');
const sources = execFileSync('mops', ['sources'], { cwd: domain, encoding: 'utf8' }).trim().split(/\s+/);
const moc = process.env.MOC_BIN ?? '/root/.cache/mops/moc/1.16.1/moc';
execFileSync(moc, [...sources, '--enhanced-migration', resolve(fixture, 'src/backend/migrations'), '-o', legacyWasm, resolve(fixture, 'src/main.mo')], { cwd: domain, stdio: 'pipe' });
const governor = Principal.fromUint8Array(Uint8Array.from([1, 1]));
const member = Principal.fromUint8Array(Uint8Array.from([2, 1]));
const ok = r => { assert.ok('Ok' in r); return r.Ok; };
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl(), { fiduciary: { state: { type: 'new' } } });
  const club = await pic.setupCanister({ idlFactory: clubIdl, wasm: resolve(root, 'backend/club_domain/.mops/.build/club_domain.wasm'),
    sender: governor, controllers: [governor], arg: IDL.encode([IDL.Principal], [governor]) });
  club.actor.setPrincipal(governor); ok(await club.actor.create_club('legacy', 'Legacy', 'legacy', [], []));
  ok(await club.actor.add_role_grant(member, 'legacy', 'player', []));
  // PocketIC's fiduciary subnet exposes key_1 only; test_key_1 matching is
  // covered by the attestation rule tests, not claimed as a replica rehearsal.
  for (const name of ['key_1']) {
    const old = await pic.setupCanister({ idlFactory: piiIdl, wasm: legacyWasm, sender: governor, controllers: [governor],
      arg: IDL.encode([IDL.Principal], [governor]), environmentVariables: [{ name: 'VETKD_KEY_NAME', value: name }] });
    const a = old.actor; a.setPrincipal(governor); ok(await a.set_club_domain_canister(club.canisterId));
    const verificationBytes = Uint8Array.from(await a.pii_vetkey_verification_key());
    const verification = DerivedPublicKey.deserialize(verificationBytes);
    const identity = new TextEncoder().encode('clubmedia:legacy\u001fblob');
    const plain = new TextEncoder().encode('Frozen old-schema photo');
    const ciphertext = IbeCiphertext.encrypt(verification, IbeIdentity.fromBytes(identity), plain, IbeSeed.random()).serialize();
    ok(await a.register_pii('legacy-child', 'name', [7, 8, 9], member));
    await pic.upgradeCanister({ canisterId: old.canisterId, wasm: resolve(domain, '.mops/.build/pii_access_control.wasm'), sender: governor,
      arg: IDL.encode([IDL.Principal], [governor]), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
    assert.deepEqual(Uint8Array.from(await a.pii_vetkey_verification_key()), verificationBytes);
    assert.equal(ok(await a.read_club_media_authority('legacy')).revision, 0n);
    a.setPrincipal(member);
    assert.deepEqual(ok(await a.get_encrypted_pii_batch(['legacy-child'], 'name', 'read', 'test'))[0].ciphertext, Uint8Array.from([7, 8, 9]));
    const transport = TransportSecretKey.random();
    const relay = ok(await a.get_club_media_vetkey('legacy', transport.publicKeyBytes()));
    const key = EncryptedVetKey.deserialize(Uint8Array.from(relay)).decryptAndVerify(transport, verification, identity);
    assert.deepEqual(IbeCiphertext.deserialize(ciphertext).decrypt(key), plain);
  }
  console.log(`PASS: frozen old schema ${manifest.commit} upgrades with key_1, preserves stored PII and decrypts pre-upgrade ciphertext. PocketIC does not expose test_key_1; not mainnet attestation.`);
} finally { if (pic) await pic.tearDown(); await server.stop(); }