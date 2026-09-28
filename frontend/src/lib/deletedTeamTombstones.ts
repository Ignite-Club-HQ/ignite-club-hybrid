/**
 * Deleted-team tombstones.
 *
 * When a team is soft-deleted, the authoritative server queries immediately
 * stop returning it (`.is("deleted_at", null)`), but every client-side cache
 * that was seeded *before* the delete still holds the row — most notably the
 * persisted inbox snapshot (`messagesPageCache`) used as react-query
 * `initialData`. That stale row repaints as a second, empty chat thread for the
 * same team name after the team is recreated.
 *
 * Tombstones give first paint a cheap, local source of truth: any team id
 * recorded here is never rendered again, no matter which cache produced it.
 *
 * Key uses the `ignite_` prefix so `clearUserScopedCaches()` sweeps it on
 * sign-out / cross-user sign-in.
 */

const KEY = "ignite_deleted_team_ids";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // matches the 30-day restore window

type Tombstones = Record<string, number>;

let mem: Tombstones | null = null;

function load(): Tombstones {
  if (mem) return mem;
  try {
    if (typeof localStorage === "undefined") return (mem = {});
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Tombstones) : {};
    const now = Date.now();
    const fresh: Tombstones = {};
    for (const [id, ts] of Object.entries(parsed || {})) {
      if (typeof ts === "number" && now - ts < TTL_MS) fresh[id] = ts;
    }
    mem = fresh;
  } catch {
    mem = {};
  }
  return mem;
}

function persist(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(KEY, JSON.stringify(mem ?? {}));
  } catch {
    /* best-effort */
  }
}

export function markTeamDeleted(teamId: string | null | undefined): void {
  if (!teamId) return;
  const store = load();
  store[teamId] = Date.now();
  persist();
}

/** Called when a team is restored so it can show up again. */
export function unmarkTeamDeleted(teamId: string | null | undefined): void {
  if (!teamId) return;
  const store = load();
  if (store[teamId] === undefined) return;
  delete store[teamId];
  persist();
}

export function isTeamDeletedLocally(teamId: string | null | undefined): boolean {
  if (!teamId) return false;
  return load()[teamId] !== undefined;
}

/** Drops any tombstoned team from a cached/fetched list. */
export function filterDeletedTeams<T extends { id: string }>(
  teams: T[] | null | undefined,
): T[] {
  if (!teams || teams.length === 0) return [];
  const store = load();
  return teams.filter((t) => store[t.id] === undefined);
}

export function clearDeletedTeamTombstones(): void {
  mem = {};
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
