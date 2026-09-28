import * as React from "react";
import { DropdownMenuContent } from "@/components/ui/dropdown-menu";

interface SwipeableDropdownContentProps
  extends React.ComponentPropsWithoutRef<typeof DropdownMenuContent> {
  onSwipeClose?: () => void;
  swipeThreshold?: number;
  velocityThreshold?: number;
}

export const SwipeableDropdownContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuContent>,
  SwipeableDropdownContentProps
>(({ onSwipeClose, swipeThreshold = 30, velocityThreshold = 0.3, children, ...props }, ref) => {
  const touchStartY = React.useRef<number | null>(null);
  const touchStartX = React.useRef<number | null>(null);
  const touchStartTime = React.useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchStartX.current = e.touches[0].clientX;
    touchStartTime.current = Date.now();
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current === null || touchStartX.current === null || touchStartTime.current === null) return;

    const deltaY = e.changedTouches[0].clientY - touchStartY.current;
    const deltaX = Math.abs(e.changedTouches[0].clientX - touchStartX.current);
    const deltaTime = Date.now() - touchStartTime.current;
    
    // Calculate velocity (pixels per millisecond) - negative for upward movement
    const velocity = deltaY / deltaTime;

    // Trigger close on fast upward flick (negative velocity = upward)
    const isUpwardFlick = velocity < -velocityThreshold && deltaY < -10 && Math.abs(deltaY) > deltaX;

    if (isUpwardFlick) {
      onSwipeClose?.();
    }

    touchStartY.current = null;
    touchStartX.current = null;
    touchStartTime.current = null;
  };

  return (
    <DropdownMenuContent
      ref={ref}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      {...props}
    >
      {/* Swipe indicator handle */}
      <div className="flex justify-center pt-1 pb-0 md:hidden">
        <div className="w-8 h-1 rounded-full bg-muted-foreground/30" />
      </div>
      {children}
    </DropdownMenuContent>
  );
});

SwipeableDropdownContent.displayName = "SwipeableDropdownContent";
