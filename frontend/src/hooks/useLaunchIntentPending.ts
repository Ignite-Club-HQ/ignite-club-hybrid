import { useEffect, useState } from "react";
import {
  getLaunchIntentState,
  isLaunchIntentPending,
  subscribeLaunchIntent,
} from "@/lib/nativeLaunchIntent";

/**
 * True while the native launch intent (`App.getLaunchUrl()`) is still being
 * resolved. Routing must not redirect to generic `/auth` during this window,
 * otherwise a cold-start invite tap flashes the login screen.
 */
export function useLaunchIntentPending(): boolean {
  const [pending, setPending] = useState(() => isLaunchIntentPending());

  useEffect(() => {
    // Re-sync in case it settled between render and subscribe.
    setPending(isLaunchIntentPending());
    return subscribeLaunchIntent(() => {
      setPending(isLaunchIntentPending());
    });
  }, []);

  return pending;
}

export { getLaunchIntentState };
