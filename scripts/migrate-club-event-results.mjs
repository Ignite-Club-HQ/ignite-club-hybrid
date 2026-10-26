// Pure conversion: Supabase game_results/game_summaries/game_player_stats ->
// events_domain snapshot results/summaries/stats/player_details. No network,
// no source writes. Private names (MVP, fill-in players) and unsupported
// fields refuse rather than being stored as plaintext or silently dropped.
import { claimedPrincipal, timestamp } from './migrate-club-members.mjs';
const opt = (v) => (v == null || v === '' ? [] : [v]);
const int = (v, min, max, d = 0) => {
  const n = Number(v ?? d);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw Error('Invalid source value');
  return n;
};
const n16 = (v) => int(v, 0, 65535);
const n32 = (v) => int(v, 0, 4294967295);
const json = (v) => JSON.stringify(v ?? null);

export function buildGameResults({ eventIds, gameResults = [], gameSummaries = [], gamePlayerStats = [], claims, migratedChildren }) {
  const events = new Set(eventIds);
  const child = (id) => {
    if (!migratedChildren?.has(id)) throw Error('Missing verified migrated child');
    return id;
  };
  const results = gameResults.map((r) => {
    if (r.event_id && !events.has(r.event_id)) throw Error('Foreign game result refused');
    if (r.mvp_player_id || r.mvp_player_name) throw Error('MVP details need the private-name contract; refusing to store plaintext');
    return {
      id: r.id, team_id: r.team_id, event_id: opt(r.event_id), sport: r.sport ?? 'soccer',
      home_label: r.home_label ?? 'Home', away_label: r.away_label ?? 'Away',
      home_score: n32(r.home_score), away_score: n32(r.away_score),
      period_scores_json: json(r.period_scores), player_stats_json: json(r.player_stats),
      mvp_player_id: [], mvp_player_name: [],
      saved_by: claimedPrincipal(claims, r.saved_by), updated_at_ms: timestamp(r.updated_at ?? r.created_at),
    };
  });
  const summaries = gameSummaries.map((s) => {
    if (!s.event_id || !events.has(s.event_id)) throw Error('Foreign game summary refused');
    if (!s.team_id) throw Error('Game summary without a team refused');
    if (s.is_active) throw Error('A live game is in progress; finish it before migrating');
    return {
      event_id: s.event_id, team_id: s.team_id, total_game_time: n32(s.total_game_time),
      half_duration: n32(s.half_duration), formation_used: opt(s.formation_used),
      total_substitutions: n16(s.total_substitutions), updated_at_ms: timestamp(s.updated_at ?? s.created_at),
    };
  });
  const stats = [];
  const detailsByEvent = new Map();
  for (const p of gamePlayerStats) {
    if (!p.event_id || !events.has(p.event_id)) throw Error('Foreign player stat refused');
    if (!p.team_id) throw Error('Player stat without a team refused');
    if (p.fill_in_player_name || p.player_name) throw Error('Fill-in player names need the private-name contract; refusing to store plaintext');
    if (p.assists) throw Error('Assists have no destination field; refusing to drop them');
    if (p.position_minutes != null) throw Error('Position minutes units are unverified; refusing to convert');
    stats.push({
      event_id: p.event_id, team_id: p.team_id,
      user_id: p.user_id ? [claimedPrincipal(claims, p.user_id).toText()] : [],
      fill_in_player_name: [], jersey_number: p.jersey_number == null ? [] : [n16(p.jersey_number)],
      minutes_played: n32(p.minutes_played), positions_played: p.positions_played ?? (p.position ? [p.position] : []),
      substitutions_count: n16(p.substitutions_count), started_on_pitch: !!p.started_on_pitch, goals_scored: n16(p.goals_scored),
    });
    if (p.child_id) {
      const list = detailsByEvent.get(p.event_id) ?? [];
      list.push({ user_id: p.user_id ? [claimedPrincipal(claims, p.user_id).toText()] : [], child_id: [child(p.child_id)], position_seconds: [] });
      detailsByEvent.set(p.event_id, list);
    }
  }
  return { results, summaries, stats, player_details: [...detailsByEvent.entries()] };
}

/** Event tables with no destination contract; any row refuses the events step. */
export const UNSUPPORTED_EVENT_TABLES = ['duties', 'match_captains', 'match_goalkeepers', 'player_of_match', 'event_guests'];
export function assertNoUnsupportedEventRows(named) {
  for (const [table, rows] of Object.entries(named)) {
    if (rows.length) throw Error(`${table} has no destination contract; refusing to drop ${rows.length} record(s)`);
  }
}
