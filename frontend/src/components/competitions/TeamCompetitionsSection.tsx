import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Trophy, ChevronRight, Check, X, Loader2 } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  teamId: string;
  canManage: boolean;
}

export default function TeamCompetitionsSection({ teamId, canManage }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const { data: entries = [] } = useQuery({
    queryKey: ["team-competition-entries", teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const { data } = await supabase
        .from("competition_entries")
        .select("id, status, competition_id, division_id, competitions:competition_id(name, sport, season, status), competition_divisions:division_id(name)")
        .eq("team_id", teamId)
        .in("status", ["invited", "accepted"]);
      return data ?? [];
    },
  });

  const respond = async (entryId: string, status: "accepted" | "declined") => {
    setRespondingId(entryId);
    const { error } = await supabase
      .from("competition_entries")
      .update({ status, responded_by: user?.id, responded_at: new Date().toISOString() })
      .eq("id", entryId);
    setRespondingId(null);
    if (error) {
      toast({ title: "Could not respond", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: status === "accepted" ? "Invite accepted" : "Invite declined" });
    qc.invalidateQueries({ queryKey: ["team-competition-entries", teamId] });
  };

  const invited = entries.filter((e: any) => e.status === "invited");
  const accepted = entries.filter((e: any) => e.status === "accepted");

  if (entries.length === 0) return null;

  return (
    <Accordion type="multiple" defaultValue={invited.length > 0 ? ["team-competitions"] : []} className="space-y-4">
      <AccordionItem value="team-competitions" className="border rounded-lg px-4">
        <AccordionTrigger className="hover:no-underline">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            <span className="text-lg font-semibold">Competitions</span>
            <Badge className="ml-2 font-semibold bg-primary/20 text-primary dark:text-primary-foreground dark:bg-primary">
              {entries.length}
            </Badge>
            {invited.length > 0 && (
              <Badge variant="destructive" className="ml-1">{invited.length} new</Badge>
            )}
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4 pt-2">
            {invited.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground">Pending invites</h3>
                {invited.map((e: any) => (
                  <Card key={e.id} className="border-primary/40">
                    <CardContent className="p-3 space-y-3">
                      <Link to={`/competitions/${e.competition_id}`} className="flex items-center gap-3">
                        <Trophy className="h-4 w-4 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">{e.competitions?.name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {[e.competitions?.sport, e.competitions?.season, e.competition_divisions?.name].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                      </Link>
                      {canManage && (
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => respond(e.id, "accepted")} disabled={respondingId === e.id}>
                            {respondingId === e.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="h-4 w-4 mr-1" /> Accept</>}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => respond(e.id, "declined")} disabled={respondingId === e.id}>
                            <X className="h-4 w-4 mr-1" /> Decline
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {accepted.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground">Entered</h3>
                {accepted.map((e: any) => (
                  <Link key={e.id} to={`/competitions/${e.competition_id}`} className="block">
                    <Card className="hover:border-primary transition-colors">
                      <CardContent className="p-3 flex items-center gap-3">
                        <Trophy className="h-4 w-4 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{e.competitions?.name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {[e.competitions?.sport, e.competitions?.season, e.competition_divisions?.name].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
