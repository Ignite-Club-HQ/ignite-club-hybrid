import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Trophy, Users, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabClubList, getLocalLabLeaderboard, getLocalLabTeamList } from "@/lab/fixtureDataLayer";

type WindowKey = "week" | "month" | "all";
type Scope = "club" | "team" | "teams";

interface Row {
  rank: number;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  points: number;
  is_viewer: boolean;
  hidden: boolean;
}

interface TeamRow {
  rank: number;
  team_id: string;
  team_name: string;
  points: number;
}

function rankBadge(rank: number) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

function initials(name: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((n) => n[0]?.toUpperCase()).join("");
}

export default function LeaderboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeClubFilter } = useClubTheme();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  const [searchParams, setSearchParams] = useSearchParams();

  const [scope, setScope] = useState<Scope>("club");
  const [windowKey] = useState<WindowKey>("all");
  const [teamId, setTeamId] = useState<string | null>(searchParams.get("teamId"));

  // Clubs the user belongs to (for the selector)
  const { data: myClubs } = useQuery({
    queryKey: ["leaderboard-my-clubs", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      if (useIcpLab) return getLocalLabClubList().map(({ id, name }) => ({ id, name }));
      const { data, error } = await supabase
        .from("user_roles")
        .select("club_id, clubs:club_id(id, name, deleted_at)")
        .eq("user_id", user.id)
        .not("club_id", "is", null);
      if (error) throw error;
      const seen = new Set<string>();
      const out: { id: string; name: string }[] = [];
      (data ?? []).forEach((r: any) => {
        const c = r.clubs;
        if (c && !c.deleted_at && !seen.has(c.id)) {
          seen.add(c.id);
          out.push({ id: c.id, name: c.name });
        }
      });
      return out;
    },
    enabled: !!user?.id,
  });

  const [clubId, setClubId] = useState<string | null>(activeClubFilter ?? null);
  useEffect(() => {
    if (!clubId && (activeClubFilter || myClubs?.[0]?.id)) {
      setClubId(activeClubFilter ?? myClubs![0].id);
    }
  }, [activeClubFilter, myClubs, clubId]);

  // Teams in the selected club
  const { data: teams } = useQuery({
    queryKey: ["leaderboard-teams", clubId],
    queryFn: async () => {
      if (!clubId) return [];
      if (useIcpLab) {
        return getLocalLabTeamList()
          .filter((team) => team.club_id === clubId)
          .map(({ id, name }) => ({ id, name }));
      }
      const { data, error } = await supabase.rpc("list_leaderboard_teams", { _club_id: clubId });
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
    enabled: !!clubId,
  });

  useEffect(() => {
    if (scope !== "team" || !teams?.length) return;
    const selectedTeamStillExists = teamId && teams.some((team) => team.id === teamId);
    if (!selectedTeamStillExists) {
      setTeamId(teams[0].id);
      setSearchParams({ teamId: teams[0].id });
    }
  }, [scope, teams, teamId, setSearchParams]);

  // Leaderboard rows (members)
  const { data: rows, isLoading } = useQuery({
    queryKey: ["leaderboard", scope, scope === "team" ? teamId : clubId, windowKey, user?.id],
    queryFn: async () => {
      if (useIcpLab) {
        const selectedClubId = clubId ?? "club-icp-001";
        return getLocalLabLeaderboard(selectedClubId) as Row[];
      }
      if (scope === "club") {
        if (!clubId) return [];
        const { data, error } = await supabase.rpc("get_club_leaderboard", {
          _club_id: clubId,
          _window: windowKey,
          _viewer_id: user?.id ?? null,
          _limit: 50,
        });
        if (error) throw error;
        return (data ?? []) as Row[];
      } else if (scope === "team") {
        if (!teamId) return [];
        const { data, error } = await supabase.rpc("get_team_leaderboard", {
          _team_id: teamId,
          _window: windowKey,
          _viewer_id: user?.id ?? null,
          _limit: 50,
        });
        if (error) throw error;
        return (data ?? []) as Row[];
      }
      return [];
    },
    enabled: scope === "club" ? !!clubId : scope === "team" ? !!teamId : false,
  });

  // Teams ranking
  const { data: teamRows, isLoading: teamsLoading } = useQuery({
    queryKey: ["leaderboard-teams-rank", clubId, windowKey],
    queryFn: async () => {
      if (!clubId) return [];
      if (useIcpLab) {
        return getLocalLabTeamList()
          .filter((team) => team.club_id === clubId)
          .map((team, index) => ({
            rank: index + 1,
            team_id: team.id,
            team_name: team.name,
            points: 120 - index * 20,
          }));
      }
      const { data, error } = await supabase.rpc("get_teams_leaderboard", {
        _club_id: clubId,
        _window: windowKey,
        _limit: 50,
      });
      if (error) throw error;
      return (data ?? []) as TeamRow[];
    },
    enabled: scope === "teams" && !!clubId,
  });

  const topRows = useMemo(() => (rows ?? []).filter((r) => r.rank <= 50 && !r.hidden), [rows]);
  const myRow = useMemo(() => (rows ?? []).find((r) => r.is_viewer) ?? null, [rows]);
  const myRowInTop = myRow && topRows.some((r) => r.user_id === myRow.user_id);

  return (
    <div className="container max-w-2xl py-4 pb-24">
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Trophy className="h-5 w-5 text-yellow-500" /> Leaderboard
        </h1>
      </div>

      {/* Club selector (if multiple) */}
      {myClubs && myClubs.length > 1 && (
        <div className="mb-3">
          <Select value={clubId ?? undefined} onValueChange={(v) => { setClubId(v); setTeamId(null); }}>
            <SelectTrigger><SelectValue placeholder="Select club" /></SelectTrigger>
            <SelectContent>
              {myClubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Scope tabs */}
      <Tabs value={scope} onValueChange={(v) => setScope(v as Scope)} className="mb-3">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="club"><Trophy className="h-4 w-4 mr-1.5" />Club</TabsTrigger>
          <TabsTrigger value="teams"><Users className="h-4 w-4 mr-1.5" />Teams</TabsTrigger>
          <TabsTrigger value="team"><Users className="h-4 w-4 mr-1.5" />My Team</TabsTrigger>
        </TabsList>
      </Tabs>

      {scope === "team" && (
        <div className="mb-3">
          <Select value={teamId ?? undefined} onValueChange={(v) => { setTeamId(v); setSearchParams({ teamId: v }); }}>
            <SelectTrigger><SelectValue placeholder="Select a team" /></SelectTrigger>
            <SelectContent>
              {(teams ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}


      {/* Body */}
      {scope === "teams" ? (
        teamsLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !teamRows || teamRows.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
            No team points in this window yet.
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {teamRows.map((t) => (
              <Card key={t.team_id}>
                <CardContent className="p-3 flex items-center gap-3">
                  <span className={cn(
                    "text-base font-semibold w-12 text-center tabular-nums",
                    t.rank <= 3 && "text-lg",
                  )}>{rankBadge(t.rank)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{t.team_name}</p>
                  </div>
                  <span className="font-bold tabular-nums">{t.points}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : scope === "team" && !teamId ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          {(teams ?? []).length === 0 ? "No teams available for this club yet." : "Select a team to view its leaderboard."}
        </CardContent></Card>
      ) : isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : topRows.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          No points earned in this window yet — be the first!
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {topRows.map((r) => (
            <LeaderboardRow key={r.user_id} row={r} highlight={r.is_viewer} />
          ))}
        </div>
      )}

      {/* Sticky "your rank" */}
      {scope !== "teams" && myRow && !myRowInTop && (
        <div className="sticky bottom-2 mt-4">
          <Card className="border-primary/40 shadow-lg">
            <CardContent className="p-3 flex items-center gap-3">
              <span className="text-base font-semibold w-12 text-center">{rankBadge(myRow.rank)}</span>
              <Avatar className="h-9 w-9">
                {myRow.avatar_url && <AvatarImage src={myRow.avatar_url} />}
                <AvatarFallback>{initials(myRow.display_name)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">You</p>
                <p className="text-xs text-muted-foreground">Keep climbing!</p>
              </div>
              <span className="font-bold tabular-nums">{myRow.points}</span>
            </CardContent>
          </Card>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground text-center mt-6">
        Children appear as their own entries. Hide yourself in Edit Profile.
      </p>
    </div>
  );
}

function LeaderboardRow({ row, highlight }: { row: Row; highlight: boolean }) {
  return (
    <Card className={cn(highlight && "border-primary bg-primary/5")}>
      <CardContent className="p-3 flex items-center gap-3">
        <span className={cn(
          "text-base font-semibold w-12 text-center tabular-nums",
          row.rank <= 3 && "text-lg",
        )}>{rankBadge(row.rank)}</span>
        <Avatar className="h-9 w-9">
          {row.avatar_url && <AvatarImage src={row.avatar_url} />}
          <AvatarFallback>{initials(row.display_name)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {highlight ? "You" : (row.display_name ?? "Member")}
          </p>
        </div>
        {highlight && <Badge variant="secondary" className="text-[10px]">You</Badge>}
        <span className="font-bold tabular-nums">{row.points}</span>
      </CardContent>
    </Card>
  );
}
