import { useState } from "react";

/**
 * Step 8c — Bench-to-pitch quick substitution sheet state.
 *
 * Owns the BenchToSubDialog open/selected-player state. The sheet is opened
 * imperatively from bench click/drag handlers in PitchBoard; selection
 * handling is delegated to `handleBenchToSubSelect` from usePitchBoardManualSub.
 */
export function usePitchBoardBenchToSub() {
  const [benchToSubOpen, setBenchToSubOpen] = useState(false);
  const [benchToSubPlayer, setBenchToSubPlayer] = useState<string | null>(null);

  return {
    benchToSubOpen,
    setBenchToSubOpen,
    benchToSubPlayer,
    setBenchToSubPlayer,
  };
}
