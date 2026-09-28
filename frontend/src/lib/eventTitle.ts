interface EventTitleInput {
  title: string;
  type?: string | null;
  opponent?: string | null;
  clubs?: { name?: string | null } | null;
}

const MATCHUP_SEPARATOR_RE = /\s+(?:v|vs|versus)\.?\s+/i;

function normalizeForMatch(value?: string | null): string {
  return (value || "")
    .toLowerCase()
    .replace(/\b(football club|soccer club|fc|sc|club)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasName(value: string, name?: string | null): boolean {
  const normalizedValue = normalizeForMatch(value);
  const normalizedName = normalizeForMatch(name);
  return !!normalizedName && (
    normalizedValue.includes(normalizedName) || normalizedName.includes(normalizedValue)
  );
}

function prefixBeforeImportedMatchup(title: string): string {
  const prefixed = title.match(/^(.*?\s[-–—]\s)(.+)$/);
  if (prefixed?.[2] && MATCHUP_SEPARATOR_RE.test(prefixed[2])) {
    return prefixed[1];
  }
  return "";
}

export function formatEventTitle(event: EventTitleInput): string {
  const title = event.title || "Event";
  const opponent = event.opponent?.trim();

  if (event.type !== "game" || !opponent) {
    return title;
  }

  const titleHasOpponent = hasName(title, opponent);
  const titleHasClub = hasName(title, event.clubs?.name);
  const titleHasMatchup = MATCHUP_SEPARATOR_RE.test(title);

  if (event.clubs?.name && titleHasClub && titleHasOpponent && titleHasMatchup) {
    return `${prefixBeforeImportedMatchup(title)}${event.clubs.name} V ${opponent}`;
  }

  if (titleHasOpponent || titleHasMatchup) {
    return title;
  }

  return `${title} vs ${opponent}`;
}

/**
 * Returns true when the title does NOT already include the opponent or a
 * matchup separator (v/vs/versus), meaning it's safe to render a separate
 * " vs {opponent}" suffix (often styled as muted text).
 */
export function shouldAppendOpponent(event: EventTitleInput): boolean {
  const title = event.title || "";
  const opponent = event.opponent?.trim();
  if (event.type !== "game" || !opponent) return false;
  if (MATCHUP_SEPARATOR_RE.test(title)) return false;
  if (hasName(title, opponent)) return false;
  return true;
}