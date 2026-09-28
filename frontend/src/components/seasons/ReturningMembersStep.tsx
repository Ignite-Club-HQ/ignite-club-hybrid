import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, AlertTriangle, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface ReturningPlayer {
  club_player_id: string;
  display_name: string;
  date_of_birth: string | null;
  age_years: number | null;
  previous_team_id: string;
  previous_team_name: string;
  membership_role: string;
}

interface TargetTeam {
  id: string;
  name: string;
}

interface Props {
  sourceSeasonId: string;
  targetSeasonId: string | null;
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
  /** club_player_id -> target team id (or null = unassigned) */
  assignments: Record<string, string | null>;
  onAssignmentsChange: (next: Record<string, string | null>) => void;
}

const UNASSIGNED = "__unassigned__";

export function ReturningMembersStep({
  sourceSeasonId,
  targetSeasonId,
  selectedIds,
  onChange,
  assignments,
  onAssignmentsChange,
}: Props) {
  const [filter, setFilter] = useState("");

  const { data: players = [], isLoading } = useQuery({
    queryKey: ["returning-players", sourceSeasonId],
    queryFn: async (): Promise<ReturningPlayer[]> => {
      const { data, error } = await supabase.rpc("get_returning_players", {
        _source_season_id: sourceSeasonId,
      });
      if (error) throw error;
      return (data ?? []) as ReturningPlayer[];
    },
  });

  const { data: targetTeams = [] } = useQuery({
    queryKey: ["season-target-teams", targetSeasonId],
    enabled: !!targetSeasonId,
    queryFn: async (): Promise<TargetTeam[]> => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name")
        .eq("season_id", targetSeasonId!)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []) as TargetTeam[];
    },
  });

  // Seed default assignments: same-named team in the new season, else unassigned.
  useEffect(() => {
    if (players.length === 0) return;
    const seeded: Record<string, string | null> = {};
    let changed = false;
    players.forEach((p) => {
      if (p.club_player_id in assignments) {
        seeded[p.club_player_id] = assignments[p.club_player_id];
        return;
      }
      const match = targetTeams.find((t) => t.name === p.previous_team_name);
      seeded[p.club_player_id] = match?.id ?? null;
      changed = true;
    });
    if (changed) onAssignmentsChange({ ...assignments, ...seeded });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, targetTeams]);

  const grouped = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const filtered = f
      ? players.filter((p) => p.display_name.toLowerCase().includes(f))
      : players;
    const map = new Map<string, ReturningPlayer[]>();
    filtered.forEach((p) => {
      const key = p.previous_team_name;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [players, filter]);

  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const toggleGroup = (groupPlayers: ReturningPlayer[]) => {
    const next = new Set(selectedIds);
    const allSelected = groupPlayers.every((p) => next.has(p.club_player_id));
    if (allSelected) {
      groupPlayers.forEach((p) => next.delete(p.club_player_id));
    } else {
      groupPlayers.forEach((p) => next.add(p.club_player_id));
    }
    onChange(next);
  };

  const setAssignment = (playerId: string, teamId: string | null) => {
    onAssignmentsChange({ ...assignments, [playerId]: teamId });
  };

  /** Bulk "move whole old team into a new team" — the common junior grade bump. */
  const moveGroup = (groupPlayers: ReturningPlayer[], teamId: string | null) => {
    const next = { ...assignments };
    const nextSel = new Set(selectedIds);
    groupPlayers.forEach((p) => {
      next[p.club_player_id] = teamId;
      if (teamId) nextSel.add(p.club_player_id);
    });
    onAssignmentsChange(next);
    onChange(nextSel);
  };

  const selectAll = () => onChange(new Set(players.map((p) => p.club_player_id)));
  const clearAll = () => onChange(new Set());

  const unassignedSelected = useMemo(
    () => Array.from(selectedIds).filter((id) => !assignments[id]).length,
    [selectedIds, assignments],
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (players.length === 0) {
    return (
      <div className="text-center py-8 space-y-2">
        <Users className="h-8 w-8 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No players from the previous season to carry over.
        </p>
        <p className="text-xs text-muted-foreground">
          You can assign players to teams later from each team page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <Users className="h-5 w-5 text-muted-foreground mt-0.5" />
        <div className="flex-1">
          <h3 className="font-semibold">Returning members</h3>
          <p className="text-sm text-muted-foreground">
            Most juniors change grade each year — set the new team for each player.
            Use the row at the top of an old team to move the whole group at once.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search players…"
          className="flex-1 h-9 px-3 rounded-md border bg-background text-sm"
        />
        <Button variant="ghost" size="sm" onClick={selectAll}>All</Button>
        <Button variant="ghost" size="sm" onClick={clearAll}>None</Button>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>{selectedIds.size} of {players.length} selected</span>
        {unassignedSelected > 0 && (
          <span className="text-warning">{unassignedSelected} without a new team</span>
        )}
      </div>

      <ScrollArea className="h-[300px] rounded-lg border">
        <div className="p-2 space-y-4">
          {grouped.map(([teamName, groupPlayers]) => {
            const allSelected = groupPlayers.every((p) => selectedIds.has(p.club_player_id));
            const someSelected = groupPlayers.some((p) => selectedIds.has(p.club_player_id));
            const groupTargets = new Set(
              groupPlayers.map((p) => assignments[p.club_player_id] ?? UNASSIGNED),
            );
            const groupValue = groupTargets.size === 1 ? Array.from(groupTargets)[0] : "";
            return (
              <div key={teamName} className="space-y-1">
                <div className="flex items-center gap-2 px-1">
                  <div className="flex items-center gap-2 flex-1 min-w-0 py-1 rounded">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={() => toggleGroup(groupPlayers)}
                      aria-label={`Select all players from ${teamName}`}
                    />
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground truncate">
                      {teamName}
                    </span>
                    <span className="text-xs text-muted-foreground">{groupPlayers.length}</span>
                  </div>

                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <Select
                    value={groupValue}
                    onValueChange={(v) => moveGroup(groupPlayers, v === UNASSIGNED ? null : v)}
                  >
                    <SelectTrigger className="h-8 w-[150px] text-xs shrink-0" aria-label={`Move all players from ${teamName} to a new team`}>

                      <SelectValue placeholder="Move all to…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>No team yet</SelectItem>
                      {targetTeams.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="ml-2 space-y-0.5">
                  {groupPlayers.map((p) => {
                    const checked = selectedIds.has(p.club_player_id);
                    const ageFlag = p.age_years != null && p.age_years >= 18;
                    const target = assignments[p.club_player_id] ?? null;
                    return (
                      <div
                        key={p.club_player_id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggle(p.club_player_id)}
                          aria-label={`Select ${p.display_name}`}
                        />

                        <span className="text-sm flex-1 truncate">{p.display_name}</span>
                        {p.age_years != null && (
                          <Badge variant="outline" className="text-xs h-5 shrink-0">
                            {p.age_years}y
                          </Badge>
                        )}
                        {ageFlag && (
                          <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
                        )}
                        <Select
                          value={target ?? UNASSIGNED}
                          onValueChange={(v) =>
                            setAssignment(p.club_player_id, v === UNASSIGNED ? null : v)
                          }
                        >
                          <SelectTrigger className="h-8 w-[150px] text-xs shrink-0" aria-label={`New team for ${p.display_name}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNASSIGNED}>No team yet</SelectItem>
                            {targetTeams.map((t) => (
                              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <p className="text-xs text-muted-foreground">
        Players left on "No team yet" still join the new season's club roster — you can place
        them from the team pages once grades are confirmed.
      </p>
    </div>
  );
}
