import { memo, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface SuggestionPlayer {
  id: string;
  name: string;
  position: unknown; // null = bench
  minutesPlayed?: number;
  isInjured?: boolean;
  isFouledOut?: boolean;
  /** Basketball only — used to favour resting players in foul trouble. */
  fouls?: number;
  /** Wall-clock ts of last bench → court transition. Used to gauge bench rest. */
  lastBenchedAt?: number | null;
}

interface SmartSubSuggestionProps {
  players: SuggestionPlayer[];
  /** Total elapsed game seconds — gate on this so we don't suggest in the first minute. */
  totalElapsedSeconds: number;
  /** Whether the timer is currently running (we only suggest mid-action). */
  isRunning: boolean;
  /** Apply the suggestion — parent wires up the actual position swap. */
  onApplySub: (outPlayerId: string, inPlayerId: string) => void;
  className?: string;
}

/**
 * One-tap "rest your most-played starter for your freshest bench player".
 *
 * Heuristic:
 *  - OUT pick = on-court, eligible, highest minutesPlayed; foul-trouble breaks ties.
 *  - IN pick  = bench, eligible, lowest minutesPlayed (proxy for "freshest").
 *
 * We only render when there's a meaningful gap between the two (≥ 90s) so the
 * coach isn't nagged when the rotation is already balanced.
 */
const SmartSubSuggestion = memo(function SmartSubSuggestion({
  players,
  totalElapsedSeconds,
  isRunning,
  onApplySub,
  className,
}: SmartSubSuggestionProps) {
  const suggestion = useMemo(() => {
    // Need a real game underway and at least 2 mins of data to be meaningful.
    if (!isRunning) return null;
    if (totalElapsedSeconds < 120) return null;

    const eligible = players.filter((p) => !p.isInjured && !p.isFouledOut);
    const onCourt = eligible.filter((p) => p.position !== null);
    const bench = eligible.filter((p) => p.position === null);
    if (onCourt.length === 0 || bench.length === 0) return null;

    // Most fatigued / foul-trouble starter.
    const out = [...onCourt].sort((a, b) => {
      const aFoul = (a.fouls ?? 0) >= 3 ? 1 : 0;
      const bFoul = (b.fouls ?? 0) >= 3 ? 1 : 0;
      if (aFoul !== bFoul) return bFoul - aFoul;
      return (b.minutesPlayed ?? 0) - (a.minutesPlayed ?? 0);
    })[0];

    // Freshest benched player.
    const inPick = [...bench].sort(
      (a, b) => (a.minutesPlayed ?? 0) - (b.minutesPlayed ?? 0)
    )[0];

    if (!out || !inPick) return null;

    const gap = (out.minutesPlayed ?? 0) - (inPick.minutesPlayed ?? 0);
    if (gap < 90) return null; // already balanced

    return { out, inPick, gap };
  }, [players, isRunning, totalElapsedSeconds]);

  if (!suggestion) return null;

  const gapMin = Math.floor(suggestion.gap / 60);
  const gapSec = suggestion.gap % 60;
  const gapLabel = gapMin > 0 ? `${gapMin}m` : `${gapSec}s`;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 border-b bg-primary/5",
        className
      )}
      role="region"
      aria-label="Smart sub suggestion"
    >
      <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
      <div className="flex-1 min-w-0 text-[11px] leading-tight">
        <span className="font-semibold truncate">{suggestion.out.name}</span>
        <ArrowRightLeft className="inline h-3 w-3 mx-1 text-muted-foreground" />
        <span className="font-semibold truncate">{suggestion.inPick.name}</span>
        <span className="text-muted-foreground ml-1">· +{gapLabel} rest gap</span>
      </div>
      <Button
        size="sm"
        variant="default"
        className="h-7 text-[11px] px-2 gap-1"
        onClick={() => onApplySub(suggestion.out.id, suggestion.inPick.id)}
      >
        Apply
      </Button>
    </div>
  );
});

export default SmartSubSuggestion;
