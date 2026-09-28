// Run only against the lab's fixed loopback Vite proxy; never accepts a remote URL.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createLocalActor } from '../src/lab/localActor.ts';
import { createIcpClubLinksService } from '../src/lab/icpClubLinksService.ts';
import { CLUB_A, CLUB_B, syntheticAcl } from '../src/lab/syntheticIdentities.mjs';

const local = new URL('../../.local-icp/', import.meta.url);
const config = JSON.parse(fs.readFileSync(new URL('public.json',local),'utf8'));
const actor = name => createLocalActor(config,name,'http://127.0.0.1:5180');
const ok = r => { assert(!('Err' in r), JSON.stringify(r,(_,v)=>typeof v==='bigint'?v.toString():v)); return r.Ok; };
const denied = r => assert('Err' in r, 'Expected rejection');
const draft = (title, active = true) => ({ title, subtitle: [], url:'https://example.invalid/lab', icon:'link', open_mode:'browser', is_active:active });
const admin = await actor('club_admin'), governor = await actor('governor');
const phase = process.argv[2] ?? 'exercise';
const json = v => JSON.stringify(v,(_,x)=>typeof x==='bigint'?{ $bigint:x.toString() }:x,2);
const read = file => JSON.parse(fs.readFileSync(new URL(file,local),'utf8'),(_,x)=>x?.$bigint ? BigInt(x.$bigint) : x);
const write = (file,v) => fs.writeFileSync(new URL(file,local),json(v)+'\n');
const request = async (operation, club = CLUB_A) => ({ club, request_id:randomUUID(), expected_revision:ok(await admin.list_links(club,true)).revision, operation });

