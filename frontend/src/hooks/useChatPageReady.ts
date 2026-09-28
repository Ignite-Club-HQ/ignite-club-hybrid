import { useEffect, useState } from "react";

/**
 * Returns false on first render and flips to true once the chat page has
 * had a chance to paint and become interactive. Used to gate non-critical
 * chat-page queries (pinned vault, pinned messages, club pro, online count,
 * shared media, etc.) so they don't compete with the first messages fetch
 * and visual-settle window — critical for fast notification-tap rendering.
 *
 * Strategy: two rAFs (one full paint) + requestIdleCallback (or a 250ms
 * fallback). This keeps the critical path tight without indefinitely
 * blocking the secondary queries.
 */
export function useChatPageReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let idleHandle: number | undefined;
    let timeoutHandle: number | undefined;
    let raf2: number | undefined;

    const fire = () => {
      if (cancelled) return;
      setReady(true);
    };

    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        const w = window as any;
        if (typeof w.requestIdleCallback === "function") {
          idleHandle = w.requestIdleCallback(fire, { timeout: 600 });
        } else {
          timeoutHandle = window.setTimeout(fire, 250);
        }
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      if (typeof raf2 === "number") cancelAnimationFrame(raf2);
      const w = window as any;
      if (idleHandle != null && typeof w.cancelIdleCallback === "function") {
        w.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle != null) clearTimeout(timeoutHandle);
    };
  }, []);

  return ready;
}
