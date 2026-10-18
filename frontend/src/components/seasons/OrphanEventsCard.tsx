import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Calendar } from "lucide-react";
import { format } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { withFeatureBackend } from "@/live/featureRouter";
import { listLiveSeasonTeamAssignment, listLiveSeasons, listLiveTeams } from "@/live/features/club";
import { listLiveEvents } from "@/live/features/events";

interface Props {
  clubId: string;
}

interface OrphanEvent {
  event_id: string;
  title: string;
  event_date: string;
  team_id: string;
  team_name: string;
}

export function OrphanEventsCard({ clubId }: Props) {
  const isIcp = resolveAuthBackend() === "icp";
  const { data: events = [], isLoading } = useQuery({
    queryKey: ["season-orphan-events", clubId, isIcp],
    queryFn: async (): Promise<OrphanEvent[]> =>
      withFeatureBackend("membership", {
        supabase: async () => {
          const { data, error } = await supabase.rpc("season_orphan_events", { _club_id: clubId });
          if (error) throw error;
          return (data ?? []) as OrphanEvent[];
        },
        // Canister teams carry no season_id; a team counts as linked when any
        // of the club's seasons has a season_team_assignment for it.
        icp: async (ctx) => {
          const teams = (await listLiveTeams(ctx, clubId)) as Array<{
            id: string;
            name: string;
            is_active: boolean;
            archived: boolean;
            deleted_at_ms: [] | [bigint];
          }>;
          const seasons = (await listLiveSeasons(ctx, clubId).catch(() => [])) as Array<{ id: string }>;
          const assignmentLists = await Promise.all(
            seasons.map((s) =>
              (listLiveSeasonTeamAssignment(ctx, s.id) as Promise<Array<{ team_id: string }>>).catch(() => []),
            ),
          );
          const linkedTeamIds = new Set(assignmentLists.flat().map((a) => a.team_id));
          const activeTeams = teams.filter(
            (t) => t.is_active && !t.archived && t.deleted_at_ms.length === 0 && !linkedTeamIds.has(t.id),
          );
          if (activeTeams.length === 0) return [];
          const teamNameById = new Map(activeTeams.map((t) => [t.id, t.name]));

          const eventLists = await Promise.all(
            activeTeams.map((t) => listLiveEvents(ctx, null, t.id)),
          );
          const out: OrphanEvent[] = [];
          eventLists.forEach((evs, idx) => {
            const teamId = activeTeams[idx].id;
            (evs as Array<{ id: string; title: string; starts_at_ms: bigint }>).forEach((e) => {
              out.push({
                event_id: e.id,
                title: e.title,
                event_date: new Date(Number(e.starts_at_ms)).toISOString(),
                team_id: teamId,
                team_name: teamNameById.get(teamId) ?? teamId,
              });
            });
          });
          return out.sort((a, b) => a.event_date.localeCompare(b.event_date));
        },
      }, { clubId: clubId! }),
  });

  if (isLoading || events.length === 0) return null;

  return (
    <Card className="border-warning/40">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning" />
          Events without a season
        </CardTitle>
        <CardDescription>
          {events.length} event{events.length === 1 ? "" : "s"} belong to teams that aren't linked to any season. They won't appear in season analytics.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-[200px]">
          <div className="space-y-1.5">
            {events.map((e) => (
              <div
                key={e.event_id}
                className="flex items-center gap-3 p-2 rounded border text-sm"
              >
                <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{e.title}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {e.team_name} · {format(new Date(e.event_date), "MMM d, yyyy")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
