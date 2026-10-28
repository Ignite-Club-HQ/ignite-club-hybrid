import { useEffect } from "react";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { withFeatureBackend } from "@/live/featureRouter";
import { withReadDeadline } from "@/live/readDeadline";

/** Warm authorized rosters, not decrypted names, without delaying Home. */
export function useHomeClubMembers(accountId: string | undefined, clubIds: string[] | undefined, activeClubId: string | null) {
  const clubsKey = JSON.stringify([...new Set(clubIds?.filter(Boolean) ?? [])].sort());
  useEffect(() => {
    if (!accountId || !isFeatureRoutedToIcp("membership")) return;
    const ids: string[] = JSON.parse(clubsKey);
    if (activeClubId && !ids.includes(activeClubId)) ids.unshift(activeClubId);
    else if (activeClubId) ids.sort((a, b) => Number(b === activeClubId) - Number(a === activeClubId));
    if (!ids.length) return;
    let retired = false;
    let running = false;
    const warm = async () => {
      if (retired || running || !isFeatureRoutedToIcp("membership")) return;
      running = true;
      try {
        const { fetchLiveMessagingCandidates } = await import("@/live/messagingCandidates");
        let next = 0;
        const worker = async () => {
          while (!retired && next < ids.length) {
            const clubId = ids[next++];
            try {
              await withReadDeadline(withFeatureBackend("membership", {
                supabase: async () => [],
                icp: ctx => retired ? [] : fetchLiveMessagingCandidates(ctx, [clubId]),
              }, { clubId }), "Club member warm-up", 20_000);
            } catch { /* Failed warms never become an empty roster; pickers can retry. */ }
          }
        };
        await Promise.all([worker(), worker()]);
      } finally { running = false; }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void warm(); };
    void warm();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      retired = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [accountId, clubsKey, activeClubId]);
}