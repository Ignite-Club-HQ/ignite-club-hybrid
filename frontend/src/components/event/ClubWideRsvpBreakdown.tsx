/**
 * Companion attendance view for club-wide events (`events.team_id IS NULL`)
 * with an admin-selected `rsvp_grouping` of `'level'` or `'team'`.
 *
 * Renders one collapsible section per group (age level, e.g. U8, or team name,
 * e.g. U8 Blue), each with Going / Maybe / Not Going / No Response counts
 * and expandable name lists. The existing flat `<AttendanceSection>` still
 * renders below this for full detail.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

type Grouping = "level" | "team";
type RsvpStatus = "going" | "maybe" | "not_going";

interface Props {
  eventId: string;
  clubId: string;
  grouping: Grouping;
  /** When set, restrict members to those on any of these teams. */
  targetTeamIds?: string[] | null;
}

interface Attendee {
  name: string;
  team: string | null;
}

interface GroupRow {
  key: string;
  label: string;
  going: Attendee[];
  maybe: Attendee[];
  not_going: Attendee[];
  no_response: Attendee[];
}

const AGE_LEVEL_RE = /u\s*(\d+)/i;

function extractAgeLevel(source: string | null | undefined): string | null {
  if (!source) return null;
  const m = source.match(AGE_LEVEL_RE);
  if (!m) return null;
  return `U${parseInt(m[1], 10)}`;
}

function sortGroupKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const na = a.match(/^U(\d+)/i);
    const nb = b.match(/^U(\d+)/i);
    if (na && nb) {
      const diff = parseInt(na[1], 10) - parseInt(nb[1], 10);
      if (diff !== 0) return diff;
    }
    return a.localeCompare(b);
  });
}

export function ClubWideRsvpBreakdown({ eventId, clubId, grouping, targetTeamIds }: Props) {
  const targetSet = useMemo(
    () => (Array.isArray(targetTeamIds) && targetTeamIds.length > 0 ? new Set(targetTeamIds) : null),
    [targetTeamIds],
  );
  const { data, isLoading } = useQuery({
    queryKey: ["club-wide-rsvp-breakdown", eventId, clubId, grouping, targetTeamIds?.join(",") ?? ""],
    queryFn: async () => {
      // 1. Teams in the club (id, name, age_group) — filter to target teams if set.
      let teamsQ = supabase
        .from("teams")
        .select("id, name, age_group")
        .eq("club_id", clubId);
      if (targetSet) teamsQ = teamsQ.in("id", Array.from(targetSet));
      const { data: teams } = await teamsQ;

      // 2. Adult club members via user_roles.club_id (with any team_id present)
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, team_id, role, profiles:user_id (id, display_name)")
        .eq("club_id", clubId);

      // 3. Children on any team in this club
      const teamIds = (teams ?? []).map((t: any) => t.id);
      const { data: assignments } = teamIds.length
        ? await supabase
            .from("child_team_assignments")
            .select("child_id, team_id, children (id, name)")
            .in("team_id", teamIds)
        : { data: [] as any[] };

      // 4. RSVPs for this event
      const { data: rsvps } = await supabase
        .from("rsvps")
        .select("user_id, child_id, status")
        .eq("event_id", eventId);

      return { teams: teams ?? [], roles: roles ?? [], assignments: assignments ?? [], rsvps: rsvps ?? [] };
    },
    enabled: !!eventId && !!clubId,
    staleTime: 30_000,
  });

  const groups: GroupRow[] = useMemo(() => {
    if (!data) return [];
    const { teams, roles, assignments, rsvps } = data;

    // Build lookup: team_id → { name, age_group }
    const teamMeta = new Map<string, { name: string; age_group: string | null }>();
    for (const t of teams as any[]) {
      teamMeta.set(t.id, { name: t.name, age_group: t.age_group });
    }

    // Members: [{ id, name, groupKey, groupLabel, team }]
    type Member = { id: string; name: string; groupKey: string; groupLabel: string; team: string | null };
    const members: Member[] = [];
    const seenIds = new Set<string>();

    // Adults from user_roles
    for (const r of roles as any[]) {
      const profile = r.profiles;
      if (!profile) continue;
      const id = profile.id as string;
      const teamId = r.team_id as string | null;
      // When targeting a subset of teams, exclude adults not on those teams.
      if (targetSet && (!teamId || !targetSet.has(teamId))) continue;
      const meta = teamId ? teamMeta.get(teamId) : undefined;
      let groupKey: string;
      let groupLabel: string;
      if (grouping === "team") {
        groupKey = meta?.name || "__unassigned__";
        groupLabel = meta?.name || "Unassigned";
      } else {
        const lvl = extractAgeLevel(meta?.age_group) || extractAgeLevel(meta?.name);
        groupKey = lvl || "__unassigned__";
        groupLabel = lvl || "Unassigned";
      }
      const key = `${id}::${groupKey}`;
      if (seenIds.has(key)) continue;
      seenIds.add(key);
      members.push({ id, name: profile.display_name || "Member", groupKey, groupLabel, team: meta?.name || null });
    }

    // Children from team assignments
    for (const a of assignments as any[]) {
      const child = a.children;
      if (!child) continue;
      const id = child.id as string;
      const meta = teamMeta.get(a.team_id);
      let groupKey: string;
      let groupLabel: string;
      if (grouping === "team") {
        groupKey = meta?.name || "__unassigned__";
        groupLabel = meta?.name || "Unassigned";
      } else {
        const lvl = extractAgeLevel(meta?.age_group) || extractAgeLevel(meta?.name);
        groupKey = lvl || "__unassigned__";
        groupLabel = lvl || "Unassigned";
      }
      const key = `${id}::${groupKey}`;
      if (seenIds.has(key)) continue;
      seenIds.add(key);
      members.push({ id, name: child.name || "Player", groupKey, groupLabel, team: meta?.name || null });
    }

    // RSVP status per attendee (child_id preferred, else user_id)
    const rsvpStatus = new Map<string, RsvpStatus>();
    for (const r of rsvps as any[]) {
      const key = r.child_id || r.user_id;
      if (!key) continue;
      if (r.status === "going" || r.status === "maybe" || r.status === "not_going") {
        rsvpStatus.set(key, r.status);
      }
    }

    // Assemble groups
    const groupMap = new Map<string, GroupRow>();
    for (const m of members) {
      if (!groupMap.has(m.groupKey)) {
        groupMap.set(m.groupKey, {
          key: m.groupKey,
          label: m.groupLabel,
          going: [],
          maybe: [],
          not_going: [],
          no_response: [],
        });
      }
      const grp = groupMap.get(m.groupKey)!;
      const status = rsvpStatus.get(m.id);
      const attendee: Attendee = { name: m.name, team: m.team };
      if (status === "going") grp.going.push(attendee);
      else if (status === "maybe") grp.maybe.push(attendee);
      else if (status === "not_going") grp.not_going.push(attendee);
      else grp.no_response.push(attendee);
    }

    const sortedKeys = sortGroupKeys([...groupMap.keys()]);
    return sortedKeys.map((k) => groupMap.get(k)!);
  }, [data, grouping, targetSet]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground text-center">
          Loading grouped attendance…
        </CardContent>
      </Card>
    );
  }

  if (groups.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-primary" />
          Attendance by {grouping === "level" ? "age level" : "team"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {groups.map((g) => (
          <GroupRowItem key={g.key} group={g} showTeamTag={grouping === "level"} />
        ))}
      </CardContent>
    </Card>
  );
}

