import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Trophy, UserCheck, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

type StatRow = {
  playhq_game_id: string;
  playhq_team_id: string | null;
  playhq_player_id: string;
  player_name: string | null;
  stats: Record<string, number> | null;
};

type Aggregate = {
  playhq_player_id: string;
  player_name: string;
  games: number;
  totals: Record<string, number>;
};

const NUMERIC = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export default function CompetitionPlayerStatsPanel({
  competitionId,
  sport,
}: {
  competitionId: string;
  sport?: string | null;
}) {
  const { user } = useAuth();
  const isCricket = (sport ?? "").toLowerCase() === "cricket";

  // Cricket stat key categorisation (matches common PlayHQ keys, case-insensitive substring)
  const CRICKET_CATEGORIES: Record<"batting" | "bowling" | "fielding", string[]> = {
    batting: ["run", "ball_faced", "balls_faced", "four", "six", "strike_rate", "not_out", "batting", "fifty", "hundred", "duck", "high_score", "highest"],
    bowling: ["over", "maiden", "wicket", "runs_conceded", "economy", "bowling", "wide", "no_ball", "dot_ball", "best_bowl"],
    fielding: ["catch", "run_out", "stumping", "fielding", "dismissal"],
  };
  const categoriseStatKey = (key: string): "batting" | "bowling" | "fielding" | "other" => {
    const k = key.toLowerCase();
    // Bowling/fielding first so "runs_conceded" doesn't get tagged as batting via "run"
    if (CRICKET_CATEGORIES.bowling.some((m) => k.includes(m))) return "bowling";
    if (CRICKET_CATEGORIES.fielding.some((m) => k.includes(m))) return "fielding";
    if (CRICKET_CATEGORIES.batting.some((m) => k.includes(m))) return "batting";
    return "other";
  };

  // 1. Match list for this competition (need external_ids to filter stats,
  //    and team names + external team ids to power the filters below).
  const { data: matches = [], isLoading: matchesLoading } = useQuery({
    queryKey: ["competition-playhq-match-ids", competitionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competition_matches")
        .select("external_id, external_home_team_id, external_away_team_id, home_team_name, away_team_name, division_id, competition_divisions:division_id(name)")
        .eq("competition_id", competitionId)
        .eq("source", "playhq")
        .not("external_id", "is", null);
      if (error) throw error;
      return (data ?? []) as {
        external_id: string;
        external_home_team_id: string | null;
        external_away_team_id: string | null;
        home_team_name: string | null;
        away_team_name: string | null;
        division_id: string | null;
        competition_divisions: { name: string | null } | null;
      }[];
    },
  });

  const gameIds = useMemo(
    () => Array.from(new Set(matches.map((m) => m.external_id).filter(Boolean))),
    [matches]
  );

  // PlayHQ team id → display name (from match rows)
  const teamNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of matches) {
      if (row.external_home_team_id) m.set(row.external_home_team_id, row.home_team_name ?? row.external_home_team_id);
      if (row.external_away_team_id) m.set(row.external_away_team_id, row.away_team_name ?? row.external_away_team_id);
    }
    return m;
  }, [matches]);

  const externalTeamIds = useMemo(() => Array.from(teamNameById.keys()), [teamNameById]);

  // Resolve PlayHQ team id → owning Ignite club (when a team has been linked).
  const { data: linkedTeams = [] } = useQuery({
    queryKey: ["competition-stats-linked-teams", competitionId, externalTeamIds.length],
    enabled: externalTeamIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("playhq_team_id, clubs:club_id(id, name)")
        .in("playhq_team_id", externalTeamIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const clubByExternalTeam = useMemo(() => {
    const m = new Map<string, { clubId: string; clubName: string }>();
    for (const t of linkedTeams as any[]) {
      if (t.playhq_team_id && t.clubs?.id) {
        m.set(t.playhq_team_id, { clubId: t.clubs.id, clubName: t.clubs.name });
      }
    }
    return m;
  }, [linkedTeams]);

  // 2. Player stats joined by game id
  const { data: rows = [], isLoading: statsLoading } = useQuery({
    queryKey: ["competition-playhq-stats", competitionId, gameIds.length],
    enabled: gameIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("playhq_player_stats")
        .select("playhq_game_id, playhq_team_id, playhq_player_id, player_name, stats")
        .in("playhq_game_id", gameIds);
      if (error) throw error;
      return (data ?? []) as StatRow[];
    },
  });

  // 3. Existing claims
  const { data: links = [], refetch: refetchLinks } = useQuery({
    queryKey: ["playhq-player-links-mine"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("playhq_player_links")
        .select("playhq_player_id, user_id, confirmed_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const claimsByPlayer = useMemo(() => {
    const m = new Map<string, { mine: boolean; claimed: boolean }>();
    for (const l of links as any[]) {
      const prev = m.get(l.playhq_player_id) ?? { mine: false, claimed: false };
      m.set(l.playhq_player_id, {
        mine: prev.mine || l.user_id === user?.id,
        claimed: true,
      });
    }
    return m;
  }, [links, user?.id]);

  // Team / Club / Grade filters
  const [filterTeamId, setFilterTeamId] = useState<string>("_all");
  const [filterClubId, setFilterClubId] = useState<string>("_all");
  const [filterGradeId, setFilterGradeId] = useState<string>("_all");
  const [cricketCategory, setCricketCategory] = useState<"batting" | "bowling" | "fielding">("batting");
  const [teamSheetOpen, setTeamSheetOpen] = useState(false);
  const [gradeSheetOpen, setGradeSheetOpen] = useState(false);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);

  const teamOptions = useMemo(
    () =>
      Array.from(teamNameById.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [teamNameById]
  );

  // PlayHQ game id → grade/division name
  const gradeByGameId = useMemo(() => {
    const m = new Map<string, { divisionId: string; name: string }>();
    for (const row of matches) {
      if (row.external_id && row.division_id) {
        m.set(row.external_id, {
          divisionId: row.division_id,
          name: row.competition_divisions?.name ?? "Unknown grade",
        });
      }
    }
    return m;
  }, [matches]);

  const gradeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const { divisionId, name } of gradeByGameId.values()) {
      seen.set(divisionId, name);
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [gradeByGameId]);

  const clubOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const { clubId, clubName } of clubByExternalTeam.values()) {
      seen.set(clubId, clubName);
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clubByExternalTeam]);

  // Apply filters to stat rows before aggregation
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (filterTeamId !== "_all" && r.playhq_team_id !== filterTeamId) return false;
      if (filterClubId !== "_all") {
        const club = r.playhq_team_id ? clubByExternalTeam.get(r.playhq_team_id) : null;
        if (club?.clubId !== filterClubId) return false;
      }
      if (filterGradeId !== "_all") {
        const grade = r.playhq_game_id ? gradeByGameId.get(r.playhq_game_id) : null;
        if (grade?.divisionId !== filterGradeId) return false;
      }
      return true;
    });
  }, [rows, filterTeamId, filterClubId, filterGradeId, clubByExternalTeam, gradeByGameId]);

  // 4. Aggregate
  const aggregates: Aggregate[] = useMemo(() => {
    const map = new Map<string, Aggregate>();
    for (const r of filteredRows) {
      const key = r.playhq_player_id;
      if (!key) continue;
      let agg = map.get(key);
      if (!agg) {
        agg = {
          playhq_player_id: key,
          player_name: r.player_name ?? "Unknown",
          games: 0,
          totals: {},
        };
        map.set(key, agg);
      }
      agg.games += 1;
      for (const [k, v] of Object.entries(r.stats ?? {})) {
        agg.totals[k] = (agg.totals[k] ?? 0) + NUMERIC(v);
      }
    }
    return Array.from(map.values());
  }, [filteredRows]);

  const statKeys = useMemo(() => {
    const set = new Set<string>();
    aggregates.forEach((a) => Object.keys(a.totals).forEach((k) => set.add(k)));
    let keys = Array.from(set);
    if (isCricket) {
      keys = keys.filter((k) => categoriseStatKey(k) === cricketCategory);
    }
    return keys;
  }, [aggregates, isCricket, cricketCategory]);

  const [sortBy, setSortBy] = useState<string>("");
  const sortKey = sortBy || statKeys[0] || "";

  const sorted = useMemo(() => {
    const list = [...aggregates];
    if (sortKey) {
      list.sort((a, b) => (b.totals[sortKey] ?? 0) - (a.totals[sortKey] ?? 0));
    } else {
      list.sort((a, b) => b.games - a.games);
    }
    return list;
  }, [aggregates, sortKey]);

  const claim = async (playhqPlayerId: string, playerName: string) => {
    if (!user) {
      toast.error("Sign in to claim a player");
      return;
    }
    const { error } = await supabase.from("playhq_player_links").insert({
      tenant: "default",
      playhq_player_id: playhqPlayerId,
      user_id: user.id,
      claimed_by: user.id,
      confirmed_at: new Date().toISOString(),
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Claimed ${playerName}`);
    refetchLinks();
  };

  if (matchesLoading || statsLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading stats…
      </div>
    );
  }

  if (gameIds.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground text-center">
        No PlayHQ-sourced matches in this competition yet. Once the next sync runs,
        player stats will appear here.
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground text-center">
        Matches synced, but no per-player stats have been published by PlayHQ yet.
      </div>
    );
  }

  const showTeamFilter = teamOptions.length > 1;
  const showClubFilter = clubOptions.length > 1;
  const showGradeFilter = gradeOptions.length > 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Trophy className="h-4 w-4" />
          {aggregates.length} players · {gameIds.length} matches
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isCricket && (
            <>
              <button
                type="button"
                onClick={() => setCategorySheetOpen(true)}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-input bg-background px-3 text-xs font-medium capitalize shadow-sm hover:bg-accent hover:text-accent-foreground"
              >
                {cricketCategory}
                <ChevronDown className="h-3.5 w-3.5 opacity-50" />
              </button>
              <Sheet open={categorySheetOpen} onOpenChange={setCategorySheetOpen}>
                <SheetContent side="bottom" enableDragToClose className="max-h-[85vh] rounded-t-xl p-0">
                  <div className="flex justify-center pt-3 pb-1">
                    <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
                  </div>
                  <SheetHeader className="px-4 pb-2 text-left">
                    <SheetTitle className="text-base">Stat category</SheetTitle>
                  </SheetHeader>
                  <div className="px-4 pb-6">
                    <div className="space-y-1">
                      {(["batting", "bowling", "fielding"] as const).map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => {
                            setCricketCategory(c);
                            setSortBy("");
                            setCategorySheetOpen(false);
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm capitalize hover:bg-accent"
                        >
                          <span>{c}</span>
                          {cricketCategory === c && <Check className="h-4 w-4 text-primary" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </>
          )}
          {showClubFilter && (
            <Select value={filterClubId} onValueChange={setFilterClubId}>
              <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs">
                <SelectValue placeholder="All clubs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All clubs</SelectItem>
                {clubOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {showTeamFilter && (
            <>
              <button
                type="button"
                onClick={() => setTeamSheetOpen(true)}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
              >
                {filterTeamId === "_all"
                  ? "All teams"
                  : teamOptions.find((t) => t.id === filterTeamId)?.name ?? "All teams"}
                <ChevronDown className="h-3.5 w-3.5 opacity-50" />
              </button>
              <Sheet open={teamSheetOpen} onOpenChange={setTeamSheetOpen}>
                <SheetContent side="bottom" enableDragToClose className="max-h-[85vh] rounded-t-xl p-0">
                  <div className="flex justify-center pt-3 pb-1">
                    <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
                  </div>
                  <SheetHeader className="px-4 pb-2 text-left">
                    <SheetTitle className="text-base">Filter by team</SheetTitle>
                  </SheetHeader>
                  <div className="max-h-[60vh] overflow-y-auto px-4 pb-6">
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          setFilterTeamId("_all");
                          setTeamSheetOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm hover:bg-accent"
                      >
                        <span>All teams</span>
                        {filterTeamId === "_all" && <Check className="h-4 w-4 text-primary" />}
                      </button>
                      {teamOptions.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            setFilterTeamId(t.id);
                            setTeamSheetOpen(false);
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm hover:bg-accent"
                        >
                          <span>{t.name}</span>
                          {filterTeamId === t.id && <Check className="h-4 w-4 text-primary" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </>
          )}
          {showGradeFilter && (
            <>
              <button
                type="button"
                onClick={() => setGradeSheetOpen(true)}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
              >
                {filterGradeId === "_all"
                  ? "All grades"
                  : gradeOptions.find((g) => g.id === filterGradeId)?.name ?? "All grades"}
                <ChevronDown className="h-3.5 w-3.5 opacity-50" />
              </button>
              <Sheet open={gradeSheetOpen} onOpenChange={setGradeSheetOpen}>
                <SheetContent side="bottom" enableDragToClose className="max-h-[85vh] rounded-t-xl p-0">
                  <div className="flex justify-center pt-3 pb-1">
                    <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
                  </div>
                  <SheetHeader className="px-4 pb-2 text-left">
                    <SheetTitle className="text-base">Filter by grade</SheetTitle>
                  </SheetHeader>
                  <div className="max-h-[60vh] overflow-y-auto px-4 pb-6">
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          setFilterGradeId("_all");
                          setGradeSheetOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm hover:bg-accent"
                      >
                        <span>All grades</span>
                        {filterGradeId === "_all" && <Check className="h-4 w-4 text-primary" />}
                      </button>
                      {gradeOptions.map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => {
                            setFilterGradeId(g.id);
                            setGradeSheetOpen(false);
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm hover:bg-accent"
                        >
                          <span>{g.name}</span>
                          {filterGradeId === g.id && <Check className="h-4 w-4 text-primary" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </>
          )}
        </div>
      </div>

      {aggregates.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground text-center">
          No players match the current filter.
        </div>
      )}

      {aggregates.length > 0 && (
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left p-2 font-medium">Player</th>
              <th className="text-right p-2 font-medium">GP</th>
              {statKeys.map((k) => (
                <th
                  key={k}
                  className={`text-right p-2 font-medium capitalize ${
                    k === sortKey ? "text-foreground" : ""
                  }`}
                >
                  {k}
                </th>
              ))}
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const claim_ = claimsByPlayer.get(a.playhq_player_id);
              return (
                <tr key={a.playhq_player_id} className="border-t">
                  <td className="p-2 font-medium">
                    <div className="flex items-center gap-2">
                      <span>{a.player_name}</span>
                      {claim_?.mine && (
                        <Badge variant="secondary" className="text-[10px]">
                          You
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="p-2 text-right tabular-nums">{a.games}</td>
                  {statKeys.map((k) => (
                    <td
                      key={k}
                      className={`p-2 text-right tabular-nums ${
                        k === sortKey ? "font-semibold" : ""
                      }`}
                    >
                      {a.totals[k] ?? 0}
                    </td>
                  ))}
                  <td className="p-2 text-right">
                    {claim_?.claimed ? (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <UserCheck className="h-3 w-3" /> Claimed
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => claim(a.playhq_player_id, a.player_name)}
                      >
                        Claim
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}


      <p className="text-[11px] text-muted-foreground">
        Stats sourced from PlayHQ. Claim a player to link their PlayHQ record to your
        account — claims help us match stats across competitions.
      </p>
    </div>
  );
}
