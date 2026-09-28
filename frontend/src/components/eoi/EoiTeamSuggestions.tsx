import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Users, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  useEoiTeamSuggestions,
  useAllocateEoisBulk,
} from "@/hooks/useEoiTeamBuilder";

interface Props {
  clubId: string;
  seasonId: string;
}

/**
 * Auto-suggests team buckets from unallocated EOIs for a season and lets admins
 * bulk-assign each bucket to an existing team.
 */
export function EoiTeamSuggestions({ clubId, seasonId }: Props) {
  const { data: suggestions = [], isLoading } = useEoiTeamSuggestions(seasonId);
  const allocateBulk = useAllocateEoisBulk();

  const { data: teams = [] } = useQuery({
    queryKey: ["season-teams-for-alloc", seasonId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, level_age")
        .eq("club_id", clubId)
        .eq("season_id", seasonId)
        .eq("is_archived", false);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!seasonId,
  });

  const [picks, setPicks] = useState<Record<string, string>>({});

  const totalSuggested = useMemo(
    () => suggestions.reduce((acc, s) => acc + s.player_count, 0),
    [suggestions],
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Team suggestions
        </CardTitle>
        <CardDescription>
          {totalSuggested} unallocated submission{totalSuggested === 1 ? "" : "s"}, grouped by age. Pick a team to assign all players in a group.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {suggestions.map((s) => {
          const key = s.age_group;
          const picked = picks[key];
          return (
            <div
              key={key}
              className="border rounded-lg p-3 space-y-2"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{s.age_group}</Badge>
                <span className="text-sm font-medium flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {s.player_count}
                </span>
                <span className="text-xs text-muted-foreground">
                  avg skill {s.avg_skill.toFixed(1)}/5
                </span>
              </div>

              <div className="flex gap-2">
                <Select
                  value={picked ?? ""}
                  onValueChange={(v) => setPicks((p) => ({ ...p, [key]: v }))}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Assign to team…" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.length === 0 && (
                      <SelectItem value="__none" disabled>
                        No teams in this season
                      </SelectItem>
                    )}
                    {teams.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                        {t.level_age ? ` · ${t.level_age}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  size="sm"
                  disabled={!picked || allocateBulk.isPending}
                  onClick={() => {
                    if (!picked) return;
                    allocateBulk.mutate(
                      { submissionIds: s.submission_ids, teamId: picked },
                      {
                        onSuccess: () => {
                          toast.success(
                            `Allocated ${s.player_count} player${s.player_count === 1 ? "" : "s"}`,
                          );
                          setPicks((p) => {
                            const { [key]: _, ...rest } = p;
                            return rest;
                          });
                        },
                        onError: (e: any) =>
                          toast.error(e.message ?? "Allocation failed"),
                      },
                    );
                  }}
                >
                  {allocateBulk.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Allocate"
                  )}
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
