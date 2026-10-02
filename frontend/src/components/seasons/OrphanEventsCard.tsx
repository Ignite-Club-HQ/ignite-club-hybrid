import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Calendar } from "lucide-react";
import { format } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { resolveAuthBackend } from "@/live/authBackendMode";

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
  // NEEDS-CANISTER: orphan-event detection has no canister equivalent yet;
  // an II principal has no Supabase session so skip the RPC and render nothing.
  const isIcp = resolveAuthBackend() === "icp";
  const { data: events = [], isLoading } = useQuery({
    queryKey: ["season-orphan-events", clubId],
    queryFn: async (): Promise<OrphanEvent[]> => {
      if (isIcp) return [];
      const { data, error } = await supabase.rpc("season_orphan_events", { _club_id: clubId });
      if (error) throw error;
      return (data ?? []) as OrphanEvent[];
    },
    enabled: !isIcp,
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
