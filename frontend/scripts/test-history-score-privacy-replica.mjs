// Local-only, real production actors. No mainnet calls or paid fuel.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as competitionIdl } from '../src/lab/bindings/competition_domain/declarations/competition_domain.did.js';
import { idlFactory as eventsIdl } from '../src/lab/bindings/events_domain/declarations/events_domain.did.js';
const scratch=mkdtempSync(join(tmpdir(),'history-privacy-'));
const governor=Principal.fromUint8Array(new Uint8Array([1,1]));
const manager=Principal.fromUint8Array(new Uint8Array([2,1]));
const member=Principal.fromUint8Array(new Uint8Array([3,1]));
const outsider=Principal.fromUint8Array(new Uint8Array([4,1]));
const ok=r=>{ assert.ok('Ok' in r,String(r.Err)); return r.Ok; };
const compile=domain=>{
 const cwd=resolve(import.meta.dirname,`../../backend/${domain}`);
 const sources=execFileSync('npx',['-y','ic-mops@3.5.1','sources'],{cwd,encoding:'utf8'}).trim().split(/\s+/);
 const wasm=join(scratch,`${domain}.wasm`);
 execFileSync(join(homedir(),'.cache/mops/moc/1.16.1/moc'),[...sources,'--enhanced-migration','src/backend/migrations','-o',wasm,'src/main.mo'],{cwd,stdio:'inherit'});
 return wasm;
};
const eventsWasm=compile('events_domain'),competitionWasm=compile('competition_domain');
const server=await PocketIcServer.start({binPath:join(homedir(),'.cache/mops/pocket-ic/15.0.0/pocket-ic')});
let pic;
try {
 pic=await PocketIc.create(server.getUrl());
 const events=await pic.setupCanister({idlFactory:eventsIdl,wasm:eventsWasm,sender:governor,controllers:[governor],arg:IDL.encode([IDL.Principal],[governor])});
 const competition=await pic.setupCanister({idlFactory:competitionIdl,wasm:competitionWasm,sender:governor,controllers:[governor],arg:IDL.encode([IDL.Principal],[governor])});
 const e=events.actor,c=competition.actor;
 c.setPrincipal(governor); e.setPrincipal(governor);
 ok(await c.set_events_domain_canister(events.canisterId));
 ok(await e.set_competition_domain_canister(competition.canisterId));
 const cup=ok(await c.create_competition('club','Cup','2026'));
 ok(await c.grant_role(manager,'competition_admin',cup.id,[]));
 // Trusted source creates the association already used by production fan-out.
 e.setPrincipal(competition.canisterId);
 const [eventId]=ok(await e.create_competition_events('history-op',cup.id,manager,'club',[
  {team_id:'team-1',club_id:'club'}],'Cup game','','game',[],1n,60001n));
 e.setPrincipal(governor);
 ok(await e.grant_role(manager,'coach','club',['team-1']));
 ok(await e.grant_role(member,'player','club',['team-1']));
 e.setPrincipal(manager);
 const periods='[{"quarter":1,"home":23,"away":17}]';
 const players='[{"id":"player-1","name":"MVP","points":23,"secondsPlayed":120}]';
 ok(await e.save_game_result('team-1',[eventId],'basketball','Home','Away',23,17,periods,players,['player-1'],['MVP']));
 c.setPrincipal(manager); ok(await c.set_score_privacy(cup.id,[],[true]));
 e.setPrincipal(member);
 const masked=ok(await e.get_game_result(eventId))[0];
 assert.deepEqual(masked.home_score,[]); assert.deepEqual(masked.away_score,[]);
 assert.equal(masked.scores_hidden,true); assert.equal(masked.period_scores_json,'[]');
 assert.deepEqual(JSON.parse(masked.player_stats_json),[{id:'player-1',name:'MVP',secondsPlayed:120}]);
 assert.deepEqual(masked.mvp_player_id,['player-1']);
 assert.deepEqual(ok(await e.read_account_get_game_result(eventId))[0].home_score,[]);
 e.setPrincipal(manager);
 const full=ok(await e.get_game_result(eventId))[0];
 assert.deepEqual(full.home_score,[23]); assert.equal(full.player_stats_json,players); assert.equal(full.period_scores_json,periods);
 e.setPrincipal(outsider); assert.ok('Err' in await e.get_game_result(eventId));
 // Durable exact-match links survive rescheduling and snapshot transfer.
 e.setPrincipal(competition.canisterId);
 const exact=ok(await e.upsert_competition_match_events({competition_id:cup.id,match_id:'exact-match',creator:manager,teams:[{team_id:'team-1',club_id:'club'},{team_id:'team-2',club_id:'club'}],starts_at_ms:10n,ends_at_ms:60010n,title:'Exact game',venue:[]}));
 const repeated=ok(await e.upsert_competition_match_events({competition_id:cup.id,match_id:'exact-match',creator:manager,teams:[{team_id:'team-1',club_id:'club'},{team_id:'team-2',club_id:'club'}],starts_at_ms:20n,ends_at_ms:60020n,title:'Exact game',venue:[]}));
 assert.deepEqual(repeated,exact);
 e.setPrincipal(outsider);assert.ok('Err' in await e.upsert_competition_match_events({competition_id:cup.id,match_id:'forged',creator:manager,teams:[{team_id:'team-1',club_id:'club'},{team_id:'team-2',club_id:'club'}],starts_at_ms:10n,ends_at_ms:20n,title:'Forged',venue:[]}));
 e.setPrincipal(governor);ok(await e.set_transfer_fence('club',true));
 const saved=ok(await e.export_club_snapshot('club'));
 const restored=await pic.setupCanister({idlFactory:eventsIdl,wasm:eventsWasm,sender:governor,controllers:[governor],arg:IDL.encode([IDL.Principal],[governor])});
 restored.actor.setPrincipal(governor);ok(await restored.actor.set_transfer_fence('club',true));ok(await restored.actor.import_club_snapshot('club',saved));
 assert.deepEqual(ok(await restored.actor.export_club_snapshot('club')),saved);
 ok(await e.set_transfer_fence('club',false));
 c.setPrincipal(member); assert.ok('Err' in await c.read_history_score_access(cup.id,'team-1',1n,manager,false));
 c.setPrincipal(manager); ok(await c.set_score_privacy(cup.id,[],[false]));
 e.setPrincipal(member); assert.deepEqual(ok(await e.get_game_result(eventId))[0].home_score,[23]);
 // Refuse unrelated team IDs and loss of trusted authority.
 e.setPrincipal(manager); assert.ok('Err' in await e.save_game_result('other-team',[eventId],'basketball','Home','Away',1,2,'[]','[]',[],[]));
 e.setPrincipal(governor); ok(await e.set_competition_domain_canister(outsider));
 e.setPrincipal(member); assert.ok('Err' in await e.get_game_result(eventId));
 console.log('PASS: real History actors preserve detailed data, mask member scores, retain MVP, reject outsider/forged service/team and unavailable authority');
} finally { if(pic) await pic.tearDown(); await server.stop(); rmSync(scratch,{recursive:true,force:true}); }