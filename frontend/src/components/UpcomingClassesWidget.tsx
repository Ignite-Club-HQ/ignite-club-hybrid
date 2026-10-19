import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Clock, Users, CalendarDays } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { withFeatureBackend } from "@/live/featureRouter";
import { fetchLiveHomeChildren } from "@/live/features/homeFeed";
import { getLiveMyRoleGrants, listLiveChildren } from "@/live/features/membership";
import { getLiveClubProfile, listLiveTeams, listLiveClassEnrolments } from "@/live/features/club";

const DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TODAY_INDEX = new Date().getDay(); // 0=Sun
const JS_TO_DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const todayName = JS_TO_DAY_NAME[TODAY_INDEX];

interface WidgetClass {
  id: string;
  name: string;
  class_day: string | null;
  class_time: string | null;
  class_duration_minutes: number | null;
  level_age: string | null;
  club_id: string;
  clubs: { name: string } | null;
}

interface WidgetData {
  classes: WidgetClass[];
  childNamesByTeam: Record<string, string[]>;
}

/**
 * Shows upcoming enrolled classes for the logged-in parent's children.
 * Displays today's remaining classes first, then the next few days.
 */
export function UpcomingClassesWidget() {
  const { user } = useAuth();

  const { data } = useQuery<WidgetData>({
    queryKey: ["widget-upcoming-classes", user?.id],
    queryFn: async (): Promise<WidgetData> => {
      return withFeatureBackend("membership", {
        supabase: async () => {
          // 1. Get parent's children
          const { data: children } = await supabase
            .from("children")
            .select("id, name")
            .eq("parent_id", user!.id);
          const childRows = children || [];
          const childIds = childRows.map((c) => c.id);
          if (childIds.length === 0) return { classes: [], childNamesByTeam: {} };

          // 2. Get active enrolments for these children
          const { data: enrolments } = await supabase
            .from("class_enrolments")
            .select("team_id, child_id")
            .in("child_id", childIds)
            .eq("status", "enrolled");
          const enrolmentRows = enrolments || [];
          const enrolledTeamIds = [...new Set(enrolmentRows.map((e) => e.team_id))];
          if (enrolledTeamIds.length === 0) return { classes: [], childNamesByTeam: {} };

          // 3. Get class details for enrolled teams
          const { data: teams } = await supabase
            .from("teams")
            .select("id, name, class_day, class_time, class_duration_minutes, level_age, club_id, clubs!club_id(name)")
            .in("id", enrolledTeamIds)
            .eq("is_archived", false)
            .not("class_day", "is", null);
          const classes = (teams || []) as WidgetClass[];

          const childNamesByTeam: Record<string, string[]> = {};
          enrolmentRows.forEach((e) => {
            const child = childRows.find((c) => c.id === e.child_id);
            if (child) {
              if (!childNamesByTeam[e.team_id]) childNamesByTeam[e.team_id] = [];
              if (!childNamesByTeam[e.team_id].includes(child.name)) {
                childNamesByTeam[e.team_id].push(child.name);
              }
            }
          });
          return { classes, childNamesByTeam };
        },
        icp: async (ctx) => {
          // 1. Children linked to this account (names decrypted best-effort)
          const [childrenWithNames, rawChildren, grants] = await Promise.all([
            fetchLiveHomeChildren(ctx).catch(() => []),
            listLiveChildren(ctx).catch(() => []),
            getLiveMyRoleGrants(ctx).catch(() => []),
          ]);
          const childIds = rawChildren.map((c) => c.id);
          if (childIds.length === 0) return { classes: [], childNamesByTeam: {} };
          const nameByChildId = new Map(childrenWithNames.map((c) => [c.id, c.name]));

          // 2. Clubs to scan: the children's own clubs plus every club the
          // caller has a role in (covers children whose club link is unset).
          const clubIds = new Set<string>();
          rawChildren.forEach((c) => {
            const cid = c.club_id?.[0];
            if (cid) clubIds.add(cid);
          });
          grants.forEach((g) => {
            const cid = g.club?.[0];
            if (cid) clubIds.add(cid);
          });
          if (clubIds.size === 0) return { classes: [], childNamesByTeam: {} };

          // 3. Per club: enrolments for these children + class details.
          const classes: WidgetClass[] = [];
          const childNamesByTeam: Record<string, string[]> = {};
          await Promise.all(
            [...clubIds].map(async (clubId) => {
              const [enrolments, teams, profile] = await Promise.all([
                listLiveClassEnrolments(ctx, clubId).catch(() => []),
                listLiveTeams(ctx, clubId).catch(() => []),
                getLiveClubProfile(ctx, clubId).catch(() => [] as [] | [{ name: string }]),
              ]);
              const clubName = profile[0]?.name ?? null;
              const mine = enrolments.filter(
                (e) => e.status === "enrolled" && childIds.includes(e.member_id),
              );
              if (mine.length === 0) return;
              const teamById = new Map(teams.map((t) => [t.id, t]));
              mine.forEach((e) => {
                const t = teamById.get(e.class_id);
                if (!t || t.archived || !t.class_day?.[0]) return;
                if (!classes.some((c) => c.id === t.id)) {
                  classes.push({
                    id: t.id,
                    name: t.name,
                    class_day: t.class_day[0] || null,
                    class_time: t.class_time?.[0] || null,
                    class_duration_minutes: t.class_duration_minutes?.[0]
                      ? Number(t.class_duration_minutes[0])
                      : null,
                    level_age: t.level_age?.[0] || null,
                    club_id: clubId,
                    clubs: clubName ? { name: clubName } : null,
                  });
                }
                const childName = nameByChildId.get(e.member_id);
                if (childName) {
                  if (!childNamesByTeam[t.id]) childNamesByTeam[t.id] = [];
                  if (!childNamesByTeam[t.id].includes(childName)) {
                    childNamesByTeam[t.id].push(childName);
                  }
                }
              });
            }),
          );
          return { classes, childNamesByTeam };
        },
      }, { everyGroup: true, merge: (parts: any[]) => ({ classes: parts.flatMap((p) => p.classes), childNamesByTeam: Object.assign({}, ...parts.map((p) => p.childNamesByTeam)) }) });
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const classes = data?.classes ?? [];
  const childNamesByTeam = data?.childNamesByTeam ?? {};

  if (classes.length === 0) return null;

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
