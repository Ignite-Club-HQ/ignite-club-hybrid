import { useEffect, useRef, useState } from "react";

/**
 * Animates a number from its previous value to the target value over `duration` ms.
 * Uses requestAnimationFrame and an easeOutCubic curve. Skips animation if value is 0
 * or if the user prefers reduced motion.
 */
export function useCountUp(target: number, duration = 700): number {
  const [display, setDisplay] = useState<number>(target);
  const fromRef = useRef<number>(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      setDisplay(target);
      return;
    }

    const prefersReduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (prefersReduced || target === fromRef.current) {
      setDisplay(target);
      fromRef.current = target;
      return;
    }

    const from = fromRef.current;
    const start = performance.now();
    const delta = target - from;

    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      const value = Math.round(from + delta * eased);
      setDisplay(value);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = target;
    };
  }, [target, duration]);

  return display;
}
