import { useCallback, useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import { hapticImpactMedium } from "@/lib/haptics";

interface UsePitchBoardBenchLongPressArgs {
  readOnly: boolean;
  subMode: boolean;
  swapMode: boolean;
  setBenchToSubPlayer: (playerId: string | null) => void;
  setBenchToSubOpen: (open: boolean) => void;
  setPortraitSheetOpen: (open: boolean) => void;
  setToolbarCollapsed: (collapsed: boolean) => void;
}

export function usePitchBoardBenchLongPress({
  readOnly,
  subMode,
  swapMode,
  setBenchToSubPlayer,
  setBenchToSubOpen,
  setPortraitSheetOpen,
  setToolbarCollapsed,
}: UsePitchBoardBenchLongPressArgs) {
  const [benchDragPlayer, setBenchDragPlayer] = useState<string | null>(null);
  const [benchDragPos, setBenchDragPos] = useState<{ x: number; y: number } | null>(null);
  const benchLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const benchDragStartTouch = useRef<{ x: number; y: number } | null>(null);

  const handleBenchLongPressStart = useCallback(
    (playerId: string, event: ReactTouchEvent) => {
      if (readOnly || subMode || swapMode) return;
      const touch = event.touches[0];
      benchDragStartTouch.current = { x: touch.clientX, y: touch.clientY };
      benchLongPressTimer.current = setTimeout(() => {
        setBenchDragPlayer(playerId);
        setBenchDragPos({ x: touch.clientX, y: touch.clientY });
        hapticImpactMedium();
      }, 400);
    },
    [readOnly, subMode, swapMode],
  );

  const handleBenchLongPressMove = useCallback(
    (event: ReactTouchEvent) => {
      const touch = event.touches[0];
      if (benchLongPressTimer.current && benchDragStartTouch.current) {
        const dx = touch.clientX - benchDragStartTouch.current.x;
        const dy = touch.clientY - benchDragStartTouch.current.y;
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
          clearTimeout(benchLongPressTimer.current);
          benchLongPressTimer.current = null;
        }
      }
      if (benchDragPlayer) {
        event.preventDefault();
        setBenchDragPos({ x: touch.clientX, y: touch.clientY });
      }
    },
    [benchDragPlayer],
  );

  const handleBenchLongPressEnd = useCallback(() => {
    if (benchLongPressTimer.current) {
      clearTimeout(benchLongPressTimer.current);
      benchLongPressTimer.current = null;
    }
    if (benchDragPlayer && benchDragPos) {
      const pitchElement =
        document.getElementById("portrait-pitch-area") ??
        document.getElementById("landscape-pitch-area");
      if (pitchElement) {
        const rect = pitchElement.getBoundingClientRect();
        const isOnPitch =
          benchDragPos.x >= rect.left &&
          benchDragPos.x <= rect.right &&
          benchDragPos.y >= rect.top &&
          benchDragPos.y <= rect.bottom;
        const elementAtPoint = document.elementFromPoint(benchDragPos.x, benchDragPos.y);
        const isOnDrawer =
          elementAtPoint?.closest("#pitch-bench-portrait") ||
          elementAtPoint?.closest("#pitch-bench-landscape") ||
          elementAtPoint?.closest("[data-portrait-drawer]");

        if (isOnPitch && !isOnDrawer) {
          setBenchToSubPlayer(benchDragPlayer);
          setBenchToSubOpen(true);
          setPortraitSheetOpen(false);
          setToolbarCollapsed(true);
        }
      }
    }
    setBenchDragPlayer(null);
    setBenchDragPos(null);
    benchDragStartTouch.current = null;
  }, [
    benchDragPlayer,
    benchDragPos,
    setBenchToSubOpen,
    setBenchToSubPlayer,
    setPortraitSheetOpen,
    setToolbarCollapsed,
  ]);

  useEffect(() => {
    if (!benchDragPlayer) return;
    const onMove = (event: TouchEvent) => {
      event.preventDefault();
      const touch = event.touches[0];
      setBenchDragPos({ x: touch.clientX, y: touch.clientY });
    };
    const onEnd = () => {
      handleBenchLongPressEnd();
    };
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [benchDragPlayer, handleBenchLongPressEnd]);

  return {
    benchDragPlayer,
    benchDragPos,
    benchLongPressTimer,
    handleBenchLongPressStart,
    handleBenchLongPressMove,
    handleBenchLongPressEnd,
  };
}
