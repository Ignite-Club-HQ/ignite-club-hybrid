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
  const { IDL } = require('@icp-sdk/core/candid');
  const type = await snapshotType(require, new URL('./migrate-schemas/club_domain.snapshot.did.js', import.meta.url).href);
  const bytes = IDL.encode([type], [buildClubSnapshot({ club, teams, sponsors })]);
  const [back] = IDL.decode([type], bytes);
  assert.equal(back.profiles[0].name, 'Winter Cats FC');
  assert.equal(back.settings[0].theme_primary_color[0], '#ff0000');
});

import { buildEventsSnapshot, buildCompetitionSnapshot, buildLeagueSnapshot } from './migrate-club-writers.mjs';
const P = require('@icp-sdk/core/principal').Principal.fromText('aaaaa-aa');
const enc = async (domain, snap) => {
  const { IDL } = require('@icp-sdk/core/candid');
  const type = await snapshotType(require, new URL(`./migrate-schemas/${domain}.snapshot.did.js`, import.meta.url).href);
  return IDL.decode([type], IDL.encode([type], [snap]))[0];
};

test('events keep only this club, default a one-hour end, and carry no RSVPs', async () => {
  const s = buildEventsSnapshot({ clubId: 'c1', creator: P, events: [
    { id: 'e1', club_id: 'c1', title: 'Training', type: 'training', start_time: '2026-11-01T09:00:00Z', team_id: 't1', target_team_ids: ['t1', 't2'] },
    { id: 'e2', club_id: 'other', title: 'Foreign', start_time: '2026-11-01T09:00:00Z' }] });
  assert.deepEqual(s.events.map((e) => e.id), ['e1']);
  assert.equal(s.events[0].ends_at_ms - s.events[0].starts_at_ms, 3_600_000n);
  assert.equal(s.rsvps.length, 0);
  assert.equal((await enc('events_domain', s)).events[0].target_team_ids[0].length, 2);
});

test('competitions keep hidden scores and ladders hidden', async () => {
  const s = buildCompetitionSnapshot({ clubId: 'c1',
    competitions: [{ id: 'k1', organizer_club_id: 'c1', name: 'Cup', hide_scores: true, hide_ladder: true }, { id: 'k2', organizer_club_id: 'x', name: 'Other' }],
    divisions: [{ id: 'd1', competition_id: 'k1', hide_scores: true }, { id: 'd2', competition_id: 'k2' }],
    entries: [{ competition_id: 'k1', team_id: 't1', status: 'accepted' }],
    matches: [{ id: 'm1', competition_id: 'k1', home_team_id: 't1', away_team_name: 'Rivals', home_score: 3, away_score: 1, round_number: 2 }] });
  assert.deepEqual(s.competitions.map((c) => c.id), ['k1']);
  assert.deepEqual(s.score_privacy[0].map((p) => p.division[0] ?? null), [null, 'd1']);
  assert.deepEqual(s.ladders, [{ competition_id: 'k1', hide_ladder: true }]);
  assert.equal(s.owners.length, 0);
  assert.equal((await enc('competition_domain', s)).matches[0].away_team, 'Rivals');
});

test('mini-leagues keep sessions and groups but no players', async () => {
  const s = buildLeagueSnapshot({ clubId: 'c1', creator: P,
    leagues: [{ id: 'l1', club_id: 'c1', name: 'Friday', bib_colors: ['red'] }],
    sessions: [{ id: 's1', mini_league_id: 'l1', session_date: '2026-11-06', start_time: '17:30:00' }, { id: 's2', mini_league_id: 'zz', session_date: '2026-11-06' }],
    groups: [{ id: 'g1', session_id: 's1', name: 'A' }, { id: 'g2', session_id: 's2', name: 'B' }] });
  assert.deepEqual(s.sessions.map((x) => x.start_time), ['17:30']);
  assert.deepEqual(s.groups.map((g) => g.id), ['g1']);
  assert.equal(s.players.length, 0);
  assert.equal((await enc('mini_league_domain', s)).leagues[0].name, 'Friday');
});
