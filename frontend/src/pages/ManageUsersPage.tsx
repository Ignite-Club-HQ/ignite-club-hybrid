import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Shield, Trash2, Search, Loader2, Users, AlertTriangle, UserPlus, UserMinus, X, Filter, History, Download, Mail, Flame, BarChart3 } from "lucide-react";
import { Suspense } from "react";

const UserAnalyticsTab = lazyWithRetry(() => import("@/components/admin/UserAnalyticsTab"));
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GenerateDemoDataButton } from "@/components/GenerateDemoDataButton";
import { AuditLogActivityCard } from "@/components/admin/AuditLogActivityCard";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { invalidateRolesCache } from "@/lib/rolesCache";
import { recordPointsHistory } from "@/lib/pointsHistory";
import type { Database } from "@/integrations/supabase/types";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

type AppRole = Database["public"]["Enums"]["app_role"];

/**
 * Thrown when the role write committed but the follow-up membership
 * notification insert failed. Callers must report partial success and
 * refresh caches — never pretend the role change failed.
 */
export class RoleNotificationError extends Error {
  roleChangeSucceeded = true;

  constructor(message: string) {
    super(message);
    this.name = "RoleNotificationError";
  }
}



interface UserProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  scheduled_deletion_at: string | null;
  roles: any[];
}

import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabUserDirectory } from "@/lab/fixtureDataLayer";
import { connectLocalIdentityAccessClient } from "@/lab/localIdentityAccess";

export default function ManageUsersPage() {
  if (resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true)) {
    return <IcpLabManageUsersPage />;
  }
  return <SupabaseManageUsersPage />;
}

