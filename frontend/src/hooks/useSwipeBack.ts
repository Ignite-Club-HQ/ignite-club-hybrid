import { useRef, useCallback, TouchEvent } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Swipe-from-left-edge gesture to navigate back to messages list.
 * Only triggers when the touch starts within 30px of the left edge.
 */
export function useSwipeBack(to = "/messages") {
  const navigate = useNavigate();
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const isEdgeSwipe = useRef(false);

  const onTouchStart = useCallback((e: TouchEvent) => {
    const x = e.touches[0].clientX;
    // Only activate for touches starting within 30px of the left edge
    if (x <= 30) {
      touchStartX.current = x;
      touchStartY.current = e.touches[0].clientY;
      isEdgeSwipe.current = true;
    } else {
      isEdgeSwipe.current = false;
    }
  }, []);

  const onTouchEnd = useCallback((e: TouchEvent) => {
    if (!isEdgeSwipe.current || touchStartX.current === null || touchStartY.current === null) {
      touchStartX.current = null;
      touchStartY.current = null;
      isEdgeSwipe.current = false;
      return;
    }

    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const deltaX = endX - touchStartX.current;
    const deltaY = Math.abs(endY - touchStartY.current);

    // Require horizontal movement > 80px and predominantly horizontal
    if (deltaX > 80 && deltaX > deltaY * 2) {
      navigate(to);
    }

    touchStartX.current = null;
    touchStartY.current = null;
    isEdgeSwipe.current = false;
  }, [navigate, to]);

  return { onTouchStart, onTouchEnd };
}
