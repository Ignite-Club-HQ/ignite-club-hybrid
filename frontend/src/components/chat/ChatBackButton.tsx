import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useCallback, useRef } from "react";

interface ChatBackButtonProps {
  to?: string;
  label?: string;
}

/**
 * Reliability notes:
 * - Some users reported having to tap Back several times. Two common causes:
 *   (1) a transient overlay (attachment menu, emoji panel, keyboard inset
 *       animation) was eating the first tap, and (2) `preventDefault()` on
 *       the synthetic click was interfering with Android WebView's tap
 *       resolution after a scroll/momentum gesture.
 * - Fix: react to both `pointerup` and `click` with an idempotent guard so
 *   whichever event fires first wins; never call `preventDefault()` on the
 *   click (we don't want to suppress the OS default); blur any focused input
 *   first so the keyboard tear-down doesn't race the route change.
 */
export function ChatBackButton({ to = "/messages", label = "Messages" }: ChatBackButtonProps) {
  const navigate = useNavigate();
  const firedRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  const go = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    // Reset shortly after so a remounted instance still works.
    setTimeout(() => {
      firedRef.current = false;
    }, 600);

    // Close keyboard / clear focus to avoid viewport jank racing the
    // route transition.
    const active = document.activeElement as HTMLElement | null;
    if (active && typeof active.blur === "function") active.blur();

    navigate(to);
  }, [navigate, to]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const start = pointerStartRef.current;
      pointerStartRef.current = null;
      // Only count as a tap if movement was small (not a scroll).
      if (start) {
        const dx = Math.abs(e.clientX - start.x);
        const dy = Math.abs(e.clientY - start.y);
        if (dx > 16 || dy > 16) return;
      }
      go();
    },
    [go],
  );

  const handleClick = useCallback(() => {
    // Click is the backup path (keyboard activation, or if pointerup never
    // fired). Idempotent via firedRef.
    go();
  }, [go]);

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
      className="relative z-10 flex items-center justify-center h-12 w-12 -ml-1 rounded-lg text-foreground active:bg-muted/60 transition-colors shrink-0 touch-manipulation select-none"
      style={{ WebkitTapHighlightColor: "transparent" }}
      aria-label={`Back to ${label}`}
    >
      <ArrowLeft className="h-5 w-5 pointer-events-none" />
    </button>
  );
}
