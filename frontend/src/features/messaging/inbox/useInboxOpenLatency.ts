import { useEffect, useRef, type MutableRefObject } from "react";
import { isMessagesBootstrapEnabled } from "@/hooks/useMessagesPageBootstrap";
import { snapshotStages } from "@/lib/coldStartMarks";
import { logInboxOpenLatency } from "@/lib/inboxOpenLatency";

interface UseInboxOpenLatencyOptions {
  userId?: string;
  hasCachedData: boolean;
  hasRows: boolean;
  sourceQueriesFetched: boolean;
  inboxOpenStartTs: number;
  inboxMountTs: number | null;
  inboxBootstrapReturnTs: number | null;
  inboxFirstPaintTsRef: MutableRefObject<number | null>;
  primaryClubId?: string | null;
  sectionCounts: {
    teams: number;
    clubs: number;
    groups: number;
    dms: number;
    total: number;
  };
}

export function useInboxOpenLatency({
  userId,
  hasCachedData,
  hasRows,
  sourceQueriesFetched,
  inboxOpenStartTs,
  inboxMountTs,
  inboxBootstrapReturnTs,
  inboxFirstPaintTsRef,
  primaryClubId,
  sectionCounts,
}: UseInboxOpenLatencyOptions) {
  const loggedRef = useRef(false);

  useEffect(() => {
    if (loggedRef.current || !userId || (!hasRows && !sourceQueriesFetched)) return;
    loggedRef.current = true;

    let source: "warm_nav" | "cold_open" | "notification" =
      hasCachedData ? "warm_nav" : "cold_open";
    try {
      const stages = snapshotStages();
      if (
        typeof stages.deltas.notif_tap === "number"
        && typeof stages.deltas.inbox_mount === "number"
        && stages.deltas.inbox_mount >= stages.deltas.notif_tap
        && stages.deltas.inbox_mount - stages.deltas.notif_tap < 10_000
      ) {
        source = "notification";
      }
    } catch {
      // Best-effort attribution must never block inbox rendering.
    }

    if (inboxFirstPaintTsRef.current === null) {
      inboxFirstPaintTsRef.current = Date.now();
    }
    void logInboxOpenLatency({
      userId,
      source,
      startTs: inboxOpenStartTs,
      cacheHit: hasCachedData,
      bootstrapEnabled: isMessagesBootstrapEnabled(),
      mountTs: inboxMountTs,
      bootstrapReturnTs: inboxBootstrapReturnTs,
      firstPaintTs: inboxFirstPaintTsRef.current,
      primaryClubId,
      sectionCounts,
    });
  }, [
    userId,
    hasCachedData,
    hasRows,
    sourceQueriesFetched,
    inboxOpenStartTs,
    inboxMountTs,
    inboxBootstrapReturnTs,
    inboxFirstPaintTsRef,
    primaryClubId,
    sectionCounts,
  ]);
}
