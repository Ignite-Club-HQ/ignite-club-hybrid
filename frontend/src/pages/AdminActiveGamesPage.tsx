import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Activity,
  RefreshCw,
  Users,
  AlertTriangle,
  Search,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { PageLoading } from "@/components/ui/page-loading";

interface ActiveGameRow {
  id: string;
  team_id: string | null;
  user_id: string;
  is_active: boolean;
  updated_at: string;
  created_at: string;
  timer_state: Record<string, unknown> | null;
  pitch_state: Record<string, unknown> | null;
  team?: {
    id: string;
    name: string;
    club_id: string | null;
    club?: { id: string; name: string } | null;
  } | null;
}

const SPORT_BADGE: Record<string, string> = {
  soccer: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  basketball: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  netball: "bg-pink-500/15 text-pink-700 dark:text-pink-300",
};

function detectSport(row: ActiveGameRow): string {
  const a = (row.pitch_state as { sport?: string } | null)?.sport;
  const b = (row.timer_state as { sport?: string } | null)?.sport;
  return a || b || "soccer";
}

import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabActiveGames } from "@/lab/fixtureDataLayer";

export default function AdminActiveGamesPage() {
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  if (useIcpLab) {
    return <IcpLabAdminActiveGamesPage />;
  }
  return <SupabaseAdminActiveGamesPage />;
}

