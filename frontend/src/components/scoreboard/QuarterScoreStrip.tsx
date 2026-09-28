import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { periodLabel, periodPrefix, visiblePeriods, type PeriodType } from "@/lib/periodTypes";

interface ScoreLogEntry {
  side: "home" | "away";
  points: number;
  quarter: number;
}

interface QuarterScoreStripProps {
  scoreLog: ScoreLogEntry[] | undefined;
  /** @deprecated — use periodType. Kept for back-compat. */
  totalQuarters?: number;
  currentQuarter: number;
  /** "quarters" (default) renders Q1..Q4. "halves" renders H1, H2 only. */
  periodType?: PeriodType;
  className?: string;
}

/**
 * Compact per-period score breakdown derived from the scoreboard's append-only
 * scoreLog. Pure presentation — no scoring logic here.
 *
 * In halves mode, scores logged against Q1/Q2 collapse into H1, and Q3/Q4
 * collapse into H2 — so we never display empty Q3/Q4 columns or mis-bucket
 * scores when the coach toggles the period type mid-game.
 */
const QuarterScoreStrip = memo(function QuarterScoreStrip({
  scoreLog,
  totalQuarters,
  currentQuarter,
  periodType = "quarters",
  className,
}: QuarterScoreStripProps) {
  const periods = useMemo(() => {
    // Back-compat: if a legacy caller passed totalQuarters, honour it
    // by deriving the period type from the count.
    if (totalQuarters === 2) return visiblePeriods("halves");
    return visiblePeriods(periodType);
  }, [totalQuarters, periodType]);

  const breakdown = useMemo(() => {
    const rows = periods.map(() => ({ home: 0, away: 0 }));
    for (const entry of scoreLog ?? []) {
      // Map the underlying quarter slot (1..4) to the visible period index.
      // Halves: Q1+Q2 → H1 (idx 0), Q3+Q4 → H2 (idx 1).
      const idx =
        periodType === "halves"
          ? entry.quarter <= 2
            ? 0
            : 1
          : entry.quarter - 1;
      if (idx < 0 || idx >= rows.length) continue;
      rows[idx][entry.side] += entry.points;
    }
    const totalHome = rows.reduce((sum, r) => sum + r.home, 0);
    const totalAway = rows.reduce((sum, r) => sum + r.away, 0);
    return { rows, totalHome, totalAway };
  }, [scoreLog, periods, periodType]);

  const prefix = periodPrefix(periodType);

  return (
    <div
      className={cn(
        "flex items-stretch border-b bg-muted/30 text-[10px]",
        className
      )}
      role="table"
      aria-label={`Score by ${periodType === "halves" ? "half" : "quarter"}`}
    >
      {breakdown.rows.map((row, idx) => {
        const slot = periods[idx];
        const label = periodLabel(slot, periodType);
        const hasScore = row.home + row.away > 0;
        // In halves mode the "current period" covers both Q1+Q2 (or Q3+Q4).
        const isCurrent =
          periodType === "halves"
            ? (currentQuarter <= 2 ? 0 : 1) === idx
            : slot === currentQuarter;
        return (
          <div
            key={`${prefix}${slot}`}
            className={cn(
              "flex-1 flex flex-col items-center justify-center py-1 border-r last:border-r-0",
              isCurrent && "bg-primary/10"
            )}
          >
            <span
              className={cn(
                "uppercase font-semibold tracking-wide",
                isCurrent ? "text-primary" : "text-muted-foreground"
              )}
            >
              {label}
            </span>
            <span className="tabular-nums font-mono font-bold text-foreground">
              {hasScore ? `${row.home}-${row.away}` : "—"}
            </span>
          </div>
        );
      })}
      <div className="flex-1 flex flex-col items-center justify-center py-1 bg-card">
        <span className="uppercase font-semibold tracking-wide text-muted-foreground">
          Total
        </span>
        <span className="tabular-nums font-mono font-bold text-foreground">
          {breakdown.totalHome}-{breakdown.totalAway}
        </span>
      </div>
    </div>
  );
});

export default QuarterScoreStrip;
