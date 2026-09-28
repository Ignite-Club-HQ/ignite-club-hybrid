import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";

interface FairnessPlayer {
  id: string;
  name: string;
  minutesPlayed?: number;
  position: unknown; // Just need to know on-court vs bench → null = bench.
  isInjured?: boolean;
  isFouledOut?: boolean;
}

interface BenchFairnessMeterProps {
  players: FairnessPlayer[];
  /** Total elapsed game seconds — used to decide whether to show the meter at all. */
  elapsedSeconds: number;
  className?: string;
}

/**
 * Visual "minutes fairness" meter.
 *
 * Shows each player as a small bar — height proportional to their minutes
 * played vs the current squad max. Players furthest below average are tinted
 * to draw the coach's eye to who deserves court time next.
 *
 * Hidden until at least one player has logged ≥30s — meter is meaningless
 * before any meaningful gameplay has occurred.
 */
const BenchFairnessMeter = memo(function BenchFairnessMeter({
  players,
  elapsedSeconds,
  className,
}: BenchFairnessMeterProps) {
  const rows = useMemo(() => {
    // Exclude injured/fouled-out — coach can't action them.
    const eligible = players.filter((p) => !p.isInjured && !p.isFouledOut);
    if (eligible.length === 0) return [];
    const max = Math.max(1, ...eligible.map((p) => p.minutesPlayed ?? 0));
    const avg =
      eligible.reduce((sum, p) => sum + (p.minutesPlayed ?? 0), 0) /
      eligible.length;
    return eligible
      .map((p) => {
        const seconds = p.minutesPlayed ?? 0;
        const heightPct = Math.max(6, Math.round((seconds / max) * 100));
        // Anyone >=20% below the squad average is "behind".
        const behind = avg > 0 && seconds < avg * 0.8;
        return {
          id: p.id,
          name: p.name,
          minutes: Math.floor(seconds / 60),
          seconds: seconds % 60,
          heightPct,
          behind,
          onCourt: p.position !== null,
        };
      })
      .sort((a, b) => {
        // On-court first, then by minutes asc (so "behind" players surface left).
        if (a.onCourt !== b.onCourt) return a.onCourt ? -1 : 1;
        return a.minutes - b.minutes;
      });
  }, [players]);

  if (rows.length < 3 || elapsedSeconds < 30) return null;

  return (
    <div
      className={cn(
        "flex items-end gap-0.5 px-2 py-1 border-b bg-muted/20 overflow-x-auto",
        className
      )}
      role="group"
      aria-label="Player minutes balance"
    >
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold mr-1 self-center whitespace-nowrap">
        Minutes
      </span>
      {rows.map((r) => (
        <div
          key={r.id}
          className="flex flex-col items-center gap-0.5 min-w-[18px]"
          title={`${r.name}: ${r.minutes}m ${r.seconds.toString().padStart(2, "0")}s${r.onCourt ? " (on court)" : ""}`}
        >
          <div className="h-6 w-full flex items-end">
            <div
              className={cn(
                "w-full rounded-sm transition-[height]",
                r.onCourt
                  ? "bg-primary"
                  : r.behind
                  ? "bg-destructive/70"
                  : "bg-muted-foreground/40"
              )}
              style={{ height: `${r.heightPct}%` }}
            />
          </div>
          <span className="text-[8px] tabular-nums leading-none text-muted-foreground truncate max-w-[28px]">
            {r.name.split(" ")[0].slice(0, 4)}
          </span>
        </div>
      ))}
    </div>
  );
});

export default BenchFairnessMeter;
