import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  UserPlus,
  ArrowRightLeft,
  UserMinus,
  AlertTriangle,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "@/components/ui/drawer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const UNASSIGNED_ID = "__unassigned__";
const TEAM_MIN = 8;
const TEAM_MAX = 18;

interface Team {
  id: string;
  name: string;
  level_age?: string | null;
}

interface PlayerRow {
  membership_id: string | null; // null = not yet in season (raw club_player)
  club_player_id: string;
  display_name: string;
  date_of_birth: string | null;
  team_id: string | null; // null = unassigned
}

interface DraftTeamBuilderProps {
  clubId: string;
  seasonId: string;
  teams: Team[];
}

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}

export function DraftTeamBuilder({ clubId, seasonId, teams }: DraftTeamBuilderProps) {
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [moveTarget, setMoveTarget] = useState<PlayerRow | null>(null);
  const [removeTarget, setRemoveTarget] = useState<PlayerRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // All season memberships (active) for these teams + unassigned
  const { data: memberships = [] } = useQuery({
    queryKey: ["draft-builder-memberships", seasonId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_memberships")
        .select("id, club_player_id, team_id, role, status")
        .eq("season_id", seasonId)
        .eq("status", "active")
        .eq("role", "player");
      if (error) throw error;
      return data ?? [];
    },
  });

  // All club players (so we know name/dob and can add new ones)
  const { data: clubPlayers = [] } = useQuery({
    queryKey: ["club-players-active", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("club_players")
        .select("id, display_name, date_of_birth")
        .eq("club_id", clubId)
        .eq("is_active", true)
        .order("display_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const playersByMembership = useMemo<PlayerRow[]>(() => {
    const cpMap = new Map(clubPlayers.map((cp) => [cp.id, cp]));
    return memberships.map((m: any) => {
      const cp = cpMap.get(m.club_player_id);
      return {
        membership_id: m.id,
        club_player_id: m.club_player_id,
        display_name: cp?.display_name ?? "Unknown",
        date_of_birth: cp?.date_of_birth ?? null,
        team_id: m.team_id,
      };
    });
  }, [memberships, clubPlayers]);

  const grouped = useMemo(() => {
    const map: Record<string, PlayerRow[]> = { [UNASSIGNED_ID]: [] };
    teams.forEach((t) => (map[t.id] = []));
    playersByMembership.forEach((p) => {
      const key = p.team_id && map[p.team_id] ? p.team_id : UNASSIGNED_ID;
      map[key].push(p);
    });
    Object.values(map).forEach((arr) => arr.sort((a, b) => a.display_name.localeCompare(b.display_name)));
    return map;
  }, [playersByMembership, teams]);

  const inSeasonClubPlayerIds = useMemo(
    () => new Set(memberships.map((m: any) => m.club_player_id)),
    [memberships],
  );
  const playersNotInSeason = useMemo(
    () => clubPlayers.filter((cp) => !inSeasonClubPlayerIds.has(cp.id)),
    [clubPlayers, inSeasonClubPlayerIds],
  );

  const filterFn = (p: { display_name: string }) =>
    !search || p.display_name.toLowerCase().includes(search.toLowerCase());

  // ---- Mutations ----
  const moveMut = useMutation({
    mutationFn: async ({ player, newTeamId }: { player: PlayerRow; newTeamId: string | null }) => {
      if (player.membership_id) {
        if (newTeamId === null) {
          // Move to unassigned = remove from team but keep in season? We treat unassigned as removed=status active w/o team.
          // Schema requires team_id NOT NULL on team_memberships, so unassigned means: delete the row.
          const { error } = await supabase
            .from("team_memberships")
            .update({ status: "removed", removed_at: new Date().toISOString() })
            .eq("id", player.membership_id);
          if (error) throw error;
        } else {
          // Update team_id directly. Use upsert pattern: try update, on unique conflict treat as already there.
          const { error } = await supabase
            .from("team_memberships")
            .update({ team_id: newTeamId })
            .eq("id", player.membership_id);
          if (error) throw error;
        }
      } else if (newTeamId) {
        // Adding from club roster
        const { error } = await supabase.from("team_memberships").insert({
          club_player_id: player.club_player_id,
          team_id: newTeamId,
          season_id: seasonId,
          role: "player",
          status: "active",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["draft-builder-memberships", seasonId] });
      qc.invalidateQueries({ queryKey: ["season-team-player-counts", seasonId] });
      toast.success("Player moved");
      setMoveTarget(null);
      setAddOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMut = useMutation({
    mutationFn: async (player: PlayerRow) => {
      if (!player.membership_id) return;
      const { error } = await supabase
        .from("team_memberships")
        .update({ status: "removed", removed_at: new Date().toISOString() })
        .eq("id", player.membership_id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["draft-builder-memberships", seasonId] });
      qc.invalidateQueries({ queryKey: ["season-team-player-counts", seasonId] });
      toast.success("Player removed from season");
      setRemoveTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renderPlayerRow = (p: PlayerRow) => {
    const age = ageFromDob(p.date_of_birth);
    return (
      <button
        key={p.membership_id ?? p.club_player_id}
        onClick={() => setMoveTarget(p)}
        className="w-full flex items-center justify-between gap-2 p-2.5 rounded-md border bg-card hover:bg-muted/50 active:bg-muted transition text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{p.display_name}</p>
          {age !== null && <p className="text-xs text-muted-foreground">Age {age}</p>}
        </div>
        <ArrowRightLeft className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      </button>
    );
  };

  const renderSection = (
    sectionId: string,
    title: string,
    subtitle: string | null,
    players: PlayerRow[],
    showSizeWarning: boolean,
  ) => {
    const isCollapsed = collapsed[sectionId];
    const filtered = players.filter(filterFn);
    const tooSmall = showSizeWarning && players.length > 0 && players.length < TEAM_MIN;
    const tooLarge = showSizeWarning && players.length > TEAM_MAX;

    return (
      <div key={sectionId} className="border rounded-lg overflow-hidden">
        <button
          onClick={() => setCollapsed((c) => ({ ...c, [sectionId]: !c[sectionId] }))}
          className="w-full flex items-center gap-2 p-3 bg-muted/30 hover:bg-muted/50 transition text-left"
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4 flex-shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 flex-shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-medium truncate">{title}</p>
              {(tooSmall || tooLarge) && (
                <AlertTriangle className="h-3.5 w-3.5 text-warning flex-shrink-0" />
              )}
            </div>
            {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
          </div>
          <Badge variant={tooSmall || tooLarge ? "outline" : "secondary"} className="flex-shrink-0">
            {players.length}
          </Badge>
        </button>
        {!isCollapsed && (
          <div className="p-2 space-y-1.5 bg-background">
            {(tooSmall || tooLarge) && (
              <p className="text-xs text-warning px-1 py-0.5">
                {tooSmall ? `Only ${players.length} player${players.length === 1 ? "" : "s"} — typical squad is ${TEAM_MIN}–${TEAM_MAX}.` : `${players.length} players — above typical max of ${TEAM_MAX}.`}
              </p>
            )}
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground px-1 py-2">
                {search ? "No matches" : "No players"}
              </p>
            )}
            {filtered.map(renderPlayerRow)}
          </div>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">Draft team builder</CardTitle>
            <CardDescription>Tap a player to move them between teams.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <UserPlus className="h-4 w-4 mr-1.5" />
            Add
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search players"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        {renderSection(
          UNASSIGNED_ID,
          "Unassigned",
          "Players in the season but not on a team",
          grouped[UNASSIGNED_ID] ?? [],
          false,
        )}

        {teams.map((t) =>
          renderSection(t.id, t.name, t.level_age ?? null, grouped[t.id] ?? [], true),
        )}
      </CardContent>

      {/* Move drawer */}
      <Drawer open={!!moveTarget} onOpenChange={(o) => !o && setMoveTarget(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle>{moveTarget?.display_name}</DrawerTitle>
            <DrawerDescription>Move to a team or remove from this season.</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-2 space-y-1.5 overflow-y-auto">
            {teams.map((t) => {
              const isCurrent = moveTarget?.team_id === t.id;
              return (
                <button
                  key={t.id}
                  disabled={isCurrent || moveMut.isPending}
                  onClick={() =>
                    moveTarget && moveMut.mutate({ player: moveTarget, newTeamId: t.id })
                  }
                  className={cn(
                    "w-full flex items-center justify-between p-3 rounded-md border text-left transition",
                    isCurrent
                      ? "bg-muted/40 cursor-default"
                      : "bg-card hover:bg-muted/50 active:bg-muted",
                  )}
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{t.name}</p>
                    {t.level_age && <p className="text-xs text-muted-foreground">{t.level_age}</p>}
                  </div>
                  {isCurrent && <Badge variant="secondary" className="flex-shrink-0">Current</Badge>}
                </button>
              );
            })}
            {moveTarget?.team_id && (
              <button
                disabled={moveMut.isPending}
                onClick={() =>
                  moveTarget && moveMut.mutate({ player: moveTarget, newTeamId: null })
                }
                className="w-full p-3 rounded-md border border-dashed text-left hover:bg-muted/50"
              >
                <p className="font-medium text-sm">Move to Unassigned</p>
                <p className="text-xs text-muted-foreground">Keep in season but off all teams</p>
              </button>
            )}
          </div>
          <DrawerFooter className="pt-2">
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                if (moveTarget) {
                  setRemoveTarget(moveTarget);
                  setMoveTarget(null);
                }
              }}
            >
              <UserMinus className="h-4 w-4 mr-2" />
              Remove from season
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Add players drawer */}
      <Drawer open={addOpen} onOpenChange={setAddOpen}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle>Add players to season</DrawerTitle>
            <DrawerDescription>
              {playersNotInSeason.length} club player{playersNotInSeason.length === 1 ? "" : "s"} not in this season yet. Tap to choose a team.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4 space-y-1.5 overflow-y-auto">
            {playersNotInSeason.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Everyone in the club roster is already in this season.
              </p>
            )}
            {playersNotInSeason.map((cp) => {
              const age = ageFromDob(cp.date_of_birth);
              return (
                <button
                  key={cp.id}
                  onClick={() =>
                    setMoveTarget({
                      membership_id: null,
                      club_player_id: cp.id,
                      display_name: cp.display_name,
                      date_of_birth: cp.date_of_birth,
                      team_id: null,
                    })
                  }
                  className="w-full flex items-center justify-between p-2.5 rounded-md border bg-card hover:bg-muted/50 text-left"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{cp.display_name}</p>
                    {age !== null && <p className="text-xs text-muted-foreground">Age {age}</p>}
                  </div>
                  <UserPlus className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </button>
              );
            })}
          </div>
        </DrawerContent>
      </Drawer>

      {/* Remove confirm */}
      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget?.display_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes them from the season entirely. Their club roster record stays intact and they can be re-added later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeTarget && removeMut.mutate(removeTarget)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
