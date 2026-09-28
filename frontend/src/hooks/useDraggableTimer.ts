import { useRef, useState, useCallback } from "react";

interface DragStart {
  startX: number;
  startY: number;
  startPosX: number;
  startPosY: number;
}

interface PinchStart {
  startDist: number;
  startScale: number;
}

interface Position {
  x: number;
  y: number;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 2;
const MIN_X = -200;
const MIN_Y = -220;

function getPinchDist(touches: React.TouchList | TouchList): number {
  const t0 = touches[0];
  const t1 = touches[1];
  const dx = t1.clientX - t0.clientX;
  const dy = t1.clientY - t0.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function clampPosition(x: number, y: number): Position {
  return { x: Math.max(MIN_X, x), y: Math.max(MIN_Y, y) };
}

/**
 * Generic draggable + pinch-to-zoom logic for a floating HUD element.
 * Used for both landscape and portrait timer widgets.
 */
function useDraggableElement(
  defaultPosition: Position | null,
  defaultScale: number = 1,
  options?: { dragThreshold?: number }
) {
  const [position, setPosition] = useState<Position | null>(defaultPosition);
  const [scale, setScale] = useState(defaultScale);
  const dragRef = useRef<DragStart | null>(null);
  const pinchRef = useRef<PinchStart | null>(null);

  const handleMouseDragStart = useCallback((e: React.MouseEvent) => {
    const pos = position ?? { x: 8, y: 8 };
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: pos.x,
      startPosY: pos.y,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!dragRef.current) return;
      const deltaX = moveEvent.clientX - dragRef.current.startX;
      const deltaY = moveEvent.clientY - dragRef.current.startY;
      setPosition(clampPosition(dragRef.current.startPosX + deltaX, dragRef.current.startPosY + deltaY));
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [position]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Don't initiate drag if the touch target is inside an open dropdown
    const target = e.target as HTMLElement;
    if (target.closest('[data-timer-dropdown]')) return;

    const container = (e.currentTarget as HTMLElement).parentElement;

    // 2-finger pinch to resize
    if (e.touches.length === 2) {
      e.preventDefault();
      pinchRef.current = {
        startDist: getPinchDist(e.touches),
        startScale: scale,
      };
      dragRef.current = null;

      const handleTouchMove = (moveEvent: TouchEvent) => {
        if (!pinchRef.current || moveEvent.touches.length !== 2) return;
        moveEvent.preventDefault();
        const newDist = getPinchDist(moveEvent.touches);
        const ratio = newDist / pinchRef.current.startDist;
        setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchRef.current.startScale * ratio)));
      };

      const handleTouchEnd = () => {
        pinchRef.current = null;
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
      };

      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);
      return;
    }

    // 1-finger drag
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const threshold = options?.dragThreshold;

    // Compute current position (for portrait, fallback to container-based default)
    const rect = container?.getBoundingClientRect();
    const currentX = position?.x ?? (rect ? rect.width - (e.currentTarget as HTMLElement).offsetWidth - 8 : 8);
    const currentY = position?.y ?? 8;
    const startX = touch.clientX;
    const startY = touch.clientY;

    if (threshold != null) {
      // Threshold-based drag (portrait): don't start until movement exceeds threshold
      let isDragging = false;

      const handleTouchMove = (moveEvent: TouchEvent) => {
        if (moveEvent.touches.length !== 1) return;
        const t = moveEvent.touches[0];
        const deltaX = t.clientX - startX;
        const deltaY = t.clientY - startY;

        if (!isDragging) {
          if (Math.abs(deltaX) > threshold || Math.abs(deltaY) > threshold) {
            isDragging = true;
            dragRef.current = { startX, startY, startPosX: currentX, startPosY: currentY };
          } else {
            return;
          }
        }

        moveEvent.preventDefault();
        setPosition(clampPosition(currentX + deltaX, currentY + deltaY));
      };

      const handleTouchEnd = () => {
        dragRef.current = null;
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
      };

      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);
    } else {
      // Immediate drag (landscape)
      dragRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startPosX: currentX,
        startPosY: currentY,
      };

      const handleTouchMove = (moveEvent: TouchEvent) => {
        if (!dragRef.current || moveEvent.touches.length !== 1) return;
        moveEvent.preventDefault();
        const t = moveEvent.touches[0];
        const deltaX = t.clientX - dragRef.current.startX;
        const deltaY = t.clientY - dragRef.current.startY;
        setPosition(clampPosition(dragRef.current.startPosX + deltaX, dragRef.current.startPosY + deltaY));
      };

      const handleTouchEnd = () => {
        dragRef.current = null;
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
      };

      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);
    }
  }, [position, scale, options?.dragThreshold]);

  return {
    position,
    scale,
    handleMouseDragStart,
    handleTouchStart,
  };
}

/**
 * Manages drag/pinch state for both landscape and portrait timer widgets.
 */
export function useDraggableTimer() {
  const landscape = useDraggableElement({ x: 8, y: 8 });
  const portrait = useDraggableElement(null, 1, { dragThreshold: 8 });

  return {
    // Landscape
    floatingTimerPosition: landscape.position ?? { x: 8, y: 8 },
    floatingTimerScale: landscape.scale,
    handleTimerDragStart: landscape.handleMouseDragStart,
    handleTimerTouchStart: landscape.handleTouchStart,
    // Portrait
    portraitTimerPosition: portrait.position,
    portraitTimerScale: portrait.scale,
    handlePortraitTimerTouchStart: portrait.handleTouchStart,
  };
}
