import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as leagueIdl } from '../src/lab/bindings/mini_league_domain/declarations/mini_league_domain.did.js';
const owner=Principal.fromUint8Array(Uint8Array.from([1,1])),coach=Principal.fromUint8Array(Uint8Array.from([2,1])),member=Principal.fromUint8Array(Uint8Array.from([3,1])),other=Principal.fromUint8Array(Uint8Array.from([4,1]));
const ok=r=>{if('Err'in r)throw Error(r.Err);return r.Ok;};
const server=await PocketIcServer.start();let pic;
try {
 pic=await PocketIc.create(server.getUrl());const fixtures=[];
 for(const g of ['a','b']){
  const f=await pic.setupCanister({idlFactory,wasm:process.env.CLUB_DOMAIN_WASM,sender:owner,controllers:[owner],arg:IDL.encode([IDL.Principal],[owner])});
  const a=f.actor;a.setPrincipal(owner);ok(await a.replace_acl(0n,{clubs:[`club-${g}`],teams:[{id:`team-${g}`,club:`club-${g}`}],children:[],guardians:[],exclusions:[],roles:[{user:coach,role:'coach',club:[`club-${g}`],team:[`team-${g}`]}]}));fixtures.push(f);
 }
 for(const [index,f]of fixtures.entries()){
  const a=f.actor,g=index===0?'a':'b',club=`club-${g}`,team=`team-${g}`;
  a.setPrincipal(coach);assert.ok('Err'in await a.create_team_invite_link(club,team,'club_admin'));assert.ok('Err'in await a.create_team_invite_link(club,team,'team_admin'));assert.ok('Err'in await a.create_team_invite_link(club,'foreign','player'));
  a.setPrincipal(owner);const link=ok(await a.create_team_invite_link(club,team,'player'));assert.match(link.token,/^tok-[a-f0-9]{32}$/);
  const pending=ok(await a.create_pending_invite('team',club,[team],[],'private@example.test',['parent'])).invite;
  assert.equal(pending.email,'pii:email');const code=ok(await a.create_invite_short_code(pending.id));assert.match(code,/^[A-F0-9]{32}$/);
  assert.equal(ok(await a.create_invite_short_code(pending.id)),code);
  const legacy=ok(await a.create_team_invite(club,team,'opaque-email-ref','player'));assert.match(legacy.id,/^tinv-[a-f0-9]{32}$/);
  a.setPrincipal(Principal.anonymous());assert.equal(ok(await a.get_pending_invite(pending.id)).email,'');assert.equal(ok(await a.get_team_invite_link_by_token(link.token)).team_id,team);
  a.setPrincipal(member);ok(await a.accept_team_invite_link(link.token));ok(await a.accept_team_invite_link(link.token));ok(await a.accept_pending_invite(pending.id));ok(await a.accept_pending_invite(pending.id));ok(await a.accept_team_invite(legacy.id));ok(await a.accept_team_invite(legacy.id));
  a.setPrincipal(other);assert.ok('Err'in await a.accept_pending_invite(pending.id));
  a.setPrincipal(owner);assert.ok('Err'in await a.resend_pending_invite(pending.id));ok(await a.revoke_team_invite_link(link.id));assert.ok('Err'in await a.rotate_team_invite_link(link.id));
  a.setPrincipal(member);assert.ok('Err'in await a.accept_team_invite_link(link.token));
  a.setPrincipal(owner);const retry=ok(await a.create_pending_invite('team',club,[team],[],'opaque',['player'])).invite;ok(await a.resend_pending_invite(retry.id));a.setPrincipal(other);ok(await a.accept_pending_invite(retry.id));
  a.setPrincipal(owner);
  const childIds=[`child-${g}-one`,`child-${g}-two`];
  const request=`family-request-${g}-001`;
  const children=childIds.map(id=>({id,existing:false}));
  assert.ok('Err' in await a.create_family_invite(request,club,team,[children[0],{id:'missing-child',existing:true}],true,[other]));
  const family=ok(await a.create_family_invite(request,club,team,children,true,[other]));
  assert.deepEqual(family.child_ids,childIds);
  assert.equal(ok(await a.create_family_invite(request,club,team,children,true,[other])).invite.id,family.invite.id);
  const second=family.secondary[0];assert.ok(second);
  a.setPrincipal(other);assert.ok('Err' in await a.accept_pending_invite(second.id));
  a.setPrincipal(member);ok(await a.accept_pending_invite(family.invite.id));
  assert.deepEqual(ok(await a.read_family_invite_receipt(family.invite.id)).child_ids,childIds);
  const firstReceipt=ok(await a.read_family_invite_receipt(family.invite.id));
  ok(await a.accept_pending_invite(family.invite.id));
  assert.equal(ok(await a.read_family_invite_receipt(family.invite.id)).accepted_at_ms,firstReceipt.accepted_at_ms);
  a.setPrincipal(coach);assert.ok('Err' in await a.accept_pending_invite(second.id));
  a.setPrincipal(other);ok(await a.accept_pending_invite(second.id));
  assert.deepEqual(ok(await a.read_family_invite_receipt(second.id)).child_ids,childIds);
  a.setPrincipal(owner);assert.ok('Err' in await a.move_pending_invite_team(family.invite.id,[]));
  assert.ok('Err' in await a.update_pending_invite_role(family.invite.id,['player']));
  const mixed=ok(await a.create_family_invite(`family-mixed-${g}-request`,club,team,[{id:childIds[0],existing:true},{id:`child-${g}-three`,existing:false}],false,[]));
  a.setPrincipal(coach);ok(await a.accept_pending_invite(mixed.invite.id));
  assert.deepEqual(ok(await a.read_family_invite_receipt(mixed.invite.id)).child_ids,[childIds[0],`child-${g}-three`]);
  a.setPrincipal(owner);ok(await a.unlink_guardian(childIds[1],other));
  a.setPrincipal(other);assert.ok('Err' in await a.accept_pending_invite(second.id));
  await pic.upgradeCanister({canisterId:f.canisterId,wasm:process.env.CLUB_DOMAIN_WASM,sender:owner,arg:IDL.encode([IDL.Principal],[owner]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
  a.setPrincipal(member);ok(await a.accept_pending_invite(pending.id));
  assert.deepEqual(ok(await a.read_family_invite_receipt(family.invite.id)).child_ids,childIds);
 }
 // Wrong authority never accepts a token owned by another group.
 fixtures[0].actor.setPrincipal(owner);const token=ok(await fixtures[0].actor.create_pending_invite('team','club-a',['team-a'],[],'opaque',['player'])).invite.id;
 fixtures[1].actor.setPrincipal(member);assert.ok('Err'in await fixtures[1].actor.accept_pending_invite(token));
 // Mini-league named claim and reusable revocation, on both isolated authorities.
 for(const f of fixtures){
  const lf=await pic.setupCanister({idlFactory:leagueIdl,wasm:process.env.MINI_LEAGUE_DOMAIN_WASM,sender:owner,controllers:[owner],arg:IDL.encode([IDL.Principal],[owner])});
  const l=lf.actor;l.setPrincipal(owner);ok(await l.set_club_domain_canister(f.canisterId));const league=ok(await l.create_mini_league('league-club','Invite league',[],[],6,3,10,[],true));
  const player=ok(await l.add_player(league.id,'Private child',[],[],[],[]));const invite=ok(await l.create_invite(league.id,[player.id],['Private parent']));
  l.setPrincipal(Principal.anonymous());assert.deepEqual(ok(await l.get_player_invite_preview(invite.token))[0].player_name,[]);
  l.setPrincipal(member);ok(await l.claim_invite(invite.token,'Player'));ok(await l.claim_invite(invite.token,'Player'));
  l.setPrincipal(other);assert.ok('Err'in await l.claim_invite(invite.token,'Player'));
  l.setPrincipal(owner);const link=ok(await l.create_mini_league_join_link(league.id,'admin'));ok(await l.revoke_mini_league_join_link(league.id,'admin'));l.setPrincipal(other);assert.ok('Err'in await l.claim_admin_join_link(link.token));
 }
 console.log('PASS: two club and two mini-league authorities; random credentials, role/scope denial, redacted previews, same-caller receipts, resend preservation, wrong-group denial, revocation, EOP retention. No mainnet changes.');
}finally{await pic?.tearDown();await server.stop();}
