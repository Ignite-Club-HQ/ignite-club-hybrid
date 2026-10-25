// Disposable local canisters only: never contacts mainnet or uses deploy keys.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/competition_domain/declarations/competition_domain.did.js';
const wasm = process.env.COMPETITION_DOMAIN_WASM;
if (!wasm) throw new Error('Supply the locally compiled COMPETITION_DOMAIN_WASM');
const governor = Principal.fromUint8Array(Uint8Array.from([1, 1]));
const outsider = Principal.fromUint8Array(Uint8Array.from([2, 1]));
const ok = value => { assert.ok('Ok' in value, String(value.Err)); return value.Ok; };
const server = await PocketIcServer.start();
let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const setup = () => pic.setupCanister({ idlFactory, wasm, sender: governor, controllers: [governor], arg: IDL.encode([IDL.Principal], [governor]) });
  const first = await setup(), second = await setup();
  for (const [service, club] of [[first, 'club-g1'], [second, 'club-g2']]) {
    const actor = service.actor; actor.setPrincipal(outsider);
    assert.ok('Err' in await actor.link_playhq_competition(club, 'Cup', '', 'bv', 'grade', ['basketball']));
    actor.setPrincipal(governor);
    const competition = ok(await actor.link_playhq_competition(club, 'Cup', '', 'bv', 'grade', ['basketball']));
    assert.equal(competition.visibility, 'public'); assert.equal(competition.status, 'active');
    assert.equal(ok(await actor.link_playhq_competition(club, 'Cup', '', 'bv', 'grade', ['basketball'])).id, competition.id);
    assert.ok('Err' in await actor.link_playhq_competition(club, 'Cup', '', 'bv', 'grade', ['soccer']));
    assert.ok('Err' in await actor.sync_playhq_grade(competition.id, 'wrong-tenant', 'grade'));
    const rows = ok(await actor.list_playhq_competitions(club));
    assert.equal(rows.length, 1); assert.deepEqual(rows[0].link.sport, ['basketball']); assert.deepEqual(rows[0].link.last_synced_at_ms, []);
    await pic.upgradeCanister({ canisterId: service.canisterId, wasm, sender: governor, upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] }, arg: IDL.encode([IDL.Principal], [governor]) });
    assert.equal(ok(await actor.list_playhq_competitions(club)).length, 1);
    ok(await actor.set_transfer_fence(club, true));
    const snapshot = ok(await actor.export_club_snapshot(club));
    ok(await actor.import_club_snapshot(club, snapshot));
    ok(await actor.set_transfer_fence(club, false));
    assert.equal(ok(await actor.list_playhq_competitions(club))[0].link.grade_id, 'grade');
    actor.setPrincipal(outsider); assert.equal(ok(await actor.list_playhq_competitions(club)).length, 1);
    actor.setPrincipal(governor); ok(await actor.set_transfer_fence(club, true)); ok(await actor.purge_club_snapshot(club)); ok(await actor.set_transfer_fence(club, false));
    assert.deepEqual(ok(await actor.list_playhq_competitions(club)), []);
  }
  console.log('Two-group PlayHQ authorization, immutable source, duplicate receipt, upgrade, snapshot and purge checks passed.');
} finally { if (pic) await pic.tearDown(); await server.stop(); }