import { useRef, useState, useCallback, type ReactNode } from "react";

interface SwipeAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  className?: string;
}

interface SwipeableRowProps {
  children: ReactNode;
  actions: SwipeAction[];
  /** Width of the revealed actions area in px (default: 140) */
  actionsWidth?: number;
  /** Whether swiping is enabled (default: true) */
  enabled?: boolean;
}

/**
 * Wrap any row element to add swipe-left-to-reveal actions (iOS-style).
 * Uses touch events with a movement threshold to avoid conflicts with scrolling.
 */
export function SwipeableRow({
  children,
  actions,
  actionsWidth = 140,
  enabled = true,
}: SwipeableRowProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const touchRef = useRef<{
    startX: number;
    startY: number;
    currentX: number;
    swiping: boolean;
    locked: boolean; // true once we decide scroll vs swipe
  } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;
    const touch = e.touches[0];
    touchRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      swiping: false,
      locked: false,
    };
  }, [enabled]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const ref = touchRef.current;
    if (!ref || !enabled) return;

    const touch = e.touches[0];
    const deltaX = touch.clientX - ref.startX;
    const deltaY = touch.clientY - ref.startY;

    // Decide direction once movement exceeds threshold
    if (!ref.locked) {
      const absDx = Math.abs(deltaX);
      const absDy = Math.abs(deltaY);
      if (absDx < 8 && absDy < 8) return; // too small to decide
      ref.locked = true;
      ref.swiping = absDx > absDy; // horizontal wins
      if (!ref.swiping) return; // vertical → let scroll happen
    }

    if (!ref.swiping) return;

    // Prevent vertical scroll while swiping horizontally
    e.preventDefault();
    ref.currentX = touch.clientX;

    const base = isOpen ? -actionsWidth : 0;
    let newOffset = base + deltaX;
    // Clamp: don't over-swipe right of 0 or left beyond actionsWidth + overscroll
    newOffset = Math.min(0, Math.max(-actionsWidth - 30, newOffset));
    setOffsetX(newOffset);
  }, [enabled, isOpen, actionsWidth]);

  const handleTouchEnd = useCallback(() => {
    const ref = touchRef.current;
    if (!ref || !ref.swiping) {
      touchRef.current = null;
      return;
    }

    const deltaX = ref.currentX - ref.startX;
    const threshold = actionsWidth / 3;

    if (isOpen) {
      // If open and swiped right enough, close
      if (deltaX > threshold) {
        setOffsetX(0);
        setIsOpen(false);
      } else {
        setOffsetX(-actionsWidth);
        setIsOpen(true);
      }
    } else {
      // If closed and swiped left enough, open
      if (deltaX < -threshold) {
        setOffsetX(-actionsWidth);
        setIsOpen(true);
      } else {
        setOffsetX(0);
        setIsOpen(false);
      }
    }

    touchRef.current = null;
  }, [isOpen, actionsWidth]);

  const close = useCallback(() => {
    setOffsetX(0);
    setIsOpen(false);
  }, []);

  if (!enabled || actions.length === 0) {
    return <>{children}</>;
  }

  const showActions = isOpen || offsetX < 0;

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* Actions behind the row - only rendered when swiping or open */}
      {showActions && (
        <div
          className="absolute right-0 top-0 bottom-0 flex items-stretch z-0"
          style={{ width: actionsWidth }}
        >
          {actions.map((action, i) => (
            <button
              key={i}
              className={`flex-1 flex flex-col items-center justify-center gap-1 text-xs font-medium transition-colors ${
                action.className || "bg-destructive text-destructive-foreground"
              }`}
              onClick={() => {
                action.onClick();
                close();
              }}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* Sliding content */}
      <div
        className="relative z-10 bg-background"
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: touchRef.current?.swiping ? "none" : "transform 0.25s ease-out",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={isOpen ? close : undefined}
      >
        {children}
      </div>
    </div>
  );
}
