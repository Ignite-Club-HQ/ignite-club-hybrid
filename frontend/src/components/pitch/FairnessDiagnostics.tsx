import { cn } from "@/lib/utils";
import type { PlayerTimeForecast } from "./PlayerMinutesPresentation";

interface FairnessDiagnosticsProps {
  forecasts: PlayerTimeForecast[];
  teamSize: number;
  squadSize: number;
  matchMinutes: number;
  minShiftSeconds: number;
  rotateGkAtHalftime: boolean;
  mode: "Standard" | "Frequent";
}

// ===========================================================================
// FairnessDiagnostics — always-visible "Game time fairness" summary derived
// directly from the forecast minutes. Shows target vs actual min/max/spread,
// plus a plain-English message and constraint warnings.
// ===========================================================================
export function FairnessDiagnostics({
  forecasts,
  teamSize,
  squadSize,
  matchMinutes,
  minShiftSeconds,
  rotateGkAtHalftime,
  mode,
}: FairnessDiagnosticsProps) {
  if (!forecasts.length || squadSize <= teamSize) return null;

  // Target uses outfield slots × match length / outfield squad size. We treat
  // a "full game" GK as out of the rotation pool to avoid skewing the target.
  const fullGameGkIds = new Set(forecasts.filter(f => f.gkRole === 'full').map(f => f.player.id));
  const outfieldSlots = Math.max(0, teamSize - (fullGameGkIds.size > 0 ? 1 : 0));
  const outfieldSquad = squadSize - fullGameGkIds.size;
  const outfieldForecasts = forecasts.filter(f => !fullGameGkIds.has(f.player.id));
  if (outfieldSquad <= 0 || outfieldSlots <= 0 || outfieldForecasts.length === 0) return null;

  const target = (outfieldSlots * matchMinutes) / outfieldSquad;
  const mins = outfieldForecasts.map(f => f.predictedMinutes);
  const min = Math.min(...mins);
  const max = Math.max(...mins);
  const spread = max - min;

  // Fairness scoring -------------------------------------------------------
  // Max deviation: largest |actual - target| in minutes.
  const maxDeviation = mins.reduce((acc, m) => Math.max(acc, Math.abs(m - target)), 0);
  // Fairness %: 100 means everyone hits target exactly. We scale the largest
  // deviation against the target — a 5-min miss on a 35-min target is ~14 %.
  const fairnessPct = target > 0
    ? Math.max(0, Math.min(100, 100 - (maxDeviation / target) * 100))
    : 100;
  // Mathematical floor: smallest spread possible given integer-minute math.
  // 0 when (slots × T) divides evenly by N; 1 minute otherwise.
  const totalPlayerMin = outfieldSlots * matchMinutes;
  const perfectFloorMin = totalPlayerMin % outfieldSquad === 0 ? 0 : 1;

  const mathematicalMinSpread = matchMinutes - Math.floor(target) - Math.floor(target);
  // Bench size relative to outfield slots — flags large benches that need more rotations.
  const benchSize = squadSize - teamSize;
  const isLargeBench = benchSize >= Math.ceil(teamSize / 2);
  const minShiftMin = minShiftSeconds / 60;
  const constrainedByMinShift = spread > 3 && target < minShiftMin * 1.5;

  let tone: 'good' | 'warn' | 'info' = 'good';
  let message = `Fair plan: all players are within ${Math.ceil(spread)} min of each other.`;
  if (spread <= 3) {
    tone = 'good';
    message = `Fair plan: all outfielders are within ${Math.ceil(spread)} min of target game time.`;
  } else if (spread <= 6) {
    tone = 'info';
    message = `Slightly uneven: spread of ${spread.toFixed(1)} min between most- and least-played outfielder.`;
    if (constrainedByMinShift) {
      message += ' Minimum time on field is preventing a tighter rotation.';
    } else if (isLargeBench && mode === 'Standard') {
      message += ' Try Frequent mode or lower “How often to suggest subs”.';
    }
  } else {
    tone = 'warn';
    message = `Uneven plan: ${spread.toFixed(1)} min between most- and least-played outfielder.`;
    if (isLargeBench) {
      message += ' Large bench — try Frequent mode or lower “How often to suggest subs”.';
    } else if (constrainedByMinShift) {
      message += ' Lower “Minimum time on field” to allow shorter shifts.';
    } else {
      message += ' Lower “Minimum gap between sub moments” to allow more rotations.';
    }
  }

  const toneClasses =
    tone === 'good' ? 'border-emerald-500/40 bg-emerald-500/5' :
    tone === 'warn' ? 'border-amber-500/40 bg-amber-500/5' :
    'border-border bg-muted/30';

  return (
    <div className={cn('rounded-lg border p-3 space-y-2 mb-2', toneClasses)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-foreground">Game time fairness</p>
        <span className="text-[11px] text-muted-foreground">{mode} mode</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <span className="text-muted-foreground">Target per player</span>
        <span className="text-right tabular-nums font-medium text-foreground">{target.toFixed(1)} min</span>
        <span className="text-muted-foreground">Highest</span>
        <span className="text-right tabular-nums text-foreground">{max.toFixed(1)} min</span>
        <span className="text-muted-foreground">Lowest</span>
        <span className="text-right tabular-nums text-foreground">{min.toFixed(1)} min</span>
        <span className="text-muted-foreground">Spread</span>
        <span className={cn(
          'text-right tabular-nums font-medium',
          tone === 'good' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-foreground'
        )}>{spread.toFixed(1)} min</span>
        <span className="text-muted-foreground">Max deviation</span>
        <span className="text-right tabular-nums text-foreground">{maxDeviation.toFixed(1)} min</span>
        <span className="text-muted-foreground">Fairness score</span>
        <span className={cn(
          'text-right tabular-nums font-medium',
          fairnessPct >= 95 ? 'text-emerald-600' : fairnessPct >= 85 ? 'text-foreground' : 'text-amber-600'
        )}>{fairnessPct.toFixed(0)}%</span>
        <span className="text-muted-foreground">Mathematical floor</span>
        <span className="text-right tabular-nums text-muted-foreground">
          {perfectFloorMin === 0 ? '0 min (perfect possible)' : `${perfectFloorMin} min`}
        </span>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">{message}</p>
      {rotateGkAtHalftime && fullGameGkIds.size === 0 && forecasts.some(f => f.gkRole === '1h' || f.gkRole === '2h') && (
        <p className="text-[10px] leading-snug text-muted-foreground italic">
          Goalkeeper is being swapped at halftime — outfield minutes shown exclude GK time.
        </p>
      )}
    </div>
  );
}
