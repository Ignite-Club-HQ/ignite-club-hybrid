/**
 * Sport-aware match score configuration.
 *
 * Drives the per-sport labelling and behaviour of the match result entry
 * surface (MatchResultSheet) shown on game-type events. The same
 * underlying `game_results` row is reused across every sport — only the
 * UI vocabulary and which inputs/sections render changes.
 *
 * Score storage convention:
 *  - `home_score` / `away_score` always hold the headline number you'd
 *     read on a scoreboard (AFL total points, cricket runs, volleyball
 *     sets won, etc.).
 *  - `period_scores` jsonb holds sport-specific extras:
 *      • object form `{ home: {...}, away: {...} }` for per-team stats
 *        (cricket wickets/overs, AFL goals/behinds, rugby tries).
 *      • array form `[{ home, away }, ...]` for set-by-set scores
 *        (volleyball, tennis).
 *  - `player_stats` jsonb holds optional per-player entries
 *      `[{ id, name, goals, cards?, award? }]`.
 */

import { isBasketballSport, isNetballSport, isSoccerSport } from "./sportDetection";

export interface SecondaryStat {
  /** Stable key written to period_scores.home/away */
  key: string;
  /** Long form label for input fields */
  label: string;
  /** Short label for the inline score display (e.g. "W" → "120/3") */
  short: string;
  /** Max sensible value */
  max: number;
}

/**
 * Which extra optional sections should be available behind the
 * "Add match statistics" disclosure. Order in the array drives render
 * order in the sheet.
 */
export type OptionalSectionKey =
  | "scorers" // per-player goal/point attribution
  | "cards" // yellow/red cards (soccer/futsal)
  | "awards" // single MVP / best on court / best players
  | "notes"; // free-text match notes

/**
 * Drives the primary score input block.
 *  - default   : one number per team
 *  - afl       : goals + behinds per team (auto total = goals*6+behinds)
 *  - cricket   : runs + wickets per team, optional overs
 *  - sets      : sets won per team + collapsible per-set scores
 *               (volleyball, tennis)
 */
export type ScoreLayout = "default" | "afl" | "cricket" | "sets";

export interface SportScoreConfig {
  /** Canonical sport key stored in game_results.sport */
  key: string;
  /** Card heading e.g. "Match Score" */
  title: string;
  /** Sheet heading e.g. "Record Football Result" */
  entryTitle: string;
  /** Singular unit name e.g. "goal", "point", "run" */
  unit: string;
  /** Plural unit name e.g. "goals", "points", "runs" */
  unitPlural: string;
  /** Per-team score field label e.g. "Goals", "Points", "Runs" */
  teamScoreLabel: string;
  /** Heading for the scorers list e.g. "Goal scorers", "Top scorers" */
  scorersLabel: string;
  /** Whether per-player attribution makes sense for this sport. Only
   *  soccer-family sports get per-player goal attribution; everything
   *  else just records team totals (plus any secondaryStats). */
  supportsScorers: boolean;
  /** Whether to expose the "Own goal (opposition)" option */
  allowOwnGoal: boolean;
  /** Helper text shown beneath the scorers list when empty */
  scorersHint: string;
  /** Max sensible per-team total (used for input max) */
  maxScore: number;
  /** Additional per-team numeric stats (e.g. cricket wickets lost) */
  secondaryStats?: SecondaryStat[];
  /** Primary score layout selector for the result sheet */
  scoreLayout: ScoreLayout;
  /** Optional sections to expose behind "Add match statistics" */
  optionalSections: OptionalSectionKey[];
  /** Label shown on the single-pick MVP/best player section */
  awardLabel?: string;
}

const SOCCER: SportScoreConfig = {
  key: "soccer",
  title: "Match Score",
  entryTitle: "Record Football Result",
  unit: "goal",
  unitPlural: "goals",
  teamScoreLabel: "Goals",
  scorersLabel: "Goal scorers",
  supportsScorers: true,
  allowOwnGoal: true,
  scorersHint: "Optional — attribute goals to players to track top scorers.",
  maxScore: 99,
  scoreLayout: "default",
  optionalSections: ["scorers", "cards", "notes"],
};

const FUTSAL: SportScoreConfig = {
  ...SOCCER,
  key: "futsal",
  entryTitle: "Record Futsal Result",
};

const NETBALL: SportScoreConfig = {
  key: "netball",
  title: "Game Score",
  entryTitle: "Record Netball Result",
  unit: "goal",
  unitPlural: "goals",
  teamScoreLabel: "Goals",
  scorersLabel: "Goal scorers",
  supportsScorers: false,
  allowOwnGoal: false,
  scorersHint: "",
  maxScore: 200,
  scoreLayout: "default",
  optionalSections: ["notes"],
};

const BASKETBALL: SportScoreConfig = {
  key: "basketball",
  title: "Game Score",
  entryTitle: "Record Basketball Result",
  unit: "point",
  unitPlural: "points",
  teamScoreLabel: "Points",
  scorersLabel: "Top scorers",
  supportsScorers: false,
  allowOwnGoal: false,
  scorersHint: "",
  maxScore: 300,
  scoreLayout: "default",
  optionalSections: ["notes"],
};

