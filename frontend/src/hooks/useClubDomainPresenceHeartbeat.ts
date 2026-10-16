import { useEffect } from "react";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { getCurrentInternetIdentity } from "@/live/internetIdentityAuth";
import { getActiveIcpTarget } from "@/live/targetRegistry";

// Entry-chunk rule: this hook runs app-wide (mounted from AppLayout), so
// live/features/club (and the ICP SDK it pulls in) is imported lazily at the
// beat call site instead of statically here.

const HEARTBEAT_INTERVAL_MS = 60 * 1000;

/**
 * Best-effort "I'm online" ping to club_domain.record_presence_heartbeat
 * while the account is signed in via Internet Identity and the "membership"
 * feature (club_domain) is ICP-routed. Powers the admin Online Users page's
 * list_online_presence read. Never throws — a missed beat just means this
 * user briefly drops out of the roster window.
 */
export function useClubDomainPresenceHeartbeat(userId: string | null | undefined) {
  useEffect(() => {
    if (!userId) return;
    if (!isFeatureRoutedToIcp("membership")) return;

    let cancelled = false;
    const beat = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const identity = await getCurrentInternetIdentity();
        if (!identity || cancelled) return;
        const { recordLiveClubPresenceHeartbeat } = await import("@/live/features/club");
        await recordLiveClubPresenceHeartbeat({ identity, target: getActiveIcpTarget() });
      } catch {
        // Silently fail — presence heartbeat is non-critical.
      }
    };

    beat();
    const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId]);
}
