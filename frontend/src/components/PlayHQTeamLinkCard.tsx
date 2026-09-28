import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Trophy, Loader2, Unlink, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface Props {
  teamId: string;
  clubId: string;
}

interface TeamRow {
  playhq_team_id: string | null;
  playhq_competition_id: string | null;
  playhq_auto_create_events: boolean;
}

interface Competition {
  id: string;
  name: string;
  season: string | null;
}

interface MatchRow {
  external_home_team_id: string | null;
  external_away_team_id: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
}

export function PlayHQTeamLinkCard({ teamId, clubId }: Props) {
  const qc = useQueryClient();
  const [importing, setImporting] = useState(false);

  // Gate: only show this card if the club has PlayHQ configured at club level
  const { data: club, isLoading: clubLoading } = useQuery({
    queryKey: ["club-playhq-link", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("playhq_tenant, playhq_org_id")
        .eq("id", clubId)
        .maybeSingle();
      if (error) throw error;
      return data as { playhq_tenant: string | null; playhq_org_id: string | null } | null;
    },
  });
  const clubHasPlayHQ = !!(club?.playhq_tenant && club?.playhq_org_id);

  const { data: team } = useQuery({
    queryKey: ["team-playhq-link", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("playhq_team_id, playhq_competition_id, playhq_auto_create_events")
        .eq("id", teamId)
        .single();
      if (error) throw error;
      return data as TeamRow;
    },
    enabled: clubHasPlayHQ,
  });

  // PlayHQ comps the user can see (RLS already scopes by membership/visibility).
  // We don't pre-filter by organiser here so that comps run by a parent
  // association — or by a sister club the user belongs to — also surface,
  // even if `parent_org_id` hasn't been wired up on this club yet.
  const { data: comps } = useQuery({
    queryKey: ["playhq-comps-for-team", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitions")
        .select("id, name, season")
        .eq("source", "playhq")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Competition[];
    },
    enabled: clubHasPlayHQ,
  });

  const selectedCompId = team?.playhq_competition_id ?? null;

  const { data: matches } = useQuery({
    queryKey: ["playhq-comp-teams", selectedCompId],
    enabled: clubHasPlayHQ && !!selectedCompId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competition_matches")
        .select("external_home_team_id, external_away_team_id, home_team_name, away_team_name")
        .eq("competition_id", selectedCompId!)
        .eq("source", "playhq");
      if (error) throw error;
      return (data ?? []) as MatchRow[];
    },
  });

  const playhqTeams = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of matches ?? []) {
      if (m.external_home_team_id) map.set(m.external_home_team_id, m.home_team_name ?? m.external_home_team_id);
      if (m.external_away_team_id) map.set(m.external_away_team_id, m.away_team_name ?? m.external_away_team_id);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [matches]);

  const update = useMutation({
    mutationFn: async (patch: Partial<TeamRow>) => {
      const { error } = await supabase.from("teams").update(patch).eq("id", teamId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-playhq-link", teamId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update link"),
  });

  const runImport = async () => {
    setImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("playhq-materialise-team-events", {
        body: { team_id: teamId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const r = data as { created: number; updated: number; cancelled: number };
      toast.success(`Imported: ${r.created} new, ${r.updated} updated, ${r.cancelled} cancelled`);
      qc.invalidateQueries({ queryKey: ["events"] });
    } catch (e: any) {
      toast.error(e.message ?? "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const unlink = () =>
    update.mutate({ playhq_team_id: null, playhq_competition_id: null });

  if (clubLoading) return null;
  if (!clubHasPlayHQ) return null;

  return (
    <Card className="border-orange-500/30 bg-orange-500/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-orange-500" />
          <div className="font-medium text-sm">PlayHQ Link</div>
        </div>
        <p className="text-xs text-muted-foreground">
          Link this team to a PlayHQ competition and team. Fixtures will appear as match events on the team's schedule and stay in sync.
        </p>

        <div className="space-y-2">
          <Label className="text-xs">PlayHQ competition</Label>
          <Select
            value={selectedCompId ?? ""}
            onValueChange={(v) =>
              update.mutate({ playhq_competition_id: v, playhq_team_id: null })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a PlayHQ competition" />
            </SelectTrigger>
            <SelectContent>
              {(comps ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                  {c.season ? ` · ${c.season}` : ""}
                </SelectItem>
              ))}
              {comps && comps.length === 0 && (
                <div className="p-2 text-xs text-muted-foreground">
                  No PlayHQ competitions linked to your club yet.
                </div>
              )}
            </SelectContent>
          </Select>
        </div>

        {selectedCompId && (
          <div className="space-y-2">
            <Label className="text-xs">Which PlayHQ team is yours?</Label>
            <Select
              value={team?.playhq_team_id ?? ""}
              onValueChange={(v) => update.mutate({ playhq_team_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select your team in the competition" />
              </SelectTrigger>
              <SelectContent>
                {playhqTeams.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
                {playhqTeams.length === 0 && (
                  <div className="p-2 text-xs text-muted-foreground">
                    No teams found in this comp yet. Sync the comp from the association page first.
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>
        )}

        {team?.playhq_team_id && (
          <>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">Auto-create match events</div>
                <div className="text-xs text-muted-foreground">
                  When PlayHQ adds or updates a fixture, mirror it on the schedule.
                </div>
              </div>
              <Switch
                checked={team.playhq_auto_create_events}
                onCheckedChange={(v) => update.mutate({ playhq_auto_create_events: v })}
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={runImport} disabled={importing} className="flex-1">
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Import fixtures now
              </Button>
              <Button variant="outline" onClick={unlink} disabled={update.isPending}>
                <Unlink className="h-4 w-4 mr-1" />
                Unlink
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