function GroupRowItem({ group, showTeamTag }: { group: GroupRow; showTeamTag: boolean }) {
  const [open, setOpen] = useState(false);
  const total =
    group.going.length + group.maybe.length + group.not_going.length + group.no_response.length;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between px-3 py-2 h-auto"
        >
          <div className="flex items-center gap-2">
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", open ? "" : "-rotate-90")}
            />
            <span className="font-medium">{group.label}</span>
            <span className="text-xs text-muted-foreground">({total})</span>
          </div>
          <div className="flex items-center gap-1">
            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              {group.going.length} going
            </Badge>
            {group.maybe.length > 0 && (
              <Badge variant="secondary" className="bg-amber-500/10 text-amber-700 dark:text-amber-300">
                {group.maybe.length} maybe
              </Badge>
            )}
            {group.not_going.length > 0 && (
              <Badge variant="secondary" className="bg-red-500/10 text-red-700 dark:text-red-300">
                {group.not_going.length} no
              </Badge>
            )}
            {group.no_response.length > 0 && (
              <Badge variant="outline" className="text-muted-foreground">
                {group.no_response.length} n/r
              </Badge>
            )}
          </div>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        <NameBlock title="Going" people={group.going} tone="going" showTeamTag={showTeamTag} />
        <NameBlock title="Maybe" people={group.maybe} tone="maybe" showTeamTag={showTeamTag} />
        <NameBlock title="Not Going" people={group.not_going} tone="no" showTeamTag={showTeamTag} />
        <NameBlock title="No Response" people={group.no_response} tone="nr" showTeamTag={showTeamTag} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function NameBlock({
  title,
  people,
  tone,
  showTeamTag,
}: {
  title: string;
  people: Attendee[];
  tone: "going" | "maybe" | "no" | "nr";
  showTeamTag: boolean;
}) {
  if (people.length === 0) return null;
  const toneClass =
    tone === "going"
      ? "text-emerald-700 dark:text-emerald-300"
      : tone === "maybe"
      ? "text-amber-700 dark:text-amber-300"
      : tone === "no"
      ? "text-red-700 dark:text-red-300"
      : "text-muted-foreground";
  return (
    <div className="mt-2">
      <div className={cn("text-xs font-semibold mb-1", toneClass)}>
        {title} ({people.length})
      </div>
      <div className="text-sm text-foreground/90 leading-relaxed flex flex-wrap gap-x-2 gap-y-1.5">
        {people.map((p, i) => (
          <span key={`${p.name}-${i}`} className="inline-flex items-center gap-1">
            <span>{p.name}</span>
            {showTeamTag && p.team && (
              <span className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-tight bg-primary/10 text-primary border border-primary/20 whitespace-nowrap">
                {p.team}
              </span>
            )}
            {i < people.length - 1 && <span className="text-muted-foreground">,</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
