import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Trophy, Loader2, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

export default function PublicCompetitionPage() {
  usePageTitle("Competition");
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return (
      <div className="container max-w-3xl mx-auto px-4 py-10">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-6 space-y-3 text-center">
            <Trophy className="h-10 w-10 mx-auto text-muted-foreground" />
            <h1 className="text-lg font-semibold">Public competitions are unavailable in ICP lab mode</h1>
            <p className="text-sm text-muted-foreground">
              Public competition details, fixtures, and ladders are not connected to an ICP service yet.
            </p>
            <Link to="/" className="underline text-primary inline-flex items-center gap-1">
              Go to Ignite <ExternalLink className="h-3 w-3" />
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <SupabasePublicCompetitionPage />;
}

function SupabasePublicCompetitionPage() {
  const { id } = useParams<{ id: string }>();

  const { data: competition, isLoading } = useQuery({
    queryKey: ["public-competition", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from("competitions")
        .select("*")
        .eq("id", id!)
        .eq("visibility", "public")
        .maybeSingle();
      return data;
    },
  });

  const { data: divisions = [] } = useQuery({
    queryKey: ["public-competition-divisions", id],
    enabled: !!competition,
    queryFn: async () => {
      const { data } = await supabase
        .from("competition_divisions")
        .select("*")
        .eq("competition_id", id!)
        .order("sort_order");
      return data ?? [];
    },
  });

  const { data: matches = [] } = useQuery({
    queryKey: ["public-competition-matches", id],
    enabled: !!competition,
    queryFn: async () => {
      const { data } = await supabase
        .from("competition_matches")
        .select("*, home:home_team_id(id, name, logo_url), away:away_team_id(id, name, logo_url), competition_divisions:division_id(name)")
        .eq("competition_id", id!)
        .order("scheduled_at", { ascending: true, nullsFirst: false });
      return data ?? [];
    },
  });

  const { data: ladder = [] } = useQuery({
    queryKey: ["public-competition-ladder", id],
    enabled: !!competition,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competition_ladder")
        .select("*")
        .eq("competition_id", id!)
        .order("points", { ascending: false })
        .order("goal_diff", { ascending: false });
      if (error) throw error;

      const teamIds = Array.from(new Set((data ?? []).map((r: any) => r.team_id).filter(Boolean)));
      if (teamIds.length === 0) return data ?? [];

      const { data: teams } = await supabase
        .from("teams")
        .select("id, name, logo_url")
        .in("id", teamIds);

      const teamById = new Map((teams ?? []).map((team: any) => [team.id, team]));
      return (data ?? []).map((row: any) => ({
        ...row,
        teams: teamById.get(row.team_id) ?? null,
      }));
    },
  });

  if (isLoading) {
    return <div className="p-6 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!competition) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground space-y-2">
        <p>This competition isn't publicly available.</p>
        <Link to="/" className="underline text-primary inline-flex items-center gap-1">
          Go to Ignite <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    );
  }

  const hiddenDivisionIds = new Set(
    (divisions as any[]).filter((d: any) => d.hide_ladder).map((d: any) => d.id)
  );
  const hasHiddenDivisionLadder = hiddenDivisionIds.size > 0;
  const ladderByDivision = new Map<string, any[]>();
  ladder.forEach((r: any) => {
    if (hasHiddenDivisionLadder) return;
    if (r.division_id && hiddenDivisionIds.has(r.division_id)) return;
    const k = r.division_id ?? "__none";
    if (!ladderByDivision.has(k)) ladderByDivision.set(k, []);
    ladderByDivision.get(k)!.push(r);
  });

  return (
    <div className="container max-w-3xl mx-auto px-4 py-6 space-y-6">
      <header className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-3"><Trophy className="h-6 w-6 text-primary" /></div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">{competition.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[competition.sport, competition.season].filter(Boolean).join(" · ")}
          </p>
          <div className="flex gap-2 mt-2 flex-wrap">
            <Badge variant="secondary" className="capitalize">{competition.status}</Badge>
            <Badge variant="outline">Public</Badge>
          </div>
        </div>
      </header>

      {competition.description && (
        <p className="text-sm whitespace-pre-wrap">{competition.description}</p>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Ladder</h2>
        {ladderByDivision.size === 0 ? (
          <p className="text-sm text-muted-foreground">No ladder to display.</p>
        ) : (
          Array.from(ladderByDivision.entries()).map(([divId, list]) => {
            const div = divisions.find((d: any) => d.id === divId);
            return (
              <Card key={divId}>
                <CardContent className="p-4">
                  <div className="font-medium mb-3">{div?.name ?? "Overall"}</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="py-1.5">#</th><th>Team</th>
                          <th className="text-right">P</th><th className="text-right">W</th>
                          <th className="text-right">D</th><th className="text-right">L</th>
                          <th className="text-right">+/-</th><th className="text-right">Pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((r: any, i: number) => (
                          <tr key={r.team_id} className="border-t">
                            <td className="py-1.5 tabular-nums text-muted-foreground">{i + 1}</td>
                            <td className="font-medium truncate">{r.teams?.name ?? "?"}</td>
                            <td className="text-right tabular-nums">{r.played}</td>
                            <td className="text-right tabular-nums">{r.wins}</td>
                            <td className="text-right tabular-nums">{r.draws}</td>
                            <td className="text-right tabular-nums">{r.losses}</td>
                            <td className="text-right tabular-nums">{r.goal_diff > 0 ? `+${r.goal_diff}` : r.goal_diff}</td>
                            <td className="text-right tabular-nums font-bold">{r.points}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Fixtures & results</h2>
        {matches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No fixtures published yet.</p>
        ) : (
          matches.map((m: any) => (
            <Card key={m.id}>
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {m.round_number != null && <Badge variant="outline">R{m.round_number}</Badge>}
                  {m.competition_divisions?.name && <span>{m.competition_divisions.name}</span>}
                  {m.scheduled_at && <span>· {format(new Date(m.scheduled_at), "EEE d MMM HH:mm")}</span>}
                  <Badge variant="secondary" className="capitalize ml-auto">{m.status.replace("_", " ")}</Badge>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="flex-1 font-medium truncate text-right">{m.home?.name ?? "?"}</span>
                  <span className="px-2 font-bold tabular-nums">{m.home_score ?? "–"} : {m.away_score ?? "–"}</span>
                  <span className="flex-1 font-medium truncate">{m.away?.name ?? "?"}</span>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </section>

      <footer className="text-center text-xs text-muted-foreground pt-4">
        Powered by <Link to="/" className="underline">Ignite</Link>
      </footer>
    </div>
  );
}
