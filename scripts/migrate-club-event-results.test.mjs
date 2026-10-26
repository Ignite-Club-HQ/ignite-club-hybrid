import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildGameResults, buildEventExtras } from './migrate-club-event-results.mjs';
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
      mvp_player_id: 'u1', mvp_player_name: null, saved_by: 'u1', updated_at: now }],
    gameSummaries: [{ event_id: 'e1', team_id: 't1', total_game_time: 3600, half_duration: 1800,
      formation_used: '4-3-3', total_substitutions: 3, is_active: false, updated_at: now }],
    gamePlayerStats: [{ event_id: 'e1', team_id: 't1', user_id: 'u1', child_id: 'ch1', jersey_number: 7,
      minutes_played: 60, positions_played: ['ST'], substitutions_count: 0, started_on_pitch: true,
      goals_scored: 2, assists: 3, position_minutes: { ST: 40, LW: 20 }, fill_in_player_name: null, player_name: null }],
  });
  const type = await snapshotType(require, new URL('./migrate-schemas/events_domain.snapshot.did.js', import.meta.url).href);
  const { IDL } = require('@icp-sdk/core/candid');
  const [back] = IDL.decode([type], IDL.encode([type], [snap]));
  const r = back.results[0][0];
  assert.equal(r.home_score, 3);
  assert.equal(JSON.parse(r.period_scores_json)[0].home, 2);
  assert.equal(r.saved_by.toText(), member.toText());
  // Claimed MVP accounts carry over by reference.
  assert.equal(r.mvp_player_id[0], member.toText());
  const s = back.summaries[0][0];
  assert.equal(s.formation_used[0], '4-3-3');
  const st = back.stats[0][0];
  assert.equal(st.goals_scored, 2);
  assert.equal(st.user_id[0], member.toText());
  const d = back.player_details[0];
  assert.equal(d[0][0], 'e1');
  assert.deepEqual(d[0][1][0].child_id, ['ch1']);
  // Assists and source-unit position minutes ride the sidecar.
  const x = back.stat_extras[0][0];
  assert.deepEqual(x.assists, [3]);
  assert.deepEqual(x.position_minutes[0], [['ST', 40], ['LW', 20]]);
});

test('refuses plaintext private names and foreign rows', () => {
  const base = { eventIds, claims, migratedChildren };
  assert.throws(() => buildGameResults({ ...base, gameResults: [{ id: 'g', event_id: 'e1', team_id: 't1', mvp_player_name: 'Kid Name', saved_by: 'u1', updated_at: now }] }), /MVP/);
  assert.throws(() => buildGameResults({ ...base, gamePlayerStats: [{ event_id: 'e1', team_id: 't1', fill_in_player_name: 'Guest Kid' }] }), /Fill-in/);
  assert.throws(() => buildGameResults({ ...base, gameResults: [{ id: 'g', event_id: 'other', team_id: 't1', saved_by: 'u1', updated_at: now }] }), /Foreign game result/);
  assert.throws(() => buildGameResults({ ...base, gameSummaries: [{ event_id: 'e1', team_id: 't1', is_active: true, updated_at: now }] }), /live game/);
  assert.throws(() => buildGameResults({ ...base, gamePlayerStats: [{ event_id: 'e1', team_id: 't1', child_id: 'unknown' }] }), /migrated child/);
});

test('duties, officials and guests carry over by reference and survive the encoding', async () => {
  const snap = buildEventsSnapshot({
    clubId: 'c1', creator, claims, migratedChildren,
    events: [{ id: 'e1', club_id: 'c1', team_id: 't1', title: 'Game', type: 'game', start_time: now, created_at: now, duty_team_id: 't1' }],
    duties: [
      { id: 'd1', event_id: 'e1', user_id: 'u1', duty_name: 'Canteen', is_completed: true, created_at: now },
      { id: 'd2', event_id: 'e1', user_id: null, duty_name: 'Referee', created_at: now },
    ],
    captains: [{ event_id: 'e1', team_id: 't1', child_id: 'ch1' }],
    goalkeepers: [{ event_id: 'e1', team_id: 't1', user_id: 'u1' }],
    playerOfMatch: [{ event_id: 'e1', team_id: 't1', child_id: 'ch1' }],
    guests: [{ id: 'g1', event_id: 'e1', guest_name: 'Grandma', added_by: 'u1', created_at: now }],
  });
  const type = await snapshotType(require, new URL('./migrate-schemas/events_domain.snapshot.did.js', import.meta.url).href);
  const { IDL } = require('@icp-sdk/core/candid');
  const [back] = IDL.decode([type], IDL.encode([type], [snap]));
  // Assigned duty stays a duty; unassigned becomes claimable open duty.
  assert.equal(back.duties[0][0].account_id, member.toText());
  assert.equal(back.duties[0][0].completed, true);
  assert.equal(back.open_duties[0][0].duty, 'Referee');
  assert.deepEqual(back.open_duties[0][0].claimed_by, []);
  assert.equal(back.duty_teams[0][0].team_id, 't1');
  assert.deepEqual(back.captains[0][0].child_id, ['ch1']);
  assert.equal(back.goalkeepers[0][0].user_id[0], member.toText());
  assert.deepEqual(back.player_of_match[0][0].child_id, ['ch1']);
  assert.equal(back.guests[0][0].guest_name, 'Grandma');
});

test('event extras refuse foreign rows, missing subjects and plaintext names', () => {
  const base = { eventIds, claims, migratedChildren };
  assert.throws(() => buildEventExtras({ ...base, duties: [{ id: 'd', event_id: 'other', duty_name: 'X', created_at: now }] }), /Foreign duty/);
  assert.throws(() => buildEventExtras({ ...base, captains: [{ event_id: 'e1', team_id: 't1' }] }), /without a subject/);
  assert.throws(() => buildEventExtras({ ...base, playerOfMatch: [{ event_id: 'e1', team_id: 't1', user_id: 'u1', player_name: 'Kid' }] }), /plaintext/);
  assert.throws(() => buildEventExtras({ ...base, guests: [{ id: 'g', event_id: 'e1', guest_name: '', added_by: 'u1', created_at: now }] }), /without a name/);
  assert.throws(() => buildEventExtras({ ...base, captains: [{ event_id: 'e1', team_id: 't1', child_id: 'unknown' }] }), /migrated child/);
});
