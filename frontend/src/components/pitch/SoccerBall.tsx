import { cn } from "@/lib/utils";

interface SoccerBallProps {
  size?: number;
  className?: string;
  isDragging?: boolean;
  style?: React.CSSProperties;
  draggable?: boolean;
  onDragStart?: () => void;
  onDrag?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
  onTouchStart?: (e: React.TouchEvent) => void;
  onTouchMove?: (e: React.TouchEvent) => void;
  onTouchEnd?: () => void;
  readOnly?: boolean;
}

export default function SoccerBall({
  size = 24,
  className,
  isDragging,
  style,
  readOnly = false,
  draggable,
  onDragStart,
  onDrag,
  onDragEnd,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
}: SoccerBallProps) {
  // Enlarge touch target to 48px minimum while keeping visual ball at `size`
  const touchTarget = Math.max(size, 48);
  const padding = (touchTarget - size) / 2;

  return (
    <div
      draggable={readOnly ? false : draggable}
      onDragStart={readOnly ? undefined : onDragStart}
      onDrag={readOnly ? undefined : onDrag}
      onDragEnd={readOnly ? undefined : onDragEnd}
      onTouchStart={readOnly ? undefined : onTouchStart}
      onTouchMove={readOnly ? undefined : onTouchMove}
      onTouchEnd={readOnly ? undefined : onTouchEnd}
      className={cn(
        "flex items-center justify-center",
        !readOnly && "cursor-grab active:cursor-grabbing",
        readOnly && "cursor-default",
        isDragging && "opacity-70 scale-110",
        className
      )}
      style={{
        width: touchTarget,
        height: touchTarget,
        padding,
        touchAction: "none",
        ...style,
      }}
    >
      <span 
        role="img" 
        aria-label="soccer ball" 
        style={{ 
          fontSize: size,
          lineHeight: 1,
          filter: "drop-shadow(1px 2px 2px rgba(0,0,0,0.3))" 
        }}
      >
        ⚽
      </span>
    </div>
  );
}