/** Read-only synthetic active-game list; administrative mutations remain unavailable until events_domain admin tooling is wired here. */
function IcpLabAdminActiveGamesPage() {
  const navigate = useNavigate();
  const games = getLocalLabActiveGames();

  return (
    <div className="container max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">Active Games</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Showing synthetic ICP lab active-game data. Administrative mutations are disabled.
      </p>
      <div className="space-y-2">
        {games.map((game) => (
          <Card key={game.id}>
            <CardContent className="p-4">
              <p className="text-sm font-medium">{game.title}</p>
              <p className="text-xs text-muted-foreground">Status: {game.status}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SupabaseAdminActiveGamesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"active" | "recent">("active");
  const [bumpKey, setBumpKey] = useState(0);

  const { data: isAppAdmin, isLoading: roleLoading } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user?.id,
  });

  const { data: activeRows, isLoading: activeLoading, refetch: refetchActive } = useQuery({
    queryKey: ["admin-active-games", "active", bumpKey],
    enabled: !!isAppAdmin,
    refetchInterval: 15000,
    queryFn: async (): Promise<ActiveGameRow[]> => {
      const { data, error } = await supabase
        .from("active_games")
        .select(
          `id, team_id, user_id, is_active, updated_at, created_at, timer_state, pitch_state,
           team:teams ( id, name, club_id, club:clubs!club_id ( id, name ) )`
        )
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as ActiveGameRow[];
    },
  });

  const { data: recentRows, isLoading: recentLoading } = useQuery({
    queryKey: ["admin-active-games", "recent", bumpKey],
    enabled: !!isAppAdmin && tab === "recent",
    refetchInterval: 30000,
    queryFn: async (): Promise<ActiveGameRow[]> => {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("active_games")
        .select(
          `id, team_id, user_id, is_active, updated_at, created_at, timer_state, pitch_state,
           team:teams ( id, name, club_id, club:clubs!club_id ( id, name ) )`
        )
        .eq("is_active", false)
        .gte("updated_at", since)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as ActiveGameRow[];
    },
  });

  // Profiles for the union of coaches across both lists. profiles.id = auth.users.id
  // (no FK on active_games.user_id → profiles, so we fetch separately).
  const coachIds = useMemo(() => {
    const ids = new Set<string>();
    (activeRows ?? []).forEach((r) => ids.add(r.user_id));
    (recentRows ?? []).forEach((r) => ids.add(r.user_id));
    return Array.from(ids);
  }, [activeRows, recentRows]);

  const { data: profileMap } = useQuery({
    queryKey: ["admin-active-games", "coach-profiles", coachIds.sort().join(",")],
    enabled: !!isAppAdmin && coachIds.length > 0,
    queryFn: async (): Promise<Record<string, { id: string; display_name: string | null }>> => {
      const { data, error } = await selectCachedProfilesByIds(coachIds);
      if (error) throw error;
      const map: Record<string, { id: string; display_name: string | null }> = {};
      (data ?? []).forEach((p) => {
        map[p.id] = p;
      });
      return map;
    },
  });

  // Per-team write rate over the last 60s (uses the write log).
  const { data: writeRates } = useQuery({
    queryKey: ["admin-active-games", "write-rate", bumpKey],
    enabled: !!isAppAdmin,
    refetchInterval: 15000,
    queryFn: async (): Promise<Map<string, number>> => {
      const since = new Date(Date.now() - 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("active_games_write_log")
        .select("team_id")
        .gte("created_at", since)
        .not("team_id", "is", null)
        .limit(5000);
      if (error) {
        console.warn("[admin-active-games] write log unavailable", error);
        return new Map();
      }
      const counts = new Map<string, number>();
      for (const row of (data ?? []) as Array<{ team_id: string | null }>) {
        if (!row.team_id) continue;
        counts.set(row.team_id, (counts.get(row.team_id) ?? 0) + 1);
      }
      return counts;
    },
  });

  // Realtime: re-pull on any active_games change.
  useEffect(() => {
    if (!isAppAdmin) return;
    const channel = supabase
      .channel("admin-active-games")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "active_games" },
        () => setBumpKey((k) => k + 1)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAppAdmin]);

  const coachLabel = (userId: string) => {
    const p = profileMap?.[userId];
    return p?.display_name?.trim() || userId.slice(0, 8);
  };

  const filteredActive = useMemo(() => {
    const list = activeRows ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => {
      const team = r.team?.name?.toLowerCase() ?? "";
      const club = r.team?.club?.name?.toLowerCase() ?? "";
      const coach = coachLabel(r.user_id).toLowerCase();
      return team.includes(q) || club.includes(q) || coach.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRows, search, profileMap]);

  const filteredRecent = useMemo(() => {
    const list = recentRows ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => {
      const team = r.team?.name?.toLowerCase() ?? "";
      const club = r.team?.club?.name?.toLowerCase() ?? "";
      const coach = coachLabel(r.user_id).toLowerCase();
      return team.includes(q) || club.includes(q) || coach.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentRows, search, profileMap]);

  const stormCount = useMemo(() => {
    if (!writeRates) return 0;
    let n = 0;
    writeRates.forEach((c) => {
      if (c >= 30) n += 1;
    });
    return n;
  }, [writeRates]);

  const activeCount = activeRows?.length ?? 0;

  if (roleLoading) return <PageLoading />;

  if (!isAppAdmin) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Active Games</h1>
        </div>
        <p className="text-muted-foreground text-center py-12">
          Access denied. App admin role required.
        </p>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            Active Games
          </h1>
          <p className="text-sm text-muted-foreground">
            Live coaching boards across every club & team
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            setBumpKey((k) => k + 1);
            refetchActive();
          }}
          title="Refresh"
        >
          <RefreshCw className="h-5 w-5" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs uppercase text-muted-foreground">Live broadcasts</div>
            <div className="text-2xl font-bold">{activeCount}</div>
          </CardContent>
        </Card>
        <Card className={stormCount > 0 ? "border-destructive" : undefined}>
          <CardContent className="pt-4">
            <div className="text-xs uppercase text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Sync storms (now)
            </div>
            <div
              className={`text-2xl font-bold ${stormCount > 0 ? "text-destructive" : ""}`}
            >
              {stormCount}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="relative">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by team, club, or coach name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="grid grid-cols-2 w-full">
          <TabsTrigger value="active">Live now ({activeCount})</TabsTrigger>
          <TabsTrigger value="recent">Recently ended (1h)</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4">
          {activeLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
          ) : filteredActive.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No live broadcasts right now.
            </div>
          ) : (
            <ScrollArea className="h-[calc(100vh-360px)]">
              <div className="space-y-2 pr-2">
                {filteredActive.map((row) => {
                  const sport = detectSport(row);
                  const rate = row.team_id ? writeRates?.get(row.team_id) ?? 0 : 0;
                  const isStorm = rate >= 30;
                  return (
                    <Card
                      key={row.id}
                      className={isStorm ? "border-destructive" : undefined}
                    >
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold truncate">
                              {row.team?.name ?? "(no team)"}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {row.team?.club?.name ?? "—"}
                            </div>
                          </div>
                          <Badge
                            className={SPORT_BADGE[sport] ?? "bg-muted"}
                            variant="secondary"
                          >
                            {sport}
                          </Badge>
                        </div>

                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1 text-muted-foreground min-w-0">
                            <Users className="h-3 w-3 shrink-0" />
                            <span className="truncate">{coachLabel(row.user_id)}</span>
                          </div>
                          <div className="text-muted-foreground shrink-0 ml-2">
                            updated{" "}
                            {formatDistanceToNow(new Date(row.updated_at), {
                              addSuffix: true,
                            })}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 text-xs">
                          <Badge variant="outline" className="font-mono">
                            {rate}/min
                          </Badge>
                          {isStorm && (
                            <Badge variant="destructive" className="gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              storm
                            </Badge>
                          )}
                          <span className="text-muted-foreground font-mono ml-auto truncate max-w-[40%]">
                            {row.id.slice(0, 8)}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="recent" className="mt-4">
          {recentLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
          ) : filteredRecent.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No broadcasts ended in the last hour.
            </div>
          ) : (
            <ScrollArea className="h-[calc(100vh-360px)]">
              <div className="space-y-2 pr-2">
                {filteredRecent.map((row) => {
                  const sport = detectSport(row);
                  return (
                    <Card key={row.id} className="opacity-70">
                      <CardContent className="p-3 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold truncate">
                              {row.team?.name ?? "(no team)"}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {row.team?.club?.name ?? "—"} · coach{" "}
                              {coachLabel(row.user_id)}
                            </div>
                          </div>
                          <Badge
                            className={SPORT_BADGE[sport] ?? "bg-muted"}
                            variant="secondary"
                          >
                            {sport}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          ended{" "}
                          {formatDistanceToNow(new Date(row.updated_at), {
                            addSuffix: true,
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
