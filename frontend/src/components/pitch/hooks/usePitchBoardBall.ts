import { RefObject, useRef, useState } from "react";

interface UsePitchBoardBallArgs {
  containerRef: RefObject<HTMLDivElement>;
  initialBallPosition?: { x: number; y: number };
}

/**
 * Owns ball position state + drag/touch handlers for the pitch board.
 * `recentlyDraggedBallRef` is exposed so the tactical-offset memo can suppress
 * its drift correction for ~500ms after a drag (otherwise the ball snaps).
 */
export function usePitchBoardBall({
  containerRef,
  initialBallPosition,
}: UsePitchBoardBallArgs) {
  const [ballPosition, setBallPosition] = useState<{ x: number; y: number }>(
    () => initialBallPosition || { x: 50, y: 50 }
  );
  const [isDraggingBall, setIsDraggingBall] = useState(false);
  const isDraggingBallRef = useRef(false);
  const recentlyDraggedBallRef = useRef(false);

  const handleBallDragStart = () => {
    setIsDraggingBall(true);
  };

  const handleBallDrag = (e: React.DragEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setBallPosition({ x: Math.max(2, Math.min(98, x)), y: Math.max(2, Math.min(98, y)) });
  };

  const handleBallDragEnd = () => {
    recentlyDraggedBallRef.current = true;
    setTimeout(() => {
      recentlyDraggedBallRef.current = false;
    }, 500);
    setIsDraggingBall(false);
  };

  const handleBallTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingBallRef.current = true;
    setIsDraggingBall(true);
    if (containerRef.current) {
      const touch = e.touches[0];
      const rect = containerRef.current.getBoundingClientRect();
      const x = ((touch.clientX - rect.left) / rect.width) * 100;
      const y = ((touch.clientY - rect.top) / rect.height) * 100;
      setBallPosition({ x: Math.max(2, Math.min(98, x)), y: Math.max(2, Math.min(98, y)) });
    }
  };

  const handleBallTouchMove = (e: React.TouchEvent) => {
    if (!isDraggingBallRef.current || !containerRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const touch = e.touches[0];
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((touch.clientX - rect.left) / rect.width) * 100;
    const y = ((touch.clientY - rect.top) / rect.height) * 100;
    setBallPosition({ x: Math.max(2, Math.min(98, x)), y: Math.max(2, Math.min(98, y)) });
  };

  const handleBallTouchEnd = () => {
    isDraggingBallRef.current = false;
    recentlyDraggedBallRef.current = true;
    setTimeout(() => {
      recentlyDraggedBallRef.current = false;
    }, 500);
    setIsDraggingBall(false);
  };

  return {
    ballPosition,
    setBallPosition,
    isDraggingBall,
    isDraggingBallRef,
    recentlyDraggedBallRef,
    handleBallDragStart,
    handleBallDrag,
    handleBallDragEnd,
    handleBallTouchStart,
    handleBallTouchMove,
    handleBallTouchEnd,
  };
}
