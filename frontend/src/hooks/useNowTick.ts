/**
 * Lightweight tick: re-renders subscribers every N seconds.
 * Used by bench rest-timer badges (no need for per-second precision).
 */
import { useEffect, useState } from "react";

export const useNowTick = (intervalMs = 5000): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
};

/** Format seconds as M:SS (cap at 99:59 just in case). */
export const formatRest = (seconds: number): string => {
  const safe = Math.max(0, Math.min(99 * 60 + 59, Math.floor(seconds)));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};
