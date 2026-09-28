import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Trophy, Plus, ChevronRight, Lock } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  clubId: string;
  teamIds: string[];
  isAdmin: boolean;
  hasProAccess?: boolean;
}

export default function ClubCompetitionsSection({ clubId, teamIds, isAdmin, hasProAccess = false }: Props) {
  const { data: organised = [] } = useQuery({
    queryKey: ["club-organised-competitions", clubId],
    enabled: !!clubId && hasProAccess,
    queryFn: async () => {
      const { data } = await supabase
        .from("competitions")
        .select("id, name, sport, season, status, visibility, starts_on")
        .eq("organizer_club_id", clubId)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: entered = [] } = useQuery({
    queryKey: ["club-team-competition-entries", clubId, teamIds.join(",")],
    enabled: teamIds.length > 0 && hasProAccess,
    queryFn: async () => {
      const { data } = await supabase
        .from("competition_entries")
        .select("id, status, team_id, competition_id, teams:team_id(name), competitions:competition_id(id, name, sport, season, status, organizer_club_id)")
        .in("team_id", teamIds)
        .in("status", ["invited", "accepted"]);
      return (data ?? []).filter((e: any) => e.competitions && e.competitions.organizer_club_id !== clubId);
    },
  });

  if (!hasProAccess) {
    return (
      <Accordion type="multiple" defaultValue={[]} className="space-y-4">
        <AccordionItem value="club-competitions" className="border rounded-lg px-4 opacity-60 pointer-events-none select-none">
          <AccordionTrigger className="hover:no-underline" aria-disabled="true">
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" />
              <span className="text-lg font-semibold">Competitions</span>
              <Badge variant="outline" className="text-xs font-normal ml-2">
                <Lock className="h-3 w-3 mr-1" /> Pro
              </Badge>
            </div>
          </AccordionTrigger>
        </AccordionItem>
      </Accordion>
    );
  }

  if (organised.length === 0 && entered.length === 0 && !isAdmin) return null;

  return (
    <Accordion type="multiple" defaultValue={[]} className="space-y-4">
      <AccordionItem value="club-competitions" className="border rounded-lg px-4">
        <AccordionTrigger className="hover:no-underline">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            <span className="text-lg font-semibold">Competitions</span>
            {(organised.length + entered.length) > 0 && (
              <Badge className="ml-2 font-semibold bg-primary/20 text-primary dark:text-primary-foreground dark:bg-primary">
                {organised.length + entered.length}
              </Badge>
            )}
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4 pt-2">
            {isAdmin && (
              <Button asChild size="sm" variant="outline">
                <Link to={`/competitions/new?organizer=${clubId}`}>
                  <Plus className="h-4 w-4 mr-1" /> New competition
                </Link>
              </Button>
            )}

            {organised.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground">Organised by this club</h3>
                {organised.map((c: any) => (
                  <CompetitionRow key={c.id} c={c} />
                ))}
              </div>
            )}

            {entered.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground">Teams in this club entered into</h3>
                {entered.map((e: any) => (
                  <Link key={e.id} to={`/competitions/${e.competition_id}`} className="block">
                    <Card className="hover:border-primary transition-colors">
                      <CardContent className="p-3 flex items-center gap-3">
                        <Trophy className="h-4 w-4 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate text-sm">{e.competitions.name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {e.teams?.name} · {e.status}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}

            {organised.length === 0 && entered.length === 0 && (
              <p className="text-sm text-muted-foreground">No competitions yet.</p>
            )}

            <div>
              <Button asChild size="sm" variant="ghost">
                <Link to="/competitions">View all competitions <ChevronRight className="h-4 w-4 ml-1" /></Link>
              </Button>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function CompetitionRow({ c }: { c: any }) {
  return (
    <Link to={`/competitions/${c.id}`} className="block">
      <Card className="hover:border-primary transition-colors">
        <CardContent className="p-3 flex items-center gap-3">
          <Trophy className="h-4 w-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate text-sm">{c.name}</div>
            <div className="text-xs text-muted-foreground truncate">
              {[c.sport, c.season].filter(Boolean).join(" · ")}
            </div>
          </div>
          <Badge variant={c.status === "active" ? "default" : "secondary"} className="capitalize text-xs">
            {c.status}
          </Badge>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}
