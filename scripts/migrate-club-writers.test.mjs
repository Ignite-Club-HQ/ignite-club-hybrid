import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildClubSnapshot, hslToHex, slugify, snapshotType } from './migrate-club-writers.mjs';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const club = { id: 'c1', name: 'Winter Cats FC', created_at: '2025-01-01T00:00:00Z', theme_primary_h: 0, theme_primary_s: 100, theme_primary_l: 50, listed_on_marketplace: true };
const teams = [{ id: 't1', club_id: 'c1', name: 'U10' }, { id: 't2', club_id: 'c1', name: 'Gone', deleted_at: '2025-02-01T00:00:00Z' }, { id: 'x', club_id: 'other', name: 'Foreign' }];
const sponsors = [{ id: 's1', club_id: 'c1', name: 'Bakery', tier: 'gold', exposure_percentage: 140 }];

test('colours convert from Supabase HSL to hex', () => {
  assert.equal(hslToHex(0, 100, 50), '#ff0000');
  assert.equal(hslToHex(null, 1, 1), null);
});

test('slug falls back for unnamed clubs', () => {
  assert.equal(slugify('Winter Cats FC', 'c1'), 'winter-cats-fc');
  assert.equal(slugify('!!!', 'abcdef123'), 'club-abcdef12');
});

test('snapshot keeps only this club, drops deleted teams, carries no member data', () => {
  const s = buildClubSnapshot({ club, teams, sponsors });
  assert.deepEqual(s.teams.map((t) => t.id), ['t1']);
  assert.deepEqual(s.acl_teams, [{ id: 't1', club: 'c1' }]);
  assert.equal(s.sponsors[0].exposure_percentage[0], 100);
  assert.equal(s.roles.length + s.guardians.length + s.children.length, 0);
  assert.equal(s.teams[0].shell_claimed_by.length, 0);
  assert.equal(s.member, true);
});

test('snapshot encodes against the club service schema', async () => {
  const { IDL } = require('@dfinity/candid');
  const type = await snapshotType(require, new URL('./migrate-schemas/club_domain.snapshot.did.js', import.meta.url).href);
  const bytes = IDL.encode([type], [buildClubSnapshot({ club, teams, sponsors })]);
  const [back] = IDL.decode([type], bytes);
  assert.equal(back.profiles[0].name, 'Winter Cats FC');
  assert.equal(back.settings[0].theme_primary_color[0], '#ff0000');
});
