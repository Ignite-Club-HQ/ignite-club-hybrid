import { useState, Suspense } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate } from "react-router-dom";
import { resolveChatMetadataState } from "@/lib/chatMetadataGate";
import { ChatUnreachable } from "@/components/chat/ChatUnreachable";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Users, Loader2, Plus, X, UserPlus, Flame } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { hasGameBoardSupport } from "@/lib/sportDetection";
import { AddDutySheet } from "@/components/AddDutySheet";
import { AssignDutySheet } from "@/components/AssignDutySheet";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

// Lazy load PitchBoard for performance
const PitchBoard = lazyWithRetry(() => import("@/components/pitch/PitchBoard"));

interface GroupDuty {
  id: string;
  name: string;
  assigned_to: string | null;
  status: "pending" | "confirmed" | "completed";
  points: number;
  assignee?: { display_name: string } | null;
}

interface GroupPlayer {
  id: string;
  name: string;
  ability_rating: number;
  team: "a" | "b" | null;
}

import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabEventGroupPitch } from "@/lab/fixtureDataLayer";

export default function EventGroupPitchPage() {
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  if (useIcpLab) {
    return <IcpLabEventGroupPitchPage />;
  }
  return <SupabaseEventGroupPitchPage />;
}

/** Read-only synthetic event-group pitch feed; live coordination remains unavailable until events_domain messaging is wired here. */
function IcpLabEventGroupPitchPage() {
  const { id: eventId } = useParams<{ id: string; groupId: string }>();
  const navigate = useNavigate();
  const pitch = getLocalLabEventGroupPitch(eventId ?? "event-icp-001");

  return (
    <div className="container max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">Event Group Pitch</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Showing a synthetic ICP lab pitch feed. Sending messages and live coordination are disabled.
      </p>
      <div className="space-y-2">
        {pitch.messages.map((message) => (
          <Card key={message.id}>
            <CardContent className="p-3 text-sm">{message.text}</CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SupabaseEventGroupPitchPage() {
  const { id: eventId, groupId } = useParams<{ id: string; groupId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  const [showPitchBoard, setShowPitchBoard] = useState(false);
  const [isDutySheetOpen, setIsDutySheetOpen] = useState(false);
  const [assignDutyOpen, setAssignDutyOpen] = useState(false);
  const [selectedDuty, setSelectedDuty] = useState<GroupDuty | null>(null);

  // Fetch group details.
  // `maybeSingle()` so an absent row resolves to `null` on a SUCCESSFUL query —
  // that's what lets the gate below tell "deleted" apart from "network dropped".
  const {
    data: group,
    isLoading: groupLoading,
    isError: groupIsError,
    status: groupStatus,
    fetchStatus: groupFetchStatus,
    refetch: refetchGroup,
    isFetching: groupIsFetching,
  } = useQuery({
    queryKey: ["event-group", groupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_groups")
        .select(`
          *,
          event:events(id, title, event_date, start_time, end_time, mini_league_id)
        `)
        .eq("id", groupId!)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!groupId,
  });


  // Fetch group players with team assignment
  const { data: players } = useQuery({
    queryKey: ["event-group-players-with-teams", groupId],
    queryFn: async () => {
      const { data: groupPlayers, error: gpError } = await supabase
        .from("event_group_players")
        .select("player_id, team")
        .eq("group_id", groupId!);
      if (gpError) throw gpError;
      
      if (!groupPlayers?.length) return [];
      
      const { data: playersData, error: playersError } = await supabase
        .from("mini_league_players")
        .select("id, name, ability_rating")
        .in("id", groupPlayers.map(gp => gp.player_id));
      if (playersError) throw playersError;
      
      return (playersData || []).map(p => ({
        ...p,
        ability_rating: p.ability_rating || 3,
        team: groupPlayers.find(gp => gp.player_id === p.id)?.team as "a" | "b" | null,
      })) as GroupPlayer[];
    },
    enabled: !!groupId,
  });

  // Fetch group duties
  const { data: duties, isLoading: dutiesLoading } = useQuery({
    queryKey: ["event-group-duties", groupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_group_duties")
        .select("*, assignee:profiles!event_group_duties_assigned_to_fkey(display_name)")
        .eq("group_id", groupId!)
        .order("created_at");
      if (error) throw error;
      return data as GroupDuty[];
    },
    enabled: !!groupId,
  });

  // Fetch league settings for pitch board defaults
  const { data: leagueSettings } = useQuery({
    queryKey: ["mini-league-pitch-settings", group?.event?.mini_league_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_leagues")
        .select("minutes_per_half, club_id, clubs:clubs!mini_leagues_club_id_fkey(sport)")
        .eq("id", group!.event!.mini_league_id!)
        .single();
      if (error) throw error;
      return data as unknown as { minutes_per_half: number; club_id: string; clubs: { sport: string | null } | null };
    },
    enabled: !!group?.event?.mini_league_id,
  });

  // Check Pro Football subscription for the league's club
  const { data: hasProFootball, isLoading: proLoading } = useQuery({
    queryKey: ["club-pro-football", leagueSettings?.club_id],
    queryFn: async () => {
      const { data: appAdminRole } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      if (appAdminRole) return true;

      const { data } = await supabase
        .from("club_subscriptions")
        .select("is_pro_football, admin_pro_football_override, expires_at")
        .eq("club_id", leagueSettings!.club_id)
        .maybeSingle();
      if (!data) return false;
      const expired = data.expires_at && new Date(data.expires_at) < new Date();
      return !expired && (data.is_pro_football || data.admin_pro_football_override);
    },
    enabled: !!leagueSettings?.club_id && !!user,
    staleTime: 1000 * 60 * 5,
    placeholderData: (prev) => prev,
  });

  // Check if user can edit pitch board (club_admin, league_admin, coach, app_admin, or Subs Manager duty)
  const { data: editPermission } = useQuery({
    queryKey: ["mini-league-edit-permission", user?.id, leagueSettings?.club_id, groupId],
    queryFn: async () => {
      if (!user || !leagueSettings?.club_id) return { canEdit: false, isSubsManager: false };
      
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("club_id", leagueSettings.club_id)
        .in("role", ["club_admin", "league_admin", "coach", "app_admin"]);
      
      // Also check for app_admin without club_id
      const { data: appAdminRoles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "app_admin");
      
      const hasAdminRole = (roles && roles.length > 0) || (appAdminRoles && appAdminRoles.length > 0);
      if (hasAdminRole) return { canEdit: true, isSubsManager: false };

      // Check if user has "Subs Manager" duty for this specific group
      if (groupId) {
        const { data: subsManagerDuty } = await supabase
          .from("event_group_duties")
          .select("id")
          .eq("group_id", groupId)
          .eq("name", "Subs Manager")
          .eq("assigned_to", user.id)
          .maybeSingle();
        
        if (subsManagerDuty) return { canEdit: true, isSubsManager: true };
      }

      return { canEdit: false, isSubsManager: false };
    },
    enabled: !!user && !!leagueSettings?.club_id,
  });
  const userCanEdit = editPermission?.canEdit;
  const isSubsManagerForGroup = editPermission?.isSubsManager;

  // Fetch league members for duty assignment (parents, admins, coaches - not players)
  const { data: leagueMembers } = useQuery({
    queryKey: ["mini-league-duty-assignees", group?.event?.mini_league_id],
    queryFn: async () => {
      const miniLeagueId = group!.event!.mini_league_id!;
      
      // Get mini league to find the club_id
      const { data: league, error: leagueError } = await supabase
        .from("mini_leagues")
        .select("club_id")
        .eq("id", miniLeagueId)
        .single();
      if (leagueError) throw leagueError;
      
      // Get all parent user IDs from mini league players
      const { data: playersData, error: playersError } = await supabase
        .from("mini_league_players")
        .select("parent_user_id")
        .eq("mini_league_id", miniLeagueId)
        .not("parent_user_id", "is", null);
      if (playersError) throw playersError;
      
      const parentIds = [...new Set(playersData?.map(p => p.parent_user_id).filter(Boolean) as string[])];
      
      // Get club admins, league admins, and coaches from user_roles
      const { data: adminRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", league.club_id)
        .in("role", ["club_admin", "league_admin", "coach"]);
      if (rolesError) throw rolesError;
      
      const adminIds = adminRoles?.map(r => r.user_id) || [];
      
      // Combine all unique IDs
      const allUserIds = [...new Set([...parentIds, ...adminIds])];
      if (!allUserIds.length) return [];
      
      // Fetch profiles for all these users
      const { data: profiles, error: profilesError } = await selectCachedProfilesByIds(allUserIds);
      if (profilesError) throw profilesError;

      return (profiles || []).slice().sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""));
    },
    enabled: !!group?.event?.mini_league_id,
  });

  // Add duty mutation
  const addDutyMutation = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("event_group_duties").insert({
        group_id: groupId!,
        name,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-group-duties", groupId] });
      setIsDutySheetOpen(false);
      toast.success("Duty added");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Assign duty mutation
  const assignDutyMutation = useMutation({
    mutationFn: async ({ dutyId, assignedTo }: { dutyId: string; assignedTo: string | null }) => {
      const { error } = await supabase
        .from("event_group_duties")
        .update({ assigned_to: assignedTo, status: assignedTo ? "confirmed" : "pending" })
        .eq("id", dutyId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-group-duties", groupId] });
      toast.success("Duty updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Delete duty mutation
  const deleteDutyMutation = useMutation({
    mutationFn: async (dutyId: string) => {
      const { error } = await supabase.from("event_group_duties").delete().eq("id", dutyId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-group-duties", groupId] });
      toast.success("Duty removed");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (groupLoading || proLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // The pitch board is football-only in this build — block the route outright
  // for clubs playing any other sport.
  if (leagueSettings && !hasGameBoardSupport(leagueSettings.clubs?.sport)) {
    return (
      <div className="container max-w-4xl py-6 text-center space-y-4">
        <h2 className="text-xl font-semibold">Not available for this sport</h2>
        <p className="text-muted-foreground">
          The pitch board is only available for football/soccer clubs.
        </p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          Go Back
        </Button>
      </div>
    );
  }

  if (hasProFootball === false) {
    return (
      <div className="container max-w-4xl py-6 text-center space-y-4">
        <h2 className="text-xl font-semibold">Pro Football Required</h2>
        <p className="text-muted-foreground">
          Mini League match days require an active Pro Football subscription.
        </p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          Go Back
        </Button>
      </div>
    );
  }

  const groupMetadataState = resolveChatMetadataState({
    data: group,
    isLoading: groupLoading,
    isError: groupIsError,
    fetchStatus: groupFetchStatus,
    status: groupStatus,
    isOnline: typeof navigator === "undefined" ? true : navigator.onLine !== false,
  });

  if (groupMetadataState === "unreachable") {
    return (
      <div className="container max-w-4xl py-6">
        <ChatUnreachable
          label="match day group"
          onRetry={() => void refetchGroup()}
          retrying={groupIsFetching}
          backTo="/schedule"
          backLabel="Back to Schedule"
        />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="container max-w-4xl py-6 text-center">
        <p className="text-muted-foreground">Group not found</p>
      </div>
    );
  }


  // Convert mini league players to the format expected by PitchBoard
  // PitchBoard expects members in this format for initialization
  const pitchBoardMembers = (players || []).map((player, index) => ({
    id: `player-${index}`, // Synthetic ID for the member row
    user_id: player.id, // Use player ID as user_id (PitchBoard will use this)
    role: "player",
    profiles: {
      display_name: player.name,
      avatar_url: null,
    },
  }));

  // Determine team size based on players per team
  const teamACount = players?.filter(p => p.team === "a").length || 0;
  const teamBCount = players?.filter(p => p.team === "b").length || 0;
  const avgTeamSize = Math.max(Math.ceil((teamACount + teamBCount) / 2), 4);
  const initialTeamSize = avgTeamSize <= 4 ? 4 : avgTeamSize <= 7 ? 7 : avgTeamSize <= 9 ? 9 : 11;

  // Build mini-league two-team configuration
  const miniLeagueTeams = {
    teamAPlayerIds: (players || []).filter(p => p.team === "a").map(p => p.id),
    teamBPlayerIds: (players || []).filter(p => p.team === "b").map(p => p.id),
    teamAColor: group.team_a_color || "#ef4444",
    teamBColor: group.team_b_color || "#3b82f6",
    teamAName: "Team A",
    teamBName: "Team B",
  };

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => navigate(`/events/${eventId}`)}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{group.name}</h1>
          <p className="text-muted-foreground text-sm">
            {group.ability_band && `${group.ability_band} • `}
            {group.pitch_name || "No pitch assigned"}
          </p>
        </div>
        <Badge variant="outline">
          <Users className="h-3.5 w-3.5 mr-1" />
          {players?.length || 0}
        </Badge>
      </div>

      {/* Open Pitch Board Button — only available on the day of the game */}
      {(() => {
        const eventDateStr = (group as any)?.event?.event_date;
        if (!eventDateStr) return null;
        const eventDate = new Date(eventDateStr);
        const now = new Date();
        const isGameDay =
          eventDate.getFullYear() === now.getFullYear() &&
          eventDate.getMonth() === now.getMonth() &&
          eventDate.getDate() === now.getDate();

        if (!isGameDay) {
          return (
            <Card className="bg-muted/40 border-dashed">
              <CardContent className="p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  The pitch board for this match opens on game day.
                </p>
              </CardContent>
            </Card>
          );
        }

        return (
          <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
            <CardContent className="p-6">
              <Button
                size="lg"
                className="w-full"
                onClick={() => setShowPitchBoard(true)}
              >
                <Flame className="h-5 w-5 mr-2" />
                Open Pitch Board
              </Button>
              <p className="text-center text-sm text-muted-foreground mt-3">
                Manage players, track game time, and record substitutions
              </p>
            </CardContent>
          </Card>
        );
      })()}

      {/* Players */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Players</CardTitle>
          <CardDescription>
            {players?.length || 0} players in this match
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Two Teams Display */}
          {players && players.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {/* Team A */}
              <div className="p-2 rounded-lg border" style={{ borderColor: group.team_a_color || "#ef4444" }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-xs font-medium" style={{ color: group.team_a_color || "#ef4444" }}>
                    Team A
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({players.filter(p => p.team === "a").length})
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {players.filter(p => p.team === "a").map((player) => (
                    <Badge key={player.id} variant="secondary" className="text-xs py-1">
                      {player.name}
                    </Badge>
                  ))}
                  {players.filter(p => p.team === "a").length === 0 && (
                    <span className="text-xs text-muted-foreground">No players</span>
                  )}
                </div>
              </div>
              
              {/* Team B */}
              <div className="p-2 rounded-lg border" style={{ borderColor: group.team_b_color || "#3b82f6" }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-xs font-medium" style={{ color: group.team_b_color || "#3b82f6" }}>
                    Team B
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({players.filter(p => p.team === "b").length})
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {players.filter(p => p.team === "b").map((player) => (
                    <Badge key={player.id} variant="secondary" className="text-xs py-1">
                      {player.name}
                    </Badge>
                  ))}
                  {players.filter(p => p.team === "b").length === 0 && (
                    <span className="text-xs text-muted-foreground">No players</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No players assigned</p>
          )}
        </CardContent>
      </Card>

      {/* Duties */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Duties</CardTitle>
              <CardDescription>
                {duties?.length || 0} duties for this match
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setIsDutySheetOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {dutiesLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : duties?.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-muted-foreground">No duties assigned</p>
            </div>
          ) : (
            <div className="space-y-2">
              {duties?.map((duty) => (
                <div 
                  key={duty.id} 
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${
                      duty.status === "completed" ? "bg-green-500" :
                      duty.status === "confirmed" ? "bg-primary" : "bg-muted-foreground"
                    }`} />
                    <div>
                      <p className="font-medium text-sm">{duty.name}</p>
                      {duty.assignee?.display_name && (
                        <p className="text-xs text-muted-foreground">
                          {duty.assignee.display_name}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => {
                        setSelectedDuty(duty);
                        setAssignDutyOpen(true);
                      }}
                    >
                      <UserPlus className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => deleteDutyMutation.mutate(duty.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Duty Sheet - uses match context for mini league */}
      <AddDutySheet
        open={isDutySheetOpen}
        onOpenChange={setIsDutySheetOpen}
        onAddDuty={(dutyName) => addDutyMutation.mutate(dutyName)}
        isPending={addDutyMutation.isPending}
        isMiniLeague={true}
        context="match"
      />

      {/* Assign Duty Sheet */}
      {selectedDuty && (
        <AssignDutySheet
          open={assignDutyOpen}
          onOpenChange={(open) => {
            setAssignDutyOpen(open);
            if (!open) setSelectedDuty(null);
          }}
          dutyName={selectedDuty.name}
          currentAssignee={selectedDuty.assigned_to}
          members={(leagueMembers || []).map(m => ({
            id: m.id,
            display_name: m.display_name,
            avatar_url: m.avatar_url,
          }))}
          onAssign={(userId) => {
            assignDutyMutation.mutate({
              dutyId: selectedDuty.id,
              assignedTo: userId,
            });
            setAssignDutyOpen(false);
            setSelectedDuty(null);
          }}
          isPending={assignDutyMutation.isPending}
        />
      )}

      {/* Pitch Board Modal */}
      {showPitchBoard && pitchBoardMembers.length > 0 && createPortal(
        <Suspense fallback={
          <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ backgroundColor: '#2d5a27' }}>
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-primary">
                  <Flame className="h-8 w-8 text-primary-foreground" />
                </div>
                <span className="text-4xl" role="img" aria-label="soccer ball">⚽</span>
              </div>
              <Loader2 className="h-6 w-6 animate-spin text-white" />
              <p className="text-sm text-white/80">Loading Pitch Board...</p>
            </div>
          </div>
        }>
          <PitchBoard
            key={groupId}
            teamId={`event-group-${groupId}`}
            teamName={group.name}
            members={pitchBoardMembers}
            onClose={() => setShowPitchBoard(false)}
            disableAutoSubs={false}
            initialRotationSpeed={2}
            initialDisablePositionSwaps={false}
            initialDisableBatchSubs={false}
            initialRotateGkAtHalftime={true}
            initialMinutesPerHalf={leagueSettings?.minutes_per_half || 10}
            initialMaxSpreadMinutes={(leagueSettings as any)?.max_spread_minutes ?? 5}
            initialTeamSize={initialTeamSize}
            readOnly={!userCanEdit}
            isSubsManager={!!isSubsManagerForGroup}
            initialLinkedEventId={null}
            initialShowMatchHeader={false}
            miniLeagueTeams={miniLeagueTeams}
          />
        </Suspense>,
        document.body
      )}
    </div>
  );
}
