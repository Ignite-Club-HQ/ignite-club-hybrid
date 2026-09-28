import { useEffect, useRef, useState } from "react";
import { hydrateEventLineupToLocal } from "../eventLineupRepository";

/**
 * Pulls the durable per-event lineup (`event_lineups`) into localStorage BEFORE
 * the pitch board reads its initial state, so a lineup planned on one device
 * shows up on another.
 *
 * Returns `ready` — the board must not mount until this flips true, otherwise
 * its synchronous localStorage init would race the fetch.
 */
export function useEventLineupHydration(
  eventId: string | null | undefined,
  teamId: string | null | undefined,
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled !== false;
  const shouldHydrate = enabled && !!eventId && !!teamId;
  const [ready, setReady] = useState(!shouldHydrate);
  const [hydratedFromDb, setHydratedFromDb] = useState(false);
  const doneKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!shouldHydrate) {
      setReady(true);
      return;
    }
    const key = `${eventId}:${teamId}`;
    if (doneKeyRef.current === key) return;
    doneKeyRef.current = key;

    let cancelled = false;
    setReady(false);

    // Fail-safe: never block the board for more than 2.5s on a slow network.
    const failSafe = setTimeout(() => {
      if (!cancelled) setReady(true);
    }, 2500);

    hydrateEventLineupToLocal(eventId!, teamId!)
      .then((adopted) => {
        if (cancelled) return;
        if (adopted) setHydratedFromDb(true);
      })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        clearTimeout(failSafe);
        setReady(true);
      });

    return () => {
      cancelled = true;
      clearTimeout(failSafe);
    };
  }, [shouldHydrate, eventId, teamId]);

  return { ready, hydratedFromDb };
}
