import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";

/** Upcoming competition-wide events (one shared event, not team copies). */
export function CompetitionEventsList({ competitionId }: { competitionId: string }) {
  const { data: events = [] } = useQuery({
    queryKey: ["competition-events", competitionId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("events")
        .select("id, title, event_date, location_name, location, is_cancelled")
        .eq("competition_id", competitionId)
        .is("team_id", null)
        .gte("event_date", new Date(Date.now() - 12 * 3600 * 1000).toISOString())
        .order("event_date", { ascending: true })
        .limit(20);
      if (error) throw error;
      return (data ?? []).filter((e: any) => !e.is_cancelled);
    },
  });
  if (events.length === 0) return null;
  return (
    <Card>
      <CardContent className="p-3 space-y-1">
        <p className="text-sm font-semibold px-1 pb-1">Competition events</p>
        {events.map((e: any) => (
          <Link key={e.id} to={`/events/${e.id}`} className="flex items-center gap-3 rounded-md px-1 py-2 hover:bg-muted/50">
            <CalendarDays className="h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{e.title}</p>
              <p className="text-xs text-muted-foreground truncate">
                {format(new Date(e.event_date), "EEE d MMM, h:mm a")}
                {(e.location_name || e.location) ? ` · ${e.location_name || e.location}` : ""}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
