import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Archive, Rocket, AlertTriangle, Users2, Bell, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { PageLoading } from "@/components/ui/page-loading";
import { toast } from "sonner";
import { format } from "date-fns";
import { DraftTeamBuilder } from "@/components/seasons/DraftTeamBuilder";
import { SeasonAnalyticsCard } from "@/components/seasons/SeasonAnalyticsCard";
import { BulkRolloverDialog } from "@/components/seasons/BulkRolloverDialog";
import { SeasonEoiConfigCard } from "@/components/seasons/SeasonEoiConfigCard";
import { EoiEmbedCard } from "@/components/eoi/EoiEmbedCard";
import { useClubSeasons } from "@/hooks/useClubSeasons";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabSeasonDetail } from "@/lab/fixtureDataLayer";

export default function SeasonDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    const season = getLocalLabSeasonDetail(id ?? "season-icp-001") ?? getLocalLabSeasonDetail("season-icp-001");
    return (
      <div className="container max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold">{season?.name ?? "Season"}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Showing synthetic ICP lab season data. Rollover, activation, archiving, and EOI configuration are disabled.
        </p>
        {season && (
          <Card>
            <CardContent className="p-4 grid grid-cols-2 gap-2 text-center">
              <div><p className="text-xl font-bold">{season.stats.games_played}</p><p className="text-xs text-muted-foreground">Games played</p></div>
              <div><p className="text-xl font-bold">{season.stats.wins}</p><p className="text-xs text-muted-foreground">Wins</p></div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return <SupabaseSeasonDetailPage />;
}

function SupabaseSeasonDetailPage() {
  const { clubId, seasonId } = useParams<{ clubId: string; seasonId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [bulkRolloverOpen, setBulkRolloverOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [ackReadonly, setAckReadonly] = useState(false);
  const [ackIrreversible, setAckIrreversible] = useState(false);
  const [ackBackup, setAckBackup] = useState(false);

  const resetArchiveConfirm = () => {
    setConfirmName("");
    setAckReadonly(false);
    setAckIrreversible(false);
    setAckBackup(false);
  };

  const { data: allSeasons = [] } = useClubSeasons(clubId);

  const { data: season, isLoading: seasonLoading } = useQuery({
    queryKey: ["season", seasonId],
    queryFn: async () => {
      if (!seasonId) return null;
      const { data, error } = await supabase.from("seasons").select("*").eq("id", seasonId).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!seasonId,
  });

const { data: club } = useQuery({
    queryKey: ["club-detail", clubId],
    queryFn: async () => {
      if (!clubId) return null;
      const { data } = await supabase.from("clubs").select("id, name").eq("id", clubId).maybeSingle();
      return data;
    },
    enabled: !!clubId,
  });

  const { data: teams = [], isLoading: teamsLoading } = useQuery({
    queryKey: ["season-teams", seasonId],
    queryFn: async () => {
      if (!seasonId) return [];
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, level_age, lifecycle_status")
        .eq("season_id", seasonId)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!seasonId,
  });

  const teamIds = teams.map((t) => t.id);
  const { data: playerCounts = {} } = useQuery({
    queryKey: ["season-team-player-counts", seasonId, teamIds.join(",")],
    queryFn: async (): Promise<Record<string, number>> => {
      if (teamIds.length === 0) return {};
      const { data, error } = await supabase
        .from("team_memberships")
        .select("team_id")
        .eq("season_id", seasonId!)
        .eq("status", "active")
        .eq("role", "player")
        .in("team_id", teamIds);
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data ?? []).forEach((row: any) => {
        counts[row.team_id] = (counts[row.team_id] ?? 0) + 1;
      });
      return counts;
    },
    enabled: teamIds.length > 0,
  });

  const totalPlayers = Object.values(playerCounts).reduce((a, b) => a + b, 0);

  const archiveMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("archive_season", { _season_id: seasonId! });
      if (error) throw error;
      const { data: notified, error: notifyError } = await supabase.rpc(
        "notify_season_archived",
        { _season_id: seasonId! },
      );
      return { notified: notified ?? 0, notifyError };
    },
    onSuccess: ({ notified, notifyError }) => {
      if (notifyError) {
        toast.success("Season archived");
        toast.warning("Could not send all member notifications");
      } else {
        toast.success(
          notified > 0
            ? `Season archived — ${notified} member${notified === 1 ? "" : "s"} notified`
            : "Season archived",
        );
      }
      qc.invalidateQueries({ queryKey: ["season", seasonId] });
      qc.invalidateQueries({ queryKey: ["club-seasons", clubId] });
      qc.invalidateQueries({ queryKey: ["season-teams", seasonId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const notifyMut = useMutation({
    mutationFn: async () => {
      const rpc = season?.status === "active" ? "notify_season_published" : "notify_season_archived";
      const { data, error } = await supabase.rpc(rpc as any, { _season_id: seasonId! });
      if (error) throw error;
      return data ?? 0;
    },
    onSuccess: (count) => {
      toast.success(
        count > 0
          ? `Notified ${count} member${count === 1 ? "" : "s"}`
          : "No members to notify",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const priorSeasons = allSeasons.filter((s) => s.id !== seasonId && (s.status === "closed" || s.status === "archived" || s.status === "active"));

  const publishMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("publish_season", { _season_id: seasonId! });
      if (error) throw error;
      // Fan out push notifications to all placed players (and guardians of children).
      // Failure here should not block the publish — surface as a soft warning instead.
      const { data: notified, error: notifyError } = await supabase.rpc(
        "notify_season_published",
        { _season_id: seasonId! },
      );
      return { notified: notified ?? 0, notifyError };
    },
    onSuccess: ({ notified, notifyError }) => {
      if (notifyError) {
        toast.success("Season published");
        toast.warning("Could not send all member notifications");
      } else {
        toast.success(
          notified > 0
            ? `Season published — ${notified} member${notified === 1 ? "" : "s"} notified`
            : "Season published — it is now active",
        );
      }
      qc.invalidateQueries({ queryKey: ["season", seasonId] });
      qc.invalidateQueries({ queryKey: ["club-seasons", clubId] });
      qc.invalidateQueries({ queryKey: ["season-teams", seasonId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (seasonLoading || teamsLoading) return <PageLoading />;
  if (!season) {
    return (
      <div className="py-6">
        <Button variant="ghost" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4 mr-2" />Back</Button>
        <p className="text-muted-foreground p-4">Season not found.</p>
      </div>
    );
  }

  const isArchived = season.status === "archived";
  const isDraft = season.status === "draft";
  const isActive = season.status === "active";

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/clubs/${clubId}/seasons`)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">{season.name}</h1>
          <p className="text-sm text-muted-foreground">
            {season.start_date ? format(new Date(season.start_date), "MMM d, yyyy") : "No start date"}
          </p>
        </div>
        <Badge variant={isActive ? "default" : "secondary"} className="capitalize flex-shrink-0">
          {season.status}
        </Badge>
      </div>

      {isDraft && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Rocket className="h-4 w-4" /> Ready to publish?
            </CardTitle>
            <CardDescription>
              Publishing makes this the active season. Teams become live and members will see the new structure.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => publishMut.mutate()} disabled={publishMut.isPending}>
              <Rocket className="h-4 w-4 mr-2" />
              Publish season
            </Button>
          </CardContent>
        </Card>
      )}

      {isDraft && clubId && seasonId && teams.length > 0 && (
        <DraftTeamBuilder clubId={clubId} seasonId={seasonId} teams={teams} />
      )}

      {isDraft && priorSeasons.length > 0 && teams.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users2 className="h-4 w-4" /> Bulk roll over teams
            </CardTitle>
            <CardDescription>
              Carry players from an earlier season across, team-by-team.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => setBulkRolloverOpen(true)}>
              <Users2 className="h-4 w-4 mr-2" />
              Choose teams to roll over
            </Button>
          </CardContent>
        </Card>
      )}

      {(isActive || isArchived) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4" /> Notify members
            </CardTitle>
            <CardDescription>
              Send a push reminder about this season to all placed players and their guardians.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => notifyMut.mutate()} disabled={notifyMut.isPending}>
              <Bell className="h-4 w-4 mr-2" />
              Send notification
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Teams in this season</CardTitle>
          <CardDescription>
            {teams.length} team{teams.length === 1 ? "" : "s"} · {totalPlayers} player{totalPlayers === 1 ? "" : "s"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {teams.length === 0 && (
            <p className="text-sm text-muted-foreground">No teams yet.</p>
          )}
          {teams.map((t) => {
            const playerCount = playerCounts[t.id] ?? 0;
            return (
              <div
                key={t.id}
                className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/40 cursor-pointer"
                onClick={() => navigate(`/teams/${t.id}`)}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {playerCount} player{playerCount === 1 ? "" : "s"}
                    {t.level_age ? ` · ${t.level_age}` : ""}
                  </p>
                </div>
                <Badge variant="outline" className="capitalize flex-shrink-0">{t.lifecycle_status}</Badge>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {(isActive || isArchived) && seasonId && <SeasonAnalyticsCard seasonId={seasonId} />}

{seasonId && club && season && (
        <>
          <SeasonEoiConfigCard seasonId={seasonId} clubName={club.name} season={season as any} />
{seasonId && club && season && season.eoi_enabled && (
            <EoiEmbedCard 
              clubId={club.id} 
              seasonId={seasonId} 
              seasonSlug={season.eoi_slug || season.id} 
              clubSlug={club.id}
            />
          )}
        </>
      )}

      {isActive && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" /> Danger zone
            </CardTitle>
            <CardDescription>
              Archiving a season locks every team's chat, events, attendance and roster. This is intended for end-of-season only and should not be used by mistake.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!dangerOpen ? (
              <Button variant="outline" size="sm" onClick={() => setDangerOpen(true)}>
                <ShieldAlert className="h-4 w-4 mr-2" />
                Show end-of-season controls
              </Button>
            ) : (
              <>
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  <p className="font-medium mb-1">Are you sure you want to do this?</p>
                  <p className="text-destructive/80">
                    Archiving {season.name} will set all {teams.length} team{teams.length === 1 ? "" : "s"} to read-only immediately. Members will lose the ability to chat, RSVP, or update rosters on these teams. This action cannot be undone from the app.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setDangerOpen(false)}>
                    Never mind
                  </Button>
                  <AlertDialog
                    open={archiveDialogOpen}
                    onOpenChange={(o) => {
                      setArchiveDialogOpen(o);
                      if (!o) resetArchiveConfirm();
                    }}
                  >
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm">
                        <Archive className="h-4 w-4 mr-2" />
                        Archive season…
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                          <ShieldAlert className="h-5 w-5" />
                          Archive {season.name}?
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                          <div className="space-y-3 text-sm">
                            <p>
                              This will lock <strong>{teams.length} team{teams.length === 1 ? "" : "s"}</strong> to read-only. Chats, events, attendance and rosters will all be frozen. History is preserved, but no further changes can be made.
                            </p>
                            <p className="text-destructive font-medium">
                              This cannot be undone from the app.
                            </p>
                          </div>
                        </AlertDialogDescription>
                      </AlertDialogHeader>

                      <div className="space-y-3 py-2">
                        <label className="flex items-start gap-2 text-sm">
                          <Checkbox checked={ackReadonly} onCheckedChange={(v) => setAckReadonly(v === true)} className="mt-0.5" />
                          <span>I understand all teams in this season will become read-only.</span>
                        </label>
                        <label className="flex items-start gap-2 text-sm">
                          <Checkbox checked={ackIrreversible} onCheckedChange={(v) => setAckIrreversible(v === true)} className="mt-0.5" />
                          <span>I understand this cannot be undone from the app.</span>
                        </label>
                        <label className="flex items-start gap-2 text-sm">
                          <Checkbox checked={ackBackup} onCheckedChange={(v) => setAckBackup(v === true)} className="mt-0.5" />
                          <span>I've confirmed with the club committee that this season should end now.</span>
                        </label>

                        <div className="space-y-1.5 pt-1">
                          <Label htmlFor="confirm-season-name" className="text-xs">
                            Type the season name <span className="font-mono font-semibold">{season.name}</span> to confirm
                          </Label>
                          <Input
                            id="confirm-season-name"
                            value={confirmName}
                            onChange={(e) => setConfirmName(e.target.value)}
                            placeholder={season.name}
                            autoComplete="off"
                          />
                        </div>
                      </div>

                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={(e) => {
                            const allChecked = ackReadonly && ackIrreversible && ackBackup;
                            const nameMatches = confirmName.trim() === season.name.trim();
                            if (!allChecked || !nameMatches || archiveMut.isPending) {
                              e.preventDefault();
                              return;
                            }
                            archiveMut.mutate();
                            setArchiveDialogOpen(false);
                            setDangerOpen(false);
                            resetArchiveConfirm();
                          }}
                          disabled={
                            !ackReadonly ||
                            !ackIrreversible ||
                            !ackBackup ||
                            confirmName.trim() !== season.name.trim() ||
                            archiveMut.isPending
                          }
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {archiveMut.isPending ? "Archiving…" : "Yes, archive this season"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {isArchived && (
        <Card>
          <CardContent className="p-4 flex items-start gap-2 text-sm text-muted-foreground">
            <Archive className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>This season is archived and read-only. All history is preserved.</span>
          </CardContent>
        </Card>
      )}

      {bulkRolloverOpen && priorSeasons.length > 0 && seasonId && (
        <BulkRolloverDialog
          open={bulkRolloverOpen}
          onOpenChange={setBulkRolloverOpen}
          sourceSeasonId={priorSeasons[0].id}
          targetSeasonId={seasonId}
        />
      )}
    </div>
  );
}
