// Lightweight localStorage snapshots for the Home page's async side sections
// (Club News, Club Info & Links). Mirrors nextUpEventsCache: cold opens paint
// the last known content immediately instead of appearing seconds later once
// the query resolves. Keyed per section + scope (club filter).

const PREFIX = "ignite_home_section_";
const TTL_MS = 24 * 60 * 60 * 1000;

interface Entry<T> {
  data: T;
  timestamp: number;
}

const key = (section: string, scope: string | null | undefined) =>
  `${PREFIX}${section}_${scope || "all"}`;

export function readHomeSectionSnapshot<T>(
  section: string,
  scope: string | null | undefined,
): T | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key(section, scope));
    if (!raw) return null;
    const entry: Entry<T> = JSON.parse(raw);
    if (Date.now() - entry.timestamp > TTL_MS) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export function writeHomeSectionSnapshot<T>(
  section: string,
  scope: string | null | undefined,
  data: T,
): void {
  try {
    if (typeof localStorage === "undefined") return;
    const entry: Entry<T> = { data, timestamp: Date.now() };
    localStorage.setItem(key(section, scope), JSON.stringify(entry));
  } catch {
    /* quota or unavailable — ignore */
  }
}

/**
 * Drop every home-section snapshot (all sections/scopes). Called after
 * club/team create/delete/restore so a tombstoned club's news or links can't
 * repaint from the last-known-good snapshot on the next cold open.
 */
export function clearHomeSectionSnapshots(): void {
  try {
    if (typeof localStorage === "undefined") return;
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch {
    // storage unavailable — ignore
  }
}
