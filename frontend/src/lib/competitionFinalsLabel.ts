/** Finals metadata uses the existing match notes field, including generated finals. */
export function getCompetitionFinalsLabel(value?: string | null): string | null {
  const label = value?.split("·")[0].trim();
  return label && /\bfinals?\b/i.test(label) ? label : null;
}

const FINALS_PHRASE = /\b((?:grand|semi|preliminary|prelim|elimination|qualifying|quarter)[\s-]*)?finals?\b(?:[\s-]*(?:match|game)?[\s-]*\d+)?/i;

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_m, p, c) => p + c.toUpperCase());

/**
 * Derive a finals label from an imported fixture row. The Round cell wins
 * ("Grand Final", "Finals vs TBD" → "Finals"); otherwise any other cell
 * mentioning finals (e.g. a Notes column) yields the short finals phrase.
 */
export function deriveImportedFinalsLabel(roundCell: string, otherCells: string[]): string | null {
  const round = roundCell.trim().replace(/\s+(?:vs?\.?|versus)\s+.*$/i, "").trim();
  if (round && FINALS_PHRASE.test(round)) return round.replace(/\s+/g, " ");
  for (const cell of otherCells) {
    const hit = cell.match(FINALS_PHRASE);
    if (hit) return titleCase(hit[0].replace(/\s+/g, " "));
  }
  return null;
}

/** Key used to detect a fixture that already exists (or repeats in the file). */
export function competitionFixtureKey(f: {
  scheduledAt: string | Date;
  homeId: string | null;
  awayId: string | null;
  venue?: string | null;
  pitch?: string | null;
  finalsLabel?: string | null;
}): string {
  const minute = Math.floor(new Date(f.scheduledAt).getTime() / 60000);
  const teams = [f.homeId ?? "tbd", f.awayId ?? "tbd"].sort().join("|");
  // Distinct finals ("Finals Match 1" vs "Finals Match 2") are separate games
  // even when teams/time/venue coincide, so the label is part of the key.
  const finals = f.finalsLabel ? `|f:${f.finalsLabel.trim().toLowerCase()}` : "";
  // When both teams are unknown, the venue/pitch is the only thing that tells games apart.
  const place = !f.homeId && !f.awayId
    ? `|${(f.venue ?? "").trim().toLowerCase()}|${(f.pitch ?? "").trim().toLowerCase()}`
    : "";
  return `${minute}|${teams}${finals}${place}`;
}

/** Competition fixture event whose opponent is still TBD (finals placeholder). */
export function isFinalsPlaceholderEvent(e: { type?: string | null; opponent?: string | null; competition_match_id?: string | null }): boolean {
  return e.type === "game" && !!e.competition_match_id && (e.opponent ?? "").trim().toUpperCase() === "TBD";
}
