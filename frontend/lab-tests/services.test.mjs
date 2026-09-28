import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureClubLinksService, selectClubLinksService, DEMO_CLUB_ID as club } from '../src/lab/clubLinksService.mjs';
const draft = title => ({title,subtitle:null,url:'https://example.invalid',icon:'link',open_mode:'browser',is_active:true});
test('editor service persists edits, visibility and reorder only in memory', async () => {
  const s=createFixtureClubLinksService(); const a=await s.save(club,draft('First')); const b=await s.save(club,draft('Second'));
  await s.reorder(club,a.id,b.id); assert.deepEqual((await s.listAdmin(club)).map(r=>r.title),['Second','First']);
  await s.setActive(a.id,false); assert.equal((await s.listVisible(club)).length,1);
  await s.save(club,{...b,title:'Changed'}); assert.equal((await s.get(b.id)).title,'Changed');
  await s.remove(b.id); assert.equal((await s.listAdmin(club)).length,1);
  await s.save(club,draft('After deletion')); assert.equal(new Set((await s.listAdmin(club)).map(r => r.sort_order)).size,2);
  assert.equal((await createFixtureClubLinksService().listAdmin(club)).length,0);
});
test('fixture rejects cross-club mutations and non-admin writes', async () => {
  const s=createFixtureClubLinksService(); await assert.rejects(s.save('other-club',draft('No')));
  await assert.rejects(createFixtureClubLinksService({role:'member'}).save(club,draft('No')));
  await assert.rejects(s.save(club,{...draft('Bad'),url:'javascript:alert(1)'}));
});
test('missing ICP implementation never falls back', () => {
  assert.throws(()=>selectClubLinksService('icp')); assert.throws(()=>selectClubLinksService('supabase'));
});
