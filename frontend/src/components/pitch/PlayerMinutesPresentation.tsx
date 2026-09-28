import type { CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { FairnessReport } from "./planner/analysis";

export interface PlayerMinutesPlayer {
  id: string;
  name: string;
  number?: number;
}

export interface PlayerTimeForecast {
  player: PlayerMinutesPlayer;
  predictedMinutes: number;
  percentageOfGame: number;
  startsOnPitch: boolean;
  gkRole?: "full" | "1h" | "2h";
}

interface PlayersNeedingAttentionProps {
  forecasts: PlayerTimeForecast[];
  fairnessReport: FairnessReport | null;
}

export function PlayersNeedingAttention({
  forecasts,
  fairnessReport,
}: PlayersNeedingAttentionProps) {
  const outfield = forecasts.filter((f) => f.gkRole !== "full");
  if (outfield.length < 3) return null;

  const sorted = [...outfield].sort((a, b) => a.predictedMinutes - b.predictedMinutes);
  const lowest = sorted[0];
  const highest = sorted[sorted.length - 1];
  const spread = highest.predictedMinutes - lowest.predictedMinutes;

  type Row = { id: string; number?: number; name: string; minutes: number; reason: string; tone: string };
  const rows: Row[] = [];
  const seen = new Set<string>();

  if (spread > 3) {
    rows.push({ id: lowest.player.id, number: lowest.player.number, name: lowest.player.name, minutes: lowest.predictedMinutes, reason: "Lowest minutes", tone: "border-amber-500/50 text-amber-600" });
    seen.add(lowest.player.id);
    if (!seen.has(highest.player.id)) {
      rows.push({ id: highest.player.id, number: highest.player.number, name: highest.player.name, minutes: highest.predictedMinutes, reason: "Highest minutes", tone: "border-amber-500/50 text-amber-600" });
      seen.add(highest.player.id);
    }
  }

  if (fairnessReport) {
    for (const stat of fairnessReport.perPlayer) {
      if (rows.length >= 5) break;
      if (seen.has(stat.playerId)) continue;
      const f = forecasts.find((x) => x.player.id === stat.playerId);
      if (!f) continue;
      if (stat.shortShifts > 0) {
        rows.push({ id: stat.playerId, number: f.player.number, name: f.player.name, minutes: f.predictedMinutes, reason: `${stat.shortShifts} very short turn${stat.shortShifts > 1 ? "s" : ""}`, tone: "border-red-500/50 text-red-500" });
        seen.add(stat.playerId);
      } else if (stat.bounceBacks > 0) {
        rows.push({ id: stat.playerId, number: f.player.number, name: f.player.name, minutes: f.predictedMinutes, reason: `${stat.bounceBacks} bounce-back${stat.bounceBacks > 1 ? "s" : ""}`, tone: "border-purple-500/50 text-purple-500" });
        seen.add(stat.playerId);
      }
    }
  }

  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5 mb-2">
      <p className="text-xs font-semibold text-foreground">Players needing attention</p>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={`${row.id}-${row.reason}`} className="flex items-center gap-2 text-xs">
            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/20 text-primary text-[10px] font-bold shrink-0">
              {row.number ?? "?"}
            </div>
            <span className="flex-1 min-w-0 truncate text-foreground">{row.name}</span>
            <span className="text-muted-foreground tabular-nums shrink-0">{row.minutes}'</span>
            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 shrink-0", row.tone)}>
              {row.reason}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

interface SortablePlayerMinutesRowProps {
  forecast: PlayerTimeForecast;
  fairnessReport: FairnessReport | null;
  draggable: boolean;
}

export function SortablePlayerMinutesRow({
  forecast,
  fairnessReport,
  draggable,
}: SortablePlayerMinutesRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: forecast.player.id,
    disabled: !draggable,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const stat = fairnessReport?.perPlayer.find(s => s.playerId === forecast.player.id);
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 p-2 rounded-lg bg-muted/50",
        isDragging && "ring-2 ring-primary/40"
      )}
    >
      {draggable ? (
        <button
          type="button"
          aria-label="Drag to reorder priority"
          className="touch-none p-1 -ml-1 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      ) : (
        <div className="w-6 shrink-0" aria-hidden />
      )}
      <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/20 text-primary text-xs font-bold shrink-0">
        {forecast.player.number || "?"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium truncate">{forecast.player.name}</span>
          <Badge
            variant="outline"
            className={cn(
              "text-xs px-1.5 py-0",
              forecast.startsOnPitch ? "border-emerald-500/50 text-emerald-500" : "border-muted-foreground/50"
            )}
          >
            {forecast.startsOnPitch ? 'Start' : 'Bench'}
          </Badge>
          {forecast.gkRole && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 border-amber-500/50 text-amber-600">
              {forecast.gkRole === 'full' ? 'GK' : forecast.gkRole === '1h' ? 'GK 1H' : 'GK 2H'}
            </Badge>
          )}
          {stat?.shortShifts ? (
            <Badge variant="outline" className="text-xs px-1.5 py-0 border-red-500/50 text-red-500">
              {stat.shortShifts} very short
            </Badge>
          ) : null}
          {stat?.bounceBacks ? (
            <Badge variant="outline" className="text-xs px-1.5 py-0 border-purple-500/50 text-purple-500">
              {stat.bounceBacks} bounce
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Progress value={forecast.percentageOfGame} className="h-2 flex-1" />
          <span className="text-xs text-muted-foreground w-20 text-right shrink-0 tabular-nums">
            {forecast.predictedMinutes}' ({forecast.percentageOfGame}%)
          </span>
        </div>
      </div>
    </div>
  );
}
