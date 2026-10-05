import { useEffect, useRef, useState } from "react";
import { subscribePendingIcpUpdateCalls } from "@/live/pendingCalls";

/** Wait this long before showing, so fast calls never flash the bar. */
const SHOW_DELAY_MS = 200;
/** Once shown, stay up at least this long so the bar doesn't strobe. */
const MIN_VISIBLE_MS = 500;

/**
 * Slim indeterminate progress bar pinned to the very top of the viewport,
 * visible while any ICP canister UPDATE call is in flight. Canister writes
 * take ~2–5s on mainnet and most ICP-mode buttons have no per-button pending
 * state, so this is the universal "your tap registered — saving" signal.
 * Query calls (chat polling etc.) never trigger it. pointer-events:none, so
 * it never blocks interaction.
 */
export function IcpPendingBar() {
  const [visible, setVisible] = useState(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAtRef = useRef(0);

  useEffect(() => {
    const unsubscribe = subscribePendingIcpUpdateCalls((pending) => {
      if (pending > 0) {
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        if (showTimerRef.current || shownAtRef.current > 0) return;
        showTimerRef.current = setTimeout(() => {
          showTimerRef.current = null;
          shownAtRef.current = Date.now();
          setVisible(true);
        }, SHOW_DELAY_MS);
        return;
      }
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
      if (shownAtRef.current === 0) return;
      const hide = () => {
        shownAtRef.current = 0;
        hideTimerRef.current = null;
        setVisible(false);
      };
      const elapsed = Date.now() - shownAtRef.current;
      if (elapsed >= MIN_VISIBLE_MS) hide();
      else hideTimerRef.current = setTimeout(hide, MIN_VISIBLE_MS - elapsed);
    });
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      unsubscribe();
    };
  }, []);

  if (!visible) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[1000002] h-[3px] overflow-hidden"
    >
      <div className="icp-pending-bar h-full w-2/5 bg-primary" />
    </div>
  );
}
