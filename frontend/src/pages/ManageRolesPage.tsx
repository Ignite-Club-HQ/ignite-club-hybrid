import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import AddClubRoleToMemberDialog from "@/components/AddClubRoleToMemberDialog";
import { RoleRequestsList } from "@/components/members/RoleRequestsList";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabRoleRoster } from "@/lab/fixtureDataLayer";
import { connectLocalIdentityAccessClient } from "@/lab/localIdentityAccess";
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

const roleColors: Record<AppRole, string> = {
  app_admin: "bg-red-500/20 text-red-400 border-red-500/30",
  club_admin: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  team_admin: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  coach: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  player: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  parent: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  basic_user: "bg-muted text-muted-foreground border-border",
  committee_member: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  league_admin: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  association_admin: "bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30",
  competition_admin: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

const MEMBERS_PER_PAGE = 10;

export default function ManageRolesPage() {
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return <IcpLabManageRolesPage />;
  }

  return <SupabaseManageRolesPage />;
}

/** Read-only role roster backed by synthetic fixtures; mutations remain unavailable until identity_access role-projection is wired here. */
function IcpLabManageRolesPage() {
  const { user } = useAuth();
  const { clubId } = useParams<{ clubId: string }>();
  const persona = user?.id?.startsWith("icp-") ? user.id.slice(4) : "member";
  const [fallbackRoster] = useState(() => getLocalLabRoleRoster(clubId ?? "club-icp-001"));
  const { data: state, error, isLoading } = useQuery({
    queryKey: ["icp-role-roster", clubId, persona],
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
      .filter((role) => role.club[0] === (clubId ?? "club-icp-001"))
      .map((role) => ({
        profile: { id: role.account_id, display_name: role.account_id },
        roles: [{ id: `${role.account_id}-${role.role}`, role: role.role }],
      }))
    : fallbackRoster;

  return (
    <IcpLabRoleRosterView
      title="Club Roles"
      source={state?.source}
      isLoading={isLoading}
      error={error}
      errorFallbackMessage="Unable to load role data."
      roster={roster}
      roleBadgeClassName={(role) => roleColors[role as AppRole]}
    />
  );
}

function SupabaseManageRolesPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [displayCount, setDisplayCount] = useState(MEMBERS_PER_PAGE);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: club, isLoading: loadingClub } = useQuery({
    queryKey: ["club", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("*")
        .eq("id", clubId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!clubId,
  });

  const { data: roles, isLoading: loadingRoles } = useQuery({
    queryKey: ["club-members-roles", clubId],
    queryFn: async () => {
      // First get team IDs for this club
      const { data: teamsData } = await supabase
        .from("teams")
        .select("id")
        .eq("club_id", clubId!);
      const teamIds = teamsData?.map(t => t.id) || [];

      // Fetch club-level roles
      const { data: clubRoles, error: clubError } = await supabase
        .from("user_roles")
        .select("*, profiles (id, display_name, avatar_url), teams (id, name)")
        .eq("club_id", clubId!);
      if (clubError) throw clubError;

      // Fetch team-level roles for teams in this club
      let teamRoles: typeof clubRoles = [];
      if (teamIds.length > 0) {
        const { data: teamRolesData, error: teamError } = await supabase
          .from("user_roles")
          .select("*, profiles (id, display_name, avatar_url), teams (id, name)")
          .in("team_id", teamIds);
        if (teamError) throw teamError;
        teamRoles = teamRolesData || [];
      }

      // Combine and deduplicate by role id
      const allRoles = [...(clubRoles || []), ...(teamRoles || [])];
      const uniqueRoles = allRoles.filter((role, index, self) => 
        index === self.findIndex(r => r.id === role.id)
      );
      return uniqueRoles;
    },
    enabled: !!clubId,
    refetchOnMount: true,
  });

  const { data: requests } = useQuery({
    queryKey: ["club-role-requests", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_requests")
        .select("*")
        .eq("club_id", clubId!)
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
    enabled: !!clubId,
  });

  const deleteRoleMutation = useMutation({
    mutationFn: async ({ roleId, userId, roleName, userName }: { roleId: string; userId: string; roleName: string; userName: string }) => {
      const { error } = await supabase.from("user_roles").delete().eq("id", roleId);
      if (error) throw error;
      
      // Send notification to the user about role removal
      await supabase.from("notifications").insert({
        user_id: userId,
        type: "membership",
        message: `Your ${roleName} role has been removed from ${club?.name || "the club"}`,
        related_id: clubId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-roles", clubId] });
      toast(roleMutationFeedback.removed);
    },
  });

  const handleRequestMutation = useMutation({
    mutationFn: async ({ requestId, approved }: { 
      requestId: string; 
      approved: boolean;
      request: any;
    }) => {
      const rpcName = approved ? "approve_role_request" : "deny_role_request";
      const { error } = await supabase.rpc(rpcName, { p_request_id: requestId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-role-requests", clubId] });
      queryClient.invalidateQueries({ queryKey: ["club-roles", clubId] });
      toast(roleMutationFeedback.requestProcessed);
    },
    onError: (error: Error) => {
      toast(roleRequestErrorFeedback("club", error));
    },
  });

  if (loadingClub) {
    return <RolePageLoading />;
  }

  if (!club) {
    return <div className="py-6 text-center text-muted-foreground">Club not found</div>;
  }

  const userRoles = groupRoleRowsByUser(roles ?? []);

  const q = searchQuery.trim().toLowerCase();
  const filteredUserEntries = Object.entries(userRoles).filter(([, { profile }]) =>
    !q || (profile?.display_name || "").toLowerCase().includes(q)
  );

  return (
    <div className="py-6 space-y-6">
      <RoleManagementHeader subtitle={club.name} onBack={() => navigate(-1)} />
      <RoleManagementTabs
        requestCount={requests?.length ?? 0}
        members={
          <>
            <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setDisplayCount(MEMBERS_PER_PAGE); }}
              placeholder="Search members..."
              className="pl-9"
            />
            </div>
          {loadingRoles ? (
            <RoleRosterLoading />
          ) : filteredUserEntries.length === 0 ? (
            <RoleRosterEmpty message={q ? "No members match your search" : "No members yet"} />
          ) : (
            <>
            {filteredUserEntries.slice(0, displayCount).map(([userId, { profile, roles: userRoleList }]) => (
              <RoleMemberCard
                key={userId}
                userId={userId}
                displayName={profile?.display_name}
                avatarUrl={profile?.avatar_url}
                isCurrentUser={userId === user?.id}
                headerAction={
                    <AddClubRoleToMemberDialog
                      userId={userId}
                      userName={profile?.display_name || "User"}
                      clubId={clubId!}
                      clubName={club?.name || ""}
                      existingRoles={userRoleList}
                    />
                }
                roles={userRoleList.map((role) => ({
                  id: role.id,
                  label: roleLabels[role.role as AppRole],
                  className: `border ${roleColors[role.role as AppRole]}`,
                  variant: "outline" as const,
                  scopeName: role.teams?.name || (role.club_id ? club.name : undefined),
                  removal:
                    userId === user?.id &&
                    (role.role === "club_admin" || role.role === "team_admin")
                      ? undefined
                      : {
                          description: `Remove ${roleLabels[role.role as AppRole]} role from ${profile?.display_name}?`,
                          onConfirm: () =>
                            deleteRoleMutation.mutate({
                              roleId: role.id,
                              userId,
                              roleName: roleLabels[role.role as AppRole],
                              userName: profile?.display_name || "User",
                            }),
                        },
                }))}
              />
            ))}
            {filteredUserEntries.length > displayCount && (
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => setDisplayCount(prev => prev + MEMBERS_PER_PAGE)}
              >
                Show more ({filteredUserEntries.length - displayCount} remaining)
              </Button>
            )}
            </>
          )}
          </>
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
