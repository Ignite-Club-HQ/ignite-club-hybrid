import { useState, useRef, useCallback, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SwipeAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  className?: string;
}

interface SwipeableCardProps {
  children: ReactNode;
  actions: SwipeAction[];
  className?: string;
  enabled?: boolean;
}

const ACTION_WIDTH = 64; // px per action button

export function SwipeableCard({ children, actions, className, enabled = true }: SwipeableCardProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const currentX = useRef(0);
  const isDragging = useRef(false);
  const isVertical = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const maxSwipe = actions.length * ACTION_WIDTH;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled || actions.length === 0) return;
    const touch = e.touches[0];
    startX.current = touch.clientX;
    startY.current = touch.clientY;
    currentX.current = isOpen ? -maxSwipe : 0;
    isDragging.current = false;
    isVertical.current = false;
  }, [enabled, actions.length, isOpen, maxSwipe]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!enabled || actions.length === 0) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - startX.current;
    const deltaY = touch.clientY - startY.current;

    // Determine direction on first significant movement
    if (!isDragging.current && !isVertical.current) {
      if (Math.abs(deltaY) > 8 && Math.abs(deltaY) > Math.abs(deltaX)) {
        isVertical.current = true;
        return;
      }
      if (Math.abs(deltaX) > 8) {
        isDragging.current = true;
      }
      return;
    }

    if (isVertical.current) return;

    const newOffset = currentX.current + deltaX;
    const clamped = Math.max(-maxSwipe, Math.min(0, newOffset));
    setOffsetX(clamped);
  }, [enabled, actions.length, maxSwipe]);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;

    // Snap open or closed based on threshold
    const threshold = maxSwipe * 0.35;
    if (Math.abs(offsetX) > threshold) {
      setOffsetX(-maxSwipe);
      setIsOpen(true);
    } else {
      setOffsetX(0);
      setIsOpen(false);
    }
  }, [offsetX, maxSwipe]);

  const close = useCallback(() => {
    setOffsetX(0);
    setIsOpen(false);
  }, []);

  if (!enabled || actions.length === 0) {
    return <Card className={className}>{children}</Card>;
  }

  return (
    <div ref={containerRef} className="relative overflow-hidden rounded-lg">
      {/* Action buttons behind the card */}
      <div
        className="absolute inset-y-0 right-0 flex items-stretch"
        style={{ width: maxSwipe }}
      >
        {actions.map((action, i) => (
          <button
            key={i}
            className={cn(
              "flex flex-col items-center justify-center gap-1 text-[10px] font-medium text-primary-foreground",
              action.className
            )}
            style={{ width: ACTION_WIDTH }}
            onClick={() => {
              action.onClick();
              close();
            }}
          >
            {action.icon}
            <span className="leading-tight">{action.label}</span>
          </button>
        ))}
      </div>

      {/* Foreground card */}
      <Card
        className={cn("relative transition-transform will-change-transform bg-card", className)}
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: isDragging.current ? "none" : "transform 200ms ease-out",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={isOpen ? close : undefined}
      >
        {children}
      </Card>
    </div>
  );
}
