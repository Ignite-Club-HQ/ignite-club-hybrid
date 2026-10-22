// Disposable populated pre-discovery upgrade; no mainnet flags or calls.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { execFileSync } from 'node:child_process';
import { idlFactory } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
const root=resolve(import.meta.dirname,'../..'); const p=n=>Principal.fromUint8Array(Uint8Array.from([n,1]));
const governor=p(1),parent=p(2),guardian=p(3),stranger=p(4);
const ok=r=>{assert.ok('Ok' in r,String(r.Err));return r.Ok;};
const subjects=[governor,parent,guardian,stranger];
function sourceLines(edges){return edges.map(edge=>{
 const [kind,value]=Object.entries(edge)[0];
 switch(kind){
  case 'Club':return [kind,value.id,String(value.deleted)].join('\t');
  case 'Role':return [kind,value.subject.toText(),value.club[0]??'*'].join('\t');
  case 'Parent':case 'Guardian':return [kind,value.child,value.subject.toText()].join('\t');
  case 'ChildTeam':return [kind,value.child,value.team].join('\t');
  case 'Team':return [kind,value.id,value.club,String(value.deleted)].join('\t');
  case 'Excluded':return [kind,value.subject.toText(),value.club].join('\t');
  default:throw new Error('Unrecognized source edge');
 }
}).join('\n')+'\n';}
const server=await PocketIcServer.start();let pic;
try {
 pic=await PocketIc.create(server.getUrl());
 const fixture=await pic.setupCanister({idlFactory,wasm:resolve(root,'backend/club_domain/main.wasm'),sender:governor,controllers:[governor],arg:IDL.encode([IDL.Principal],[governor])});
 const a=fixture.actor;a.setPrincipal(governor);
 for(const id of ['club-a','club-b'])ok(await a.create_club(id,id,id,[],[]));
 const child={id:'child',parent:[parent],club_id:['club-a'],teams:Array.from({length:251},(_,i)=>`team-${i}`)};
 const acl={clubs:['club-a','club-b'],teams:child.teams.map(id=>({id,club:'club-a'})),children:[child],guardians:[{child:'child',user:guardian}],exclusions:[],
  roles:[{user:governor,role:'club_admin',club:[],team:[]},{user:parent,role:'member',club:['club-b'],team:[]}]};
 ok(await a.replace_acl(10n,acl));
 const upgrade=()=>pic.upgradeCanister({canisterId:fixture.canisterId,wasm:resolve(root,'backend/club_domain/.mops/.build/club_domain.wasm'),sender:governor,arg:IDL.encode([IDL.Principal],[governor]),upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
 await upgrade();
 const parity=async()=>{
  a.setPrincipal(governor);let cursor=[],edges=[];
  do{const page=ok(await a.read_membership_source_page(cursor));assert.ok(page.scanned<=100n);edges.push(...page.edges);cursor=page.next;}while(cursor.length);
  const output=execFileSync(resolve(root,'target/debug/examples/check_membership_backfill'),subjects.map(p=>p.toText()),{input:sourceLines(edges),encoding:'utf8'});
  const rows=output.trim().split('\n').map(line=>line.split('\t'));
  const active=edges.filter(e=>'Club'in e&&!e.Club.deleted).map(e=>e.Club.id);
  for(const subject of subjects){const name=subject.toText();
   for(const club of active){const indexed=rows.some(r=>r[0]==='PAIR'&&r[1]===name&&r[2]===club);
    assert.equal(indexed,await a.is_club_member(subject,club),`source parity ${name}/${club}`);
   }
  }
  return rows;
 };
 await parity();
 const initial=ok(await a.read_membership_discovery_status());assert.equal(initial.revision,1n);assert.equal(initial.pending,true);
 let cursor=[],edges=[],first;
 for(let i=0;i<20;i++){
  const page=ok(await a.read_membership_source_page(cursor));assert.ok(page.scanned<=100n);assert.ok(page.edges.length<=100);
  if(!first)first=page;
  edges.push(...page.edges);cursor=page.next;if(!cursor.length)break;
 }
 assert.equal(cursor.length,0);assert.equal(edges.filter(e=>'ChildTeam'in e).length,251);
 assert.ok(edges.some(e=>'Parent'in e&&e.Parent.subject.toText()===parent.toText()));
 assert.ok(edges.some(e=>'Guardian'in e&&e.Guardian.subject.toText()===guardian.toText()));
 await upgrade();assert.deepEqual(ok(await a.read_membership_discovery_status()),initial);
 assert.ok('Ok'in await a.read_membership_source_page(first.next));
 a.setPrincipal(stranger);assert.ok('Err'in await a.read_membership_source_page([]));assert.ok('Err'in await a.read_membership_discovery_status());
 a.setPrincipal(governor);ok(await a.remove_member('club-a',guardian));
 const removed=ok(await a.read_membership_discovery_status());assert.ok(removed.revision>initial.revision);
 await parity();
 assert.ok('Err'in await a.read_membership_source_page(first.next));
 ok(await a.restore_member('club-a',guardian));const restored=ok(await a.read_membership_discovery_status());assert.ok(restored.revision>removed.revision);
 await parity();
 a.setPrincipal(guardian);const memberships=ok(await a.read_my_club_memberships(0n,100));assert.ok(memberships.clubs.includes('club-a'));
 a.setPrincipal(parent);
 for(const team of child.teams)ok(await a.set_own_child_team('child',team,false));
 a.setPrincipal(governor);assert.ok(ok(await a.read_membership_discovery_status()).revision>restored.revision);
 a.setPrincipal(guardian);assert.ok(!ok(await a.read_my_club_memberships(0n,100)).clubs.includes('club-a'));
 a.setPrincipal(parent);assert.ok(ok(await a.read_my_club_memberships(0n,100)).clubs.includes('club-b'));
 await parity();
 a.setPrincipal(governor);ok(await a.soft_delete_club('club-b',false));
 const deletedRows=await parity();assert.ok(!deletedRows.some(r=>r[0]==='PAIR'&&r[2]==='club-b'));
 a.setPrincipal(governor);ok(await a.restore_club('club-b',false));await parity();
 console.log('PASS: populated legacy upgrade and Rust reconstruction parity against real membership checks; 251 bounded family edges, app-wide roles, durable cursors, removal/restore, last-family-link loss, club deletion/restore. No directory cutover.');
}finally{if(pic)await pic.tearDown();await server.stop();}