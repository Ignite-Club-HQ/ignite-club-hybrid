import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarDays, Clock, Users, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

interface TodaysClassesDashboardProps {
  clubId: string;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function TodaysClassesDashboard({ clubId }: TodaysClassesDashboardProps) {
  const today = DAY_NAMES[new Date().getDay()];
  const todayDate = format(new Date(), "yyyy-MM-dd");

  // Fetch today's classes
  const { data: todaysClasses = [] } = useQuery({
    queryKey: ["todays-classes", clubId, today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, class_time, class_duration_minutes, class_capacity, level_age")
        .eq("club_id", clubId)
        .eq("is_archived", false)
        .eq("class_day", today)
        .order("class_time");
      if (error) throw error;
      return data;
    },
  });

  // Fetch active term
  const { data: activeTerm } = useQuery({
    queryKey: ["terms", clubId, "active-first"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("terms")
        .select("id, name")
        .eq("club_id", clubId)
        .eq("is_active", true)
        .order("start_date", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Fetch enrolment counts for today's classes
  const classIds = todaysClasses.map((c) => c.id);
  const { data: enrolmentCounts = {} } = useQuery({
    queryKey: ["todays-enrolment-counts", activeTerm?.id, classIds],
    queryFn: async () => {
      if (!activeTerm?.id || classIds.length === 0) return {};
      const { data, error } = await supabase
        .from("class_enrolments")
        .select("team_id")
        .eq("term_id", activeTerm.id)
        .in("team_id", classIds)
        .eq("status", "enrolled");
      if (error) throw error;
      const counts: Record<string, number> = {};
      data?.forEach((e) => {
        counts[e.team_id] = (counts[e.team_id] || 0) + 1;
      });
      return counts;
    },
    enabled: !!activeTerm?.id && classIds.length > 0,
  });

  // Fetch today's attendance records
  const { data: attendanceCounts = {} } = useQuery({
    queryKey: ["todays-attendance-counts", activeTerm?.id, todayDate, classIds],
    queryFn: async () => {
      if (!activeTerm?.id || classIds.length === 0) return {};
      const { data, error } = await supabase
        .from("class_attendance")
        .select("team_id, status")
        .eq("term_id", activeTerm.id)
        .eq("session_date", todayDate)
        .in("team_id", classIds);
      if (error) throw error;
      const counts: Record<string, { present: number; total: number }> = {};
      data?.forEach((a) => {
        if (!counts[a.team_id]) counts[a.team_id] = { present: 0, total: 0 };
        counts[a.team_id].total++;
        if (a.status === "present" || a.status === "late") counts[a.team_id].present++;
      });
      return counts;
    },
    enabled: !!activeTerm?.id && classIds.length > 0,
  });

  if (todaysClasses.length === 0) return null;

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">Today's Classes</h3>
          </div>
          <Badge variant="outline" className="text-xs">
            {today}
          </Badge>
        </div>

        <div className="space-y-2">
          {todaysClasses.map((cls) => {
            const enrolled = enrolmentCounts[cls.id] || 0;
            const att = attendanceCounts[cls.id];
            const hasAttendance = att && att.total > 0;

            return (
              <div
                key={cls.id}
                className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-background border"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{cls.name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    {cls.class_time && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {cls.class_time.slice(0, 5)}
                      </span>
                    )}
                    {cls.class_duration_minutes && (
                      <span>{cls.class_duration_minutes}m</span>
                    )}
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {enrolled}{cls.class_capacity ? `/${cls.class_capacity}` : ""}
                    </span>
                  </div>
                </div>
                <div className="shrink-0">
                  {hasAttendance ? (
                    <Badge variant="default" className="text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-600">
                      <CheckCircle2 className="h-3 w-3" />
                      {att.present}/{att.total}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] gap-1 text-amber-600 border-amber-300">
                      <AlertCircle className="h-3 w-3" />
                      Not taken
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
