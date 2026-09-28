// Persists a lightweight "does this user see content in a given header strip"
// hint per (strip, user, club) tuple. Used to decide whether to reserve
// vertical space on cold load before the strip's async queries resolve —
// eliminates the ~40px content jump on Schedule / Media pages when the
// sponsor/ad strip finally mounts.
//
// Values:
//   true  → user previously saw a strip here → reserve space on next cold load
//   false → resolved with no content → don't reserve (no jump anyway)
//   null  → unknown (first ever visit)

const PREFIX = "ignite_strip_hint_";

const key = (strip: string, userId: string | undefined, clubId: string | null | undefined) =>
  `${PREFIX}${strip}_${userId || "anon"}_${clubId || "none"}`;

export function readStripHint(
  strip: string,
  userId: string | undefined,
  clubId: string | null | undefined,
): boolean | null {
  try {
    const raw = localStorage.getItem(key(strip, userId, clubId));
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * Fallback read used when the caller doesn't know the resolved club yet
 * (e.g. Schedule page header strip with no active club filter — the strip
 * resolves the club asynchronously, so a clubId-keyed read would always
 * miss and force a space reservation that later collapses, causing the
 * content-below jump). Scans all hints for this (strip, user) pair and
 * returns the first match. Users effectively have one strip club, so any
 * hit is the right answer; a `true` hit wins over `false` since reserving
 * space for content that appears is the safe direction.
 */
export function readAnyStripHint(
  strip: string,
  userId: string | undefined,
): boolean | null {
  try {
    const prefix = `${PREFIX}${strip}_${userId || "anon"}_`;
    let sawFalse = false;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const raw = localStorage.getItem(k);
      if (raw === "1") return true;
      if (raw === "0") sawFalse = true;
    }
    return sawFalse ? false : null;
  } catch {
    return null;
  }
}

export function writeStripHint(
  strip: string,
  userId: string | undefined,
  clubId: string | null | undefined,
  hasContent: boolean,
): void {
  try {
    localStorage.setItem(key(strip, userId, clubId), hasContent ? "1" : "0");
  } catch {
    /* noop */
  }
}