const RUGBY: SportScoreConfig = {
  key: "rugby",
  title: "Match Score",
  entryTitle: "Record Rugby Result",
  unit: "point",
  unitPlural: "points",
  teamScoreLabel: "Points",
  scorersLabel: "Try scorers",
  supportsScorers: false,
  allowOwnGoal: false,
  scorersHint: "",
  maxScore: 200,
  secondaryStats: [{ key: "tries", label: "Tries", short: "T", max: 30 }],
  scoreLayout: "default",
  optionalSections: ["notes"],
};

const AFL: SportScoreConfig = {
  key: "afl",
  title: "Match Score",
  entryTitle: "Record AFL Result",
  unit: "point",
  unitPlural: "points",
  teamScoreLabel: "Points",
  scorersLabel: "Goal kickers",
  supportsScorers: false,
  allowOwnGoal: false,
  scorersHint: "",
  maxScore: 300,
  secondaryStats: [
    { key: "goals", label: "Goals", short: "G", max: 40 },
    { key: "behinds", label: "Behinds", short: "B", max: 40 },
  ],
  scoreLayout: "afl",
  optionalSections: ["notes"],
};

const CRICKET: SportScoreConfig = {
  key: "cricket",
  title: "Match Score",
  entryTitle: "Record Cricket Result",
  unit: "run",
  unitPlural: "runs",
  teamScoreLabel: "Runs",
  scorersLabel: "Batting highlights",
  supportsScorers: false,
  allowOwnGoal: false,
  scorersHint: "",
  maxScore: 999,
  secondaryStats: [
    { key: "wickets", label: "Wickets lost", short: "W", max: 10 },
    { key: "overs", label: "Overs", short: "O", max: 100 },
  ],
  scoreLayout: "cricket",
  optionalSections: ["notes"],
};

const HOCKEY: SportScoreConfig = {
  ...SOCCER,
  key: "hockey",
  entryTitle: "Record Hockey Result",
  scorersHint: "Optional — attribute goals to players.",
  maxScore: 99,
};

const BASEBALL: SportScoreConfig = {
  key: "baseball",
  title: "Game Score",
  entryTitle: "Record Baseball Result",
  unit: "run",
  unitPlural: "runs",
  teamScoreLabel: "Runs",
  scorersLabel: "Top batters",
  supportsScorers: false,
  allowOwnGoal: false,
  scorersHint: "",
  maxScore: 99,
  secondaryStats: [
    { key: "hits", label: "Hits", short: "H", max: 99 },
    { key: "errors", label: "Errors", short: "E", max: 30 },
  ],
  scoreLayout: "default",
  optionalSections: ["notes"],
};

const VOLLEYBALL: SportScoreConfig = {
  key: "volleyball",
  title: "Match Score",
  entryTitle: "Record Volleyball Result",
  unit: "set",
  unitPlural: "sets",
  teamScoreLabel: "Sets won",
  scorersLabel: "Top scorers",
  supportsScorers: false,
  allowOwnGoal: false,
  scorersHint: "",
  maxScore: 5,
  scoreLayout: "sets",
  optionalSections: ["notes"],
};

const TENNIS: SportScoreConfig = {
  ...VOLLEYBALL,
  key: "tennis",
  entryTitle: "Record Tennis Result",
  unit: "set",
  unitPlural: "sets",
  teamScoreLabel: "Sets won",
  scorersLabel: "",
  supportsScorers: false,
};

const HANDBALL: SportScoreConfig = {
  ...SOCCER,
  key: "handball",
  entryTitle: "Record Handball Result",
  unit: "goal",
  unitPlural: "goals",
  scorersHint: "Optional — attribute goals to players.",
  maxScore: 99,
};

const GENERIC: SportScoreConfig = {
  key: "other",
  title: "Match Score",
  entryTitle: "Record Match Result",
  unit: "point",
  unitPlural: "points",
  teamScoreLabel: "Score",
  scorersLabel: "Top scorers",
  supportsScorers: false,
  allowOwnGoal: false,
  scorersHint: "",
  maxScore: 999,
  scoreLayout: "default",
  optionalSections: ["notes"],
};

const lower = (s: string | null | undefined) => (s || "").toLowerCase();
const matchAny = (s: string, kws: string[]) => kws.some((k) => s.includes(k));

/**
 * Pick the right score config for a given club sport string.
 * Falls back to a generic "points" config so any sport an admin types
 * still gets a usable score entry experience.
 */
export const getSportScoreConfig = (
  sport: string | null | undefined
): SportScoreConfig => {
  if (isSoccerSport(sport)) return SOCCER;
  if (isBasketballSport(sport)) return BASKETBALL;
  if (isNetballSport(sport)) return NETBALL;
  const s = lower(sport);
  if (!s) return GENERIC;
  if (matchAny(s, ["futsal"])) return FUTSAL;
  if (matchAny(s, ["rugby", "league", "union"])) return RUGBY;
  if (matchAny(s, ["afl", "aussie", "australian rules"])) return AFL;
  if (matchAny(s, ["cricket"])) return CRICKET;
  if (matchAny(s, ["hockey"])) return HOCKEY;
  if (matchAny(s, ["baseball", "softball", "tee ball", "t-ball"])) return BASEBALL;
  if (matchAny(s, ["volleyball"])) return VOLLEYBALL;
  if (matchAny(s, ["tennis", "padel"])) return TENNIS;
  if (matchAny(s, ["handball"])) return HANDBALL;
  return GENERIC;
};
