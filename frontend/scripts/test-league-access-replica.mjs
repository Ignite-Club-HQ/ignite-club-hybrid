// Local-only query authorization rehearsal; no mainnet calls or fixture bundle.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as leagueIdl } from '../src/lab/bindings/mini_league_domain/declarations/mini_league_domain.did.js';
import { idlFactory as competitionIdl } from '../src/lab/bindings/competition_domain/declarations/competition_domain.did.js';

const leagueWasm = process.env.MINI_LEAGUE_DOMAIN_WASM;
const competitionWasm = process.env.COMPETITION_DOMAIN_WASM;
if (!leagueWasm || !competitionWasm) throw new Error('Provide freshly compiled local league and competition WASM paths');
const governor = Principal.fromUint8Array(Uint8Array.from([1, 1]));
const member = Principal.fromUint8Array(Uint8Array.from([2, 1]));
const stranger = Principal.fromUint8Array(Uint8Array.from([3, 1]));
const ok = result => { if ('Err' in result) throw new Error(result.Err); return result.Ok; };
const server = await PocketIcServer.start(); let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const argument = IDL.encode([IDL.Principal], [governor]);
  const league = (await pic.setupCanister({ idlFactory: leagueIdl, wasm: leagueWasm, sender: governor, controllers: [governor], arg: argument })).actor;
  const competition = (await pic.setupCanister({ idlFactory: competitionIdl, wasm: competitionWasm, sender: governor, controllers: [governor], arg: argument })).actor;
  league.setPrincipal(governor); competition.setPrincipal(governor);
  const a = ok(await league.create_mini_league('club-a', 'League A', [], [], 6, 3, 20, [], true));
  const b = ok(await league.create_mini_league('club-b', 'League B', [], [], 6, 3, 20, [], true));
  ok(await league.add_player(a.id, 'Player A', [], [member.toText()], [3], []));
  ok(await league.add_player(b.id, 'Player B', [], [stranger.toText()], [3], []));
  ok(await league.grant_role(member, 'parent', 'club-a', []));
  league.setPrincipal(member);
  assert.deepEqual(ok(await league.get_my_league_access([a.id, b.id])).map(r => [r.id, r.can_manage, r.can_delete]), [[a.id, false, false]]);
  const members = ok(await league.get_league_members(a.id));
  assert.equal(members.find(m => m.user_id === member.toText())?.is_parent, true);
  assert.equal(members.find(m => m.user_id === governor.toText())?.is_staff, true);
  assert.equal(members.some(m => m.user_id === stranger.toText()), false);
  assert.ok('Err' in await league.get_league_members(b.id));
  assert.equal((await league.get_my_league_access(Array(201).fill(a.id))).Err, 'Too many ids');
  league.setPrincipal(stranger);
  assert.deepEqual(ok(await league.get_my_league_access([a.id])), []);
  assert.ok('Err' in await league.get_league_members(a.id));
  league.setPrincipal(governor);
  assert.equal(ok(await league.get_my_league_access([a.id]))[0].can_manage, true);

  const privateCompetition = ok(await competition.create_competition('club-a', 'Private Cup', '2026'));
  assert.deepEqual(ok(await competition.read_competition_club(privateCompetition.id)), ['club-a']);
  competition.setPrincipal(stranger);
  assert.deepEqual(ok(await competition.read_competition_club(privateCompetition.id)), []);
  assert.deepEqual(ok(await competition.read_competition_club('missing')), []);
  competition.setPrincipal(governor);
  ok(await competition.update_competition_settings(privateCompetition.id, 'Public Cup', [], 'open', 'public', 3, 1, 0));
  competition.setPrincipal(stranger);
  assert.deepEqual(ok(await competition.read_competition_club(privateCompetition.id)), ['club-a']);
  assert.ok('Err' in await competition.update_competition_settings(privateCompetition.id, 'Forbidden', [], 'open', 'public', 3, 1, 0));
  console.log('Local league access and competition location rehearsal passed: scoped members, creator staff, hidden denial, 200-id limit, public location and denied stranger mutation.');
} finally { await pic?.tearDown(); await server.stop(); }