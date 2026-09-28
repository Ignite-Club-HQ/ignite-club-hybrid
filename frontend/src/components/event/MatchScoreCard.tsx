/**
 * Backwards-compatible shim. The match score UI was rebuilt as a
 * sport-aware, mobile-first result entry system under
 * `src/components/event/result/`. This file re-exports the new card so
 * any existing imports of `MatchScoreCard` keep working.
 */
export { MatchResultCard as MatchScoreCard } from "./result/MatchResultCard";
export { MatchResultCard } from "./result/MatchResultCard";
