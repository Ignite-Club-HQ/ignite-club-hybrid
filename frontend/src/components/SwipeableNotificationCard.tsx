import { useRef, useState, useCallback } from "react";
import { Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SwipeableNotificationCardProps {
  children: React.ReactNode;
  onDelete: () => void;
  onClick: () => void;
  className?: string;
}

export function SwipeableNotificationCard({
  children,
  onDelete,
  onClick,
  className,
}: SwipeableNotificationCardProps) {
  const [swipeX, setSwipeX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const isHorizontalSwipe = useRef<boolean | null>(null);
  const DELETE_THRESHOLD = -80;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    isHorizontalSwipe.current = null;
    setIsSwiping(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isSwiping) return;

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = currentX - startX.current;
    const diffY = currentY - startY.current;

    // Determine swipe direction on first significant move
    if (isHorizontalSwipe.current === null) {
      if (Math.abs(diffX) > 10 || Math.abs(diffY) > 10) {
        isHorizontalSwipe.current = Math.abs(diffX) > Math.abs(diffY);
      }
    }

    // Only handle horizontal swipes (left swipe for delete)
    if (isHorizontalSwipe.current && diffX < 0) {
      e.stopPropagation();
      setSwipeX(Math.max(diffX, DELETE_THRESHOLD * 1.5));
    }
  }, [isSwiping]);

  const handleTouchEnd = useCallback(() => {
    if (swipeX <= DELETE_THRESHOLD) {
      onDelete();
    }
    setSwipeX(0);
    setIsSwiping(false);
    isHorizontalSwipe.current = null;
  }, [swipeX, onDelete]);

  const handleClick = useCallback(() => {
    if (Math.abs(swipeX) < 10) {
      onClick();
    }
  }, [swipeX, onClick]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDelete();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  }, [onDelete, onClick]);

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* Delete background */}
      <div 
        className="absolute inset-y-0 right-0 flex items-center justify-end bg-destructive px-4"
        style={{ 
          width: Math.abs(Math.min(swipeX, 0)) + 60,
          opacity: Math.min(Math.abs(swipeX) / Math.abs(DELETE_THRESHOLD), 1)
        }}
        aria-hidden="true"
      >
        <Trash2 className="h-5 w-5 text-destructive-foreground" />
      </div>
      
      {/* Card content */}
      <Card
        className={cn(
          "cursor-pointer transition-transform relative bg-card",
          !isSwiping && "transition-all duration-200",
          className
        )}
        style={{ transform: `translateX(${swipeX}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-label="Notification. Press Enter to view, Delete to remove."
      >
        <CardContent className="p-4">
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
