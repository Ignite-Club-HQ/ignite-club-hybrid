/**
 * Derives event card display content from STRUCTURED fields, not raw titles.
 *
 * Rules:
 *  - Game with opponent → primary "vs {Opponent}", secondary = cleaned title (if meaningful)
 *  - Game w/o opponent  → primary "Game" (or "Match Day" via type label), secondary = cleaned title
 *  - Training           → primary "Training", secondary = cleaned title (if meaningful)
 *  - Social/custom      → primary = title (the only case title drives UI), no secondary
 *
 * Cleans noisy prefixes like "Round 1:", "Game:", "Training:", "Match:".
 */

import { getEventTypeLabel } from "./eventTypeLabel";

interface EventDisplayInput {
  title?: string | null;
  type?: string | null;
  opponent?: string | null;
  mini_league_id?: string | null;
  is_bye?: boolean | null;
  teams?: { name?: string | null } | null;
  clubs?: { name?: string | null } | null;
}

const NOISY_PREFIX_RE =
  /^\s*(round\s*\d+\s*[:\-–—]?\s*|game\s*[:\-–—]\s*|match\s*[:\-–—]\s*|training\s*[:\-–—]\s*|session\s*[:\-–—]\s*)+/i;

const MATCHUP_SEPARATOR_RE = /\s+(?:v|vs|versus)\.?\s+/i;

function cleanTitle(raw?: string | null): string {
  if (!raw) return "";
  let t = raw.trim();
  // Strip repeated noisy prefixes
  let prev = "";
  while (t !== prev) {
    prev = t;
    t = t.replace(NOISY_PREFIX_RE, "").trim();
  }
  return t;
}

function normalizeForCompare(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bunder\s*(\d+)\b/g, "u$1") // "Under 12" → "u12"
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isRedundant(
  secondary: string,
  primary: string,
  typeLabel: string,
  teamName?: string | null,
): boolean {
  if (!secondary) return true;
  const s = secondary.toLowerCase().trim();
  if (s === primary.toLowerCase().trim()) return true;
  if (s === typeLabel.toLowerCase().trim()) return true;

  // Suppress "{team} {type}" style titles (e.g. "U8 Blue Training",
  // "Under 12 Blue Training") when team is already shown as the card title
  // and type is the primary line. This is the most common duplication.
  if (teamName) {
    const ns = normalizeForCompare(secondary);
    const nteam = normalizeForCompare(teamName);
    const ntype = normalizeForCompare(typeLabel);
    const nprimary = normalizeForCompare(primary);
    if (nteam && (ns === `${nteam} ${ntype}` || ns === `${nteam} ${nprimary}` || ns === nteam)) {
      return true;
    }
    // Also catch reversed order "training u8 blue"
    if (nteam && (ns === `${ntype} ${nteam}` || ns === `${nprimary} ${nteam}`)) {
      return true;
    }
  }
  return false;
}

export interface EventDisplay {
  /** Primary scan line — derived from structured fields whenever possible. */
  primary: string;
  /** Optional secondary metadata (the user-entered title, when meaningful). */
  secondary: string | null;
  /** True when the event leads with the title (social/custom only). */
  titleLed: boolean;
}

export function getEventDisplay(event: EventDisplayInput): EventDisplay {
  const type = event.type || "";
  const typeLabel = getEventTypeLabel(type, { miniLeagueId: event.mini_league_id });
  const cleaned = cleanTitle(event.title);
  let opponent = event.opponent?.trim() || "";

  // Fallback: derive opponent from a "Team A vs Team B" title when the
  // structured field is empty. Pick the side that isn't the team/club name.
  if (!opponent && cleaned && MATCHUP_SEPARATOR_RE.test(cleaned)) {
    const [left, right] = cleaned.split(MATCHUP_SEPARATOR_RE).map((s) => s.trim());
    const ownNames = [event.teams?.name, event.clubs?.name]
      .map((n) => (n || "").toLowerCase().trim())
      .filter(Boolean);
    const isOwn = (s: string) =>
      ownNames.some((n) => s.toLowerCase().includes(n) || n.includes(s.toLowerCase()));
    if (left && right) {
      opponent = isOwn(left) && !isOwn(right) ? right : isOwn(right) && !isOwn(left) ? left : right;
    }
  }

  // A. Game / Match Day
  if (type === "game" || type === "mini_league" || event.mini_league_id) {
    if (event.is_bye) {
      // BYE rounds — opponent/title irrelevant; surface BYE prominently.
      const secondary = cleaned && !isRedundant(cleaned, "BYE", typeLabel, event.teams?.name) ? cleaned : null;
      return { primary: "BYE — no match", secondary, titleLed: false };
    }
    if (opponent) {
      const primary = `vs ${opponent}`;
      // Avoid echoing "Team A vs Opponent" titles as secondary
      const secondary =
        cleaned && !MATCHUP_SEPARATOR_RE.test(cleaned) && !isRedundant(cleaned, primary, typeLabel, event.teams?.name)
          ? cleaned
          : null;
      return { primary, secondary, titleLed: false };
    }
    // No opponent — fall back to type label, expose cleaned title as secondary if meaningful
    const primary = typeLabel; // "Game" or "Match Day"
    const secondary = cleaned && !isRedundant(cleaned, primary, typeLabel, event.teams?.name) ? cleaned : null;
    return { primary, secondary, titleLed: false };
  }

  // B. Training
  if (type === "training") {
    const primary = "Training";
    const secondary = cleaned && !isRedundant(cleaned, primary, typeLabel, event.teams?.name) ? cleaned : null;
    return { primary, secondary, titleLed: false };
  }

  // C. Social / custom — title drives the UI
  const primary = cleaned || typeLabel;
  return { primary, secondary: null, titleLed: true };
}
