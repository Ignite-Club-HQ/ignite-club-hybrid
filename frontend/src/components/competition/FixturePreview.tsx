import { format } from "date-fns";
import { AlertTriangle, CalendarDays, Loader2, RefreshCw, Save, Shuffle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { dateKey, type PlacedFixture } from "@/lib/competitionScheduler";

interface FixturePreviewSummary {
  unscheduledCount: number;
}

interface FixturePreviewProps {
  allPlaced: PlacedFixture[];
  placedByRound: Map<number, PlacedFixture[]>;
  finalsRoundNumber: number | null;
  teamsInScope: any[];
  nameById: Map<string, string>;
  roundDateOverrides: Map<number, string>;
  summary: FixturePreviewSummary | null;
  generating: boolean;
  onSetRoundDate: (round: number, isoDate: string) => void;
  onSave: () => void;
  onShuffle: () => void;
  onRegenerate: () => void;
  onBack: () => void;
}

export function FixturePreview({
  allPlaced,
  placedByRound,
  finalsRoundNumber,
  teamsInScope,
  nameById,
  roundDateOverrides,
  summary,
  generating,
  onSetRoundDate,
  onSave,
  onShuffle,
  onRegenerate,
  onBack,
}: FixturePreviewProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-base">Fixture preview</div>
        <Badge variant="secondary" className="text-xs font-medium">
          {allPlaced.length} matches
        </Badge>
      </div>
      {summary?.unscheduledCount ? (
        <div className="text-xs text-destructive flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{summary.unscheduledCount} match{summary.unscheduledCount === 1 ? "" : "es"} won't fit before the end date — adjust before saving.</span>
        </div>
      ) : null}
      <div className="space-y-3 max-h-[55vh] overflow-y-auto -mx-1 px-1">
        {Array.from(placedByRound.entries()).map(([round, list]) => {
          const isFinalsRound = finalsRoundNumber === round;
          const playingIds = new Set<string>();
          list.forEach((p) => { if (p.home) playingIds.add(p.home); if (p.away) playingIds.add(p.away); });
          const byeTeams = isFinalsRound ? [] : teamsInScope.filter((t: any) => !playingIds.has(t.id));
          const datesInRound = Array.from(new Set(list.map((p) => p.scheduledAt ? dateKey(p.scheduledAt) : "—")));
          const overrideValue = roundDateOverrides.get(round) ?? (datesInRound[0] !== "—" ? datesInRound[0] : "");
          return (
            <div key={round} className="rounded-lg border bg-card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-muted/50 border-b">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-sm font-semibold">
                    {isFinalsRound ? `Finals (Round ${round})` : `Round ${round}`}
                  </span>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {list.length} {list.length === 1 ? "match" : "matches"}
                    {datesInRound.length > 1 ? ` · ${datesInRound.length} days` : ""}
                  </span>
                </div>
                {!isFinalsRound && (
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <CalendarDays className="h-3 w-3" />
                    <span>Move to:</span>
                    <input
                      type="date"
                      value={overrideValue}
                      onChange={(e) => onSetRoundDate(round, e.target.value)}
                      className="h-7 px-1.5 py-0.5 text-xs bg-background border border-input rounded"
                    />
                  </label>
                )}
              </div>
              <ul className="divide-y">
                {list.map((p, i) => {
                  const timeLabel = p.scheduledAt
                    ? format(p.scheduledAt, "EEE d MMM · HH:mm")
                    : "(unscheduled)";
                  const homeName = p.homeLabel ?? (p.home ? (nameById.get(p.home) ?? "?") : "TBD");
                  const awayName = p.awayLabel ?? (p.away ? (nameById.get(p.away) ?? "?") : "TBD");
                  return (
                    <li key={i} className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="flex-1 min-w-0 text-sm font-medium text-right truncate">{homeName}</span>
                        <span className="text-xs text-muted-foreground uppercase tracking-wide shrink-0">vs</span>
                        <span className="flex-1 min-w-0 text-sm font-medium text-left truncate">{awayName}</span>
                      </div>
                      {p.note && (
                        <div className="mt-0.5 text-center text-[11px] font-medium text-primary">
                          {p.note}
                        </div>
                      )}
                      <div className="mt-1 flex items-center justify-center gap-3 text-[11px] text-muted-foreground">
                        <span>{timeLabel}</span>
                        {p.pitch && <span>· Pitch {p.pitch}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {byeTeams.length > 0 && (
                <div className="px-3 py-1.5 text-[11px] text-muted-foreground italic border-t bg-muted/30">
                  Bye: {byeTeams.map((t: any) => t.name).join(", ")}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap">
        <Button onClick={onSave} disabled={generating || allPlaced.length === 0} className="w-full sm:w-auto min-h-11">
          {generating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
          Save fixtures
        </Button>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-2">
          <Button variant="outline" onClick={onShuffle} disabled={generating} className="min-h-11">
            <Shuffle className="h-4 w-4 mr-1" /> Shuffle
          </Button>
          <Button variant="outline" onClick={onRegenerate} disabled={generating} className="min-h-11">
            <RefreshCw className="h-4 w-4 mr-1" /> Regenerate
          </Button>
        </div>
        <Button variant="ghost" onClick={onBack} disabled={generating} className="w-full sm:w-auto min-h-11 sm:ml-auto">
          Back
        </Button>
      </div>
    </>
  );
}
