import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Clock, Users, CalendarDays } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TODAY_INDEX = new Date().getDay(); // 0=Sun
const JS_TO_DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const todayName = JS_TO_DAY_NAME[TODAY_INDEX];

/**
 * Shows upcoming enrolled classes for the logged-in parent's children.
 * Displays today's remaining classes first, then the next few days.
 */
export function UpcomingClassesWidget() {
  const { user } = useAuth();

  // 1. Get parent's children
  const { data: children = [] } = useQuery({
    queryKey: ["widget-children", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("children")
        .select("id, name")
        .eq("parent_id", user!.id);
      return data || [];
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const childIds = children.map(c => c.id);

  // 2. Get active enrolments for these children
  const { data: enrolments = [] } = useQuery({
    queryKey: ["widget-child-enrolments", childIds],
    queryFn: async () => {
      const { data } = await supabase
        .from("class_enrolments")
        .select("team_id, child_id")
        .in("child_id", childIds)
        .eq("status", "enrolled");
      return data || [];
    },
    enabled: childIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const enrolledTeamIds = [...new Set(enrolments.map(e => e.team_id))];

  // 3. Get class details for enrolled teams
  const { data: classes = [] } = useQuery({
    queryKey: ["widget-class-details", enrolledTeamIds],
    queryFn: async () => {
      const { data } = await supabase
        .from("teams")
        .select("id, name, class_day, class_time, class_duration_minutes, level_age, club_id, clubs!club_id(name)")
        .in("id", enrolledTeamIds)
        .eq("is_archived", false)
        .not("class_day", "is", null);
      return (data || []) as Array<{
        id: string;
        name: string;
        class_day: string | null;
        class_time: string | null;
        class_duration_minutes: number | null;
        level_age: string | null;
        club_id: string;
        clubs: { name: string } | null;
      }>;
    },
    enabled: enrolledTeamIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  if (classes.length === 0) return null;

  // Build child name map per class
  const childNamesByTeam: Record<string, string[]> = {};
  enrolments.forEach(e => {
    const child = children.find(c => c.id === e.child_id);
    if (child) {
      if (!childNamesByTeam[e.team_id]) childNamesByTeam[e.team_id] = [];
      if (!childNamesByTeam[e.team_id].includes(child.name)) {
        childNamesByTeam[e.team_id].push(child.name);
      }
    }
  });

  // Sort classes: today first, then upcoming days in order
  const todayIdx = DAY_ORDER.indexOf(todayName);
  const sortedClasses = [...classes].sort((a, b) => {
    const aIdx = DAY_ORDER.indexOf(a.class_day || "");
    const bIdx = DAY_ORDER.indexOf(b.class_day || "");
    // Rotate so today comes first
    const aRot = (aIdx - todayIdx + 7) % 7;
    const bRot = (bIdx - todayIdx + 7) % 7;
    if (aRot !== bRot) return aRot - bRot;
    // Same day: sort by time
    return (a.class_time || "").localeCompare(b.class_time || "");
  });

  // Show max 4 upcoming classes
  const displayClasses = sortedClasses.slice(0, 4);

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <CalendarDays className="h-5 w-5 text-primary" />
        Upcoming Classes
      </h2>
      <div className="space-y-2">
        {displayClasses.map(cls => {
          const isToday = cls.class_day === todayName;
          const names = childNamesByTeam[cls.id] || [];

          return (
            <Link key={cls.id} to={`/clubs/${cls.club_id}/enrol`}>
              <Card className={`hover:border-primary/30 transition-colors ${isToday ? "border-primary/30 bg-primary/5" : ""}`}>
                <CardContent className="py-2.5 px-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{cls.name}</span>
                        {isToday && <Badge variant="default" className="text-[10px] px-1.5 py-0 shrink-0">Today</Badge>}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <span>{cls.class_day}</span>
                        {cls.class_time && (
                          <span className="flex items-center gap-0.5">
                            <Clock className="h-3 w-3" />
                            {cls.class_time.slice(0, 5)}
                          </span>
                        )}
                        {cls.class_duration_minutes && <span>{cls.class_duration_minutes} mins</span>}
                        {cls.level_age && <span>{cls.level_age}</span>}
                      </div>
                      {names.length > 0 && (
                        <div className="flex items-center gap-1 mt-1">
                          <Users className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">{names.join(", ")}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
