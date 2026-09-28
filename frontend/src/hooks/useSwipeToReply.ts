import { useRef, useCallback, useState, useEffect } from "react";
import { hapticSelectionTick } from "@/lib/haptics";

// Global registry: when any message reveals reply, others dismiss
type ResetFn = () => void;
const activeResets = new Set<ResetFn>();

interface UseSwipeToReplyOptions {
  enabled?: boolean;
  threshold?: number;
  onReply?: () => void;
}

interface SwipeToReplyState {
  offsetX: number;
  isSwiping: boolean;
  pastThreshold: boolean;
}

export function useSwipeToReply({
  enabled = true,
  threshold = 100,
  onReply,
}: UseSwipeToReplyOptions) {
  const [swipeState, setSwipeState] = useState<SwipeToReplyState>({
    offsetX: 0,
    isSwiping: false,
    pastThreshold: false,
  });

  const resetReplyReveal = useCallback(() => {
    setSwipeState({ offsetX: 0, isSwiping: false, pastThreshold: false });
  }, []);

  useEffect(() => {
    activeResets.add(resetReplyReveal);
    return () => { activeResets.delete(resetReplyReveal); };
  }, [resetReplyReveal]);

  const touchRef = useRef<{
    startX: number;
    startY: number;
    currentX: number;
    locked: boolean;
    isSwiping: boolean;
  } | null>(null);

  const hapticFiredRef = useRef(false);
  const onReplyRef = useRef(onReply);
  onReplyRef.current = onReply;

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;
    const touch = e.touches[0];
    touchRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      locked: false,
      isSwiping: false,
    };
  }, [enabled]);

  /**
   * Force-activate the swipe gesture from the parent gesture coordinator.
   * Called when the parent's handleTouchMove determines this is a rightward swipe
   * (transitioning from "press" to "swipe" mode). This bypasses the hook's own
   * directionality check which can be stricter and reject valid swipes.
   */
  const forceActivate = useCallback((startX: number, startY: number) => {
    touchRef.current = {
      startX,
      startY,
      currentX: startX,
      locked: true,
      isSwiping: true,
    };
    hapticFiredRef.current = false;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const ref = touchRef.current;
    if (!enabled || !ref) return;

    const touch = e.touches[0];
    const rawDeltaX = touch.clientX - ref.startX;
    const deltaX = Math.max(0, rawDeltaX);
    const deltaY = Math.abs(touch.clientY - ref.startY);

    if (!ref.locked) {
      if (Math.abs(rawDeltaX) < 10 && deltaY < 10) return;
      ref.locked = true;
      // Only activate swipe for clearly rightward gestures
      ref.isSwiping = rawDeltaX > 10 && rawDeltaX > deltaY * 1.2;
      if (!ref.isSwiping) return;
      hapticFiredRef.current = false;
    }

    if (!ref.isSwiping) return;

    ref.currentX = touch.clientX;
    const offset = deltaX <= threshold ? deltaX : threshold + (deltaX - threshold) * 0.3;
    const past = deltaX >= threshold;

    // Haptic tick when crossing threshold
    if (past && !hapticFiredRef.current) {
      hapticFiredRef.current = true;
      hapticSelectionTick();
    }

    setSwipeState({ offsetX: offset, isSwiping: true, pastThreshold: past });
  }, [enabled, threshold]);

  const onTouchEnd = useCallback(() => {
    const ref = touchRef.current;

    if (!ref || !ref.isSwiping) {
      touchRef.current = null;
      return;
    }

    const deltaX = ref.currentX - ref.startX;
    const passedThreshold = deltaX >= threshold;
    hapticFiredRef.current = false;
    touchRef.current = null;

    if (passedThreshold) {
      // Keep bubble in place briefly so "Release to reply" is visible
      setSwipeState(s => ({ ...s, isSwiping: false }));
      onReplyRef.current?.();
      setTimeout(() => {
        setSwipeState({ offsetX: 0, isSwiping: false, pastThreshold: false });
      }, 200);
    } else {
      setSwipeState({ offsetX: 0, isSwiping: false, pastThreshold: false });
    }
  }, [threshold]);

  return {
    swipeState,
    swipeHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      forceActivate,
    },
    resetReplyReveal,
  };
}
