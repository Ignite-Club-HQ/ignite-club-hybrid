import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ShieldAlert, Crown, Lock, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { supabase } from "@/integrations/supabase/client";
import { FixturesCSVImport } from "@/components/FixturesCSVImport";
import { ClubAdminConfirmBanner } from "@/components/ClubAdminConfirmBanner";

import { IcpUnavailablePage } from "@/components/IcpUnavailablePage";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

export default function ImportFixturesPage() {
  if (resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true)) {
    return <IcpUnavailablePage title="Fixture import is unavailable in ICP lab mode" description="External calendar and document-provider imports remain disabled until an approved worker boundary is implemented." />;
  }
  return <SupabaseImportFixturesPage />;
}

function SupabaseImportFixturesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { activeClubFilter } = useClubTheme();
  const [clubId, setClubId] = useState("");
  const [teamId, setTeamId] = useState("");

  // Fetch user's club-level admin roles (club_admin and committee_member)
  const { data: clubAdminRoles, isLoading: clubRolesLoading } = useQuery({
    queryKey: ["user-club-admin-roles", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("club_id, role")
        .eq("user_id", user!.id)
        .in("role", ["club_admin", "committee_member"])
        .not("club_id", "is", null);
      return data || [];
    },
    enabled: !!user,
  });

  // Fetch user's team admin/coach roles
  const { data: teamAdminRoles, isLoading: teamRolesLoading } = useQuery({
    queryKey: ["user-team-admin-roles", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("team_id, club_id")
        .eq("user_id", user!.id)
        .in("role", ["team_admin", "coach", "committee_member"])
        .not("team_id", "is", null);
      return data || [];
    },
    enabled: !!user,
  });

  // Determine which clubs the user can access
  const { data: allClubs } = useQuery({
    queryKey: ["user-admin-clubs", user?.id, clubAdminRoles, teamAdminRoles],
    queryFn: async () => {
      const clubIdsFromClubs = clubAdminRoles?.map((r) => r.club_id).filter(Boolean) || [];
      const clubIdsFromTeams = teamAdminRoles?.map((r) => r.club_id).filter(Boolean) || [];
      const clubIds = [...new Set([...clubIdsFromClubs, ...clubIdsFromTeams])];

      if (clubIds.length === 0) return [];
      
      const { data } = await supabase
        .from("clubs")
        .select("id, name, sport")
        .in("id", clubIds);

      return data || [];
    },
    enabled: !!user && (!!clubAdminRoles || !!teamAdminRoles),
  });

  // When the app is filtered to a single club, restrict selection to that club only
  const clubs = useMemo(() => {
    if (!allClubs) return allClubs;
    if (!activeClubFilter) return allClubs;
    return allClubs.filter((c) => c.id === activeClubFilter);
  }, [allClubs, activeClubFilter]);

  const clubLocked = !!activeClubFilter && (clubs?.length ?? 0) > 0;

  // Auto-select / correct the club when filtered
  useEffect(() => {
    if (!activeClubFilter) return;
    if (!clubs || clubs.length === 0) return;
    if (clubId !== activeClubFilter) {
      setClubId(activeClubFilter);
      setTeamId("");
    }
  }, [activeClubFilter, clubs, clubId]);

  // Get current club name and sport for Dribl detection
  const selectedClub = clubs?.find(c => c.id === clubId);

  const isFootballClub = selectedClub?.sport?.toLowerCase().includes('football') || 
                          selectedClub?.sport?.toLowerCase().includes('soccer');

  // We no longer need userHasAnyProAccess - Pro access should be checked per team

  // Fetch club subscription to check Pro status for selected club
  const { data: clubSubscription, isLoading: subscriptionLoading } = useQuery({
    queryKey: ["club-subscription-for-import", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("club_subscriptions")
        .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
        .eq("club_id", clubId)
        .maybeSingle();
      return data;
    },
    enabled: !!clubId,
  });

  // Pro Access Logic for selected club/team:
  // 1. If club has Pro → all teams inherit Pro
  // 2. If club does NOT have Pro → check team's individual subscription
  const clubHasPro = clubSubscription?.is_pro || clubSubscription?.is_pro_football || 
                     clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override;

  // Check if user is club admin or committee member for selected club
  const isClubAdmin = useMemo(() => {
    if (!clubId || !clubAdminRoles) return false;
    return clubAdminRoles.some((r) => r.club_id === clubId);
  }, [clubId, clubAdminRoles]);

  // Get team IDs user has admin access to (for non-club-admins)
  const adminTeamIds = useMemo(() => {
    if (!teamAdminRoles) return new Set<string>();
    const teamIds = teamAdminRoles
      .map((r) => r.team_id)
      .filter((id): id is string => id !== null && id !== undefined);
    return new Set(teamIds);
  }, [teamAdminRoles]);

  // Fetch teams with their Pro subscription status
  const { data: teams, isLoading: teamsLoading } = useQuery({
    queryKey: ["club-teams-for-import", clubId],
    queryFn: async () => {
      const { data: teamsData } = await supabase
        .from("teams")
        .select("id, name, level_age")
        .eq("club_id", clubId);
      
      if (!teamsData || teamsData.length === 0) return [];
      
      // Check if club has Pro
      const hasClubPro = clubHasPro;
      
      if (hasClubPro) {
        return teamsData.map(t => ({ ...t, hasPro: true }));
      }
      
      // If club doesn't have Pro, check each team's subscription
      const { data: teamSubs } = await supabase
        .from("team_subscriptions")
        .select("team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
        .in("team_id", teamsData.map(t => t.id));
      
      type TeamSubscriptionStatus = {
        team_id: string;
        is_pro: boolean | null;
        is_pro_football: boolean | null;
        admin_pro_override: boolean | null;
        admin_pro_football_override: boolean | null;
      };
      const subsByTeamId = new Map<string, TeamSubscriptionStatus>(
        (teamSubs ?? []).map((subscription): [string, TeamSubscriptionStatus] => [
          subscription.team_id,
          subscription,
        ]),
      );
      
      return teamsData.map(t => {
        const sub = subsByTeamId.get(t.id);
        const hasPro = hasClubPro || !!(sub?.is_pro || sub?.is_pro_football || sub?.admin_pro_override || sub?.admin_pro_football_override);
        return { ...t, hasPro };
      });
    },
    enabled: !!clubId,
  });

  // Filter teams based on user permissions
  // Show all teams user has access to - Pro status is shown separately
  const accessibleTeams = useMemo(() => {
    if (!teams) return [];
    
    // Filter by user permissions if not club admin
    if (!isClubAdmin) {
      return teams.filter((t) => adminTeamIds.has(t.id));
    }
    
    return teams;
  }, [teams, isClubAdmin, adminTeamIds]);

  // Get selected team's Pro status from the teams data
  const selectedTeamHasPro = useMemo(() => {
    if (!teamId || !teams) return false;
    const selectedTeam = teams.find(t => t.id === teamId);
    return selectedTeam?.hasPro ?? false;
  }, [teamId, teams]);
  
  // Pro access is now strictly per-selection:
  // - No selection: show the selection UI (no Pro gate at this level)
  // - Club selected: check if club has Pro
  // - Team selected: check if team has Pro (via club inheritance or individual)
  const isProActive = useMemo(() => {
    // If no club selected yet, allow selection first
    if (!clubId) return true;
    
    // If still loading subscription, assume Pro until we know
    if (subscriptionLoading) return true;
    
    // If club has Pro, all teams inherit it
    if (clubHasPro) return true;
    
    // If club doesn't have Pro and a team is selected, check team's individual subscription
    if (teamId) return selectedTeamHasPro;
    
    // If club is selected but no team yet (multi-team import for club admins):
    // Club must have Pro for multi-team import
    return false;
  }, [clubId, teamId, clubHasPro, selectedTeamHasPro, subscriptionLoading]);

  const proStatusLoading = !!clubId && (subscriptionLoading || teamsLoading);

  const rolesLoading = clubRolesLoading || teamRolesLoading;

  const hasNoAccess = useMemo(() => {
    if (rolesLoading) return false;
    const hasClubRoles = clubAdminRoles && clubAdminRoles.length > 0;
    const hasTeamRoles = teamAdminRoles && teamAdminRoles.length > 0;
    return !hasClubRoles && !hasTeamRoles;
  }, [clubAdminRoles, teamAdminRoles, rolesLoading]);

  // Check if club admin is acting on a team they don't directly manage
  const isClubAdminActingOnOtherTeam = useMemo(() => {
    // Must be a club admin
    if (!isClubAdmin) return false;
    // If no team selected (all teams mode), show banner since they're acting on all teams
    if (!teamId) return clubId ? true : false;
    // Check if the selected team is NOT one they directly admin/coach
    return !adminTeamIds.has(teamId);
  }, [isClubAdmin, teamId, clubId, adminTeamIds]);

  // Get selected team name for the banner
  const selectedTeamName = useMemo(() => {
    if (!teamId || !teams) return "all teams";
    const team = teams.find(t => t.id === teamId);
    return team?.name || "this team";
  }, [teamId, teams]);

  if (hasNoAccess) {
    return (
      <div className="container max-w-lg mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold">Import Fixtures</h1>
        </div>

        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center text-center space-y-4">
              <div className="rounded-full bg-destructive/10 p-4">
                <ShieldAlert className="h-10 w-10 text-destructive" />
              </div>
              <div className="space-y-2">
                <h2 className="text-lg font-semibold">Access Denied</h2>
                <p className="text-sm text-muted-foreground max-w-sm">
                  You need to be a club admin, team admin, coach, or committee member to import fixtures.
                </p>
              </div>
              <Button variant="outline" onClick={() => navigate("/events")}>
                Back to Events
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Import Fixtures</h1>
          {!proStatusLoading && !isProActive && (
            <span className="inline-flex items-center gap-1 text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">
              <Crown className="h-3 w-3" />
              Pro
            </span>
          )}
        </div>
      </div>

      {/* Pro upgrade banner - show when club doesn't have Pro AND there are teams without Pro */}
      {!proStatusLoading && clubId && !clubHasPro && (() => {
        // Get teams with and without Pro access
        const teamsWithPro = accessibleTeams.filter(t => t.hasPro);
        const teamsWithoutPro = (teams || []).filter(t => !t.hasPro && (isClubAdmin || adminTeamIds.has(t.id)));
        
        // Don't show banner if all accessible teams have Pro
        if (teamsWithoutPro.length === 0) return null;
        
        // Determine which upgrade button to show (prefer club admin over team admin)
        const hasClubAdminRole = clubAdminRoles && clubAdminRoles.length > 0 && clubAdminRoles[0]?.club_id;
        const hasTeamAdminRole = teamAdminRoles && teamAdminRoles.length > 0 && teamAdminRoles[0]?.team_id;
        
        return (
          <Alert className="border-primary/20 bg-primary/5">
            <Lock className="h-4 w-4 text-primary" />
            <AlertDescription className="flex flex-col gap-3">
              <div className="space-y-2">
                <span className="text-sm font-medium">
                  This club doesn't have a Pro subscription.
                </span>
                
                {teamsWithPro.length > 0 && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Teams with Pro access: </span>
                    <span className="font-medium text-primary">
                      {teamsWithPro.map(t => t.name).join(", ")}
                    </span>
                  </div>
                )}
                
                {teamsWithoutPro.length > 0 && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Teams without Pro: </span>
                    <span>
                      {teamsWithoutPro.map(t => t.name).join(", ")}
                    </span>
                  </div>
                )}
                
                {teamsWithPro.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Select a Pro team below to import fixtures.
                  </p>
                )}
              </div>
              
              {/* Show upgrade button */}
              {hasClubAdminRole ? (
                <Button 
                  size="sm" 
                  onClick={() => navigate(`/clubs/${clubAdminRoles![0].club_id}/upgrade`)}
                  className="w-fit"
                >
                  <Crown className="h-4 w-4 mr-1" />
                  Upgrade Club to Pro
                </Button>
              ) : hasTeamAdminRole && teamsWithoutPro.length > 0 ? (
                <Button 
                  size="sm" 
                  onClick={() => navigate(`/teams/${teamAdminRoles![0].team_id}/upgrade`)}
                  className="w-fit"
                >
                  <Crown className="h-4 w-4 mr-1" />
                  Upgrade Team to Pro
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        );
      })()}

      {/* Club & Team Selection */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-sm font-medium">Club</Label>
          <Select value={clubId} disabled={clubLocked} onValueChange={(v) => { setClubId(v); setTeamId(""); }}>
            <SelectTrigger className="h-12">
              <SelectValue placeholder="Select a club" />
            </SelectTrigger>

            <SelectContent>
              {clubs?.map((club) => (
                <SelectItem key={club.id} value={club.id}>
                  {club.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {clubLocked && (
            <p className="text-xs text-muted-foreground">
              Locked to your currently filtered club. Switch clubs in the header to import for another club.
            </p>
          )}
        </div>


        {clubId && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              Team {isClubAdmin && <span className="text-muted-foreground font-normal">(optional)</span>}
            </Label>
            <Select 
              value={teamId || (isClubAdmin ? "all" : "")} 
              onValueChange={(v) => setTeamId(v === "all" ? "" : v)} 
            >
              <SelectTrigger className="h-12">
                <SelectValue placeholder={isClubAdmin ? "All teams" : "Select a team"} />
              </SelectTrigger>
              <SelectContent>
                {isClubAdmin && <SelectItem value="all">All teams (multi-team import)</SelectItem>}
                {accessibleTeams?.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!isClubAdmin && (
              <p className="text-xs text-muted-foreground">
                You can only import fixtures for teams you manage.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Permission notice for non-club admins */}
      {clubId && !isClubAdmin && !teamId && (
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription className="text-sm">
            Select a team to start importing fixtures.
          </AlertDescription>
        </Alert>
      )}

      {/* Club admin confirmation banner */}
      {isClubAdminActingOnOtherTeam && clubId && (isClubAdmin || teamId) && isProActive && !proStatusLoading && (
        <ClubAdminConfirmBanner teamName={selectedTeamName} action="import fixtures" />
      )}

      {/* Import Component */}
      {clubId && !proStatusLoading && isProActive && (isClubAdmin || teamId) ? (
        <FixturesCSVImport
          clubId={clubId}
          clubName={selectedClub?.name || ''}
          teamId={teamId || undefined}
          teams={isClubAdmin ? (teams || []) : accessibleTeams}
          onImportComplete={() => navigate("/events")}
          isClubAdmin={isClubAdmin}
          isProFootball={!!(clubSubscription?.is_pro_football || clubSubscription?.admin_pro_football_override)}
        />
      ) : clubId && !proStatusLoading && isProActive && !isClubAdmin && !teamId ? null : clubId && !proStatusLoading && !isProActive ? (
        <Card className="border-dashed">
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center text-center gap-3">
              <div className="rounded-full bg-muted p-4">
                <Lock className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                Upgrade to Pro to access bulk fixture import
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center text-center gap-3">
              <div className="rounded-full bg-muted p-4">
                <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                {proStatusLoading ? "Loading..." : "Select a club to get started"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
