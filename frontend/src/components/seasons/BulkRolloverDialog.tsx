import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Users, UserX } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceSeasonId: string;
  targetSeasonId: string;
  onComplete?: () => void;
}

interface ReturningPlayer {
  club_player_id: string;
  display_name: string;
  previous_team_id: string;
  previous_team_name: string;
}

export function BulkRolloverDialog({
  open,
  onOpenChange,
  sourceSeasonId,
  targetSeasonId,
  onComplete,
}: Props) {
  const qc = useQueryClient();
  const [teamChoices, setTeamChoices] = useState<Record<string, boolean>>({});

  const { data: players = [], isLoading } = useQuery({
    queryKey: ["bulk-rollover-players", sourceSeasonId],
    queryFn: async (): Promise<ReturningPlayer[]> => {
      const { data, error } = await supabase.rpc("get_returning_players", {
        _source_season_id: sourceSeasonId,
      });
      if (error) throw error;
      return (data ?? []) as ReturningPlayer[];
    },
    enabled: open,
  });

  const teamGroups = useMemo(() => {
    const map = new Map<string, { team_name: string; players: ReturningPlayer[] }>();
    players.forEach((p) => {
      if (!map.has(p.previous_team_id)) {
        map.set(p.previous_team_id, { team_name: p.previous_team_name, players: [] });
      }
      map.get(p.previous_team_id)!.players.push(p);
    });
    return Array.from(map.entries())
      .map(([id, v]) => ({ team_id: id, ...v }))
      .sort((a, b) => a.team_name.localeCompare(b.team_name));
  }, [players]);

  // Default: all teams on
  useMemo(() => {
    if (teamGroups.length > 0 && Object.keys(teamChoices).length === 0) {
      const initial: Record<string, boolean> = {};
      teamGroups.forEach((g) => (initial[g.team_id] = true));
      setTeamChoices(initial);
    }
  }, [teamGroups, teamChoices]);

  const selectedPlayerIds = useMemo(() => {
    const ids: string[] = [];
    teamGroups.forEach((g) => {
      if (teamChoices[g.team_id]) {
        g.players.forEach((p) => ids.push(p.club_player_id));
      }
    });
    return ids;
  }, [teamGroups, teamChoices]);

  const rollMut = useMutation({
    mutationFn: async () => {
      if (selectedPlayerIds.length === 0) return 0;
      const { data, error } = await supabase.rpc("carry_over_players", {
        _source_season_id: sourceSeasonId,
        _target_season_id: targetSeasonId,
        _club_player_ids: selectedPlayerIds,
      });
      if (error) throw error;
      return data ?? 0;
    },
    onSuccess: (count) => {
      toast.success(
        count > 0
          ? `Rolled over ${count} player${count === 1 ? "" : "s"}`
          : "No players rolled over",
      );
      qc.invalidateQueries({ queryKey: ["season-teams"] });
      qc.invalidateQueries({ queryKey: ["season-team-player-counts"] });
      onOpenChange(false);
      onComplete?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleTeam = (teamId: string) => {
    setTeamChoices((prev) => ({ ...prev, [teamId]: !prev[teamId] }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Bulk roll over teams</DialogTitle>
          <DialogDescription>
            Choose which teams to carry players across. Players are matched to the team with the same name in the new season.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : teamGroups.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No players to roll over from the previous season.
          </div>
        ) : (
          <ScrollArea className="flex-1 -mx-6 px-6">
            <div className="space-y-2 py-2">
              {teamGroups.map((g) => {
                const on = !!teamChoices[g.team_id];
                return (
                  <div
                    key={g.team_id}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg border"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{g.team_name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        {on ? (
                          <>
                            <Users className="h-3 w-3" />
                            Carry {g.players.length} player{g.players.length === 1 ? "" : "s"}
                          </>
                        ) : (
                          <>
                            <UserX className="h-3 w-3" />
                            Start empty
                          </>
                        )}
                      </p>
                    </div>
                    <Badge variant="outline" className="flex-shrink-0">
                      {g.players.length}
                    </Badge>
                    <Switch checked={on} onCheckedChange={() => toggleTeam(g.team_id)} />
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => rollMut.mutate()}
            disabled={rollMut.isPending || selectedPlayerIds.length === 0}
          >
            {rollMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Roll over {selectedPlayerIds.length} player
            {selectedPlayerIds.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
