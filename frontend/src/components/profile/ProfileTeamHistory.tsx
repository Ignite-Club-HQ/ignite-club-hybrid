import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, History, Trophy, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useProfileTeamHistory, type ProfileTeamHistoryEntry } from "@/hooks/useProfileTeamHistory";
import { format } from "date-fns";

interface Props {
  profileId: string | undefined;
}

export function ProfileTeamHistory({ profileId }: Props) {
  const navigate = useNavigate();
  const [pastOpen, setPastOpen] = useState(false);
  const { data: history = [], isLoading } = useProfileTeamHistory(profileId);

  const { current, past } = useMemo(() => {
    const curr: ProfileTeamHistoryEntry[] = [];
    const p: ProfileTeamHistoryEntry[] = [];
    history.forEach((h) => {
      if (h.season_status === "active" || h.season_status === "draft") curr.push(h);
      else p.push(h);
    });
    return { current: curr, past: p };
  }, [history]);

  if (isLoading || history.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Trophy className="h-5 w-5 text-primary" />
          Team History
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {current.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Current
            </p>
            {current.map((t) => (
              <button
                key={t.membership_id}
                onClick={() => navigate(`/teams/${t.team_id}`)}
                className="w-full flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors text-left"
              >
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{t.team_name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {t.club_name} · {t.season_name}
                    {t.team_level_age ? ` · ${t.team_level_age}` : ""}
                  </p>
                </div>
                <Badge variant="default" className="flex-shrink-0 capitalize">
                  {t.season_status}
                </Badge>
              </button>
            ))}
          </div>
        )}

        {past.length > 0 && (
          <Collapsible open={pastOpen} onOpenChange={setPastOpen}>
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 transition-colors text-left">
                <History className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  Past teams ({past.length})
                </span>
                <ChevronDown
                  className={`h-4 w-4 ml-auto text-muted-foreground transition-transform ${pastOpen ? "rotate-180" : ""}`}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-2">
              {past.map((t) => (
                <button
                  key={t.membership_id}
                  onClick={() => navigate(`/teams/${t.team_id}`)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border bg-muted/20 hover:bg-muted/50 transition-colors text-left"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{t.team_name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {t.club_name} · {t.season_name}
                      {t.season_start_date
                        ? ` · ${format(new Date(t.season_start_date), "MMM yyyy")}`
                        : ""}
                    </p>
                  </div>
                  <Badge variant="secondary" className="flex-shrink-0 capitalize">
                    {t.season_status}
                  </Badge>
                </button>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
