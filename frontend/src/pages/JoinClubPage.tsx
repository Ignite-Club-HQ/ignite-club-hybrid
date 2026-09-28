import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfileById } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { AppStoreDownloadGuide } from "@/components/AppStoreDownloadGuide";
import { setInviteFlowContext, getInviteFlowContext, clearInviteFlowContext } from "@/components/InviteFlowProgress";
import { safeSessionSet, buildAuthPathWithIntent } from "@/lib/authRedirectStorage";
import type { Database } from "@/integrations/supabase/types";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabProfile } from "@/lab/fixtureDataLayer";

type AppRole = Database["public"]["Enums"]["app_role"];

const roleLabels: Record<AppRole, string> = {
  basic_user: "Member",
  club_admin: "Club Admin",
  team_admin: "Team Admin",
  coach: "Coach",
  player: "Player",
  parent: "Parent",
  app_admin: "App Admin",
  league_admin: "League Admin",
  committee_member: "Committee Member",
  association_admin: "Association Admin",
  competition_admin: "Competition Admin",
};

export default function JoinClubPage() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  const [joined, setJoined] = useState(false);
  const autoJoinAttempted = useRef(false);
  
  // Check if we should auto-join (returning from auth after install flow)
  const shouldAutoJoin = sessionStorage.getItem("autoJoinAfterAuth") === "true";

  // Fetch invite details using secure RPC function
  const { data: invite, isLoading: inviteLoading, error: inviteError } = useQuery({
    queryKey: ["club-invite", token, useIcpLab],
    queryFn: async () => {
      if (useIcpLab) return null;
      const { data, error } = await supabase
        .rpc("get_club_invite_by_token", { _token: token! });
      if (error) throw error;
      // Transform RPC result to match expected shape
      if (data && data.length > 0) {
        const row = data[0];
        return {
          id: row.id,
          club_id: row.club_id,
          role: row.role,
          token: row.token,
          uses_count: row.uses_count,
          max_uses: row.max_uses,
          expires_at: row.expires_at,
          created_at: row.created_at,
          created_by: row.created_by,
          clubs: {
            id: row.club_id,
            name: row.club_name,
            logo_url: row.club_logo_url,
            description: row.club_description
          }
        };
      }
      return null;
    },
    enabled: !!token,
  });

  // Fetch user's existing roles in this club
  const { data: existingRoles } = useQuery({
    queryKey: ["user-club-roles", invite?.club_id, user?.id, useIcpLab],
    queryFn: async () => {
      if (useIcpLab) return [];
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("club_id", invite!.club_id);
      return data?.map(r => r.role as AppRole) || [];
    },
    enabled: !!invite?.club_id && !!user,
  });

  // Fetch user's profile to check if profile is complete
  // Use staleTime: 0 to ensure fresh data when returning from profile completion
  const { data: userProfile, isLoading: profileLoading } = useQuery({
    queryKey: ["user-profile-for-join-club", user?.id, useIcpLab],
    queryFn: async () => {
      if (useIcpLab) return getLocalLabProfile(user!.id);
      const { data } = await selectCachedProfileById(user!.id);
      return data;
    },
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Check if user needs to complete their profile first
  const needsProfileCompletion = user && userProfile !== undefined && !userProfile?.display_name;

  // Set up invite flow context when invite is loaded (for progress tracking across pages)
  useEffect(() => {
    if (invite) {
      // Check if we're resuming from a stored context (e.g., after PWA install)
      const existingContext = getInviteFlowContext();
      const resumeStep = existingContext?.currentStep;
      
      setInviteFlowContext({
        active: true,
        clubName: invite.clubs?.name || undefined,
        clubLogoUrl: invite.clubs?.logo_url || undefined,
        teamName: undefined,
        role: invite.role,
        inviteToken: token,
        currentStep: resumeStep || "view",
      });
    }
  }, [invite, token]);

  // Clear invite flow context on successful join
  useEffect(() => {
    if (joined) {
      clearInviteFlowContext();
    }
  }, [joined]);

  const joinMutation = useMutation({
    mutationFn: async () => {
      if (useIcpLab) {
        throw new Error("Club joining is unavailable in ICP lab mode");
      }
      if (!invite || !user) throw new Error("Missing data");

      // Check if invite is expired
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        throw new Error("This invite link has expired");
      }

      // Check if max uses reached
      if (invite.max_uses && invite.uses_count >= invite.max_uses) {
        throw new Error("This invite link has reached its usage limit");
      }

      const roleToAdd = invite.role as AppRole;

      // Check if user already has this role
      if (existingRoles?.includes(roleToAdd)) {
        throw new Error(`You already have the ${roleLabels[roleToAdd]} role in this club`);
      }

      // Add user to club with the invite role
      const { error: roleError } = await supabase.from("user_roles").insert({
        user_id: user.id,
        club_id: invite.club_id,
        role: roleToAdd,
      });

      if (roleError) {
        const isDuplicate = roleError.code === '23505' || roleError.message.includes('duplicate key');
        if (!isDuplicate) {
          throw new Error(`Failed to join: ${roleError.message}`);
        }
      }

      // Increment uses_count
      await supabase
        .from("club_invites")
        .update({ uses_count: invite.uses_count + 1 })
        .eq("id", invite.id);

      // Send notification to the new member
      await supabase.from("notifications").insert({
        user_id: user.id,
        type: "membership",
        message: `You've joined ${invite.clubs?.name} as ${roleLabels[roleToAdd]}`,
        related_id: invite.club_id,
      });

      return roleToAdd;
    },
    onSuccess: (role) => {
      setJoined(true);
      toast({ title: `Successfully joined as ${roleLabels[role]}!` });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to join club", variant: "destructive" });
    },
  });

  // Auto-join effect: when user returns from auth and shouldAutoJoin is true
  useEffect(() => {
    // Wait for profile to finish loading before making any decisions
    if (profileLoading) return;
    
    // First check if user needs to complete their profile
    if (user && userProfile !== undefined && !userProfile?.display_name) {
      // User hasn't completed profile - redirect to complete profile
      safeSessionSet("redirectAfterAuth", `/join-club/${token}`);
      safeSessionSet("autoJoinAfterAuth", "true"); // Ensure flag is set

      navigate("/complete-profile", { replace: true });
      return;
    }

    // Wait for invite data to load before attempting auto-join
    if (inviteLoading) return;

    if (
      shouldAutoJoin && 
      user && 
      invite && 
      userProfile?.display_name && // Only auto-join if profile is complete
      !joined && 
      !joinMutation.isPending &&
      !autoJoinAttempted.current
    ) {
      autoJoinAttempted.current = true;
      try { sessionStorage.removeItem("autoJoinAfterAuth"); } catch { /* storage blocked */ }
      // Small delay to ensure UI is ready
      setTimeout(() => {
        joinMutation.mutate();
      }, 500);
    }
  }, [shouldAutoJoin, user, invite, userProfile, joined, joinMutation, token, navigate, profileLoading, inviteLoading]);

  // Handle join action - redirect to auth if not logged in
  const handleJoinClick = async () => {
    // If not logged in, redirect to auth with auto-join flag
    if (!user) {
      // Storage writes MUST be guarded: a throwing sessionStorage (restricted
      // webviews / blocked storage) used to abort this handler before
      // `navigate`, so the button appeared to do nothing.
      const nextPath = `/join-club/${token}`;
      safeSessionSet("redirectAfterAuth", nextPath);
      safeSessionSet("autoJoinAfterAuth", "true");
      console.log("[SignupFlow] JoinClub → /auth", { nextPath });
      navigate(buildAuthPathWithIntent({ next: nextPath, mode: "signup", invite: token }));
      return;
    }

    // Check if user needs to complete their profile first
    if (!userProfile?.display_name) {
      safeSessionSet("redirectAfterAuth", `/join-club/${token}`);
      safeSessionSet("autoJoinAfterAuth", "true");
      navigate("/complete-profile");
      return;
    }
    
    // User is logged in with complete profile - proceed with join
    joinMutation.mutate();
  };

  if (inviteLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading club invite...</p>
      </div>
    );
  }

  // Club shareable invite links are no longer supported - only email invites work
  // This page handles /join-club/:token which are all shareable links
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-6 text-center">
          <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Invite Links Disabled</h2>
          <p className="text-muted-foreground mb-4">
            {useIcpLab
              ? "Club joining is unavailable in ICP lab mode. No membership changes have been made."
              : "Shareable invite links are no longer supported. Please ask your club admin to send you an email invite instead."}
          </p>
          <Button onClick={() => navigate("/")}>Go to Home</Button>
        </CardContent>
      </Card>
    </div>
  );
}
