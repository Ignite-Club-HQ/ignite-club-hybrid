// Disposable original-PII release boundary + real SDK keys, no live inventory.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { DerivedPublicKey, EncryptedVetKey, TransportSecretKey, IbeCiphertext, IbeIdentity, IbeSeed } from '@icp-sdk/vetkeys';
import { idlFactory } from '../src/lab/bindings/pii_access_control/declarations/pii_access_control.did.js';
for (const key of ['POCKET_IC_BIN', 'PRIVATE_NAME_FENCE_PII_WASM', 'PRIVATE_NAME_FENCE_IDENTITY_WASM']) assert.ok(process.env[key], `${key} required`);
const p = n => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const owner = p(1), viewer = p(2), subject = p(3), outsider = p(4);
const requestType = IDL.Record({ operation_id: IDL.Text, generation: IDL.Nat64, inventory_digest: IDL.Vec(IDL.Nat8) });
const receiptType = IDL.Record({ request: requestType, receiver: IDL.Principal, completed: IDL.Bool, release_epoch: IDL.Nat });
const identityIdl = ({ IDL }) => IDL.Service({
  configure: IDL.Func([IDL.Principal], [], []), hold_on: IDL.Func([IDL.Nat], [], []),
  is_held: IDL.Func([], [IDL.Bool], ['query']), release: IDL.Func([], [], []),
  fence: IDL.Func([requestType, IDL.Bool], [IDL.Variant({ Ok: receiptType, Err: IDL.Text })], []),
  fence_lost_reply: IDL.Func([requestType, IDL.Bool], [IDL.Variant({ Ok: receiptType, Err: IDL.Text })], []),
  receipt: IDL.Func([requestType], [IDL.Variant({ Ok: receiptType, Err: IDL.Text })], []),
});
const ok = result => { assert.ok('Ok' in result, result.Err); return result.Ok; };
const server = await PocketIcServer.start({ binPath: process.env.POCKET_IC_BIN });
let pic;
try {
  pic = await PocketIc.create(server.getUrl(), { fiduciary: { state: { type: 'new' } } });
  const identity = await pic.setupCanister({ idlFactory: identityIdl, wasm: process.env.PRIVATE_NAME_FENCE_IDENTITY_WASM, sender: owner, controllers: [owner], arg: IDL.encode([IDL.Principal, IDL.Principal, IDL.Principal], [owner, viewer, subject]) });
  const arg = IDL.encode([IDL.Principal], [owner]);
  const env = [{ name: 'VETKD_KEY_NAME', value: 'key_1' }, { name: 'IGNITE_PRIVATE_PROFILE_READS_REHEARSAL', value: '1' }, { name: 'IGNITE_PRIVATE_PROFILE_IDENTITY', value: identity.canisterId.toText() }];
  const pii = await pic.setupCanister({ idlFactory, wasm: process.env.PRIVATE_NAME_FENCE_PII_WASM, sender: owner, controllers: [owner], arg, environmentVariables: env });
  identity.actor.setPrincipal(owner); await identity.actor.configure(pii.canisterId);
  pii.actor.setPrincipal(subject);
  const publicKey = DerivedPublicKey.deserialize(Uint8Array.from(await pii.actor.pii_vetkey_verification_key()));
  const input = new TextEncoder().encode(`${subject.toText()}\u001fdisplay_name`);
  const cipher = IbeCiphertext.encrypt(publicKey, IbeIdentity.fromBytes(input), new TextEncoder().encode('Private test name'), IbeSeed.random()).serialize();
  ok(await pii.actor.register_pii(subject.toText(), 'display_name', cipher, subject));
  const scope = { kind: 'club', authority: identity.canisterId, resource: 'test-club', profile_revision: 0n };
  pii.actor.setPrincipal(viewer);
  const decrypt = async () => {
    const rows = ok(await pii.actor.get_private_profile_names_batch([subject.toText()], scope));
    const transport = TransportSecretKey.random();
    const keys = ok(await pii.actor.get_private_profile_name_vetkeys_batch([subject.toText()], scope, transport.publicKeyBytes()));
    const key = EncryptedVetKey.deserialize(Uint8Array.from(keys[0][0])).decryptAndVerify(transport, publicKey, input);
    assert.equal(new TextDecoder().decode(IbeCiphertext.deserialize(Uint8Array.from(rows[0].ciphertext)).decrypt(key)), 'Private test name');
  };
  await decrypt();
  pii.actor.setPrincipal(outsider);
  const first = { operation_id: 'outsider', generation: 1n, inventory_digest: Array(32).fill(7) };
  assert.ok('Err' in await pii.actor.prepare_private_name_release_fence(first));
  pii.actor.setPrincipal(viewer);
  for (const method of ['get_private_profile_names_batch', 'get_private_profile_name_vetkeys_batch']) {
   for (const reply of [1n, 2n]) {
    identity.actor.setPrincipal(owner); await identity.actor.hold_on(reply);
    const transport = TransportSecretKey.random();
    const args = method.includes('vetkeys') ? [[subject.toText()], scope, transport.publicKeyBytes()] : [[subject.toText()], scope];
    const signature = idlFactory({ IDL })._fields.find(([name]) => name === method)?.[1]; assert.ok(signature);
    const pending = await pic.client.submitCall({ canisterId: pii.canisterId, sender: viewer, method, payload: new Uint8Array(IDL.encode(signature.argTypes, args)) });
    for (let n = 0; n < 200 && !await identity.actor.is_held(); n++) await pic.tick();
    assert.equal(await identity.actor.is_held(), true, 'Final identity reply is genuinely held');
    const request = { operation_id: `${method}-${reply}`, generation: 2n, inventory_digest: Array(32).fill(8) };
    const fenced = ok(await identity.actor.fence(request, false)); assert.equal(fenced.completed, false);
    const completed = ok(await identity.actor.fence(request, true)); assert.equal(completed.completed, true);
    assert.ok(completed.release_epoch > fenced.release_epoch);
    await identity.actor.release();
    const result = IDL.decode(signature.retTypes, (await pic.client.awaitCall(pending)).body)[0];
    assert.ok('Err' in result, 'Prepare/reopen ABA rejects an old final reply for both ciphertext and keys');
    assert.ok('Err' in await identity.actor.fence(request, false), 'Delayed prepare cannot revive completed operation');
   }
  }
  await decrypt();
  const uncertain = { operation_id: 'lost-ack', generation: 5n, inventory_digest: Array(32).fill(11) };
  assert.ok('Err' in await identity.actor.fence_lost_reply(uncertain, false));
  const observed = ok(await identity.actor.receipt(uncertain)); assert.equal(observed.completed, false);
  assert.ok('Err' in await pii.actor.get_private_profile_names_batch([subject.toText()], scope), 'Unknown prepare retains the committed fence');
  const retried = ok(await identity.actor.fence(uncertain, false)); assert.equal(retried.release_epoch, observed.release_epoch);
  assert.ok('Err' in await identity.actor.fence_lost_reply(uncertain, true));
  const closed = ok(await identity.actor.receipt(uncertain)); assert.equal(closed.completed, true);
  assert.equal(ok(await identity.actor.fence(uncertain, true)).release_epoch, closed.release_epoch);
  assert.ok('Err' in await identity.actor.fence(uncertain, false));
  assert.ok('Err' in await identity.actor.receipt({ ...uncertain, generation: 6n }));
  await decrypt();
  const a = { operation_id: 'upgrade-active', generation: 3n, inventory_digest: Array(32).fill(9) };
  const b = { operation_id: 'concurrent', generation: 4n, inventory_digest: Array(32).fill(10) };
  ok(await identity.actor.fence(a, false)); ok(await identity.actor.fence(b, false));
  await pic.upgradeCanister({ canisterId: pii.canisterId, wasm: process.env.PRIVATE_NAME_FENCE_PII_WASM, sender: owner, arg, upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  assert.ok('Err' in await pii.actor.get_private_profile_names_batch([subject.toText()], scope));
  ok(await identity.actor.fence(a, true));
  assert.ok('Err' in await pii.actor.get_private_profile_names_batch([subject.toText()], scope), 'Completing one operation retains the other fence');
  ok(await identity.actor.fence(b, true)); await decrypt();
  console.log('PASS: real SDK PII sink fences reject final held ciphertext/key replies and ABA; concurrent fences and upgrade persistence verified. No cross-service writer coverage claimed.');
} finally { await pic?.tearDown(); await server.stop(); }