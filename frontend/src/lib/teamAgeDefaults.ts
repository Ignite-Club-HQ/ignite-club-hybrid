/**
 * Age-based defaults derived from a team's name.
 *
 * Used as a fallback when a team has no persisted `team_subscriptions` row,
 * so junior teams don't open the pitch board with the legacy 10-minute halves.
 *
 * Rules (per product):
 *   U6  – U11  → 20 minute halves
 *   U12, U13, U15 → 25 minute halves
 *   anything else → 25 minute halves (sensible adult/competition default)
 */

/** Extract the first "U<number>" age band from a team name (case-insensitive). */
export function parseTeamAgeYears(teamName: string | null | undefined): number | null {
  if (!teamName) return null;
  const m = teamName.match(/\bU\s*-?\s*(\d{1,2})\b/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Default minutes-per-half for a team based on its name.
 * Returns the configured fallback (default 20) when no age band can be parsed.
 */
export function defaultMinutesPerHalfForTeamName(
  teamName: string | null | undefined,
  fallback: number = 20
): number {
  const age = parseTeamAgeYears(teamName);
  if (age === null) return fallback;
  if (age <= 11) return 20;
  // U12, U13, U14, U15+ → 25
  return 25;
}

/**
 * Heuristic: detect whether a team is an adult team based on its name and
 * level/age string. Used to seed sensible defaults at team creation, e.g.
 * `default_rsvp_audience = 'players_only'` for adult teams (no parents in
 * the loop), vs `players_and_parents` for junior teams.
 *
 * Returns true when:
 *  - The name/levelAge contains an explicit adult marker
 *    (senior, seniors, men, mens, women, womens, ladies, adult, adults,
 *     masters, reserves, firsts, seconds, premier, premiers, open, opens), OR
 *  - A U<number> marker is present with number >= 19.
 *
 * Otherwise returns false (junior assumption, so parents stay in the loop).
 */
export function isAdultTeam(
  name: string | null | undefined,
  levelAge?: string | null | undefined,
): boolean {
  const haystack = `${name ?? ""} ${levelAge ?? ""}`.toLowerCase();
  const adultMarkers = /\b(senior|seniors|men|mens|women|womens|ladies|adult|adults|masters|reserves?|firsts?|seconds?|premiers?|opens?)\b/;
  if (adultMarkers.test(haystack)) return true;
  const age = parseTeamAgeYears(haystack);
  if (age !== null && age >= 19) return true;
  return false;
}

/**
 * Default RSVP audience for a newly created team. Adult teams default to
 * `players_only` so players (not parents) are the primary RSVP focus; all
 * other teams default to `players_and_parents`.
 */
export function defaultRsvpAudienceForTeam(
  name: string | null | undefined,
  levelAge?: string | null | undefined,
): "players_only" | "players_and_parents" {
  return isAdultTeam(name, levelAge) ? "players_only" : "players_and_parents";
}
