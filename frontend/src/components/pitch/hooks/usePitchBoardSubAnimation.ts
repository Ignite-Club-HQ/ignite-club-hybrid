import { useCallback, useRef, useState } from "react";
import { hapticImpactLight } from "@/lib/haptics";

export function usePitchBoardSubAnimation() {
  const [subAnimationPlayers, setSubAnimationPlayers] = useState<{
    in: string | null;
    out: string | null;
    swap: string | null;
  }>({ in: null, out: null, swap: null });
  const subAnimationTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [swapFlashIds, setSwapFlashIds] = useState<string[]>([]);
  const swapFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashSwapFeedback = useCallback((idA: string, idB: string) => {
    if (swapFlashTimerRef.current) clearTimeout(swapFlashTimerRef.current);
    setSwapFlashIds([idA, idB]);
    hapticImpactLight();
    swapFlashTimerRef.current = setTimeout(() => {
      setSwapFlashIds([]);
      swapFlashTimerRef.current = null;
    }, 600);
  }, []);

  const runSubAnimation = useCallback(
    (playerOutId: string, playerInId: string, swapPlayerId?: string) => {
      subAnimationTimers.current.forEach((timer) => clearTimeout(timer));
      subAnimationTimers.current = [];

      setSubAnimationPlayers({ in: null, out: playerOutId, swap: null });
      const playerInTimer = setTimeout(() => {
        setSubAnimationPlayers({ in: playerInId, out: playerOutId, swap: null });
      }, 500);
      subAnimationTimers.current.push(playerInTimer);

      if (swapPlayerId) {
        const swapTimer = setTimeout(() => {
          setSubAnimationPlayers({
            in: playerInId,
            out: playerOutId,
            swap: swapPlayerId,
          });
        }, 1000);
        subAnimationTimers.current.push(swapTimer);
      }

      const clearTimer = setTimeout(() => {
        setSubAnimationPlayers({ in: null, out: null, swap: null });
        subAnimationTimers.current = [];
      }, swapPlayerId ? 2500 : 1800);
      subAnimationTimers.current.push(clearTimer);
    },
    [],
  );

  return {
    subAnimationPlayers,
    swapFlashIds,
    flashSwapFeedback,
    runSubAnimation,
  };
}
