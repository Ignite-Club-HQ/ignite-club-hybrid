import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildGameResults, assertNoUnsupportedEventRows } from './migrate-club-event-results.mjs';
import { buildEventsSnapshot, snapshotType } from './migrate-club-writers.mjs';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { Principal } = require('@icp-sdk/core/principal');
const member = Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai');
const creator = Principal.fromText('ryjl3-tyaaa-aaaaa-aaaba-cai');
const now = '2026-10-26T00:00:00Z';
const claims = new Map([['u1', member]]);
const eventIds = ['e1'];
const migratedChildren = new Set(['ch1']);

test('game results, summaries and stats survive the snapshot encoding intact', async () => {
  const snap = buildEventsSnapshot({
    clubId: 'c1', creator, claims, migratedChildren,
    events: [{ id: 'e1', club_id: 'c1', title: 'Game', type: 'game', start_time: now, created_at: now }],
    gameResults: [{ id: 'gr1', event_id: 'e1', team_id: 't1', sport: 'soccer', home_label: 'Us', away_label: 'Them',
      home_score: 3, away_score: 2, period_scores: [{ half: 1, home: 2, away: 1 }], player_stats: null,
      mvp_player_id: null, mvp_player_name: null, saved_by: 'u1', updated_at: now }],
    gameSummaries: [{ event_id: 'e1', team_id: 't1', total_game_time: 3600, half_duration: 1800,
      formation_used: '4-3-3', total_substitutions: 3, is_active: false, updated_at: now }],
    gamePlayerStats: [{ event_id: 'e1', team_id: 't1', user_id: 'u1', child_id: 'ch1', jersey_number: 7,
      minutes_played: 60, positions_played: ['ST'], substitutions_count: 0, started_on_pitch: true,
      goals_scored: 2, assists: null, position_minutes: null, fill_in_player_name: null, player_name: null }],
  });
  const type = await snapshotType(require, new URL('./migrate-schemas/events_domain.snapshot.did.js', import.meta.url).href);
  const { IDL } = require('@icp-sdk/core/candid');
  const [back] = IDL.decode([type], IDL.encode([type], [snap]));
  const r = back.results[0][0];
  assert.equal(r.home_score, 3);
  assert.equal(JSON.parse(r.period_scores_json)[0].home, 2);
  assert.equal(r.saved_by.toText(), member.toText());
  const s = back.summaries[0][0];
  assert.equal(s.formation_used[0], '4-3-3');
  const st = back.stats[0][0];
  assert.equal(st.goals_scored, 2);
  assert.equal(st.user_id[0], member.toText());
  const d = back.player_details[0];
  assert.equal(d[0][0], 'e1');
  assert.deepEqual(d[0][1][0].child_id, ['ch1']);
});

test('refuses plaintext private names, unverifiable fields and foreign rows', () => {
  const base = { eventIds, claims, migratedChildren };
  assert.throws(() => buildGameResults({ ...base, gameResults: [{ id: 'g', event_id: 'e1', team_id: 't1', mvp_player_name: 'Kid Name', saved_by: 'u1', updated_at: now }] }), /MVP/);
  assert.throws(() => buildGameResults({ ...base, gamePlayerStats: [{ event_id: 'e1', team_id: 't1', fill_in_player_name: 'Guest Kid' }] }), /Fill-in/);
  assert.throws(() => buildGameResults({ ...base, gamePlayerStats: [{ event_id: 'e1', team_id: 't1', assists: 2 }] }), /Assists/);
  assert.throws(() => buildGameResults({ ...base, gamePlayerStats: [{ event_id: 'e1', team_id: 't1', position_minutes: { ST: 30 } }] }), /Position minutes/);
  assert.throws(() => buildGameResults({ ...base, gameResults: [{ id: 'g', event_id: 'other', team_id: 't1', saved_by: 'u1', updated_at: now }] }), /Foreign game result/);
  assert.throws(() => buildGameResults({ ...base, gameSummaries: [{ event_id: 'e1', team_id: 't1', is_active: true, updated_at: now }] }), /live game/);
  assert.throws(() => buildGameResults({ ...base, gamePlayerStats: [{ event_id: 'e1', team_id: 't1', child_id: 'unknown' }] }), /migrated child/);
});

test('unsupported event tables stop the step instead of being dropped', () => {
  assert.throws(() => assertNoUnsupportedEventRows({ duties: [{ id: 'd1' }], match_captains: [] }), /duties.*no destination contract/);
  assert.doesNotThrow(() => assertNoUnsupportedEventRows({ duties: [], event_guests: [] }));
});
