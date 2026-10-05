import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { noteIcpNavigation } from "@/live/pendingCalls";

/**
 * Marks every route change (and the initial mount) as a navigation in the
 * ICP pending-call tracker, so the canister reads that load the freshly
 * opened page drive the top progress bar. Must render inside the router.
 */
export function IcpNavActivityTracker() {
  const location = useLocation();
  useEffect(() => {
    noteIcpNavigation();
  }, [location.key]);
  return null;
}
