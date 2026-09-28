/**
 * One-time retroactive sweep for phantom (soft-deleted) teams.
 *
 * Existing installs may already hold a persisted inbox snapshot that was
 * seeded *before* a team was soft-deleted (and before tombstoning shipped).
 * The render-time filter hides those rows only if a tombstone exists, so this
 * sweep reconciles the cache against the server once per user per app version:
 * any cached team id whose row now has `deleted_at IS NOT NULL` (or no longer
 * readable at all is left alone — that could just be a permissions blip) is
 * tombstoned and purged from the snapshot.
 *
 * Cheap: one `in(...)` query over ids we already have locally, run once,
 * scheduled off the critical path.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  getCachedMessagesPageData,
  removeTeamFromMessagesPageCache,
} from "./messagesPageCache";
import { markTeamDeleted } from "./deletedTeamTombstones";

const SWEEP_VERSION = "v1";
const KEY_PREFIX = "ignite_deleted_team_sweep_"; // ignite_ => swept on sign-out

function sweepKey(userId: string): string {
  return `${KEY_PREFIX}${SWEEP_VERSION}_${userId}`;
}

function alreadySwept(userId: string): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(sweepKey(userId)) === "1";
  } catch {
    return true;
  }
}

function markSwept(userId: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(sweepKey(userId), "1");
  } catch {
    /* best-effort */
  }
}

async function runSweep(userId: string): Promise<void> {
  const cached = getCachedMessagesPageData(userId);
  const ids = Array.from(
    new Set((cached?.teams ?? []).map((t) => t?.id).filter(Boolean) as string[]),
  );
  if (ids.length === 0) {
    markSwept(userId);
    return;
  }

  // Chunk so a power user with many teams never sends an oversized filter.
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("teams")
      .select("id, deleted_at")
      .in("id", slice);

    // Any error (offline, RLS blip) => abort without marking swept so we retry
    // on a later app open instead of tombstoning on incomplete information.
    if (error) return;

    for (const row of data ?? []) {
      if (row?.deleted_at) {
        markTeamDeleted(row.id);
        removeTeamFromMessagesPageCache(userId, row.id);
      }
    }
  }

  markSwept(userId);
}

let inFlight = false;

/** Fire-and-forget; safe to call on every mount. */
export function sweepStaleDeletedTeams(userId: string | null | undefined): void {
  if (!userId || inFlight || alreadySwept(userId)) return;
  inFlight = true;
  const start = () => {
    void runSweep(userId).finally(() => {
      inFlight = false;
    });
  };
  const ric =
    typeof window !== "undefined"
      ? ((window as unknown as {
          requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
        }).requestIdleCallback)
      : undefined;
  if (ric) ric(start, { timeout: 4000 });
  else setTimeout(start, 1200);
}
