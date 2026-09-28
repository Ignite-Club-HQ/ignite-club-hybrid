import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMessagesPageBootstrap } from "@/hooks/useMessagesPageBootstrap";

/**
 * Mount once at the app shell so the messages-page bootstrap RPC is in the
 * react-query cache by the time the user navigates to /messages. Same query
 * key as MessagesPage, so react-query dedupes — zero extra round trips.
 * Honours the same `?bootstrap=off` kill switch.
 *
 * Gated behind requestIdleCallback (setTimeout 400ms fallback) so the RPC
 * fires after the current route's first paint instead of racing HomePage's
 * queries during initial mount.
 */
export function MessagesBootstrapPrefetcher() {
  const { user, initialized } = useAuth();
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (!initialized || !user?.id) return;
    const w = window as any;
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;
    const run = () => setIdle(true);
    if (typeof w.requestIdleCallback === "function") {
      idleHandle = w.requestIdleCallback(run, { timeout: 2000 });
    } else {
      timeoutHandle = window.setTimeout(run, 400);
    }
    return () => {
      if (idleHandle != null && typeof w.cancelIdleCallback === "function") {
        w.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle != null) window.clearTimeout(timeoutHandle);
    };
  }, [initialized, user?.id]);

  useMessagesPageBootstrap(user?.id, initialized && idle);
  return null;
}
