// Persists a lightweight "does this user have any home-page sponsors" hint,
// scoped by (userId, activeClubFilter). Used so the home page can reserve
// the right amount of vertical space on cold load — preventing the sponsor
// tile from popping in later and pushing Next Up / Rewards / Teams down.
//
// Values:
//   "has"  → user has at least one sponsor to render → reserve full height
//   "none" → no sponsors → reserve nothing
//   null   → unknown (first visit) → reserve conservative height

export type HomeSponsorHint = "has" | "none";

const PREFIX = "ignite_home_sponsor_";

const key = (userId: string | undefined, clubFilter: string | null | undefined) =>
  `${PREFIX}${userId || "anon"}_${clubFilter || "all"}`;

export function readHomeSponsorHint(
  userId: string | undefined,
  clubFilter: string | null | undefined,
): HomeSponsorHint | null {
  try {
    const raw = localStorage.getItem(key(userId, clubFilter));
    if (raw === "has" || raw === "none") return raw;
    return null;
  } catch {
    return null;
  }
}

export function writeHomeSponsorHint(
  userId: string | undefined,
  clubFilter: string | null | undefined,
  hint: HomeSponsorHint,
): void {
  try {
    localStorage.setItem(key(userId, clubFilter), hint);
  } catch {
    /* noop */
  }
}
