import { memo, useMemo } from "react";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScoreLogEntry {
  side: "home" | "away";
  points: number;
  quarter: number;
  at: number;
}

interface MomentumStripProps {
  scoreLog: ScoreLogEntry[] | undefined;
  /** Rolling window in seconds (default 180s = 3 min). */
  windowSeconds?: number;
  /** Hide until at least this many wall-clock seconds of game data exist. */
  minDataSeconds?: number;
  className?: string;
}

/**
 * Rolling ±score over the last N minutes — the coach's "are we on a run?" gauge.
 *
 * Reads from the same append-only scoreLog the scoreboard already produces, so
 * there's no new state to track. Hidden until at least one minute of scoring
 * data exists so it doesn't sit empty during dead time at the start.
 */
const MomentumStrip = memo(function MomentumStrip({
  scoreLog,
  windowSeconds = 180,
  minDataSeconds = 60,
  className,
}: MomentumStripProps) {
  const { delta, homePts, awayPts, hasEnoughData } = useMemo(() => {
    const log = scoreLog ?? [];
    if (log.length === 0) return { delta: 0, homePts: 0, awayPts: 0, hasEnoughData: false };
    const now = Date.now();
    const cutoff = now - windowSeconds * 1000;
    const earliest = log[0]?.at ?? now;
    const recent = log.filter((e) => e.at >= cutoff);
    let h = 0;
    let a = 0;
    for (const e of recent) {
      if (e.side === "home") h += e.points;
      else a += e.points;
    }
    return {
      delta: h - a,
      homePts: h,
      awayPts: a,
      hasEnoughData: now - earliest >= minDataSeconds * 1000,
    };
  }, [scoreLog, windowSeconds, minDataSeconds]);

  if (!hasEnoughData) return null;

  const windowLabel =
    windowSeconds >= 60 ? `${Math.round(windowSeconds / 60)}m` : `${windowSeconds}s`;

  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const tone =
    delta > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : delta < 0
      ? "text-destructive"
      : "text-muted-foreground";

  // Bar fill: max ±10 point swing maps to full width.
  const magnitude = Math.min(10, Math.abs(delta));
  const fillPct = (magnitude / 10) * 50; // each side gets up to 50%

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-1 border-b bg-muted/20 text-[10px]",
        className
      )}
      role="status"
      aria-label={`Momentum last ${windowLabel}: ${delta > 0 ? "+" : ""}${delta}`}
    >
      <span className="uppercase tracking-wide text-muted-foreground font-semibold whitespace-nowrap">
        Last {windowLabel}
      </span>

      {/* Centred bar: away pull on the left, home push on the right */}
      <div className="relative flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
        {delta > 0 && (
          <div
            className="absolute inset-y-0 left-1/2 bg-emerald-500/70 rounded-r-full"
            style={{ width: `${fillPct}%` }}
          />
        )}
        {delta < 0 && (
          <div
            className="absolute inset-y-0 right-1/2 bg-destructive/70 rounded-l-full"
            style={{ width: `${fillPct}%` }}
          />
        )}
      </div>

      <div className={cn("flex items-center gap-1 font-mono tabular-nums font-bold", tone)}>
        <Icon className="h-3 w-3" />
        <span>
          {delta > 0 ? "+" : ""}
          {delta}
        </span>
      </div>

      <span className="text-muted-foreground tabular-nums whitespace-nowrap">
        {homePts}-{awayPts}
      </span>
    </div>
  );
});

export default MomentumStrip;
