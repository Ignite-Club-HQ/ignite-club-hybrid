import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, GitCompare, Users, Calendar, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageLoading } from "@/components/ui/page-loading";
import { useClubSeasons } from "@/hooks/useClubSeasons";
import { useSeasonTeamSummary } from "@/hooks/useSeasonAnalytics";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabSeasonCompare } from "@/lab/fixtureDataLayer";

export default function SeasonComparePage() {
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    const compare = getLocalLabSeasonCompare("club-icp-001");
    return (
      <div className="container max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold">Season Comparison</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Showing synthetic ICP lab season comparison data.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {compare.seasons.map((season) => (
            <Card key={season.id}>
              <CardContent className="p-4">
                <p className="text-sm font-medium">{season.name}</p>
                <p className="text-xs text-muted-foreground">{season.games_played} games · {season.wins} wins</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return <SupabaseSeasonComparePage />;
}

function SupabaseSeasonComparePage() {
  const { clubId } = useParams<{ clubId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [leftId, setLeftId] = useState<string | undefined>(searchParams.get("a") || undefined);
  const [rightId, setRightId] = useState<string | undefined>(searchParams.get("b") || undefined);

  const { data: club } = useQuery({
    queryKey: ["club-basic", clubId],
    queryFn: async () => {
      if (!clubId) return null;
      const { data } = await supabase.from("clubs").select("id, name").eq("id", clubId).maybeSingle();
      return data;
    },
    enabled: !!clubId,
  });

  const { data: canAccess, isLoading: accessLoading } = useQuery({
    queryKey: ["can-compare-seasons", clubId, user?.id],
    queryFn: async () => {
      if (!clubId || !user?.id) return false;
      const [appAdmin, clubAdmin, coach] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "app_admin").maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id).eq("club_id", clubId).eq("role", "club_admin").maybeSingle(),
        supabase
          .from("user_roles")
          .select("role, teams!inner(club_id)")
          .eq("user_id", user.id)
          .in("role", ["coach", "team_admin"])
          .eq("teams.club_id", clubId)
          .limit(1),
      ]);
      return !!appAdmin.data || !!clubAdmin.data || (coach.data && coach.data.length > 0);
    },
    enabled: !!clubId && !!user?.id,
  });

  const { data: seasons = [], isLoading: seasonsLoading } = useClubSeasons(clubId);

  // Auto-pick sensible defaults once
  useMemo(() => {
    if (!leftId && !rightId && seasons.length >= 2) {
      setLeftId(seasons[0].id);
      setRightId(seasons[1].id);
    } else if (!leftId && seasons.length >= 1) {
      setLeftId(seasons[0].id);
    }
  }, [seasons, leftId, rightId]);

  if (accessLoading || seasonsLoading) return <PageLoading />;

  if (!canAccess) {
    return (
      <div className="py-6 space-y-4">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <p className="text-muted-foreground p-4">
          Only club admins and coaches can compare seasons.
        </p>
      </div>
    );
  }

  const updateParam = (side: "a" | "b", value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set(side, value);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/clubs/${clubId}/seasons`)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitCompare className="h-6 w-6" /> Compare seasons
          </h1>
          <p className="text-sm text-muted-foreground truncate">{club?.name}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">
            Season A
          </label>
          <Select
            value={leftId}
            onValueChange={(v) => {
              setLeftId(v);
              updateParam("a", v);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pick a season" />
            </SelectTrigger>
            <SelectContent>
              {seasons.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">
            Season B
          </label>
          <Select
            value={rightId}
            onValueChange={(v) => {
              setRightId(v);
              updateParam("b", v);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pick a season" />
            </SelectTrigger>
            <SelectContent>
              {seasons.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {leftId && rightId ? (
        <ComparePanels
          leftId={leftId}
          rightId={rightId}
          leftName={seasons.find((s) => s.id === leftId)?.name ?? "Season A"}
          rightName={seasons.find((s) => s.id === rightId)?.name ?? "Season B"}
        />
      ) : (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground text-sm">
            Pick two seasons to compare.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ComparePanels({
  leftId,
  rightId,
  leftName,
  rightName,
}: {
  leftId: string;
  rightId: string;
  leftName: string;
  rightName: string;
}) {
  const { data: left = [], isLoading: leftLoading } = useSeasonTeamSummary(leftId);
  const { data: right = [], isLoading: rightLoading } = useSeasonTeamSummary(rightId);

  if (leftLoading || rightLoading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  const summarise = (rows: typeof left) => {
    const teamCount = rows.length;
    const playerCount = rows.reduce((a, r) => a + r.roster_size, 0);
    const eventsCount = rows.reduce((a, r) => a + r.events_count, 0);
    const avgAttendance =
      rows.length === 0
        ? 0
        : rows.reduce((a, r) => a + Number(r.avg_attendance_pct), 0) / rows.length;
    const topTeam = [...rows].sort(
      (a, b) => Number(b.avg_attendance_pct) - Number(a.avg_attendance_pct),
    )[0];
    return { teamCount, playerCount, eventsCount, avgAttendance, topTeam };
  };

  const L = summarise(left);
  const R = summarise(right);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <SeasonSummaryCard name={leftName} {...L} />
        <SeasonSummaryCard name={rightName} {...R} />
      </div>

      <DeltaCard
        label="Teams"
        icon={Users}
        left={L.teamCount}
        right={R.teamCount}
      />
      <DeltaCard
        label="Players"
        icon={Users}
        left={L.playerCount}
        right={R.playerCount}
      />
      <DeltaCard
        label="Events held"
        icon={Calendar}
        left={L.eventsCount}
        right={R.eventsCount}
      />
      <DeltaCard
        label="Avg attendance"
        icon={TrendingUp}
        left={L.avgAttendance}
        right={R.avgAttendance}
        suffix="%"
        decimals={1}
      />
    </div>
  );
}

function SeasonSummaryCard({
  name,
  teamCount,
  playerCount,
  topTeam,
}: {
  name: string;
  teamCount: number;
  playerCount: number;
  eventsCount: number;
  avgAttendance: number;
  topTeam?: { team_name: string; avg_attendance_pct: number };
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm truncate">{name}</CardTitle>
        <CardDescription className="text-xs">
          {teamCount} team{teamCount === 1 ? "" : "s"} · {playerCount} player
          {playerCount === 1 ? "" : "s"}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 text-xs text-muted-foreground">
        {topTeam ? (
          <span>
            Top: <span className="font-medium text-foreground">{topTeam.team_name}</span> (
            {Number(topTeam.avg_attendance_pct).toFixed(0)}%)
          </span>
        ) : (
          <span>No teams yet</span>
        )}
      </CardContent>
    </Card>
  );
}

function DeltaCard({
  label,
  icon: Icon,
  left,
  right,
  suffix = "",
  decimals = 0,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  left: number;
  right: number;
  suffix?: string;
  decimals?: number;
}) {
  const delta = right - left;
  const deltaSign = delta > 0 ? "+" : "";
  const deltaColor =
    delta > 0 ? "text-emerald-600" : delta < 0 ? "text-destructive" : "text-muted-foreground";
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="text-sm flex-1 truncate">{label}</span>
        <span className="font-medium tabular-nums text-sm">
          {left.toFixed(decimals)}
          {suffix}
        </span>
        <span className="text-muted-foreground text-xs">→</span>
        <span className="font-medium tabular-nums text-sm">
          {right.toFixed(decimals)}
          {suffix}
        </span>
        <span className={`font-medium tabular-nums text-xs w-14 text-right ${deltaColor}`}>
          {delta === 0 ? "—" : `${deltaSign}${delta.toFixed(decimals)}${suffix}`}
        </span>
      </CardContent>
    </Card>
  );
}
