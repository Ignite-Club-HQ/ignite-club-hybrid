import { writeOnce } from "@/live/clubScope";
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { Principal } from "@icp-sdk/core/principal";
import { withFeatureBackend } from "@/live/featureRouter";
import { getLiveTeam } from "@/live/features/club";
import {
  listLiveTeamRoleGrants,
  listLiveRoleRequests,
  approveLiveRoleRequest,
  rejectLiveRoleRequest,
  removeLiveRoleGrant,
} from "@/live/features/membership";
import { getLiveUserPoints, awardLivePoints, subjectForUser } from "@/live/features/points";
import { fanOutLiveNotifications } from "@/live/features/notifications";

const isIcpPageMode = () => resolveAuthBackend() === "icp";
import { listSupabaseRoleRequests } from "@/features/membership/roleRequestRepository";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { RoleRequestsList } from "@/components/members/RoleRequestsList";
import { membershipKeys } from "@/lab/membershipQueryKeys";
import { refreshTeamRoleChange } from "@/lab/teamMembershipCacheCompletion";
import { roleLabels, type AppRole } from "@/features/membership/rolePresentation";
import { groupRoleRowsByUser } from "@/features/membership/roleRoster";
import { roleMemberProfiles } from "@/features/membership/roleMemberProfiles";
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

export default SupabaseManageTeamRolesPage;

function SupabaseManageTeamRolesPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: team, isLoading: loadingTeam, fetchStatus: teamFetchStatus } = useQuery({
    queryKey: ["team", teamId],
    queryFn: async () => {
      if (isIcpPageMode()) {
        return withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            const row = await getLiveTeam(ctx, teamId!);
            const t = row.length ? row[0] : null;
            if (!t) return null;
            return {
              id: t.id,
              club_id: t.club_id,
              name: t.name,
              clubs: { name: null, bot_user_id: null },
            } as any;
          },
        }, { teamId: teamId! });
      }
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
      if (isIcpPageMode()) {
        return withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            const grants = await listLiveTeamRoleGrants(ctx, teamId!);
            const profiles = await roleMemberProfiles(grants.map(g => g.account_id), team?.club_id);
            return (grants as any[]).map((g) => ({
              id: `${g.account_id}-${g.role}`,
              role: g.role,
              user_id: g.account_id,
              profiles: profiles.get(g.account_id),
            }));
          },
        }, { teamId: teamId! });
      }
      const { data, error } = await supabase
        .from("user_roles")
        .select("*, profiles (id, display_name, avatar_url)")
        .eq("team_id", teamId!);
      if (error) throw error;
      return data;
    },
    enabled: !!teamId,
  });

  const { data: requests, isPending: loadingRequests, error: requestError } = useQuery({
    queryKey: ["team-role-requests", teamId],
    queryFn: async () => {
      if (isIcpPageMode()) {
        return withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            if (!team?.club_id) return [];
            const rows = await listLiveRoleRequests(ctx, team.club_id);
            const profiles = await roleMemberProfiles(rows.filter(r => r.status === "pending" && (r.team?.[0] ?? null) === teamId).map(r => r.account_id), team?.club_id);
            return (rows as any[])
              .filter((r) => r.status === "pending" && (r.team?.[0] ?? null) === teamId)
              .map((r) => ({
                id: r.id,
                user_id: r.account_id,
                team_id: teamId,
                role: r.role,
                status: r.status,
                requester: profiles.get(r.account_id),
              }));
          },
        }, { clubId: team?.club_id as string });
      }
      if (!teamId) return [];
      return listSupabaseRoleRequests({ teamId });
    },
    enabled: !!teamId && !!(isIcpPageMode() ? team?.club_id : true),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const deleteRoleMutation = useMutation({
    mutationFn: async ({ roleId, userId, roleName, userName }: { roleId: string; userId: string; roleName: string; userName: string }) => {
      if (isIcpPageMode()) {
        await withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            const roleValue = roleId.includes("-") ? roleId.slice(roleId.lastIndexOf("-") + 1) : roleName;
            await removeLiveRoleGrant(ctx, Principal.fromText(userId), team!.club_id, roleValue, teamId!);
            try {
              await fanOutLiveNotifications(ctx, {
                userIds: [userId],
                clubId: team!.club_id,
                kind: "membership",
                body: `Your ${roleName} role has been removed from ${team?.name || "the team"}`,
                idempotencyKeyPrefix: `role-removed-${teamId}-${roleValue}-${Date.now()}`,
                relatedId: teamId,
              });
            } catch (e) {
              console.warn("Failed to notify user of role removal", e);
            }
          },
        }, writeOnce({ teamId: teamId! }));
        return;
      }
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
      if (isIcpPageMode()) {
        await withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            const clubId = team?.club_id;
            if (!clubId) throw new Error("Team has no club");
            const currentPoints = await getLiveUserPoints(ctx, clubId, userId);
            if (currentPoints > 0) {
              await awardLivePoints(
                ctx,
                clubId,
                subjectForUser(userId),
                "admin_reset",
                `reset-${teamId}-${Date.now()}`,
                -currentPoints,
                "Points reset by team admin",
              );
            }
          },
        }, writeOnce({ teamId: teamId! }));
        return;
      }
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
      if (isIcpPageMode()) {
        await withFeatureBackend("membership", {
          supabase: async () => { throw new Error("unreachable"); },
          icp: async (ctx) => {
            if (approved) {
              await approveLiveRoleRequest(ctx, requestId);
            } else {
              await rejectLiveRoleRequest(ctx, requestId);
            }
          },
        }, writeOnce({ teamId: teamId! }));
        return;
      }
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
            isLoading={loadingRequests}
            error={requestError}
            isProcessing={handleRequestMutation.isPending}
            onApprove={(request) => handleRequestMutation.mutate({ requestId: request.id, approved: true, request })}
            onDeny={(request) => handleRequestMutation.mutate({ requestId: request.id, approved: false, request })}
          />
        }
      />
    </div>
  );
}
