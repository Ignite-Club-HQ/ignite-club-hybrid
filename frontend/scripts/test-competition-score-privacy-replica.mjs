// Local-only actor authorization and operator transfer rehearsal.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { resolve, join } from 'node:path';
// Compile the production entry point separately: importing the actor from a
// Motoko test bypasses enhanced migration initialization and is not equivalent.
const scratch = mkdtempSync(join(tmpdir(), 'competition-privacy-'));
const wasm = process.env.COMPETITION_DOMAIN_WASM ?? join(scratch, 'competition.wasm');
if (!process.env.COMPETITION_DOMAIN_WASM) {
  const cwd = resolve(import.meta.dirname, '../../backend/competition_domain');
  const sources = execFileSync('npx', ['-y', 'ic-mops@3.5.1', 'sources'], {cwd, encoding:'utf8'}).trim().split(/\s+/);
  execFileSync(join(homedir(), '.cache/mops/moc/1.16.1/moc'), [...sources,
    '--enhanced-migration', 'src/backend/migrations', '-o', wasm, 'src/main.mo'], {cwd, stdio:'inherit'});
}

import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/competition_domain/declarations/competition_domain.did.js';
const governor = Principal.fromUint8Array(Uint8Array.from([1,1]));
const manager = Principal.fromUint8Array(Uint8Array.from([2,1]));
const member = Principal.fromUint8Array(Uint8Array.from([3,1]));
const ok = r => { assert.ok('Ok' in r, String(r.Err ?? 'Expected Ok')); return r.Ok; };
const service = idlFactory({ IDL });
const state = service._fields.find(([k]) => k === 'export_state')[1].retTypes[0]._fields.find(([k]) => k === 'Ok')[1];
const field = k => state._fields.find(([n]) => n === k)[1];
const fields = { competitions: field('competitions'), roles: field('roles'), entries: field('entries'), matches: field('matches') };
for (const k of ['tokens','seasons','chat_settings','welcome','invites','join_links','official_invites','welcome_jobs','eoi','divisions','ladders','broadcasts','owners','role_links','official_chats']) fields[k] = IDL.Vec(IDL.Empty);
const privacyType = IDL.Vec(IDL.Record({competition_id: IDL.Text, division: IDL.Opt(IDL.Text), hide_scores: IDL.Bool}));
const oldType = IDL.Record(fields), newType = IDL.Record({...fields, score_privacy: IDL.Opt(privacyType)});
const snapshot = Object.fromEntries(Object.keys(fields).map(k => [k, []]));
snapshot.competitions = [{id:'cup',club_id:'club',name:'Cup',season:'2026',status:'open',visibility:'public',description:[],points_win:5,points_draw:2,points_loss:1,revision:1n}];
snapshot.roles = [{user:manager,role:'competition_admin',competition_id:'cup',team_id:[]},{user:member,role:'member',competition_id:'cup',team_id:[]}];
snapshot.matches = [{id:'match',competition_id:'cup',home_team:'h',away_team:'a',home_score:4,away_score:2,status:'completed',revision:1n,...Object.fromEntries(['division_id','scheduled_at_ms','venue','pitch_number','round_number','duration_minutes','arrival_minutes_before','notes'].map(k => [k,[]]))}];
snapshot.matches = [[], ['inherit'], ['hide'], ['show']].map((division_id, i) => ({...snapshot.matches[0], id: `match-${i}`, division_id}));
const privacy = [{competition_id:'cup',division:[],hide_scores:true}];
const server = await PocketIcServer.start({binPath:join(homedir(), '.cache/mops/pocket-ic/15.0.0/pocket-ic')});
let pic;
try {
 pic = await PocketIc.create(server.getUrl());
 const { actor:c } = await pic.setupCanister({idlFactory,wasm:wasm,sender:governor,controllers:[governor],arg:IDL.encode([IDL.Principal],[governor])});
 c.setPrincipal(governor); ok(await c.set_transfer_fence('club',true));
 ok(await c.import_club_snapshot('club',IDL.encode([newType],[{...snapshot,score_privacy:[privacy]}])));
 ok(await c.set_transfer_fence('club',false));
 const assertScores = (rows, expected) => {
   assert.equal(rows.length, 4);
   rows.forEach((row, i) => {
     assert.deepEqual(row.home_score, expected[i] ? [] : [4], row.id);
     assert.deepEqual(row.away_score, expected[i] ? [] : [2], row.id);
   });
 };
 for (const hideDefault of [false, true]) {
   c.setPrincipal(manager);
   ok(await c.set_score_privacy('cup', [], [hideDefault]));
   ok(await c.set_score_privacy('cup', ['inherit'], []));
   ok(await c.set_score_privacy('cup', ['hide'], [true]));
   ok(await c.set_score_privacy('cup', ['show'], [false]));
   assertScores(ok(await c.list_matches('cup')), [false,false,false,false]);
   c.setPrincipal(member);
   assertScores(ok(await c.list_matches('cup')), [hideDefault,hideDefault,true,false]);
   assert.ok('Err' in await c.set_score_privacy('cup', [], [false]));
   c.setPrincipal(Principal.anonymous());
   assertScores(ok(await c.get_public_competition_page('cup')).matches, [hideDefault,hideDefault,true,false]);
 }
 c.setPrincipal(governor); ok(await c.set_transfer_fence('club',true));
 const exported = ok(await c.export_club_snapshot('club'));
 const savedPrivacy = await c.get_score_privacy('cup');
 const { actor: destination } = await pic.setupCanister({idlFactory, wasm:wasm,sender:governor,controllers:[governor],arg:IDL.encode([IDL.Principal],[governor])});
 destination.setPrincipal(governor);
 ok(await destination.set_transfer_fence('club',true));
 ok(await destination.import_club_snapshot('club',exported));
 assert.deepEqual(await destination.get_score_privacy('cup'),savedPrivacy);
 assert.deepEqual(ok(await destination.export_club_snapshot('club')), exported);
 ok(await destination.set_transfer_fence('club',false));
 destination.setPrincipal(member);
 assertScores(ok(await destination.list_matches('cup')), [true,true,true,false]);
 destination.setPrincipal(manager);
 assertScores(ok(await destination.list_matches('cup')), [false,false,false,false]);
 destination.setPrincipal(Principal.anonymous());
 assertScores(ok(await destination.get_public_competition_page('cup')).matches, [true,true,true,false]);
 ok(await c.purge_club_snapshot('club'));
 assert.deepEqual(await c.get_score_privacy('cup'),[]);
 const cleared = IDL.decode([newType],ok(await c.export_club_snapshot('club')))[0];
 for (const [key, rows] of Object.entries(cleared)) assert.deepEqual(rows, key === 'score_privacy' ? [[]] : [], key);
 c.setPrincipal(governor); ok(await c.set_transfer_fence('club',true));
 ok(await c.import_club_snapshot('club',IDL.encode([oldType],[snapshot]))); assert.deepEqual(await c.get_score_privacy('cup'),[]);
 // Actual PlayHQ snapshot data must inherit match privacy and isolate claims.
 const metaType=IDL.Record({match_id:IDL.Text,competition_id:IDL.Text,tenant:IDL.Text,grade_id:IDL.Text,game_id:IDL.Text,home_id:IDL.Text,away_id:IDL.Text,home_name:IDL.Text,away_name:IDL.Text,synced_revision:IDL.Nat64});
 const statType=IDL.Record({competition_id:IDL.Text,match_id:IDL.Text,tenant:IDL.Text,game_id:IDL.Text,team_id:IDL.Text,player_id:IDL.Text,player_name:IDL.Text,stats_json:IDL.Text});
 const phqType=IDL.Record({...fields,score_privacy:IDL.Opt(privacyType),playhq_metadata:IDL.Opt(IDL.Vec(metaType)),playhq_stats:IDL.Opt(IDL.Vec(statType))});
 const phq={...snapshot,score_privacy:[privacy],playhq_metadata:[[{match_id:'match-0',competition_id:'cup',tenant:'tenant-a',grade_id:'grade',game_id:'game',home_id:'h',away_id:'a',home_name:'Home',away_name:'Away',synced_revision:1n}]],playhq_stats:[[{competition_id:'cup',match_id:'match-0',tenant:'tenant-a',game_id:'game',team_id:'h',player_id:'player',player_name:'Player',stats_json:'{"goals":4}'}]]};
 ok(await c.import_club_snapshot('club',IDL.encode([phqType],[phq])));
 ok(await c.set_transfer_fence('club',false));
 c.setPrincipal(manager);assert.equal(ok(await c.read_playhq_stats('cup')).stats.length,1);
 ok(await c.claim_playhq_player('cup','tenant-a','player'));
 c.setPrincipal(member);assert.equal(ok(await c.read_playhq_stats('cup')).stats.length,0);
 ok(await c.claim_playhq_player('cup','tenant-a','player')); // another self-identification cannot be blocked
 c.setPrincipal(Principal.fromUint8Array(Uint8Array.from([9,1])));
 assert.ok('Err' in await c.claim_playhq_player('cup','tenant-a','player'));
 c.setPrincipal(manager);ok(await c.set_score_privacy('cup',[],[false]));
 c.setPrincipal(member);assert.equal(ok(await c.read_playhq_stats('cup')).stats.length,1);
 assert.deepEqual(ok(await c.read_playhq_stats('cup')).claims,[{player_id:'player',tenant:'tenant-a',mine:true}]);
 c.setPrincipal(governor);ok(await c.set_events_domain_canister(governor));
 ok(await c.write_history_match_result('match-0','h',manager,23,17));
 const canonical=ok(await c.read_history_match_result('match-0','h',member));
 assert.deepEqual(canonical.home,[23]);assert.deepEqual(canonical.away,[17]);
 c.setPrincipal(manager);ok(await c.set_score_privacy('cup',[],[true]));
 c.setPrincipal(governor);assert.equal(ok(await c.read_history_match_result('match-0','h',member)).hidden,true);
 assert.ok('Err' in await c.write_history_match_result('match-0','h',member,99,99));
 c.setPrincipal(member);assert.ok('Err' in await c.read_history_match_result('match-0','h',manager));
 console.log('PASS: manager/member/anonymous default/inherit/hide/show; two-canister export/import/source purge and older snapshot compatibility');
} finally { if(pic) await pic.tearDown(); await server.stop(); rmSync(scratch, {recursive:true, force:true}); }
