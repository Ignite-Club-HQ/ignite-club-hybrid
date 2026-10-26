// Pure conversion: Supabase game_results/game_summaries/game_player_stats and
// event extras (duties, duty teams, captains, goalkeepers, player of the
// match, guests) -> events_domain snapshot fields. No network, no source
// writes. Plaintext private names (MVP, fill-in players) still refuse rather
// than being stored outside pii_access_control; everything else is carried
// by a destination contract.
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
    if (r.mvp_player_name) throw Error('MVP names stay out of plaintext storage; refusing to store plaintext');
    return {
      id: r.id, team_id: r.team_id, event_id: opt(r.event_id), sport: r.sport ?? 'soccer',
      home_label: r.home_label ?? 'Home', away_label: r.away_label ?? 'Away',
      home_score: n32(r.home_score), away_score: n32(r.away_score),
      period_scores_json: json(r.period_scores), player_stats_json: json(r.player_stats),
      // Claimed MVP accounts carry over by reference; names never do.
      mvp_player_id: r.mvp_player_id ? [claimedPrincipal(claims, r.mvp_player_id).toText()] : [],
      mvp_player_name: [],
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
  const statExtras = [];
  const detailsByEvent = new Map();
  for (const p of gamePlayerStats) {
    if (!p.event_id || !events.has(p.event_id)) throw Error('Foreign player stat refused');
    if (!p.team_id) throw Error('Player stat without a team refused');
    if (p.fill_in_player_name || p.player_name) throw Error('Fill-in player names stay out of plaintext storage; refusing to store plaintext');
    const subject = {
      user_id: p.user_id ? [claimedPrincipal(claims, p.user_id).toText()] : [],
      child_id: p.child_id ? [child(p.child_id)] : [],
    };
    stats.push({
      event_id: p.event_id, team_id: p.team_id,
      user_id: subject.user_id,
      fill_in_player_name: [], jersey_number: p.jersey_number == null ? [] : [n16(p.jersey_number)],
      minutes_played: n32(p.minutes_played), positions_played: p.positions_played ?? (p.position ? [p.position] : []),
      substitutions_count: n16(p.substitutions_count), started_on_pitch: !!p.started_on_pitch, goals_scored: n16(p.goals_scored),
    });
    // Assists and position minutes ride the sidecar contract; position_minutes
    // is preserved verbatim in its source units (minutes).
    if (p.assists != null || p.position_minutes != null) {
      statExtras.push({
        event_id: p.event_id, team_id: p.team_id, ...subject,
        assists: p.assists == null ? [] : [n16(p.assists)],
        position_minutes: p.position_minutes == null ? [] : [Object.entries(p.position_minutes).map(([pos, m]) => [pos, n16(m)])],
      });
    }
    // The canister requires exactly one detail entry per stat row.
    const list = detailsByEvent.get(p.event_id) ?? [];
    list.push({ ...subject, position_seconds: [] });
    detailsByEvent.set(p.event_id, list);
  }
  return { results, summaries, stats, stat_extras: statExtras, player_details: [...detailsByEvent.entries()] };
}

/**
 * Supabase duties/event_duty_teams/match_captains/match_goalkeepers/
 * player_of_match/event_guests -> events_domain snapshot extras.
 * People are carried by reference only: claimed account principals or
 * verified migrated child ids. Rows naming nobody refuse.
 */
export function buildEventExtras({ eventIds, duties = [], eventDutyTeams = [], captains = [], goalkeepers = [], playerOfMatch = [], guests = [], claims, migratedChildren }) {
  const events = new Set(eventIds);
  const inScope = (r, label) => { if (!r.event_id || !events.has(r.event_id)) throw Error(`Foreign ${label} refused`); };
  const child = (id) => {
    if (!migratedChildren?.has(id)) throw Error('Missing verified migrated child');
    return id;
  };
  const subject = (r, label) => {
    const user = r.user_id ?? r.player_id ?? null;
    const kid = r.child_id ?? null;
    if (!user && !kid) throw Error(`${label} without a subject refused`);
    return { user_id: user ? [claimedPrincipal(claims, user).toText()] : [], child_id: kid ? [child(kid)] : [] };
  };

  const dutyRows = [];
  const openDuties = [];
  for (const d of duties) {
    inScope(d, 'duty');
    const name = d.duty_name ?? d.duty ?? d.name;
    if (typeof name !== 'string' || !name.trim()) throw Error('Duty without a name refused');
    const user = d.user_id ?? d.assigned_to ?? null;
    if (user) {
      dutyRows.push({ event_id: d.event_id, account_id: claimedPrincipal(claims, user).toText(), duty: name, completed: !!(d.is_completed ?? d.completed) });
    } else {
      // Unassigned duties stay claimable on the destination.
      openDuties.push({ id: d.id, event_id: d.event_id, duty: name, claimed_by: [], created_at_ms: timestamp(d.created_at) });
    }
  }
  const dutyTeams = eventDutyTeams.map((t) => {
    inScope(t, 'duty team');
    if (!t.team_id) throw Error('Duty team without a team refused');
    return { event_id: t.event_id, team_id: t.team_id };
  });
  const captainRows = captains.map((c) => { inScope(c, 'captain'); if (!c.team_id) throw Error('Captain without a team refused'); return { event_id: c.event_id, team_id: c.team_id, ...subject(c, 'Captain') }; });
  const goalkeeperRows = goalkeepers.map((g) => { inScope(g, 'goalkeeper'); if (!g.team_id) throw Error('Goalkeeper without a team refused'); return { event_id: g.event_id, team_id: g.team_id, ...subject(g, 'Goalkeeper') }; });
  const potmRows = playerOfMatch.map((p) => {
    inScope(p, 'player of the match');
    if (p.player_name || p.name) throw Error('Player-of-the-match names stay out of plaintext storage; refusing to store plaintext');
    return { event_id: p.event_id, team_id: opt(p.team_id), ...subject(p, 'Player of the match') };
  });
  const guestRows = guests.map((g) => {
    inScope(g, 'event guest');
    if (typeof g.guest_name !== 'string' || !g.guest_name.trim()) throw Error('Event guest without a name refused');
    return { id: g.id, event_id: g.event_id, guest_name: g.guest_name, added_by: claimedPrincipal(claims, g.added_by ?? g.created_by), created_at_ms: timestamp(g.created_at) };
  });
  return { duties: dutyRows, duty_teams: dutyTeams, open_duties: openDuties, captains: captainRows, goalkeepers: goalkeeperRows, player_of_match: potmRows, guests: guestRows };
}
