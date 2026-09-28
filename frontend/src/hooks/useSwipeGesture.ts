import { useRef, useCallback, TouchEvent } from "react";

interface SwipeHandlers {
  onTouchStart: (e: TouchEvent) => void;
  onTouchMove: (e: TouchEvent) => void;
  onTouchEnd: () => void;
}

interface UseSwipeGestureOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  threshold?: number;
}

export function useSwipeGesture({
  onSwipeLeft,
  onSwipeRight,
  threshold = 50, // Increased threshold for more intentional swipes
}: UseSwipeGestureOptions): SwipeHandlers {
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const touchCurrentX = useRef<number | null>(null);
  const swipeDetected = useRef<boolean>(false);

  const onTouchStart = useCallback((e: TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    touchCurrentX.current = e.touches[0].clientX;
    swipeDetected.current = false;
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    touchCurrentX.current = currentX;
    
    const deltaX = currentX - touchStartX.current;
    const deltaY = Math.abs(currentY - touchStartY.current);
    
    // Only treat as swipe if horizontal movement is dominant and significant
    if (Math.abs(deltaX) > 20 && Math.abs(deltaX) > deltaY * 1.5) {
      swipeDetected.current = true;
      // Prevent vertical scrolling when swiping horizontally
      e.preventDefault();
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    if (touchStartX.current === null || touchCurrentX.current === null) {
      touchStartX.current = null;
      touchCurrentX.current = null;
      touchStartY.current = null;
      swipeDetected.current = false;
      return;
    }
    
    if (!swipeDetected.current) {
      touchStartX.current = null;
      touchCurrentX.current = null;
      touchStartY.current = null;
      swipeDetected.current = false;
      return;
    }
    
    const distance = touchStartX.current - touchCurrentX.current;
    const isLeftSwipe = distance > threshold;
    const isRightSwipe = distance < -threshold;
    
    if (isLeftSwipe && onSwipeLeft) {
      onSwipeLeft();
    }
    if (isRightSwipe && onSwipeRight) {
      onSwipeRight();
    }
    
    touchStartX.current = null;
    touchCurrentX.current = null;
    touchStartY.current = null;
    swipeDetected.current = false;
  }, [threshold, onSwipeLeft, onSwipeRight]);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };
}
