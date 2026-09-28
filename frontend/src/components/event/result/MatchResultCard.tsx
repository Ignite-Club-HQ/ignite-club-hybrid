import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy, Pencil, Plus, Target, Award, StickyNote, Square } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getSportScoreConfig } from "@/lib/sportScoreConfig";
import { formatScoreLine, outcomeFor } from "@/lib/matchResultFormat";
import { MatchResultSheet, hasUnsavedMatchResultDraft } from "./MatchResultSheet";

/**
 * Public-facing result summary card. Renders the saved result + optional
 * scorers / award / notes / cards inline, and opens MatchResultSheet for
 * entry/edit. Drop-in replacement for the previous MatchScoreCard.
 */

interface MatchResultCardProps {
  eventId: string;
  teamId: string;
  teamName: string;
  opponent: string | null;
  sport: string | null | undefined;
  canEdit: boolean;
}

interface SavedRow {
  id: string;
  home_score: number;
  away_score: number;
  home_label: string | null;
  away_label: string | null;
  player_stats: any;
  period_scores: any;
  notes: string | null;
}

export function MatchResultCard({
  eventId, teamId, teamName, opponent, sport, canEdit,
}: MatchResultCardProps) {
  const config = useMemo(() => getSportScoreConfig(sport), [sport]);
  const [open, setOpen] = useState(false);
  const hasDraft = useMemo(() => !open && hasUnsavedMatchResultDraft(eventId), [open, eventId]);

  const { data: result, isLoading } = useQuery({
    queryKey: ["match-result", eventId],
    queryFn: async (): Promise<SavedRow | null> => {
      const { data } = await supabase
        .from("game_results")
        .select(
          "id, home_score, away_score, home_label, away_label, player_stats, period_scores, notes"
        )
        .eq("event_id", eventId)
        .maybeSingle();
      return (data as any) ?? null;
    },
    enabled: !!eventId,
  });

  if (isLoading) return null;
  const hasScore = !!result;

  const labelHome = result?.home_label || teamName;
  const savedAway = result?.away_label;
  const labelAway =
    opponent ||
    (savedAway && savedAway.toLowerCase() !== "opponent" ? savedAway : "Opponent");

  const scoreLine = hasScore
    ? formatScoreLine({
        config,
        homeLabel: labelHome,
        awayLabel: labelAway,
        homeScore: result!.home_score ?? 0,
        awayScore: result!.away_score ?? 0,
        periodScores: result!.period_scores,
      })
    : null;
  const outcome = hasScore ? outcomeFor(result!.home_score ?? 0, result!.away_score ?? 0) : null;

  const savedScorers = Array.isArray(result?.player_stats)
    ? (result!.player_stats as any[])
        .filter((p) => p && (p.goals ?? 0) > 0)
        .map((p) => ({ id: String(p.id), name: String(p.name || "Player"), goals: Number(p.goals) || 0 }))
    : [];
  const carded = Array.isArray(result?.player_stats)
    ? (result!.player_stats as any[]).filter((p) => p && ((p.yellow ?? 0) > 0 || (p.red ?? 0) > 0))
    : [];
  const award = Array.isArray(result?.player_stats)
    ? (result!.player_stats as any[]).find((p) => p?.award === "mvp")
    : null;

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
                <Trophy className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{config.title}</p>
                {hasScore ? (
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-sm font-bold">{scoreLine}</span>
                    {outcome === "win" && (
                      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
                        Win
                      </Badge>
                    )}
                    {outcome === "loss" && <Badge variant="destructive">Loss</Badge>}
                    {outcome === "draw" && <Badge variant="secondary">Draw</Badge>}
                  </div>
                ) : hasDraft ? (
                  <p className="text-sm text-amber-600 dark:text-amber-500 mt-0.5">
                    Unsaved draft — tap Record to save it
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground mt-0.5">No result recorded yet</p>
                )}
              </div>
            </div>
            {canEdit && (
              <Button
                size="sm"
                variant={hasScore ? "ghost" : "default"}
                onClick={() => setOpen(true)}
                className={cn(!hasScore && "h-9")}
              >
                {hasScore ? (
                  <><Pencil className="h-4 w-4 mr-1" /> Edit</>
                ) : (
                  <><Plus className="h-4 w-4 mr-1" /> Record</>
                )}
              </Button>
            )}
          </div>

          {hasScore && savedScorers.length > 0 && (
            <div className="mt-3 pt-3 border-t">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                <Target className="h-3.5 w-3.5" /> {config.scorersLabel}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {savedScorers.map((s) => (
                  <Badge key={s.id} variant="secondary" className="font-normal">
                    {s.name}
                    {s.goals > 1 && <span className="ml-1 opacity-70">×{s.goals}</span>}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {hasScore && carded.length > 0 && (
            <div className="mt-3 pt-3 border-t">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                <Square className="h-3.5 w-3.5 fill-yellow-400 text-yellow-500" /> Cards
              </div>
              <div className="flex flex-wrap gap-1.5">
                {carded.map((p: any) => (
                  <Badge key={p.id} variant="outline" className="font-normal gap-1">
                    {p.name}
                    {(p.yellow ?? 0) > 0 && <span className="text-yellow-500">●{p.yellow > 1 ? p.yellow : ""}</span>}
                    {(p.red ?? 0) > 0 && <span className="text-red-500">●{p.red > 1 ? p.red : ""}</span>}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {hasScore && award && (
            <div className="mt-3 pt-3 border-t flex items-center gap-2 text-sm">
              <Award className="h-3.5 w-3.5 text-primary" />
              <span className="text-muted-foreground">{config.awardLabel || "MVP"}:</span>
              <span className="font-medium truncate">{award.name}</span>
            </div>
          )}

          {hasScore && result?.notes && (
            <div className="mt-3 pt-3 border-t">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                <StickyNote className="h-3.5 w-3.5" /> Notes
              </div>
              <p className="text-sm whitespace-pre-wrap break-words">{result.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <MatchResultSheet
        open={open}
        onOpenChange={setOpen}
        eventId={eventId}
        teamId={teamId}
        teamName={teamName}
        opponent={opponent}
        sport={sport}
      />
    </>
  );
}

export default MatchResultCard;
