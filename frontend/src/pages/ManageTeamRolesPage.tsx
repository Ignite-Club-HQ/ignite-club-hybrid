import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { RoleRequestsList } from "@/components/members/RoleRequestsList";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabTeamRoleRoster } from "@/lab/fixtureDataLayer";
import { connectLocalIdentityAccessClient } from "@/lab/localIdentityAccess";
import { membershipKeys } from "@/lab/membershipQueryKeys";
import { refreshTeamRoleChange } from "@/lab/teamMembershipCacheCompletion";
import { roleLabels, type AppRole } from "@/features/membership/rolePresentation";
import { IcpLabRoleRosterView } from "@/features/membership/IcpLabRoleRosterView";
import { groupRoleRowsByUser } from "@/features/membership/roleRoster";
import {
  RoleManagementHeader,
  RoleManagementTabs,
  RolePageLoading,
  RoleRosterEmpty,
  RoleRosterLoading,
} from "@/components/membership/RoleManagementShell";
import { RoleMemberCard } from "@/components/membership/RoleMemberCard";
import {
  roleMutationFeedback,
  roleRequestErrorFeedback,
} from "@/features/membership/roleMutationFeedback";

type TeamRole = Extract<
  AppRole,
  "basic_user" | "club_admin" | "team_admin" | "coach" | "player" | "parent" | "app_admin"
>;

const roleColors: Record<TeamRole, string> = {
  basic_user: "bg-muted text-muted-foreground",
  club_admin: "bg-primary/20 text-primary",
  team_admin: "bg-primary/20 text-primary",
  coach: "bg-blue-500/20 text-blue-500",
  player: "bg-green-500/20 text-green-500",
  parent: "bg-yellow-500/20 text-yellow-500",
  app_admin: "bg-destructive/20 text-destructive",
};

export default function ManageTeamRolesPage() {
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return <IcpLabManageTeamRolesPage />;
  }

  return <SupabaseManageTeamRolesPage />;
}

/** Read-only team role roster backed by synthetic fixtures; mutations remain unavailable until identity_access role-projection is wired here. */
function IcpLabManageTeamRolesPage() {
  const { user } = useAuth();
  const { teamId } = useParams<{ teamId: string }>();
  const persona = user?.id?.startsWith("icp-") ? user.id.slice(4) : "member";
  const [fallbackRoster] = useState(() => getLocalLabTeamRoleRoster(teamId ?? "team-icp-001"));
  const { data: state, error, isLoading } = useQuery({
    queryKey: ["icp-team-role-roster", teamId, persona],
    queryFn: async () => {
      try {
        const connection = await connectLocalIdentityAccessClient(persona);
        return { source: "icp" as const, state: await connection.client.exportState() };
      } catch (error) {
        if (!(error instanceof Error) || !/not configured/i.test(error.message)) throw error;
        return { source: "fixture" as const, state: null };
      }
    },
  });
  const roster = state?.state
    ? state.state.roles
      .filter((role) => role.team[0] === (teamId ?? "team-icp-001"))
      .map((role) => ({
        profile: { id: role.account_id, display_name: role.account_id },
        roles: [{ id: `${role.account_id}-${role.role}`, role: role.role }],
      }))
    : fallbackRoster;

  return (
    <IcpLabRoleRosterView
      title="Team Roles"
      source={state?.source}
      isLoading={isLoading}
      error={error}
      errorFallbackMessage="Unable to load team role data."
      roster={roster}
      roleBadgeClassName={(role) => roleColors[role as TeamRole]}
    />
  );
}

function SupabaseManageTeamRolesPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: team, isLoading: loadingTeam, fetchStatus: teamFetchStatus } = useQuery({
    queryKey: ["team", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*, clubs!club_id (name, bot_user_id)")
        .eq("id", teamId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!teamId,
  });

  const { data: roles, isLoading: loadingRoles } = useQuery({
    queryKey: membershipKeys.teamRoles(teamId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("*, profiles (id, display_name, avatar_url)")
        .eq("team_id", teamId!);
      if (error) throw error;
      return data;
    },
    enabled: !!teamId,
  });

  const { data: requests } = useQuery({
    queryKey: ["team-role-requests", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_requests")
        .select("*")
        .eq("team_id", teamId!)
        .eq("status", "pending");
      if (error) throw error;
      
      // Fetch profiles separately
      if (!data || data.length === 0) return [];
      const userIds = data.map(r => r.user_id);
      const { data: profiles } = await selectCachedProfilesByIds(userIds);
      
      return data.map(req => ({
        ...req,
        requester: profiles?.find(p => p.id === req.user_id) || null
      }));
    },
    enabled: !!teamId,
  });

  const deleteRoleMutation = useMutation({
    mutationFn: async ({ roleId, userId, roleName, userName }: { roleId: string; userId: string; roleName: string; userName: string }) => {
      const { error } = await supabase.from("user_roles").delete().eq("id", roleId);
      if (error) throw error;
      
      // Send notification to the user about role removal
      await supabase.from("notifications").insert({
        user_id: userId,
        type: "membership",
        message: `Your ${roleName} role has been removed from ${team?.name || "the team"}`,
        related_id: teamId,
      });
    },
    onSuccess: () => {
      if (teamId) refreshTeamRoleChange(queryClient, teamId);
      toast(roleMutationFeedback.removed);
    },
  });

  const resetPointsMutation = useMutation({
    mutationFn: async (userId: string) => {
      // Per-club balance: only reset points for THIS team's club.
      const { data: t } = await supabase
        .from("teams").select("club_id").eq("id", teamId!).maybeSingle();
      const clubId = (t as any)?.club_id;
      if (!clubId) throw new Error("Team has no club");
      const { data: row } = await supabase
        .from("user_club_points")
        .select("points").eq("user_id", userId).eq("club_id", clubId).maybeSingle();
      const currentPoints = row?.points || 0;
      if (currentPoints > 0) {
        const { error } = await (supabase.rpc as any)('increment_ignite_points', {
          _user_id: userId,
          _amount: -currentPoints,
          _club_id: clubId,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      if (teamId) refreshTeamRoleChange(queryClient, teamId);
      toast({ title: "Points reset to 0" });
    },
  });

  const handleRequestMutation = useMutation({
    mutationFn: async ({ requestId, approved }: { requestId: string; approved: boolean; request: any }) => {
      const rpcName = approved ? "approve_role_request" : "deny_role_request";
      const { error } = await supabase.rpc(rpcName, { p_request_id: requestId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-role-requests", teamId] });
      if (teamId) refreshTeamRoleChange(queryClient, teamId);
      toast(roleMutationFeedback.requestProcessed);
    },
    onError: (error: Error) => {
      toast(roleRequestErrorFeedback("team", error));
    },
  });

  if (loadingTeam || (teamFetchStatus === "paused" && !team)) {
    return <RolePageLoading />;
  }

  if (!team) {
    return <div className="py-6 text-center text-muted-foreground">Team not found</div>;
  }

  // Exclude the club's broadcast/bot account from the member list
  const botUserId = (team as any)?.clubs?.bot_user_id ?? null;

  const userRoles = groupRoleRowsByUser(roles ?? [], { excludeUserIds: botUserId ? [botUserId] : [] });

  return (
    <div className="py-6 space-y-6">
      <RoleManagementHeader subtitle={team.name} onBack={() => navigate(-1)} />
      <RoleManagementTabs
        requestCount={requests?.length ?? 0}
        members={
          loadingRoles ? (
            <RoleRosterLoading />
          ) : Object.keys(userRoles).length === 0 ? (
            <RoleRosterEmpty message="No members yet" />
          ) : (
            Object.entries(userRoles).map(([userId, { profile, roles: userRoleList }]) => (
              <RoleMemberCard
                key={userId}
                userId={userId}
                displayName={profile?.display_name}
                avatarUrl={profile?.avatar_url}
                isCurrentUser={userId === user?.id}
                roles={userRoleList.map((role) => ({
                  id: role.id,
                  label: roleLabels[role.role as AppRole],
                  className: roleColors[role.role as TeamRole],
                  variant: "secondary" as const,
                  removal:
                    userId === user?.id &&
                    role.role === "team_admin" &&
                    userRoleList.length <= 1
                      ? undefined
                      : {
                          description: `Remove ${roleLabels[role.role as AppRole]} from ${profile?.display_name}?`,
                          onConfirm: () =>
                            deleteRoleMutation.mutate({
                              roleId: role.id,
                              userId,
                              roleName: roleLabels[role.role as AppRole],
                              userName: profile?.display_name || "User",
                            }),
                        },
                }))}
                footerAction={
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1">
                        <RotateCcw className="h-3 w-3" />
                        <Flame className="h-3 w-3" />
                        Reset Points
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Reset Points?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will reset {profile?.display_name}'s points to 0 and remove any earned rewards.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => resetPointsMutation.mutate(userId)}
                          className="bg-destructive text-destructive-foreground"
                        >
                          Reset Points
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                }
              />
            ))
          )
        }
        requests={
          <RoleRequestsList
            requests={requests}
            isProcessing={handleRequestMutation.isPending}
            onApprove={(request) => handleRequestMutation.mutate({ requestId: request.id, approved: true, request })}
            onDeny={(request) => handleRequestMutation.mutate({ requestId: request.id, approved: false, request })}
          />
        }
      />
    </div>
  );
}