/** Read-only identity_access directory; account status and role mutations remain unavailable pending parity. */
function IcpLabManageUsersPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const persona = user?.id?.startsWith("icp-") ? user.id.slice(4) : "member";
  const [fallbackUsers] = useState(() => getLocalLabUserDirectory());
  const { data: directory, error, isLoading } = useQuery({
    queryKey: ["icp-user-directory", persona],
    queryFn: async () => {
      try {
        const connection = await connectLocalIdentityAccessClient(persona);
        const state = await connection.client.exportState();
        return {
          source: "icp" as const,
          users: state.accounts.map((account) => ({
            id: account.id,
            display_name: account.id,
            email: account.principals[0]?.toText() ?? "synthetic-principal",
          })),
        };
      } catch (error) {
        if (!(error instanceof Error) || !/not configured/i.test(error.message)) throw error;
        return { source: "fixture" as const, users: fallbackUsers };
      }
    },
  });
  const users = directory?.users ?? fallbackUsers;

  return (
    <div className="container max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">Users</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        {directory?.source === "icp"
          ? "Loaded from the local identity_access canister. Account status changes, bans, and role edits are disabled."
          : "The local identity_access canister is not configured. Showing a synthetic read-only preview; no Supabase request was made."}
      </p>
      {isLoading && <Skeleton className="h-10 w-full" />}
      {error && <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Unable to load users."}</p>}
      <div className="space-y-2">
        {users.map((profile) => (
          <Card key={profile.id}>
            <CardContent className="flex items-center gap-3 p-4">
              <Avatar>
                <AvatarFallback>{(profile.display_name ?? "?").slice(0, 1)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{profile.display_name}</p>
                <p className="text-xs text-muted-foreground">{profile.email}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SupabaseManageUsersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("users");
  
  // Users tab state
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteType, setDeleteType] = useState<"scheduled" | "immediate" | "gdpr">("scheduled");
  const [confirmText, setConfirmText] = useState("");
  const [recentDeletion, setRecentDeletion] = useState<{ id: string; name: string; immediate: boolean } | null>(null);
  
  // Filter state
  const [filterRole, setFilterRole] = useState<AppRole | "">("");
  const [filterClubId, setFilterClubId] = useState<string>("");
  const [filterTeamId, setFilterTeamId] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);
  
  // Bulk selection state
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [bulkAssignDialogOpen, setBulkAssignDialogOpen] = useState(false);
  const [bulkAssignStep, setBulkAssignStep] = useState<"select" | "confirm">("select");
  const [bulkRemoveDialogOpen, setBulkRemoveDialogOpen] = useState(false);
  const [bulkRemoveStep, setBulkRemoveStep] = useState<"select" | "confirm">("select");
  const [bulkRole, setBulkRole] = useState<AppRole | "">("");
  const [bulkClubId, setBulkClubId] = useState<string>("");
  const [bulkTeamId, setBulkTeamId] = useState<string>("");
  
  // Award points state
  const [awardPointsTarget, setAwardPointsTarget] = useState<{ id: string; name: string } | null>(null);
  const [awardPoints, setAwardPoints] = useState(10);
  const [awardReason, setAwardReason] = useState("");
  const [awardClubId, setAwardClubId] = useState<string>("");

  // App Admins tab state
  const [adminSearchQuery, setAdminSearchQuery] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [sendingTestEmail, setSendingTestEmail] = useState(false);

  // Check if current user is an app admin
  const { data: isAppAdmin, isLoading: checkingAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
    enabled: !!user?.id,
  });

  // Fetch all clubs for filters and role assignment
  const { data: allClubs } = useQuery({
    queryKey: ["all-clubs-for-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: isAppAdmin === true,
  });

  // Fetch all teams for filters
  const { data: allTeams } = useQuery({
    queryKey: ["all-teams-for-filters"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, club_id")
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: isAppAdmin === true,
  });

  // Filter teams by selected club for filters
  const filteredTeams = filterClubId 
    ? allTeams?.filter(t => t.club_id === filterClubId) 
    : allTeams;

  // Search users with filters
  const { data: searchResults, isLoading: searching } = useQuery({
    queryKey: ["search-users-manage", searchQuery, filterRole, filterClubId, filterTeamId],
    queryFn: async () => {
      // Need at least search query or a filter
      const hasFilter = filterRole || filterClubId || filterTeamId;
      if (!hasFilter && (!searchQuery.trim() || searchQuery.length < 2)) return [];
      
      // If filtering by role/club/team, start with user_roles
      if (hasFilter) {
        let rolesQuery = supabase
          .from("user_roles")
          .select("id, user_id, role, club_id, team_id, clubs!club_id(name), teams(name)");
        
        if (filterRole) {
          rolesQuery = rolesQuery.eq("role", filterRole);
        }
        if (filterClubId) {
          rolesQuery = rolesQuery.eq("club_id", filterClubId);
        }
        if (filterTeamId) {
          rolesQuery = rolesQuery.eq("team_id", filterTeamId);
        }
        
        const { data: roles, error: rolesError } = await rolesQuery;
        if (rolesError) throw rolesError;
        
        // Get unique user IDs
        const userIds = [...new Set(roles?.map(r => r.user_id) || [])];
        if (userIds.length === 0) return [];
        
        // Fetch profiles for these users
        let profilesQuery = supabase
          .from("profiles")
          .select("id, display_name, avatar_url, scheduled_deletion_at")
          .in("id", userIds);
        
        if (searchQuery.trim() && searchQuery.length >= 2) {
          profilesQuery = profilesQuery.ilike("display_name", `%${searchQuery}%`);
        }
        
        const { data: profiles, error: profilesError } = await profilesQuery.limit(50);
        if (profilesError) throw profilesError;
        
        // Filter out current user
        const filteredProfiles = profiles?.filter(p => p.id !== user?.id) || [];
        
        // Fetch ALL roles for these users (not just filtered ones)
        const { data: allUserRoles } = await supabase
          .from("user_roles")
          .select("id, user_id, role, club_id, team_id, clubs!club_id(name), teams(name)")
          .in("user_id", filteredProfiles.map(p => p.id));
        
        // Group roles by user
        const rolesByUser = new Map<string, typeof allUserRoles>();
        allUserRoles?.forEach(role => {
          const existing = rolesByUser.get(role.user_id) || [];
          existing.push(role);
          rolesByUser.set(role.user_id, existing);
        });
        
        return filteredProfiles.map(profile => ({
          ...profile,
          roles: rolesByUser.get(profile.id) || []
        })) as UserProfile[];
      }
      
      // No filter, just search by name
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, scheduled_deletion_at")
        .ilike("display_name", `%${searchQuery}%`)
        .limit(20);
      if (error) throw error;
      
      // Filter out current user
      const filteredProfiles = profiles?.filter(p => p.id !== user?.id) || [];
      
      // Fetch roles for these users
      const userIds = filteredProfiles.map(p => p.id);
      if (userIds.length === 0) return [];
      
      const { data: roles } = await supabase
        .from("user_roles")
        .select("id, user_id, role, club_id, team_id, clubs!club_id(name), teams(name)")
        .in("user_id", userIds);
      
      // Group roles by user
      const rolesByUser = new Map<string, typeof roles>();
      roles?.forEach(role => {
        const existing = rolesByUser.get(role.user_id) || [];
        existing.push(role);
        rolesByUser.set(role.user_id, existing);
      });
      
      return filteredProfiles.map(profile => ({
        ...profile,
        roles: rolesByUser.get(profile.id) || []
      })) as UserProfile[];
    },
    enabled: isAppAdmin === true && (searchQuery.length >= 2 || !!filterRole || !!filterClubId || !!filterTeamId),
  });

  // Fetch teams for selected club in bulk assign dialog
  const clubTeams = bulkClubId 
    ? allTeams?.filter(t => t.club_id === bulkClubId) 
    : [];

  // Fetch all app admins
  const { data: appAdmins, isLoading: loadingAdmins } = useQuery({
    queryKey: ["app-admins"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("id, user_id, created_at, profiles (id, display_name, avatar_url)")
        .eq("role", "app_admin");
      if (error) throw error;
      return data;
    },
    enabled: isAppAdmin === true,
  });

  // Fetch audit logs
  const { data: auditLogs, isLoading: loadingAuditLogs } = useQuery({
    queryKey: ["audit-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    enabled: isAppAdmin === true,
  });

  // Search users for adding as admin
  const { data: adminSearchResults, isLoading: adminSearching } = useQuery({
    queryKey: ["search-users-for-admin", adminSearchQuery],
    queryFn: async () => {
      if (!adminSearchQuery.trim() || adminSearchQuery.length < 2) return [];
      
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .ilike("display_name", `%${adminSearchQuery}%`)
        .limit(10);
      if (error) throw error;
      
      // Filter out users who are already app admins
      const adminIds = appAdmins?.map(a => a.user_id) || [];
      return data?.filter(p => !adminIds.includes(p.id)) || [];
    },
    enabled: adminSearchQuery.length >= 2 && isAddDialogOpen,
  });

  // Get common roles among selected users for bulk removal
  const getSelectedUsersRoles = () => {
    if (!searchResults || selectedUsers.size === 0) return [];
    
    const selectedProfiles = searchResults.filter(p => selectedUsers.has(p.id));
    const allRoles: any[] = [];
    
    selectedProfiles.forEach(profile => {
      profile.roles?.forEach(role => {
        // Check if this role is already in the list
        const exists = allRoles.some(r => 
          r.role === role.role && 
          r.club_id === role.club_id && 
          r.team_id === role.team_id
        );
        if (!exists) {
          allRoles.push(role);
        }
      });
    });
    
    return allRoles;
  };

  const deleteAccountMutation = useMutation({
    mutationFn: async ({ userId, immediate, gdprRequest = false }: { userId: string; immediate: boolean; gdprRequest?: boolean }) => {
      const { data, error } = await supabase.functions.invoke('admin-delete-account', {
        body: { userId, immediate, gdprRequest }
      });
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data, { userId, immediate, gdprRequest }) => {
      queryClient.invalidateQueries({ queryKey: ["search-users-manage"] });
      const deletedName = deleteTarget?.name || "User";
      
      if (!immediate && !gdprRequest) {
        setRecentDeletion({ id: userId, name: deletedName, immediate: false });
        
        toast({ 
          title: "Account scheduled for deletion",
          description: `${deletedName}'s account will be deleted in 30 days`,
          action: (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleUndoDeletion(userId)}
            >
              Undo
            </Button>
          ),
          duration: 10000,
        });
      } else if (gdprRequest) {
        toast({ 
          title: "GDPR data deletion complete",
          description: `All data for ${deletedName} has been permanently removed`,
        });
      } else {
        toast({ 
          title: "Account permanently deleted",
          description: `${deletedName}'s account has been removed`
        });
      }
      
      setDeleteTarget(null);
      setDeleteType("scheduled");
      setConfirmText("");
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to delete account", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const addAdminMutation = useMutation({
    mutationFn: async ({ userId, displayName }: { userId: string; displayName: string }) => {
      const { error } = await supabase.from("user_roles").insert({
        user_id: userId,
        role: "app_admin",
      });
      if (error) throw error;

      const { error: notifyError } = await supabase.from("notifications").insert({
        user_id: userId,
        type: "membership",
        message: "You have been granted App Admin privileges",
      });
      if (notifyError) throw new RoleNotificationError(notifyError.message);
    },
    onSuccess: (_, { displayName }) => {
      queryClient.invalidateQueries({ queryKey: ["app-admins"] });
      invalidateRolesCache();
      toast({ title: `${displayName} is now an App Admin` });
      setAdminSearchQuery("");
      setIsAddDialogOpen(false);
    },
    onError: (error: Error) => {
      if (error instanceof RoleNotificationError) {
        queryClient.invalidateQueries({ queryKey: ["app-admins"] });
        invalidateRolesCache();
        setAdminSearchQuery("");
        setIsAddDialogOpen(false);
        toast({
          title: "Admin added — notification failed",
          description: `The role change was saved, but we couldn't notify the user. Please tell them manually. (${error.message})`,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Failed to add admin", variant: "destructive" });
    },
  });

  const removeAdminMutation = useMutation({
    mutationFn: async ({ roleId, userId }: { roleId: string; userId: string }) => {
      const { error } = await supabase.from("user_roles").delete().eq("id", roleId);
      if (error) throw error;

      const { error: notifyError } = await supabase.from("notifications").insert({
        user_id: userId,
        type: "membership",
        message: "Your App Admin privileges have been removed",
      });
      if (notifyError) throw new RoleNotificationError(notifyError.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-admins"] });
      invalidateRolesCache();
      toast({ title: "Admin removed" });
    },
    onError: (error: Error) => {
      if (error instanceof RoleNotificationError) {
        queryClient.invalidateQueries({ queryKey: ["app-admins"] });
        invalidateRolesCache();
        toast({
          title: "Admin removed — notification failed",
          description: `The role change was saved, but we couldn't notify the user. Please tell them manually. (${error.message})`,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Failed to remove admin", variant: "destructive" });
    },
  });

  const bulkAssignRoleMutation = useMutation({
    mutationFn: async ({ userIds, role, clubId, teamId }: { 
      userIds: string[]; 
      role: AppRole; 
      clubId?: string;
      teamId?: string;
    }) => {
      const inserts = userIds.map(userId => ({
        user_id: userId,
        role,
        club_id: clubId || null,
        team_id: teamId || null,
      }));
      
      const { error } = await supabase.from("user_roles").insert(inserts);
      if (error) throw error;
      
      // Send notifications
      const notifications = userIds.map(userId => ({
        user_id: userId,
        type: "membership",
        message: `You have been assigned the ${role.replace('_', ' ')} role`,
      }));
      const { error: notifyError } = await supabase.from("notifications").insert(notifications);
      if (notifyError) throw new RoleNotificationError(notifyError.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["search-users-manage"] });
      invalidateRolesCache();
      toast({ title: `Role assigned to ${selectedUsers.size} user(s)` });
      setBulkAssignDialogOpen(false);
      setBulkRole("");
      setBulkClubId("");
      setBulkTeamId("");
      setSelectedUsers(new Set());
    },
    onError: (error: Error) => {
      if (error instanceof RoleNotificationError) {
        queryClient.invalidateQueries({ queryKey: ["search-users-manage"] });
        invalidateRolesCache();
        setBulkAssignDialogOpen(false);
        setBulkRole("");
        setBulkClubId("");
        setBulkTeamId("");
        setSelectedUsers(new Set());
        toast({
          title: "Roles assigned — notification failed",
          description: `The role changes were saved, but we couldn't notify the affected users. Please tell them manually. (${error.message})`,
          variant: "destructive",
        });
        return;
      }
      toast({ 
        title: "Failed to assign roles", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const bulkRemoveRoleMutation = useMutation({
    mutationFn: async ({ userIds, role, clubId, teamId }: { 
      userIds: string[]; 
      role: AppRole; 
      clubId?: string | null;
      teamId?: string | null;
    }) => {
      let query = supabase.from("user_roles")
        .delete()
        .in("user_id", userIds)
        .eq("role", role);
      
      if (clubId) {
        query = query.eq("club_id", clubId);
      }
      if (teamId) {
        query = query.eq("team_id", teamId);
      }
      
      const { error } = await query;
      if (error) throw error;
      
      // Send notifications
      const notifications = userIds.map(userId => ({
        user_id: userId,
        type: "membership",
        message: `Your ${role.replace('_', ' ')} role has been removed`,
      }));
      const { error: notifyError } = await supabase.from("notifications").insert(notifications);
      if (notifyError) throw new RoleNotificationError(notifyError.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["search-users-manage"] });
      invalidateRolesCache();
      toast({ title: `Role removed from ${selectedUsers.size} user(s)` });
      setBulkRemoveDialogOpen(false);
      setBulkRole("");
      setBulkClubId("");
      setBulkTeamId("");
      setSelectedUsers(new Set());
    },
    onError: (error: Error) => {
      if (error instanceof RoleNotificationError) {
        queryClient.invalidateQueries({ queryKey: ["search-users-manage"] });
        invalidateRolesCache();
        setBulkRemoveDialogOpen(false);
        setBulkRole("");
        setBulkClubId("");
        setBulkTeamId("");
        setSelectedUsers(new Set());
        toast({
          title: "Roles removed — notification failed",
          description: `The role changes were saved, but we couldn't notify the affected users. Please tell them manually. (${error.message})`,
          variant: "destructive",
        });
        return;
      }
      toast({ 
        title: "Failed to remove roles", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });


  const awardPointsMutation = useMutation({
    mutationFn: async ({ userId, userName, points, reason, clubId }: {
      userId: string;
      userName: string;
      points: number;
      reason: string;
      clubId: string;
    }) => {
      // Use the per-club RPC so the awarded points land on the correct club's
      // balance (and the legacy global mirror stays in sync). The RPC clamps
      // negative results to zero internally.
      const { data: newTotal, error: rpcError } = await supabase.rpc(
        "increment_ignite_points",
        {
          _user_id: userId,
          _amount: points,
          _club_id: clubId,
        } as any,
      );
      if (rpcError) throw rpcError;

      // For email/notification + threshold check we need the prior balance.
      const newPoints = (newTotal as number | null) ?? 0;
      const currentPoints = Math.max(0, newPoints - points);

      const clubName = allClubs?.find(c => c.id === clubId)?.name || "Admin";

      await recordPointsHistory({
        userId,
        clubId,
        amount: points,
        balanceAfter: newPoints,
        sourceType: 'admin_award',
        description: reason || (points > 0 ? 'Points awarded by admin' : 'Points adjustment by admin'),
        createdBy: user?.id,
      });

      const pointsText = points > 0 ? `+${points}` : `${points}`;
      await supabase.from("notifications").insert({
        user_id: userId,
        type: "points_awarded",
        message: reason
          ? `You received ${pointsText} points from ${clubName}: "${reason}"`
          : `You received ${pointsText} points from ${clubName}`,
        related_id: clubId,
      });

      // Check reward threshold
      let rewardName: string | undefined;
      if (points > 0 && clubId) {
        const { checkRewardThreshold } = await import("@/lib/rewardThresholdCheck");
        rewardName = await checkRewardThreshold({
          userId,
          clubId,
          previousPoints: currentPoints,
          newPoints,
        });
      }

      try {
        await supabase.functions.invoke('send-points-notification-email', {
          body: {
            recipientUserId: userId,
            pointsAwarded: points,
            reason: reason || (points > 0 ? 'Points awarded by admin' : 'Points adjustment'),
            totalPoints: newPoints,
            clubName,
            rewardUnlocked: !!rewardName,
            rewardName,
          },
        });
      } catch (e) {
        console.error("Failed to send points email:", e);
      }
    },
    onSuccess: () => {
      toast({
        title: awardPoints > 0 ? "Points Awarded!" : "Points Deducted",
        description: `${awardPoints > 0 ? "+" : ""}${awardPoints} points ${awardPoints > 0 ? "awarded to" : "deducted from"} ${awardPointsTarget?.name}`,
      });
      setAwardPointsTarget(null);
      setAwardPoints(10);
      setAwardReason("");
      setAwardClubId("");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update points", description: error.message, variant: "destructive" });
    },
  });

  const handleUndoDeletion = async (userId: string) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ scheduled_deletion_at: null })
        .eq('id', userId);
      
      if (error) throw error;
      
      queryClient.invalidateQueries({ queryKey: ["search-users-manage"] });
      setRecentDeletion(null);
      
      toast({ 
        title: "Deletion cancelled",
        description: "The account deletion has been undone"
      });
    } catch (error) {
      toast({ 
        title: "Failed to undo deletion",
        variant: "destructive" 
      });
    }
  };

  const toggleUserSelection = (userId: string) => {
    const newSelected = new Set(selectedUsers);
    if (newSelected.has(userId)) {
      newSelected.delete(userId);
    } else {
      newSelected.add(userId);
    }
    setSelectedUsers(newSelected);
  };

  const toggleSelectAll = () => {
    if (!searchResults) return;
    if (selectedUsers.size === searchResults.length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(searchResults.map(p => p.id)));
    }
  };

  const clearSelection = () => {
    setSelectedUsers(new Set());
  };

  const getRoleLabel = (role: any) => {
    const roleName = role.role.replace('_', ' ');
    if (role.role === 'app_admin' || role.role === 'basic_user') return roleName;
    
    // For team-level roles, show team name
    if (role.teams?.name) {
      return `${roleName} • ${role.teams.name}`;
    }
    // For club admin, show club
    if (role.clubs?.name) {
      return `${roleName} • ${role.clubs.name}`;
    }
    return roleName;
  };

  const getRoleBadgeClasses = (roleName: string) => {
    switch (roleName) {
      case 'app_admin':
        return 'bg-destructive/10 text-destructive border-destructive/30';
      case 'club_admin':
        return 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30';
      case 'team_admin':
        return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
      case 'coach':
        return 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30';
      case 'committee_member':
        return 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30';
      case 'player':
        return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30';
      case 'parent':
        return 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  // Club admin only needs club selection
  const isClubLevelRole = (role: AppRole) => {
    return role === 'club_admin';
  };

  // Team-level roles require both club AND team selection
  const isTeamLevelRole = (role: AppRole) => {
    return ['team_admin', 'coach', 'player', 'parent'].includes(role);
  };

  // Roles that need club selection (either club-only or team-level)
  const needsClub = (role: AppRole) => {
    return isClubLevelRole(role) || isTeamLevelRole(role);
  };

  // Roles that need team selection (only team-level roles)
  const needsTeam = (role: AppRole) => {
    return isTeamLevelRole(role);
  };

  if (checkingAdmin) {
    return (
      <div className="py-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!isAppAdmin) {
    return (
      <div className="py-6 text-center">
        <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h1 className="text-xl font-bold mb-2">Access Denied</h1>
        <p className="text-muted-foreground">You need to be an App Admin to access this page.</p>
        <Button className="mt-4" onClick={() => navigate(-1)}>Go Back</Button>
      </div>
    );
  }

  const selectedUsersRoles = getSelectedUsersRoles();

  return (
    <div className="py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">User Management</h1>
            <p className="text-sm text-muted-foreground">Manage users and app administrators</p>
          </div>
        </div>
        <GenerateDemoDataButton />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="users" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Users</span>
          </TabsTrigger>
          <TabsTrigger value="admins" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            <span className="hidden sm:inline">Admins</span>
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Analytics</span>
          </TabsTrigger>
          <TabsTrigger value="audit" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            <span className="hidden sm:inline">Audit Log</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4 mt-4">
          {/* Search and Filters */}
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search users by name..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSelectedUsers(new Set());
                  }}
                  className="pl-9"
                />
              </div>
              <Button
                variant={showFilters || filterRole || filterClubId || filterTeamId ? "secondary" : "outline"}
                size="icon"
                onClick={() => setShowFilters(!showFilters)}
                className="shrink-0"
              >
                <Filter className="h-4 w-4" />
              </Button>
            </div>
            
            {/* Collapsible Filters */}
            {showFilters && (
              <div className="flex flex-wrap gap-2 items-center p-3 bg-muted/50 rounded-lg">
                <Select value={filterRole || "all"} onValueChange={(v) => {
                  setFilterRole(v === "all" ? "" : v as AppRole);
                  setSelectedUsers(new Set());
                }}>
                  <SelectTrigger className="w-[140px] h-9">
                    <SelectValue placeholder="Role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                    <SelectItem value="app_admin">App Admin</SelectItem>
                    <SelectItem value="club_admin">Club Admin</SelectItem>
                    <SelectItem value="team_admin">Team Admin</SelectItem>
                    <SelectItem value="coach">Coach</SelectItem>
                    <SelectItem value="player">Player</SelectItem>
                    <SelectItem value="parent">Parent</SelectItem>
                    <SelectItem value="basic_user">Basic User</SelectItem>
                  </SelectContent>
                </Select>
                
                <Select value={filterClubId || "all"} onValueChange={(v) => {
                  setFilterClubId(v === "all" ? "" : v);
                  setFilterTeamId("");
                  setSelectedUsers(new Set());
                }}>
                  <SelectTrigger className="w-[140px] h-9">
                    <SelectValue placeholder="Club" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Clubs</SelectItem>
                    {allClubs?.map(club => (
                      <SelectItem key={club.id} value={club.id}>
                        {club.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                <Select value={filterTeamId || "all"} onValueChange={(v) => {
                  setFilterTeamId(v === "all" ? "" : v);
                  setSelectedUsers(new Set());
                }}>
                  <SelectTrigger className="w-[140px] h-9">
                    <SelectValue placeholder="Team" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Teams</SelectItem>
                    {filteredTeams?.map(team => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                {(filterRole || filterClubId || filterTeamId) && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => {
                      setFilterRole("");
                      setFilterClubId("");
                      setFilterTeamId("");
                      setSelectedUsers(new Set());
                    }}
                    className="h-9"
                  >
                    <X className="h-4 w-4 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Bulk Actions Bar */}
          {selectedUsers.size > 0 && (
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{selectedUsers.size} selected</Badge>
                    <Button variant="ghost" size="sm" onClick={clearSelection}>
                      <X className="h-4 w-4 mr-1" />
                      Clear
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => {
                      setBulkAssignStep("select");
                      setBulkAssignDialogOpen(true);
                    }}>
                      <UserPlus className="h-4 w-4 mr-2" />
                      Assign Role
                    </Button>
                    <ResponsiveDialog open={bulkAssignDialogOpen} onOpenChange={(open) => {
                      setBulkAssignDialogOpen(open);
                      if (!open) {
                        setBulkAssignStep("select");
                      }
                    }}>
                      <ResponsiveDialogContent>
                        <ResponsiveDialogHeader>
                          <ResponsiveDialogTitle>
                            {bulkAssignStep === "select" 
                              ? `Assign Role to ${selectedUsers.size} User(s)` 
                              : "Confirm Role Assignment"}
                          </ResponsiveDialogTitle>
                          <ResponsiveDialogDescription>
                            {bulkAssignStep === "select"
                              ? "Select a role to assign to the selected users"
                              : "Review the changes before confirming"}
                          </ResponsiveDialogDescription>
                        </ResponsiveDialogHeader>
                        
                        {bulkAssignStep === "select" ? (
                          <>
                            <div className="space-y-4 py-4">
                              <div className="space-y-2">
                                <label className="text-sm font-medium">Role</label>
                                <Select value={bulkRole} onValueChange={(v) => {
                                  setBulkRole(v as AppRole);
                                  setBulkClubId("");
                                  setBulkTeamId("");
                                }}>
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select a role" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="app_admin">App Admin (global)</SelectItem>
                                    <SelectItem value="club_admin">Club Admin (requires club)</SelectItem>
                                    <SelectItem value="team_admin">Team Admin (requires team)</SelectItem>
                                    <SelectItem value="coach">Coach (requires team)</SelectItem>
                                    <SelectItem value="player">Player (requires team)</SelectItem>
                                    <SelectItem value="parent">Parent (requires team)</SelectItem>
                                    <SelectItem value="basic_user">Basic User (global)</SelectItem>
                                  </SelectContent>
                                </Select>
                                {bulkRole && isClubLevelRole(bulkRole as AppRole) && (
                                  <p className="text-xs text-muted-foreground">Club Admin role requires selecting a club.</p>
                                )}
                                {bulkRole && isTeamLevelRole(bulkRole as AppRole) && (
                                  <p className="text-xs text-muted-foreground">This role requires selecting a club and team.</p>
                                )}
                              </div>
                              
                              {bulkRole && needsClub(bulkRole as AppRole) && (
                                <div className="space-y-2">
                                  <label className="text-sm font-medium">
                                    Club <span className="text-destructive">*</span>
                                  </label>
                                  <Select value={bulkClubId} onValueChange={(v) => {
                                    setBulkClubId(v);
                                    setBulkTeamId("");
                                  }}>
                                    <SelectTrigger className="w-full">
                                      <SelectValue placeholder="Select a club" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {allClubs?.map(club => (
                                        <SelectItem key={club.id} value={club.id}>
                                          {club.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                              
                              {bulkRole && needsTeam(bulkRole as AppRole) && bulkClubId && (
                                <div className="space-y-2">
                                  <label className="text-sm font-medium">
                                    Team <span className="text-destructive">*</span>
                                  </label>
                                  <Select value={bulkTeamId} onValueChange={setBulkTeamId}>
                                    <SelectTrigger className="w-full">
                                      <SelectValue placeholder="Select a team" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {clubTeams?.length === 0 ? (
                                        <div className="p-2 text-sm text-muted-foreground text-center">
                                          No teams in this club
                                        </div>
                                      ) : (
                                        clubTeams?.map(team => (
                                          <SelectItem key={team.id} value={team.id}>
                                            {team.name}
                                          </SelectItem>
                                        ))
                                      )}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                              
                              {bulkRole && needsTeam(bulkRole as AppRole) && !bulkClubId && (
                                <p className="text-sm text-muted-foreground">Please select a club first to see available teams.</p>
                              )}
                            </div>
                            <ResponsiveDialogFooter className="flex-col sm:flex-row gap-2">
                              <Button variant="outline" onClick={() => setBulkAssignDialogOpen(false)} className="w-full sm:w-auto">
                                Cancel
                              </Button>
                              <Button 
                                className="w-full sm:w-auto"
                                onClick={() => setBulkAssignStep("confirm")}
                                disabled={
                                  !bulkRole || 
                                  (!!bulkRole && needsClub(bulkRole as AppRole) && !bulkClubId) ||
                                  (!!bulkRole && needsTeam(bulkRole as AppRole) && !bulkTeamId)
                                }
                              >
                                Continue
                              </Button>
                            </ResponsiveDialogFooter>
                          </>
                        ) : (
                          <>
                            <div className="space-y-4 py-4">
                              <Card className="bg-muted/50">
                                <CardContent className="p-4 space-y-3">
                                  <div className="flex items-center gap-2">
                                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                                    <span className="font-medium">You are about to:</span>
                                  </div>
                                  <div className="pl-7 space-y-2 text-sm">
                                    <div>
                                      Assign <Badge variant="secondary" className="capitalize mx-1">
                                        {bulkRole?.replace('_', ' ')}
                                      </Badge> role to <strong>{selectedUsers.size}</strong> user(s)
                                    </div>
                                    {bulkClubId && (
                                      <p className="text-muted-foreground">
                                        Club: {allClubs?.find(c => c.id === bulkClubId)?.name}
                                      </p>
                                    )}
                                    {bulkTeamId && (
                                      <p className="text-muted-foreground">
                                        Team: {clubTeams?.find(t => t.id === bulkTeamId)?.name}
                                      </p>
                                    )}
                                  </div>
                                  <div className="pl-7 pt-2">
                                    <p className="text-xs text-muted-foreground">
                                      All selected users will receive a notification about this change.
                                    </p>
                                  </div>
                                </CardContent>
                              </Card>
                            </div>
                            <ResponsiveDialogFooter className="flex-col sm:flex-row gap-2">
                              <Button variant="outline" onClick={() => setBulkAssignStep("select")} className="w-full sm:w-auto">
                                Back
                              </Button>
                              <Button 
                                className="w-full sm:w-auto"
                                onClick={() => {
                                  if (!bulkRole) return;
                                  bulkAssignRoleMutation.mutate({
                                    userIds: Array.from(selectedUsers),
                                    role: bulkRole as AppRole,
                                    clubId: bulkClubId || undefined,
                                    teamId: bulkTeamId || undefined,
                                  });
                                }}
                                disabled={bulkAssignRoleMutation.isPending}
                              >
                                {bulkAssignRoleMutation.isPending && (
                                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                )}
                                Confirm Assignment
                              </Button>
                            </ResponsiveDialogFooter>
                          </>
                        )}
                      </ResponsiveDialogContent>
                    </ResponsiveDialog>

                    <Button size="sm" variant="outline" className="text-destructive border-destructive/50" onClick={() => {
                      setBulkRemoveStep("select");
                      setBulkRemoveDialogOpen(true);
                    }}>
                      <UserMinus className="h-4 w-4 mr-2" />
                      Remove Role
                    </Button>
                    <ResponsiveDialog open={bulkRemoveDialogOpen} onOpenChange={(open) => {
                      setBulkRemoveDialogOpen(open);
                      if (!open) {
                        setBulkRemoveStep("select");
                      }
                    }}>
                      <ResponsiveDialogContent>
                        <ResponsiveDialogHeader>
                          <ResponsiveDialogTitle>
                            {bulkRemoveStep === "select"
                              ? `Remove Role from ${selectedUsers.size} User(s)`
                              : "Confirm Role Removal"}
                          </ResponsiveDialogTitle>
                          <ResponsiveDialogDescription>
                            {bulkRemoveStep === "select"
                              ? "Select a role to remove from the selected users"
                              : "Review the changes before confirming"}
                          </ResponsiveDialogDescription>
                        </ResponsiveDialogHeader>
                        
                        {bulkRemoveStep === "select" ? (
                          <>
                            <div className="space-y-4 py-4">
                              {selectedUsersRoles.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-4">
                                  Selected users have no roles to remove
                                </p>
                              ) : (
                                <div className="space-y-2">
                                  <label className="text-sm font-medium">Role to Remove</label>
                                  <div className="space-y-2 max-h-64 overflow-y-auto">
                                    {selectedUsersRoles.map((role, idx) => (
                                      <div
                                        key={idx}
                                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                                          bulkRole === role.role && bulkClubId === (role.club_id || "") && bulkTeamId === (role.team_id || "")
                                            ? "bg-destructive/10 border-destructive/30"
                                            : "hover:bg-muted/50"
                                        }`}
                                        onClick={() => {
                                          setBulkRole(role.role);
                                          setBulkClubId(role.club_id || "");
                                          setBulkTeamId(role.team_id || "");
                                        }}
                                      >
                                        <Badge variant="outline" className={`capitalize font-medium ${getRoleBadgeClasses(role.role)}`}>
                                          {getRoleLabel(role)}
                                        </Badge>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                            <ResponsiveDialogFooter className="flex-col sm:flex-row gap-2">
                              <Button variant="outline" onClick={() => setBulkRemoveDialogOpen(false)} className="w-full sm:w-auto">
                                Cancel
                              </Button>
                              <Button 
                                variant="destructive"
                                className="w-full sm:w-auto"
                                onClick={() => setBulkRemoveStep("confirm")}
                                disabled={!bulkRole}
                              >
                                Continue
                              </Button>
                            </ResponsiveDialogFooter>
                          </>
                        ) : (
                          <>
                            <div className="space-y-4 py-4">
                              <Card className="bg-destructive/5 border-destructive/20">
                                <CardContent className="p-4 space-y-3">
                                  <div className="flex items-center gap-2">
                                    <AlertTriangle className="h-5 w-5 text-destructive" />
                                    <span className="font-medium">You are about to:</span>
                                  </div>
                                  <div className="pl-7 space-y-2 text-sm">
                                    <div>
                                      Remove <Badge variant="secondary" className="capitalize mx-1">
                                        {bulkRole?.replace('_', ' ')}
                                      </Badge> role from <strong>{selectedUsers.size}</strong> user(s)
                                    </div>
                                    {bulkClubId && (
                                      <p className="text-muted-foreground">
                                        Club: {allClubs?.find(c => c.id === bulkClubId)?.name}
                                      </p>
                                    )}
                                    {bulkTeamId && (
                                      <p className="text-muted-foreground">
                                        Team: {allTeams?.find(t => t.id === bulkTeamId)?.name}
                                      </p>
                                    )}
                                  </div>
                                  <div className="pl-7 pt-2">
                                    <p className="text-xs text-muted-foreground">
                                      All selected users will receive a notification about this change.
                                    </p>
                                  </div>
                                </CardContent>
                              </Card>
                            </div>
                            <ResponsiveDialogFooter className="flex-col sm:flex-row gap-2">
                              <Button variant="outline" onClick={() => setBulkRemoveStep("select")} className="w-full sm:w-auto">
                                Back
                              </Button>
                              <Button 
                                variant="destructive"
                                className="w-full sm:w-auto"
                                onClick={() => {
                                  if (!bulkRole) return;
                                  bulkRemoveRoleMutation.mutate({
                                    userIds: Array.from(selectedUsers),
                                    role: bulkRole as AppRole,
                                    clubId: bulkClubId || null,
                                    teamId: bulkTeamId || null,
                                  });
                                }}
                                disabled={bulkRemoveRoleMutation.isPending}
                              >
                                {bulkRemoveRoleMutation.isPending && (
                                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                )}
                                Confirm Removal
                              </Button>
                            </ResponsiveDialogFooter>
                          </>
                        )}
                      </ResponsiveDialogContent>
                    </ResponsiveDialog>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Results */}
          {searching && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {!searching && !searchResults?.length && !filterRole && !filterClubId && !filterTeamId && searchQuery.length < 2 && (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center">
                <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Search for users by name or use filters to find users</p>
              </CardContent>
            </Card>
          )}

          {!searching && searchResults?.length === 0 && (searchQuery.length >= 2 || filterRole || filterClubId || filterTeamId) && (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center">
                <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  No users found{searchQuery.length >= 2 ? ` matching "${searchQuery}"` : ""}{(filterRole || filterClubId || filterTeamId) ? " with selected filters" : ""}
                </p>
              </CardContent>
            </Card>
          )}

          {searchResults && searchResults.length > 0 && (
            <div className="space-y-3">
              {/* Select All */}
              <div className="flex items-center gap-2 px-1">
                <Checkbox
                  checked={selectedUsers.size === searchResults.length && searchResults.length > 0}
                  onCheckedChange={toggleSelectAll}
                  id="select-all"
                />
                <label htmlFor="select-all" className="text-sm text-muted-foreground cursor-pointer">
                  Select all ({searchResults.length})
                </label>
              </div>
              
              {searchResults.map((profile) => (
                <Card key={profile.id} className={selectedUsers.has(profile.id) ? "ring-1 ring-primary" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={selectedUsers.has(profile.id)}
                        onCheckedChange={() => toggleUserSelection(profile.id)}
                      />
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={profile.avatar_url || undefined} />
                        <AvatarFallback>{profile.display_name?.charAt(0) || "?"}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{profile.display_name || "Unknown User"}</p>
                        {profile.roles && profile.roles.length > 0 ? (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {profile.roles.slice(0, 3).map((role: any, idx: number) => (
                              <span 
                                key={idx} 
                                className={`inline-flex items-center rounded-md border text-[10px] leading-none capitalize font-medium px-1.5 py-1 ${getRoleBadgeClasses(role.role)}`}
                              >
                                {getRoleLabel(role)}
                              </span>
                            ))}
                            {profile.roles.length > 3 && (
                              <span className="inline-flex items-center rounded-md border border-border bg-muted text-muted-foreground text-[10px] leading-none font-medium px-1.5 py-1">
                                +{profile.roles.length - 3}
                              </span>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">No roles</p>
                        )}
                      </div>
                      {profile.scheduled_deletion_at && (
                        <Badge variant="outline" className="text-destructive border-destructive shrink-0">
                          Scheduled for deletion
                        </Badge>
                      )}
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 shrink-0"
                        title="Award Points"
                        onClick={() => setAwardPointsTarget({ id: profile.id, name: profile.display_name || "Unknown User" })}
                      >
                        <Flame className="h-4 w-4 text-amber-500" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 shrink-0"
                        onClick={() => setDeleteTarget({ id: profile.id, name: profile.display_name || "Unknown User" })}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* App Admins Tab */}
        <TabsContent value="admins" className="space-y-4 mt-4">
          {/* Admin Actions */}
          <div className="flex justify-between items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={sendingTestEmail}
              onClick={async () => {
                if (!user?.email) {
                  toast({
                    title: "No email found",
                    description: "Your account doesn't have an email address.",
                    variant: "destructive",
                  });
                  return;
                }
                setSendingTestEmail(true);
                try {
                  const { data, error } = await supabase.functions.invoke("send-email", {
                    body: {
                      to: user.email,
                      subject: "Ignite Club HQ - Test Email",
                      html: `
                        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                          <h1 style="color: #f97316; margin-bottom: 20px;">🔥 Test Email Successful!</h1>
                          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
                            This is a test email from Ignite Club HQ. If you're receiving this, 
                            the email system is working correctly.
                          </p>
                          <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
                            Sent at: ${new Date().toLocaleString()}
                          </p>
                          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
                          <p style="color: #9ca3af; font-size: 12px;">
                            Ignite Club HQ - Sports Team Management
                          </p>
                        </div>
                      `,
                    },
                  });
                  if (error) throw error;
                  toast({
                    title: "Test email sent!",
                    description: `A test email has been sent to ${user.email}`,
                  });
                } catch (error: any) {
                  console.error("Error sending test email:", error);
                  toast({
                    title: "Failed to send test email",
                    description: error.message || "An error occurred",
                    variant: "destructive",
                  });
                } finally {
                  setSendingTestEmail(false);
                }
              }}
            >
              {sendingTestEmail ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Mail className="h-4 w-4 mr-2" />
              )}
              Send Test Email
            </Button>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <UserPlus className="h-4 w-4 mr-2" />
                  Add Admin
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add App Admin</DialogTitle>
                  <DialogDescription>
                    Search for a user to grant App Admin privileges
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name..."
                      value={adminSearchQuery}
                      onChange={(e) => setAdminSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  
                  {adminSearching && (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  
                  {adminSearchQuery.length >= 2 && !adminSearching && adminSearchResults?.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No users found
                    </p>
                  )}
                  
                  {adminSearchResults && adminSearchResults.length > 0 && (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {adminSearchResults.map((profile) => (
                        <div
                          key={profile.id}
                          className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"
                          onClick={() => addAdminMutation.mutate({ 
                            userId: profile.id, 
                            displayName: profile.display_name || "User" 
                          })}
                        >
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={profile.avatar_url || undefined} />
                            <AvatarFallback>{profile.display_name?.charAt(0) || "?"}</AvatarFallback>
                          </Avatar>
                          <span className="font-medium flex-1">{profile.display_name || "Unknown User"}</span>
                          {addAdminMutation.isPending && (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Admins List */}
          {loadingAdmins ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : appAdmins?.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center">
                <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No app admins found</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {appAdmins?.map((admin) => (
                <Card key={admin.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={admin.profiles?.avatar_url || undefined} />
                        <AvatarFallback>{admin.profiles?.display_name?.charAt(0) || "?"}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <p className="font-medium">{admin.profiles?.display_name || "Unknown User"}</p>
                        {admin.user_id === user?.id && (
                          <p className="text-xs text-muted-foreground">You</p>
                        )}
                      </div>
                      <Badge className="bg-red-500/20 text-red-400 border-red-500/30" variant="outline">
                        App Admin
                      </Badge>
                      {admin.user_id !== user?.id && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove App Admin?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Remove App Admin privileges from {admin.profiles?.display_name}?
                                They will no longer have administrative access to the app.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={() => removeAdminMutation.mutate({ 
                                  roleId: admin.id, 
                                  userId: admin.user_id 
                                })}
                                className="bg-destructive text-destructive-foreground"
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="mt-4">
          <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
            <UserAnalyticsTab />
          </Suspense>
        </TabsContent>

        {/* Audit Log Tab */}
        <TabsContent value="audit" className="space-y-4 mt-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Recent activity log showing user deletions and role changes
            </p>
            {auditLogs && auditLogs.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const csvRows = [
                    ['Date', 'Action', 'User', 'Role', 'Club', 'Team', 'Details'].join(',')
                  ];
                  
                  auditLogs.forEach(log => {
                    const details = log.details as Record<string, any> || {};
                    const date = format(new Date(log.created_at), "yyyy-MM-dd HH:mm:ss");
                    const action = log.action_type.replace('_', ' ');
                    const userName = (log.target_user_name || 'Unknown').replace(/,/g, ' ');
                    const role = (details.role || '').replace('_', ' ');
                    const club = (details.club_name || '').replace(/,/g, ' ');
                    const team = (details.team_name || '').replace(/,/g, ' ');
                    const extraDetails = log.action_type === 'user_deleted' 
                      ? `Points: ${details.ignite_points || 0}`
                      : '';
                    
                    csvRows.push([date, action, userName, role, club, team, extraDetails].join(','));
                  });
                  
                  const csvContent = csvRows.join('\n');
                  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `audit-log-${format(new Date(), 'yyyy-MM-dd')}.csv`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  URL.revokeObjectURL(url);
                  
                  toast({
                    title: "Export complete",
                    description: `Exported ${auditLogs.length} audit log entries`,
                  });
                }}
              >
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            )}
          </div>

          {loadingAuditLogs ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : !auditLogs?.length ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No audit logs yet</p>
                <p className="text-sm">Activity will appear here when users are deleted or roles are changed</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {auditLogs.map(log => {
                const details = log.details as Record<string, any> || {};

                return (
                  <AuditLogActivityCard
                    key={log.id}
                    actionType={log.action_type}
                    createdAtLabel={format(new Date(log.created_at), "MMM d, yyyy 'at' h:mm a")}
                    targetUserName={log.target_user_name || "Unknown User"}
                    ignitePoints={details.ignite_points || 0}
                    role={details.role}
                    clubName={details.club_name}
                    teamName={details.team_name}
                  />
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <AlertDialog 
        open={!!deleteTarget} 
        onOpenChange={(open) => {
          if (!open) {
            // Never let the dialog close while a deletion request is in flight,
            // otherwise a failure leaves the admin with no way to retry.
            if (deleteAccountMutation.isPending) return;
            setDeleteTarget(null);
            setConfirmText("");
            setDeleteType("scheduled");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Account
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <p>
                  You are about to delete the account for <strong>{deleteTarget?.name}</strong>.
                </p>
                <div className="space-y-3">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="deleteType"
                      checked={deleteType === "scheduled"}
                      onChange={() => setDeleteType("scheduled")}
                      className="h-4 w-4 mt-0.5"
                    />
                    <div>
                      <span>Schedule for deletion in 30 days</span>
                      <p className="text-xs text-muted-foreground">User can recover their account</p>
                    </div>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="deleteType"
                      checked={deleteType === "immediate"}
                      onChange={() => setDeleteType("immediate")}
                      className="h-4 w-4 mt-0.5"
                    />
                    <div>
                      <span className="text-destructive font-medium">Delete immediately</span>
                      <p className="text-xs text-muted-foreground">Cannot be undone</p>
                    </div>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer border-t pt-3">
                    <input
                      type="radio"
                      name="deleteType"
                      checked={deleteType === "gdpr"}
                      onChange={() => setDeleteType("gdpr")}
                      className="h-4 w-4 mt-0.5"
                    />
                    <div>
                      <span className="text-destructive font-medium">🔒 GDPR Data Request</span>
                      <p className="text-xs text-muted-foreground">Permanently delete ALL user data including messages, photos, payment records, and personal information. Use for privacy law compliance.</p>
                    </div>
                  </label>
                </div>
                
                {(deleteType === "immediate" || deleteType === "gdpr") && (
                  <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-md">
                    <p className="text-sm text-destructive font-medium">
                      {deleteType === "gdpr" 
                        ? "⚠️ GDPR Deletion: This will permanently remove ALL user data from ALL systems. Messages will be anonymized, photos soft-deleted, and all personal records removed. This action is irreversible and is intended for privacy law compliance."
                        : "⚠️ Warning: Permanent deletion cannot be undone. All user data will be immediately and irreversibly removed."
                      }
                    </p>
                  </div>
                )}
                
                <div className="pt-2 border-t">
                  <p className="text-sm mb-2">
                    Type <strong className="text-foreground">
                      {deleteType === "gdpr" ? "GDPR DELETE" : deleteType === "immediate" ? "DELETE PERMANENTLY" : "delete"}
                    </strong> to confirm:
                  </p>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={
                      deleteType === "gdpr" 
                        ? "Type 'GDPR DELETE' to confirm" 
                        : deleteType === "immediate" 
                          ? "Type 'DELETE PERMANENTLY' to confirm" 
                          : "Type 'delete' to confirm"
                    }
                    className="font-mono"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteAccountMutation.isPending}>Cancel</AlertDialogCancel>
            {/* Plain Button (not AlertDialogAction): the primitive auto-closes the
                dialog on click, which would detach a failed request from its UI. */}
            <Button
              onClick={() => {
                if (deleteAccountMutation.isPending) return;
                const requiredText = deleteType === "gdpr" ? "gdpr delete" : deleteType === "immediate" ? "delete permanently" : "delete";
                if (deleteTarget && confirmText.toLowerCase() === requiredText) {
                  deleteAccountMutation.mutate({ 
                    userId: deleteTarget.id, 
                    immediate: deleteType === "immediate" || deleteType === "gdpr",
                    gdprRequest: deleteType === "gdpr"
                  });
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={
                deleteAccountMutation.isPending || 
                confirmText.toLowerCase() !== (deleteType === "gdpr" ? "gdpr delete" : deleteType === "immediate" ? "delete permanently" : "delete")
              }
            >
              {deleteAccountMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {deleteType === "gdpr" ? "GDPR Delete All Data" : deleteType === "immediate" ? "Delete Permanently" : "Schedule Deletion"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Award Points Dialog */}
      <ResponsiveDialog open={!!awardPointsTarget} onOpenChange={(open) => {
        if (!open) {
          setAwardPointsTarget(null);
          setAwardPoints(10);
          setAwardReason("");
          setAwardClubId("");
        }
      }}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-amber-500" />
              Award Points
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Award or deduct points for {awardPointsTarget?.name}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Club <span className="text-destructive">*</span>
              </label>
              <select
                value={awardClubId}
                onChange={(e) => setAwardClubId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="">Select a club</option>
                {allClubs?.map(club => (
                  <option key={club.id} value={club.id}>
                    {club.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Points are associated with a club</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Points to Award/Deduct</label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setAwardPoints(Math.max(-100, awardPoints - 5))}
                >
                  <UserMinus className="h-4 w-4" />
                </Button>
                <Input
                  type="number"
                  value={awardPoints}
                  onChange={(e) => setAwardPoints(parseInt(e.target.value) || 0)}
                  className="text-center text-lg font-bold"
                  min={-100}
                  max={100}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setAwardPoints(Math.min(100, awardPoints + 5))}
                >
                  <UserPlus className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Use negative values to deduct points
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Reason (optional)</label>
              <Input
                placeholder="e.g., Extra help at training"
                value={awardReason}
                onChange={(e) => setAwardReason(e.target.value)}
                maxLength={200}
              />
            </div>
          </div>

          <ResponsiveDialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setAwardPointsTarget(null)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button
              className="w-full sm:w-auto"
              disabled={!awardClubId || awardPoints === 0 || awardPointsMutation.isPending}
              onClick={() => {
                if (!awardPointsTarget || !awardClubId) return;
                awardPointsMutation.mutate({
                  userId: awardPointsTarget.id,
                  userName: awardPointsTarget.name,
                  points: awardPoints,
                  reason: awardReason,
                  clubId: awardClubId,
                });
              }}
            >
              {awardPointsMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {awardPoints > 0 ? `Award +${awardPoints} Points` : `Deduct ${awardPoints} Points`}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