if (phase === 'exercise') {
  const initialAcl = ok(await governor.export_acl());
  ok(await governor.replace_acl(initialAcl.acl_version, syntheticAcl()));
  const firstRequest = await request({ Save: { id:[], draft:draft(`POC ${randomUUID()}`) } });
  const first = ok(await admin.mutate(firstRequest));
  assert.deepEqual(ok(await admin.mutate(firstRequest)),first,'Retry must return original result');
  denied(await admin.mutate({ ...firstRequest, operation:{ Save:{ id:[],draft:draft('Different payload') } } }));
  const firstId = first.link[0].id;
  const hidden = ok(await admin.mutate(await request({ Save:{ id:[],draft:draft('Private synthetic link',false) } }))).link[0];

  for (const name of ['member','team_member','parent','guardian']) {
    const a = await actor(name);
    const rows = ok(await a.list_links(CLUB_A,false)).links;
    assert(rows.some(l=>l.id===firstId),`${name} active access`);
    assert(!rows.some(l=>l.id===hidden.id),`${name} inactive denied`);
    ok(await a.get_link(firstId)); denied(await a.get_link(hidden.id));
    denied(await a.list_links(CLUB_A,true));
    for (const operation of [ {Save:{id:[],draft:draft('forbidden')}}, {SetActive:{id:firstId,active:false}}, {Remove:{id:firstId}}, {Reorder:{first:firstId,second:hidden.id}} ]) denied(await a.mutate(await request(operation)));
  }
  for (const name of ['outsider','anonymous','excluded_member','other_admin']) {
    const a = await actor(name); denied(await a.list_links(CLUB_A,false)); denied(await a.list_links(CLUB_A,true));
    denied(await a.get_link(firstId)); denied(await a.get_link(hidden.id));
    denied(await a.mutate(await request({Remove:{id:firstId}})));
    denied(await a.export_links()); denied(await a.export_acl());
  }
  for (const name of ['club_admin','app_admin','excluded_admin']) {
    const a = await actor(name);
    assert(ok(await a.list_links(CLUB_A,true)).links.some(l=>l.id===hidden.id));
    ok(await a.get_link(hidden.id));
    ok(await a.mutate(await request({SetActive:{id:hidden.id,active:false}})));
  }
  const other = await actor('other_admin');
  const otherRevision = ok(await other.list_links(CLUB_B,true)).revision;
  const otherLink = ok(await other.mutate({club:CLUB_B,request_id:randomUUID(),expected_revision:otherRevision,operation:{Save:{id:[],draft:draft('Other synthetic club')}}})).link[0];
  denied(await admin.get_link(otherLink.id));
  denied(await admin.mutate(await request({Save:{id:[otherLink.id],draft:draft('Scope move')}})));
  denied(await admin.mutate(await request({Reorder:{first:firstId,second:otherLink.id}})));

  const before = ok(await admin.list_links(CLUB_A,true));
  const aOrder = before.links.find(l=>l.id===firstId).sort_order, bOrder = before.links.find(l=>l.id===hidden.id).sort_order;
  ok(await admin.mutate(await request({Reorder:{first:firstId,second:hidden.id}})));
  const reordered = ok(await admin.list_links(CLUB_A,true));
  assert.equal(reordered.links.find(l=>l.id===firstId).sort_order,bOrder);
  assert.equal(reordered.links.find(l=>l.id===hidden.id).sort_order,aOrder);
  const concurrent = await request({SetActive:{id:firstId,active:false}});
  const competing = await Promise.all([admin.mutate(concurrent),admin.mutate({...concurrent,request_id:randomUUID(),operation:{SetActive:{id:firstId,active:true}}})]);
  assert.equal(competing.filter(r=>'Ok' in r).length,1,'Exactly one stale-version competitor may commit');
  assert.equal(competing.filter(r=>'Err' in r).length,1);

  for (const invalid of [draft(''), {...draft('bad'),url:'javascript:alert(1)'}, {...draft('long'),title:'x'.repeat(161)}]) denied(await admin.mutate(await request({Save:{id:[],draft:invalid}})));
  denied(await admin.replace_acl(0n,syntheticAcl()));
  const aclState = ok(await governor.export_acl());
  ok(await admin.mutate(await request({SetActive:{id:firstId,active:true}})));
  ok(await (await actor('guardian')).get_link(firstId));
  const revoked = syntheticAcl(); revoked.roles = revoked.roles.filter(r=>r.role!=='club_admin'); revoked.guardians=[];
  ok(await governor.replace_acl(aclState.acl_version,revoked));
  denied(await admin.mutate(firstRequest)); // receipt replay cannot bypass revocation
  denied(await (await actor('guardian')).get_link(firstId));
  ok(await governor.replace_acl(aclState.acl_version+1n,syntheticAcl()));

  // Test the actual frontend adapter, including an ambiguous accepted-write response.
  const service = createIcpClubLinksService(admin);
  await service.listAdmin(CLUB_A);
  const record = await service.save(CLUB_A,{title:'Adapter synthetic',subtitle:null,url:'https://example.invalid',icon:'link',open_mode:'browser',is_active:true});
  await service.setActive(record.id,false);
  const staleDraft = { id: record.id, expectedRevision: record.revision, title:'Stale edit', subtitle:null, url:'https://example.invalid', icon:'link', open_mode:'browser', is_active:true };
  await service.listAdmin(CLUB_A); // A background refresh must not upgrade an open draft's revision.
  await assert.rejects(()=>service.save(CLUB_A,staleDraft),/conflict/i);
  assert.equal((await service.get(record.id)).is_active,false);
  await service.remove(record.id);
  service.dispose(); await assert.rejects(()=>service.listAdmin(CLUB_A),/Identity changed/);
  let dropResponse = true;
  const lossy = createIcpClubLinksService({
    list_links: (...a)=>admin.list_links(...a), get_link:(...a)=>admin.get_link(...a),
    mutate: async r => { const result = await admin.mutate(r); if (dropResponse) { dropResponse=false; throw new Error('Simulated lost response'); } return result; },
  });
  const retryDraft={title:'Retry synthetic',subtitle:null,url:'https://example.invalid',icon:'link',open_mode:'browser',is_active:true};
  await assert.rejects(()=>lossy.save(CLUB_A,retryDraft),/lost response/);
  const retryLink = await lossy.save(CLUB_A,retryDraft);
  assert.equal(ok(await admin.list_links(CLUB_A,true)).links.filter(l=>l.id===retryLink.id).length,1);
  const snapshot = ok(await governor.export_links());
  write('before-upgrade.json',snapshot); write('retry-request.json',firstRequest); write('retry-result.json',first);
  console.log('PASS: signed RLS matrix, scope isolation, validation, atomic reorder, concurrent writes, revocation and adapter retry/disposal.');
} else if (phase === 'checkpoint') {
  write('before-restart.json',ok(await governor.export_links()));
  console.log('Saved current synthetic records for restart comparison.');
} else if (phase === 'after-restart') {
  assert.deepEqual(ok(await governor.export_links()),read('before-restart.json'));
  console.log('PASS: complete synthetic record snapshot survives local network restart.');
} else if (phase === 'recover-checkpoint') {
  const snapshot = read('before-restart.json');
  ok(await governor.import_links(snapshot)); // Server refuses any nonempty destination.
  assert.deepEqual(ok(await governor.export_links()),snapshot);
  console.log('PASS: all synthetic link records restored from checkpoint into an empty local canister.');
} else if (phase === 'after-upgrade') {
  assert.deepEqual(ok(await governor.export_links()),read('before-upgrade.json'),'All records, order and revisions survive upgrade');
  assert.deepEqual(ok(await admin.mutate(read('retry-request.json'))),read('retry-result.json'),'Retry receipt survives upgrade');
  const acl = ok(await governor.export_acl()); assert(acl.acl_version>=3n,'ACL survives upgrade');
  console.log('PASS: actual Wasm upgrade preserves all exported records, ordering, revisions, ACL and retry receipts.');
} else if (phase === 'restore') {
  const probe = read('restore-probe.json');
  const destination = await createLocalActor({...config,...probe},'governor','http://127.0.0.1:5180');
  const snapshot = ok(await governor.export_links());
  const invalid = structuredClone(snapshot); invalid.clubs[0][1].links[0].club_id=CLUB_B;
  denied(await destination.import_links(invalid));
  assert(ok(await destination.export_links()).clubs.every(([,l])=>l.links.length===0),'Invalid import writes nothing');
  ok(await destination.import_links(snapshot));
  assert.deepEqual(ok(await destination.export_links()),snapshot,'Every exported field must reconcile');
  denied(await destination.import_links(snapshot));
  const stranger = await createLocalActor({...config,...probe},'outsider','http://127.0.0.1:5180');
  denied(await stranger.import_links(snapshot));
  console.log('PASS: fresh local canister import reconciles every field; invalid, unauthorized and overwrite imports rejected.');
} else throw new Error('Unknown local test phase');
