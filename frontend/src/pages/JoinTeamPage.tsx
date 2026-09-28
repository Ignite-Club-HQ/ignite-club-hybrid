import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  safeSessionGet,
  safeSessionSet,
  safeSessionRemove,
  buildAuthPathWithIntent,
} from "@/lib/authRedirectStorage";

import { supabase } from "@/integrations/supabase/client";
import { createChildForParentOrReuse } from "@/lib/childDedup";
import { acceptParentTeamInvite, getParentInviteErrorMessage, provisionInviteChildren } from "@/features/membership/acceptParentInvite";

import { selectCachedProfileById } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useClubTheme } from "@/hooks/useClubTheme";
import { applyInviteClubSwitch } from "@/lib/inviteClubSwitch";
import { PhotoConsentDialog } from "@/components/PhotoConsentDialog";
import { AppStoreDownloadGuide } from "@/components/AppStoreDownloadGuide";
import { InviteFlowProgress, setInviteFlowContext, getInviteFlowContext, clearInviteFlowContext } from "@/components/InviteFlowProgress";
import { JoinTeamChildStepCard } from "@/components/join-team/JoinTeamChildStepCard";
import { JoinTeamInviteCard } from "@/components/join-team/JoinTeamInviteCard";
import { JoinTeamStatusCard } from "@/components/join-team/JoinTeamStatusCard";
import type { Database } from "@/integrations/supabase/types";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabClaimableTeam } from "@/lab/fixtureDataLayer";
import { membershipKeys } from "@/lab/membershipQueryKeys";

type AppRole = Database["public"]["Enums"]["app_role"];

/**
 * Referentially stable empty fallback. A fresh `[]` default made the
 * selected-role effect re-run every render (Maximum update depth exceeded),
 * which blocked React from unmounting this page when navigating to /auth.
 */
const EMPTY_ROLES: AppRole[] = [];

/** Child-carrying metadata shape stored on `pending_invites.metadata`. */
type InviteChildMetadata = {
  children?: { name: string; yearOfBirth: number | null; existingChildId?: string | null }[];
  mini_league_id?: string;
  child_id?: string;
  player_id?: string;
  second_parent_user_id?: string;
  linked_invite_token?: string;
  kind?: string;
} | null;

/** Named pending invite matched while joining through a shareable team link. */
type ReconciledInvite = {
  id: string;
  invited_label: string | null;
  role: string | null;
  metadata: unknown;
  team_id: string | null;
  club_id: string | null;
};



const roleLabels: Record<AppRole, string> = {
  basic_user: "Basic User",
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

// SessionStorage key for the invite metadata shown on the /auth page banner
// (club, team, role, invited email). This deliberately lives in sessionStorage
// so it is scoped to the current invite hand-off and can be read before the
// form is rendered.
const INVITE_AUTH_CONTEXT_KEY = "inviteAuthContext";

// Roles that users can request when joining a team
const selectableRoles: AppRole[] = ["coach", "player", "parent"];

// Roles that don't allow additional role selection (admin roles)
const fixedRoles: AppRole[] = ["club_admin", "team_admin", "app_admin"];

export default function JoinTeamPage() {
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    const team = getLocalLabClaimableTeam("team-icp-001");
    return (
      <div className="container max-w-md mx-auto px-4 py-6 space-y-4">
        <Card>
          <CardContent className="p-6 space-y-4 text-center">
            <CheckCircle className="h-10 w-10 mx-auto text-muted-foreground" />
            <h1 className="text-lg font-semibold">{team.name}</h1>
            <p className="text-sm text-muted-foreground">
              Showing a synthetic ICP lab team invite preview. Joining, membership provisioning, and role changes
              remain unavailable until identity_access invite-linking is wired here.
            </p>
            <Button variant="outline" onClick={() => navigate("/")}>
              Go to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <SupabaseJoinTeamPage />;
}

function SupabaseJoinTeamPage() {
  const { token } = useParams<{ token: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [joined, setJoined] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<AppRole[]>([]);
  const [showPhotoConsent, setShowPhotoConsent] = useState(false);
  const [pendingJoinRoles, setPendingJoinRoles] = useState<AppRole[]>([]);
  const [nameValidationError, setNameValidationError] = useState<string | null>(null);
  const [showChildStep, setShowChildStep] = useState(false);
  const [childName, setChildName] = useState("");
  const [childYearOfBirth, setChildYearOfBirth] = useState("");
  const [linkExistingChildId, setLinkExistingChildId] = useState<string | null>(null);
  const [addingChild, setAddingChild] = useState(false);
  const [addedChildren, setAddedChildren] = useState<string[]>([]);
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  // Children created/linked from invite metadata during this join — when
  // non-empty the manual "Add your child" step must be skipped.
  const provisionedChildIdsRef = useRef<string[]>([]);
  // Name of the club we switched the user to after a successful join (shown on the success card).
  const [clubSwitchName, setClubSwitchName] = useState<string | null>(null);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const autoJoinAttempted = useRef(false);
  
  // Check if we should auto-join (returning from auth after install flow)
  const shouldAutoJoin = safeSessionGet("autoJoinAfterAuth") === "true";

  // Check if this is a pending invite token (name-restricted) or a regular team invite
  const isPendingInvite = location.pathname.startsWith("/join/p/");

  // Fetch pending invite details using RPC function (for name-restricted invites)
  const { data: pendingInviteData, isLoading: pendingInviteLoading, error: pendingInviteError, isError: pendingInviteIsError } = useQuery({
    queryKey: membershipKeys.pendingInviteToken(token),
    queryFn: async () => {
      console.log("[JoinTeam] Fetching pending invite for token:", token);
      try {
        const { data, error } = await supabase
          .rpc("get_pending_invite_by_token", { _token: token! });
        console.log("[JoinTeam] RPC response:", { data, error });
        if (error) {
          console.error("[JoinTeam] RPC error:", error);
          throw error;
        }
        if (data && data.length > 0) {
          return data[0];
        }
        console.log("[JoinTeam] No invite found for token");
        return null;
      } catch (err) {
        console.error("[JoinTeam] Exception fetching invite:", err);
        throw err;
      }
    },
    enabled: !!token && isPendingInvite,
    retry: 2,
    retryDelay: 1000,
    staleTime: 0,
  });

  /**
   * Silent check: does the invited email already have an Ignite account?
   * Token-gated RPC (no email enumeration — the caller must already hold a
   * valid invite token). Never blocks render; failures fall back to the
   * default "Create account" behaviour.
   */
  const { data: invitedEmailHasAccount } = useQuery({
    queryKey: ["invite-email-has-account", token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("invite_token_has_existing_account", {
        _token: token!,
      });
      if (error) {
        console.warn("[JoinTeam] existing-account check failed", error.message);
        return false;
      }
      return data === true;
    },
    enabled: !!token && isPendingInvite && !user,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });


  // Fetch team invite details using secure RPC function (for regular invites)
  const { data: teamInvite, isLoading: teamInviteLoading, error: teamInviteError } = useQuery({
    queryKey: membershipKeys.teamInvite(token),
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc("get_team_invite_by_token", { _token: token! });
      if (error) throw error;
      if (data && data.length > 0) {
        const row = data[0];
        return {
          id: row.id,
          team_id: row.team_id,
          role: row.role,
          token: row.token,
          uses_count: row.uses_count,
          max_uses: row.max_uses,
          expires_at: row.expires_at,
          created_at: row.created_at,
          created_by: row.created_by,
          metadata: row.metadata as { child_name?: string; child_year_of_birth?: number } | null,
          teams: {
            id: row.team_id,
            name: row.team_name,
            logo_url: row.team_logo_url,
            club_id: row.club_id,
            clubs: {
              name: row.club_name,
              logo_url: undefined as string | undefined
            }
          }
        };
      }
      return null;
    },
    enabled: !!token && !isPendingInvite,
    retry: 2,
    retryDelay: 1000,
    staleTime: 0,
  });

  // Combine invite data based on type
  const invite = isPendingInvite 
    ? pendingInviteData 
      ? {
          id: pendingInviteData.id,
          team_id: pendingInviteData.team_id,
          role: pendingInviteData.role,
          invited_label: pendingInviteData.invited_label,
          status: pendingInviteData.status,
          token: token,
          uses_count: 0,
          max_uses: 1, // Pending invites are single-use
          expires_at: null,
          created_at: null,
          created_by: null,
          teams: {
            id: pendingInviteData.team_id,
            name: pendingInviteData.team_name,
            logo_url: pendingInviteData.team_logo_url,
            club_id: pendingInviteData.club_id,
            clubs: {
              name: pendingInviteData.club_name,
              logo_url: pendingInviteData.club_logo_url
            }
          }
        }
      : null
    : teamInvite;

  const isLoading = isPendingInvite ? pendingInviteLoading : teamInviteLoading;
  const inviteError = isPendingInvite ? pendingInviteError : teamInviteError;
  const pendingInviteMeta = (pendingInviteData?.metadata as { mini_league_id?: string } | null) ?? null;
  const inviteMiniLeagueId = isPendingInvite ? pendingInviteMeta?.mini_league_id ?? null : null;
  const inviteClubId = invite?.teams?.club_id || pendingInviteData?.club_id || null;
  const { setActiveClubTheme } = useClubTheme();
  const clubFilterSeededRef = useRef(false);



  const { data: inviteMiniLeague } = useQuery({
    queryKey: ["invite-mini-league", inviteMiniLeagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_leagues")
        .select("id, name")
        .eq("id", inviteMiniLeagueId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!inviteMiniLeagueId,
  });

  const inviteEntityName = inviteMiniLeague?.name || invite?.teams?.name || invite?.teams?.clubs?.name || "organization";
  const inviteDestination = inviteMiniLeagueId
    ? `/mini-leagues/${inviteMiniLeagueId}?from=invite`
    : invite?.team_id
      ? `/teams/${invite.team_id}?from=invite`
      : inviteClubId
        ? `/clubs/${inviteClubId}?from=invite`
        : "/";
  const inviteEntityLabel = inviteMiniLeagueId ? "League" : invite?.team_id ? "Team" : "Club";

  // Fetch user's existing roles for the invite destination
  const { data: existingRoles = EMPTY_ROLES } = useQuery({
    queryKey: membershipKeys.inviteRoles(invite?.team_id, inviteClubId, user?.id),
    queryFn: async () => {
      let query = supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id);

      if (invite?.team_id) {
        query = query.eq("team_id", invite.team_id);
      } else if (inviteClubId) {
        query = query.eq("club_id", inviteClubId).is("team_id", null);
      } else {
        return [];
      }

      const { data } = await query;
      return data?.map(r => r.role as AppRole) || [];
    },
    enabled: !!invite && !!user,
  });

  // Does the signed-in user already belong to a DIFFERENT club? Used to show a
  // heads-up that joining adds an additional club rather than replacing one.
  const { data: otherMembershipClubName } = useQuery({
    queryKey: ["join-other-club-membership", user?.id, inviteClubId],
    queryFn: async () => {
      let query = supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .not("club_id", "is", null);
      if (inviteClubId) query = query.neq("club_id", inviteClubId);
      const { data } = await query.limit(10);
      const otherClubId = (data || []).find((r) => r.club_id)?.club_id;
      if (!otherClubId) return null;
      const { data: club } = await supabase
        .from("clubs")
        .select("name")
        .eq("id", otherClubId)
        .maybeSingle();
      return (club?.name as string) ?? null;
    },
    enabled: !!user && !!invite,
    staleTime: 60 * 1000,
  });

  // Fetch user's profile for name validation and profile completion check
  // Use staleTime: 0 to ensure fresh data when returning from profile completion
  const { data: userProfile, isLoading: profileLoading } = useQuery({
    queryKey: membershipKeys.joinProfile(user?.id),
    queryFn: async () => {
      const { data } = await selectCachedProfileById(user!.id);
      return data;
    },
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  /**
   * Backend safety-net triggers can flip an invite to `accepted` before this
   * page runs its accept flow. Previously we bailed out with "invite already
   * used" and the invited children were never created, leaving the parent in
   * the team with nobody to RSVP for. Re-run the idempotent provisioning RPC
   * whenever the already-accepted invite belongs to the signed-in user.
   */
  const provisionedInviteRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user || !isPendingInvite || !pendingInviteData) return;
    if (pendingInviteData.status === "pending") return;

    const meta = (pendingInviteData.metadata ?? null) as {
      children?: unknown[];
      mini_league_id?: string;
    } | null;
    if (!meta?.children?.length || meta.mini_league_id) return;
    if (!["parent", "guardian"].includes(String(pendingInviteData.role))) return;

    const invitedEmail = (pendingInviteData.invited_email || "").toLowerCase().trim();
    const userEmail = (user.email || "").toLowerCase().trim();
    const belongsToUser =
      (invitedEmail && userEmail && invitedEmail === userEmail) ||
      (pendingInviteData as { invited_user_id?: string }).invited_user_id === user.id;
    if (!belongsToUser) return;

    if (provisionedInviteRef.current === pendingInviteData.id) return;
    provisionedInviteRef.current = pendingInviteData.id;

    (async () => {
      try {
        const childIds = await provisionInviteChildren({
          inviteId: pendingInviteData.id,
          guardianId: user.id,
        });

        if (childIds.length > 0) {
          queryClient.invalidateQueries({ queryKey: membershipKeys.teamChildrenForLinking(pendingInviteData.team_id) });
          queryClient.invalidateQueries({ queryKey: ["children"] });
          queryClient.invalidateQueries({ queryKey: membershipKeys.userRoles() });
          queryClient.invalidateQueries({ queryKey: ["rsvps"] });
          queryClient.invalidateQueries({ queryKey: ["team-members", pendingInviteData.team_id] });
          // No toast: child provisioning is an invisible part of accepting the
          // invite. The join/welcome confirmation already covers it.
        }


      } catch (err) {
        provisionedInviteRef.current = null;
        toast({
          title: "Couldn't finish setting up",
          description: getParentInviteErrorMessage(err),
          variant: "destructive",
        });
      }
    })();
  }, [user, isPendingInvite, pendingInviteData, queryClient, toast]);


  // Fetch existing children on this team for parent linking.
  // Only surface children who don't yet have a primary parent or any guardians,
  // so a new parent can claim them without colliding with existing families.
  const { data: existingTeamChildren = [] } = useQuery({
    queryKey: membershipKeys.teamChildrenForLinking(invite?.team_id),
    queryFn: async () => {
      const { data } = await supabase
        .from("child_team_assignments")
        .select("child_id, children(id, name, year_of_birth, parent_id)")
        .eq("team_id", invite!.team_id);
      const candidates = (data || [])
        .map(a => (a.children as any))
        .filter((c: any) => c && !c.parent_id);
      if (candidates.length === 0) return [];
      // Exclude any candidates that already have at least one guardian linked
      const ids = candidates.map((c: any) => c.id);
      const { data: guardians } = await supabase
        .from("child_guardians")
        .select("child_id")
        .in("child_id", ids);
      const linked = new Set((guardians || []).map((g: any) => g.child_id));
      return candidates.filter((c: any) => !linked.has(c.id));
    },
    enabled: !!invite?.team_id && showChildStep,
  });

  // Check if user needs to complete their profile first
  const needsProfileCompletion = user && userProfile !== undefined && !userProfile?.display_name;

  /**
   * True when an already-accepted pending invite was accepted BY the signed-in
   * user (matched on invited_user_id or invited email). In that case the invite
   * did its job — showing "Invite Already Used" would flash a scary error while
   * the auto-join effect redirects to /complete-profile or home.
   */
  const acceptedInviteIsOurs = (() => {
    if (!isPendingInvite || !pendingInviteData || !user) return false;
    const invitedEmail = (pendingInviteData.invited_email || "").toLowerCase().trim();
    const userEmail = (user.email || "").toLowerCase().trim();
    if ((pendingInviteData as { invited_user_id?: string }).invited_user_id === user.id) return true;
    return !!invitedEmail && !!userEmail && invitedEmail === userEmail;
  })();

  /**
   * Email-matched pending invites override the name-mismatch gate. If the
   * invite's email matches the signed-in user, we treat it as belonging to this
   * account regardless of any invited_label/display_name difference.
   */
  const emailMatches =
    isPendingInvite &&
    !!pendingInviteData?.invited_email &&
    !!user?.email &&
    pendingInviteData.invited_email.trim().toLowerCase() === user.email.trim().toLowerCase();

  const showNameMismatchInfo =
    emailMatches &&
    !!pendingInviteData?.invited_label &&
    !!userProfile?.display_name &&
    pendingInviteData.invited_label.trim().toLowerCase() !== userProfile.display_name.trim().toLowerCase();

  /**
   * Re-opening the app can replay a stale invite deep link (stored
   * `pwa_pending_invite`, native launch URL, browser history). If the invite is
   * already accepted AND the signed-in user is already in that team/club, the
   * link simply did its job — show nothing scary, just go home.
   */
  const usedInviteTeamId =
    isPendingInvite && pendingInviteData && pendingInviteData.status !== "pending"
      ? ((pendingInviteData as { team_id?: string | null }).team_id ?? null)
      : null;
  const usedInviteClubId =
    isPendingInvite && pendingInviteData && pendingInviteData.status !== "pending"
      ? ((pendingInviteData as { club_id?: string | null }).club_id ?? null)
      : null;
  const membershipCheckEnabled = !!user && (!!usedInviteTeamId || !!usedInviteClubId);

  const { data: alreadyMemberOfInviteScope, isFetched: membershipChecked } = useQuery({
    queryKey: ["used-invite-membership", user?.id, usedInviteTeamId, usedInviteClubId],
    queryFn: async () => {
      if (!user) return false;
      if (usedInviteTeamId) {
        const { data: tm } = await (supabase as any)
          .from("team_memberships")
          .select("id")
          .eq("user_id", user.id)
          .eq("team_id", usedInviteTeamId)
          .eq("status", "active")
          .limit(1);

        if (tm?.length) return true;
        const { data: tr } = await supabase
          .from("user_roles")
          .select("id")
          .eq("user_id", user.id)
          .eq("team_id", usedInviteTeamId)
          .limit(1);
        if (tr?.length) return true;
      }
      if (usedInviteClubId) {
        const { data: cr } = await supabase
          .from("user_roles")
          .select("id")
          .eq("user_id", user.id)
          .eq("club_id", usedInviteClubId)
          .limit(1);
        if (cr?.length) return true;
      }
      return false;
    },
    enabled: membershipCheckEnabled,
    staleTime: 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (!alreadyMemberOfInviteScope) return;
    clearInviteFlowContext();
    try {
      localStorage.removeItem("pwa_pending_invite");
    } catch {
      /* storage blocked */
    }
    safeSessionRemove("autoJoinAfterAuth");
    navigate("/", { replace: true });
  }, [alreadyMemberOfInviteScope, navigate]);




  // Validate name for pending invites - only block EXISTING users with a different name already set
  // New signups (no display_name yet) are allowed - their name will be auto-set during join
  // A matching email always wins over a name difference.
  useEffect(() => {
    if (isPendingInvite && pendingInviteData?.invited_label && user && userProfile !== undefined) {
      const emailMatches =
        !!pendingInviteData.invited_email &&
        !!user.email &&
        pendingInviteData.invited_email.trim().toLowerCase() === user.email.trim().toLowerCase();

      if (emailMatches) {
        setNameValidationError(null);
        return;
      }

      const expectedName = pendingInviteData.invited_label.toLowerCase().trim();
      const actualName = (userProfile?.display_name || "").toLowerCase().trim();
      
      // Only block if user has an EXISTING display_name that doesn't match
      // If display_name is empty, they're a new signup and we'll set their name during join
      if (actualName && actualName !== expectedName) {
        setNameValidationError(
          `This invite was created for "${pendingInviteData.invited_label}". Your account name "${userProfile?.display_name}" doesn't match.`
        );
      } else {
        // Either name matches OR they have no display_name yet (new signup) - allow join
        setNameValidationError(null);
      }
    } else {
      setNameValidationError(null);
    }
  }, [isPendingInvite, pendingInviteData, userProfile, user]);

  // Set up invite flow context when invite is loaded (for progress tracking across pages)
  useEffect(() => {
    if (invite) {
      // Check if we're resuming from a stored context (e.g., after PWA install)
      const existingContext = getInviteFlowContext();
      const resumeStep = existingContext?.currentStep;
      
      setInviteFlowContext({
        active: true,
        clubName: invite.teams?.clubs?.name || undefined,
        clubLogoUrl: invite.teams?.clubs?.logo_url || undefined,
        teamName: invite.teams?.name || undefined,
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

  // Surface a "Taking Too Long" screen if the invite RPC hangs (network drop, cold start, etc.)
  // Without this, isLoading stays true indefinitely and the user only sees a spinner — which they
  // typically describe as "timed out". 15s gives slow networks a chance before showing the retry UI.
  useEffect(() => {
    if (!isLoading) {
      setLoadingTimeout(false);
      return;
    }
    const t = setTimeout(() => setLoadingTimeout(true), 15000);
    return () => clearTimeout(t);
  }, [isLoading]);

  // All invite types now use a fixed role — no role selection UI needed
  // Initialize selected roles with invite role if user doesn't have it yet
  useEffect(() => {
    const inviteRole = invite?.role as AppRole | undefined;
    if (!inviteRole || existingRoles.includes(inviteRole)) return;
    setSelectedRoles((prev) =>
      prev.length === 1 && prev[0] === inviteRole ? prev : [inviteRole],
    );
  }, [invite?.role, existingRoles]);

  const toggleRole = (role: AppRole) => {
    setSelectedRoles(prev => 
      prev.includes(role) 
        ? prev.filter(r => r !== role)
        : [...prev, role]
    );
  };

  /**
   * Switches the active club filter to the invited club after a successful
   * join. Delegates to `applyInviteClubSwitch` (the sanctioned helper for
   * user-driven invite switches) so state, localStorage and
   * `profiles.active_club_theme_id` stay in sync. Without this, a user who
   * already belongs to another club joins successfully but stays filtered on
   * their old club — the new team appears nowhere and the join looks broken.
   * Applied at most once per page mount.
   */
  const applyInviteClubFilter = async () => {
    if (clubFilterSeededRef.current) return;
    if (!user?.id || !inviteClubId) return;
    clubFilterSeededRef.current = true;
    const result = await applyInviteClubSwitch(user.id, inviteClubId, setActiveClubTheme, {
      source: "join-team",
      announce: false,
    });
    // Only surface the "we've switched you" copy when we actually overrode a
    // previous club preference — a first-time seed isn't a "switch".
    if (result.switched && result.previousClubId) {
      setClubSwitchName(invite?.teams?.clubs?.name ?? null);
    }
  };

  /**
   * Single code path for materialising the children carried on a named pending
   * invite's metadata. Used by both the /join/p/<token> named-invite path and
   * the shareable /join/<token> path (where a named pending invite for the same
   * team gets reconciled) — otherwise the shareable link consumes the invite
   * and silently discards its child metadata.
   *
   * Returns the ids of the children it created or linked.
   */
  const provisionChildrenFromInviteMetadata = async (params: {
    inviteId: string;
    inviteStatus?: string | null;
    inviteRole?: string | null;
    metadata: InviteChildMetadata | null;
    teamId?: string | null;
    clubId?: string | null;
    userId: string;
    /** Pending-invite token; only present on the named-invite path. */
    claimToken?: string | null;
  }): Promise<string[]> => {
    const { inviteId, inviteStatus, inviteRole, metadata, userId, claimToken } = params;
    if (inviteRole !== "parent" || !metadata) return [];

    if (metadata.child_id && metadata.mini_league_id && claimToken) {
      console.log("[JoinTeam] Mini-league invite: claiming child via RPC:", metadata.child_id);
      const { error: claimErr } = await supabase.rpc("claim_mini_league_invite", {
        _token: claimToken,
      });
      if (claimErr) {
        console.error("[JoinTeam] claim_mini_league_invite failed:", claimErr);
        throw new Error(`Couldn't link you to your child: ${claimErr.message}`);
      }
      return [metadata.child_id];
    }

    if (metadata.children && metadata.children.length > 0) {
      // Transactional acceptance: children, guardian links, team assignment,
      // the parent role and the invite status all commit together. On failure
      // nothing is written and the invite stays pending for a retry.
      console.log("[JoinTeam] Accepting parent invite via transactional RPC");
      try {
        if (inviteStatus === "pending") {
          const result = await acceptParentTeamInvite({ inviteId });
          console.log("[JoinTeam] Parent invite accepted:", {
            children: result.childIds.length,
            alreadyAccepted: result.alreadyAccepted,
          });
        }

        const childIds = await provisionInviteChildren({
          inviteId,
          guardianId: userId,
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["children"] }),
          queryClient.invalidateQueries({ queryKey: membershipKeys.userRoles() }),
          queryClient.invalidateQueries({ queryKey: ["rsvps"] }),
        ]);
        console.log("[JoinTeam] Parent invite children provisioned:", childIds.length);
        return childIds;
      } catch (rpcError) {
        throw new Error(getParentInviteErrorMessage(rpcError));
      }
    }

    if (metadata.child_id) {
      // Link existing child to this parent (child was pre-created by admin)
      console.log("[JoinTeam] Linking existing child to parent:", metadata.child_id);
      await supabase
        .from("children")
        .update({ parent_id: userId })
        .eq("id", metadata.child_id);

      // Update legacy mini_league_players record
      if (metadata.player_id) {
        await supabase
          .from("mini_league_players")
          .update({ parent_user_id: userId })
          .eq("id", metadata.player_id);
      }
      return [metadata.child_id];
    }

    return [];
  };

  // Execute the actual join mutation
  const executeJoin = async (rolesToAdd: AppRole[]) => {
    if (!invite || !user) throw new Error("Missing data");

    // The most recent named pending invite reconciled by a shareable-link join.
    let reconciledInvite: ReconciledInvite | null = null;


    // For pending invites, validate name match
    if (isPendingInvite && pendingInviteData?.invited_label) {
      const { data: profile } = await selectCachedProfileById(user.id);

      const invitedEmail = (pendingInviteData.invited_email || "").toLowerCase().trim();
      const userEmail = (user.email || "").toLowerCase().trim();
      const emailMatches = !!invitedEmail && !!userEmail && invitedEmail === userEmail;

      // If user has no display_name, set it to the expected name
      if (!profile?.display_name) {
        await supabase
          .from("profiles")
          .update({ display_name: pendingInviteData.invited_label })
          .eq("id", user.id);
      } else if (!emailMatches) {
        const expectedName = pendingInviteData.invited_label.toLowerCase().trim();
        const actualName = (profile?.display_name || "").toLowerCase().trim();

        if (actualName !== expectedName) {
          const adminType = pendingInviteData.team_id ? "team admin" : "club admin";
          throw new Error(
            `This invite was created for "${pendingInviteData.invited_label}". Please create a new account with that name or contact your ${adminType} for a different invite link.`
          );
        }
      }

      // Accepted parent invites remain recoverable because the backend may
      // accept the invite before its child metadata is provisioned.
      if (!["pending", "accepted"].includes(pendingInviteData.status)) {
        throw new Error("This invite has already been used");
      }

      // Create children from invite metadata (if parent role with children)
      const metadata = pendingInviteData.metadata as { 
        children?: { name: string; yearOfBirth: number | null; existingChildId?: string | null }[];
        mini_league_id?: string;
        child_id?: string;
        player_id?: string;
        second_parent_user_id?: string;
        linked_invite_token?: string;
        kind?: string;
      } | null;

      // Mini-league admin invite: grant per-league admin rights and short-circuit team logic
      if (pendingInviteData.role === "league_admin" && metadata?.mini_league_id) {
        const miniLeagueId = metadata.mini_league_id;
        // Idempotent grant
        const { data: existingGrant } = await supabase
          .from("mini_league_admins")
          .select("id")
          .eq("mini_league_id", miniLeagueId)
          .eq("user_id", user.id)
          .maybeSingle();
        if (!existingGrant) {
          await supabase.from("mini_league_admins").insert({
            mini_league_id: miniLeagueId,
            user_id: user.id,
            granted_by: (pendingInviteData as any).invited_by_user_id ?? null,
          } as any);
        }

        // Mark invite accepted — but keep reusable shareable join links pending
        if (metadata?.kind !== "league_admin_join_link") {
          await supabase
            .from("pending_invites")
            .update({
              status: "accepted",
              accepted_at: new Date().toISOString(),
              invited_user_id: user.id,
            })
            .eq("id", pendingInviteData.id);
        }

        // Notification
        await supabase.from("notifications").insert({
          user_id: user.id,
          type: "membership",
          message: `You've joined ${inviteEntityName} as League Admin`,
          related_id: miniLeagueId,
        });

        return ["league_admin" as AppRole];
      }

      // Mini-league parent shareable join link: grant club-level parent role,
      // keep token reusable, and let the child-add UI run after success.
      if (
        pendingInviteData.role === "parent" &&
        metadata?.kind === "mini_league_parent_join_link" &&
        metadata?.mini_league_id
      ) {
        const miniLeagueId = metadata.mini_league_id;
        const targetClubId = (pendingInviteData as any).club_id;

        if (targetClubId) {
          const { data: existingRole } = await supabase
            .from("user_roles")
            .select("id")
            .eq("user_id", user.id)
            .eq("club_id", targetClubId)
            .is("team_id", null)
            .eq("role", "parent")
            .maybeSingle();
          if (!existingRole) {
            const { error: roleErr } = await supabase.from("user_roles").insert({
              user_id: user.id,
              club_id: targetClubId,
              role: "parent",
            });
            if (roleErr && roleErr.code !== "23505" && !roleErr.message?.includes("duplicate")) {
              throw new Error(`Failed to add parent role: ${roleErr.message}`);
            }
          }
        }

        // Notification (do NOT mark invite accepted — link is reusable)
        await supabase.from("notifications").insert({
          user_id: user.id,
          type: "membership",
          message: `You've joined ${inviteEntityName} as Parent`,
          related_id: miniLeagueId,
        });

        return ["parent" as AppRole];
      }
      provisionedChildIdsRef.current = await provisionChildrenFromInviteMetadata({
        inviteId: pendingInviteData.id,
        inviteStatus: pendingInviteData.status,
        inviteRole: pendingInviteData.role,
        metadata,
        teamId: (pendingInviteData as { team_id?: string | null }).team_id ?? invite.team_id ?? null,
        clubId: (pendingInviteData as { club_id?: string | null }).club_id ?? inviteClubId ?? null,
        userId: user.id,
        claimToken: token ?? null,
      });
    } else if (!isPendingInvite) {
      // Regular team invite - check expiry and usage limits
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        throw new Error("This invite link has expired");
      }

      if (invite.max_uses && invite.uses_count >= invite.max_uses) {
        throw new Error("This invite link has reached its usage limit");
      }

      // Reconcile any matching pending invites for this user (by user_id or email)
      const userEmail = user.email?.toLowerCase().trim();
      const orClauses = [`invited_user_id.eq.${user.id}`];
      if (userEmail) {
        orClauses.push(`invited_email.ilike.${userEmail}`);
      }

      const { data: matchingPendingInvites } = await supabase
        .from("pending_invites")
        .select("id, invited_label, role, metadata, team_id, club_id")
        .eq("team_id", invite.team_id)
        .eq("status", "pending")
        .or(orClauses.join(","))
        .order("created_at", { ascending: false });

      if (matchingPendingInvites && matchingPendingInvites.length > 0) {
        // Most recent matching row wins for child provisioning.
        reconciledInvite = matchingPendingInvites[0] as ReconciledInvite;

        // Use the first match's label to prefill display name if needed
        const firstLabel = matchingPendingInvites.find(i => i.invited_label)?.invited_label;
        if (firstLabel) {
          const { data: profile } = await selectCachedProfileById(user.id);

          if (!profile?.display_name) {
            await supabase
              .from("profiles")
              .update({ display_name: firstLabel })
              .eq("id", user.id);
          }
        }

        // Mark ALL matching pending invites as accepted
        const matchingIds = matchingPendingInvites.map(i => i.id);
        await supabase
          .from("pending_invites")
          .update({ 
            status: "accepted", 
            accepted_at: new Date().toISOString(),
            invited_user_id: user.id
          })
          .in("id", matchingIds);
        
        console.log("[JoinTeam] Reconciled", matchingIds.length, "pending invite(s) for user");

        // The reconciled invite may carry child metadata (named parent invite).
        // Without this the invite is consumed and its child silently discarded.
        const reconciledMetadata =
          (reconciledInvite.metadata as InviteChildMetadata | null) ??
          ((teamInvite?.metadata as InviteChildMetadata | null) ?? null);
        if (reconciledInvite.role === "parent") {
          try {
            const provisioned = await provisionChildrenFromInviteMetadata({
              inviteId: reconciledInvite.id,
              // Already flipped to accepted above.
              inviteStatus: "accepted",
              inviteRole: reconciledInvite.role,
              metadata: reconciledMetadata,
              teamId: reconciledInvite.team_id ?? invite.team_id ?? null,
              clubId: reconciledInvite.club_id ?? inviteClubId ?? null,
              userId: user.id,
              claimToken: null,
            });
            provisionedChildIdsRef.current = provisioned;
            console.log(
              "[JoinTeam] Reconciled invite provisioned children:",
              provisioned.length,
            );
          } catch (provisionError) {
            console.error(
              "[JoinTeam] Reconciled invite child provisioning failed:",
              provisionError,
            );
            provisionedChildIdsRef.current = [];
            // Never consume the invite when provisioning produced no children —
            // leave it pending so a retry (or an admin) can finish the job.
            await supabase
              .from("pending_invites")
              .update({ status: "pending", accepted_at: null })
              .eq("id", reconciledInvite.id);
            toast({
              title: "We couldn't link your child automatically",
              description: "Please add them below.",
            });
          }
        }
      }


      // Increment uses_count for team invite
      await supabase
        .from("team_invites")
        .update({ uses_count: invite.uses_count + 1 })
        .eq("id", invite.id);
    }

    // Add user to team with all selected roles
    for (const role of rolesToAdd) {
      const { error: roleError } = await supabase.from("user_roles").insert({
        user_id: user.id,
        team_id: invite.team_id ?? null,
        // Club-level invites (e.g. committee_member) have no team — the club id
        // must still be stamped so the role resolves to the right club.
        club_id: invite.teams?.club_id ?? inviteClubId,
        role: role,
      });

      
      // Ignore duplicate key errors
      if (roleError) {
        const isDuplicate = roleError.code === '23505' || roleError.message.includes('duplicate key') || roleError.message.includes('unique constraint');
        if (!isDuplicate) {
          console.error('Role insert error:', roleError);
          // Provide a user-friendly message for RLS violations (usually email mismatch)
          if (roleError.message.includes('row-level security policy')) {
            const invitedEmail = isPendingInvite ? pendingInviteData?.invited_email : null;
            const hint = invitedEmail 
              ? `Please make sure you signed up with the email address the invite was sent to (${invitedEmail}). If you used a different email, ask your admin to resend the invite to your correct email.`
              : `Please make sure you signed up with the same email address the invite was sent to. If you used a different email, ask your admin to resend the invite to your correct email.`;
            throw new Error(hint);
          }
          throw new Error(`Failed to add ${role} role: ${roleError.message}`);
        }
      }
    }

    // Handle child auto-creation for regular team invites with metadata
    if (!isPendingInvite && teamInvite?.metadata && rolesToAdd.includes("parent")) {
      const childMeta = teamInvite.metadata as { child_name?: string; child_year_of_birth?: number };
      if (childMeta.child_name) {
        console.log("[JoinTeam] Auto-creating child from invite metadata:", childMeta.child_name);
        
        // Check for existing child with same name on this team
        const { data: existingOnTeam } = await supabase
          .from("child_team_assignments")
          .select("child_id, children(id, name)")
          .eq("team_id", invite.team_id);
        
        const existing = existingOnTeam?.find(
          (a: any) => a.children?.name?.toLowerCase().trim() === childMeta.child_name!.toLowerCase().trim()
        );
        
        if (existing) {
          // Link as guardian to existing child
          await supabase.from("child_guardians").insert({
            child_id: (existing.children as any).id,
            guardian_id: user.id,
            relationship_type: "parent",
            is_primary: false,
          }).then(({ error }) => {
            if (error && !error.message?.includes("duplicate")) {
              console.error("[JoinTeam] Failed to link guardian:", error.message);
            }
          });
        } else {
          // Create new child and assign to team
          const { childId: reusableChildId } = await createChildForParentOrReuse(
            user.id,
            childMeta.child_name,
            childMeta.child_year_of_birth || null
          );
          const newChild = reusableChildId ? { id: reusableChildId } : null;
          
          if (newChild?.id) {
            await supabase.from("child_team_assignments").insert({
              child_id: newChild.id,
              team_id: invite.team_id,
            });
          }
        }
      }
    }

    if (isPendingInvite && pendingInviteData?.id) {
      await supabase
        .from("pending_invites")
        .update({ 
          status: "accepted", 
          accepted_at: new Date().toISOString(),
          invited_user_id: user.id
        })
        .eq("id", pendingInviteData.id);
    }

    // Send notification to the new member
    const roleNames = rolesToAdd.map(r => roleLabels[r]).join(", ");
    const membershipRelatedId = inviteMiniLeagueId || invite.team_id || invite?.teams?.club_id;
    await supabase.from("notifications").insert({
      user_id: user.id,
      type: "membership",
      message: `You've joined ${inviteEntityName} as ${roleNames}`,
      related_id: membershipRelatedId,
    });

    // Send membership confirmation email if user has an email
    if (user.email) {
      try {
        // Fetch club branding for the email
        const clubId = invite.teams?.club_id;
        let clubLogoUrl: string | undefined;
        let clubName = invite.teams?.clubs?.name || "Your Club";
        
        if (clubId) {
          const { data: clubBranding } = await supabase
            .from("clubs")
            .select("name, logo_url")
            .eq("id", clubId)
            .single();
          
          if (clubBranding) {
            clubName = clubBranding.name || clubName;
            clubLogoUrl = clubBranding.logo_url || undefined;
          }
        }

        const teamLink = `${window.location.origin}${inviteDestination}`;
        
        console.log("Sending membership email with:", { clubName, clubLogoUrl, teamName: inviteEntityName });
        
        await supabase.functions.invoke("send-email", {
          body: {
            to: user.email,
            subject: `Welcome to ${inviteEntityName}!`,
            template: "membership-confirmation",
            templateData: {
              recipientName: userProfile?.display_name || pendingInviteData?.invited_label || user.email.split("@")[0],
              teamName: inviteEntityName,
              clubName,
              roleName: roleNames,
              teamLink,
              clubLogoUrl,
            },
          },
        });
        console.log("Membership confirmation email sent to", user.email);
      } catch (emailError) {
        // Don't fail the join if email fails
        console.error("Failed to send membership confirmation email:", emailError);
      }
    }

    // Switch the active club filter to the invited club (idempotent, once only).
    await applyInviteClubFilter();

    return rolesToAdd;
  };


  const joinMutation = useMutation({
    mutationFn: async () => {
      if (!invite || !user) throw new Error("Missing data");

      // Block join if there's a name validation error
      if (nameValidationError) {
        throw new Error(nameValidationError);
      }

      // Filter out roles user already has
      const rolesToAdd = selectedRoles.filter(role => !existingRoles?.includes(role));

      if (rolesToAdd.length === 0) {
        throw new Error("You already have all selected roles in this team");
      }

      // If parent role is selected, check if we need to show consent dialog
      if (rolesToAdd.includes("parent")) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("photo_consent_given_at")
          .eq("id", user.id)
          .single();

        if (!profile?.photo_consent_given_at) {
          setPendingJoinRoles(rolesToAdd);
          setShowPhotoConsent(true);
          return null;
        }
      }

      return executeJoin(rolesToAdd);
    },
    onSuccess: (rolesToAdd) => {
      if (rolesToAdd === null) {
        console.log("[SignupFlow] Auto-join result: no roles to add");
        return;
      }
      const roleNames = rolesToAdd.map(r => roleLabels[r]).join(", ");
      console.log("[SignupFlow] Auto-join result: joined", { roles: rolesToAdd });
      // Invite hand-off is complete — safe to clear the auth tab hint now.
      safeSessionRemove("authDefaultTab");
      toast({ title: `Successfully joined as ${roleNames}!` });
      
      // If parent role was added via a regular invite WITHOUT child metadata, show child step.
      // Same flow for mini-league parent shareable join link (no preset child).
      const isLeagueParentLink =
        isPendingInvite &&
        (pendingInviteData?.metadata as any)?.kind === "mini_league_parent_join_link";
      // A reconciled named invite may have already created/linked children —
      // don't ask the parent to add a child that now exists.
      const childrenAlreadyProvisioned = provisionedChildIdsRef.current.length > 0;
      if (
        (!isPendingInvite &&
          rolesToAdd.includes("parent") &&
          !teamInvite?.metadata &&
          !childrenAlreadyProvisioned) ||
        (isLeagueParentLink && rolesToAdd.includes("parent"))
      ) {
        setShowChildStep(true);
      } else {
        setJoined(true);
      }
    },
    onError: (error: Error) => {
      console.error("[SignupFlow] Auto-join failed", error);
      toast({
        title: "Couldn't complete your join",
        description: error.message || "Failed to join. Please try again or ask your admin to resend the invite.",
        variant: "destructive",
      });
    },

  });

  // Auto-join effect: when user returns from auth and shouldAutoJoin is true
  useEffect(() => {
    // Wait for profile to finish loading before making any decisions
    if (profileLoading) return;
    
    // First check if user needs to complete their profile
    if (user && userProfile !== undefined && !userProfile?.display_name) {
      // User hasn't completed profile - redirect to complete profile
      safeSessionSet("redirectAfterAuth", location.pathname);
      safeSessionSet("autoJoinAfterAuth", "true"); // Ensure flag is set
      // Store the invited_label for profile prefill if available (pending invite)
      if (pendingInviteData?.invited_label) {
        safeSessionSet("inviteLabel", pendingInviteData.invited_label);
      }
      navigate("/complete-profile", { replace: true });
      return;
    }

    // Wait for invite data to load before attempting auto-join
    if (isLoading) return;

    // Club-level invites (committee_member etc.) must not run the role insert
    // until the club id has resolved, or the role lands with no club scope.
    if (shouldAutoJoin && invite && !invite.team_id && !inviteClubId) return;

    if (
      shouldAutoJoin && 
      user && 
      invite && 
      existingRoles !== undefined && // Wait for existing roles to load
      userProfile?.display_name && // Only auto-join if profile is complete
      !joined && 
      !joinMutation.isPending &&
      !autoJoinAttempted.current &&
      !nameValidationError
    ) {
      console.log("[SignupFlow] Auto-join start", {
        role: invite.role,
        teamId: invite.team_id,
        clubId: inviteClubId,
      });

      // Calculate roles to add - use invite role if user doesn't have it
      const inviteRole = invite.role as AppRole;
      const hasInviteRole = existingRoles?.includes(inviteRole);
      
      if (hasInviteRole) {
        // User already has this role - just navigate to the relevant destination
        autoJoinAttempted.current = true;
        safeSessionRemove("autoJoinAfterAuth");
        // Already a member — still make sure the active club filter points at
        // this invite's club so the team is actually visible afterwards.
        void applyInviteClubFilter();
        toast({ title: `You're already a member of ${inviteEntityName}!` });
        // Parents reopening a parent link may still need to link a child
        // (e.g. a sibling, or a child added to the roster after they joined).
        if (inviteRole === "parent") {
          setShowChildStep(true);
        } else {
          setJoined(true);
        }
        return;
      }
      
      // Set the role before joining
      if (selectedRoles.length === 0) {
        setSelectedRoles([inviteRole]);
        return; // Let the effect re-run after selectedRoles is set
      }
      
      autoJoinAttempted.current = true;
      safeSessionRemove("autoJoinAfterAuth");
      // Small delay to ensure UI is ready
      setTimeout(() => {
        joinMutation.mutate();
      }, 500);
    }
  }, [shouldAutoJoin, user, invite, inviteClubId, existingRoles, selectedRoles, joined, joinMutation, nameValidationError, toast, userProfile, location.pathname, navigate, profileLoading, isLoading, pendingInviteData]);

  // Handle photo consent given
  const handlePhotoConsentGiven = async () => {
    if (!user) return;
    
    await supabase
      .from("profiles")
      .update({ photo_consent_given_at: new Date().toISOString() })
      .eq("id", user.id);

    setShowPhotoConsent(false);

    if (pendingJoinRoles.length > 0) {
      try {
        const result = await executeJoin(pendingJoinRoles);
        const roleNames = result.map(r => roleLabels[r]).join(", ");
        toast({ title: `Successfully joined as ${roleNames}!` });
        if (
          !isPendingInvite &&
          result.includes("parent") &&
          !teamInvite?.metadata &&
          provisionedChildIdsRef.current.length === 0
        ) {
          setShowChildStep(true);
        } else {
          setJoined(true);
        }
      } catch (error) {
        toast({ title: (error as Error).message || "Failed to join team", variant: "destructive" });
      }
    }
    setPendingJoinRoles([]);
  };

  // Handle photo consent declined
  const handlePhotoConsentDeclined = () => {
    setShowPhotoConsent(false);
    setPendingJoinRoles([]);
    toast({ 
      title: "Photo consent required", 
      description: "You need to provide consent for your child's photos to join as a parent.",
      variant: "destructive" 
    });
  };

  const persistInviteAuthContext = () => {
    const nextPath = location.pathname + location.search;
    safeSessionSet("redirectAfterAuth", nextPath);
    safeSessionSet("autoJoinAfterAuth", "true");
    safeSessionSet(
      INVITE_AUTH_CONTEXT_KEY,
      JSON.stringify({
        clubName: invite?.teams?.clubs?.name ?? null,
        teamName: invite?.teams?.name ?? null,
        invitedEmail: isPendingInvite ? (pendingInviteData?.invited_email ?? null) : null,
        roleLabel: roleLabels[invite?.role as AppRole] ?? null,
      }),
    );
    // Keep the existing invite-flow context (localStorage) up to date so the
    // progress indicator and PWA install resume path continue to work.
    setInviteFlowContext({
      ...(getInviteFlowContext() ?? {}),
      active: true,
      clubName: invite?.teams?.clubs?.name || undefined,
      teamName: invite?.teams?.name || undefined,
      role: invite?.role || undefined,
      inviteToken: token,
      currentStep: "auth",
    });
  };

  const handleCreateAccountClick = () => {
    persistInviteAuthContext();
    navigate(
      buildAuthPathWithIntent({
        next: location.pathname + location.search,
        mode: "signup",
        invite: token,
      }),
    );
  };

  const handleSignInClick = () => {
    persistInviteAuthContext();
    navigate(
      buildAuthPathWithIntent({
        next: location.pathname + location.search,
        mode: "signin",
        invite: token,
      }),
    );
  };

  // Handle join action - redirect to auth if not logged in
  const handleJoinClick = async () => {
    // If not logged in, redirect to auth with auto-join flag.
    // The URL carries the whole intent (mode + next + invite token) because
    // sessionStorage writes throw in some webviews; storage is a fallback only.
    if (!user) {
      handleCreateAccountClick();
      return;
    }

    // Check if user needs to complete their profile first
    if (!userProfile?.display_name) {
      safeSessionSet("redirectAfterAuth", location.pathname);
      safeSessionSet("autoJoinAfterAuth", "true");
      if (pendingInviteData?.invited_label) {
        safeSessionSet("inviteLabel", pendingInviteData.invited_label);
      }
      navigate("/complete-profile");
      return;
    }
    
    // User is logged in with complete profile - proceed with join (may need photo consent for parent role)
    joinMutation.mutate();
  };



  if (isLoading && !loadingTimeout) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading team invite...</p>
      </div>
    );
  }

  // Handle loading timeout - show error and retry option
  if (loadingTimeout && isLoading) {
    return (
      <JoinTeamStatusCard
        tone="warning"
        title="Taking Too Long"
        description="We're having trouble loading this invite. This might be a network issue."
        actions={
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => navigate("/")}>Go Home</Button>
            <Button onClick={() => window.location.reload()}>Retry</Button>
          </div>
        }
      />
    );
  }

  // Regular team invites are now allowed (shareable links from AddTeamMemberSheet)

  if (inviteError || !invite) {
    return (
      <JoinTeamStatusCard
        tone="error"
        title="Invalid Invite Link"
        description="This invite link is invalid or has been deleted."
        actions={<Button onClick={() => navigate("/")}>Go to Home</Button>}
      />
    );
  }

  // Check if pending invite is already used (only for pending invite routes).
  // Suppressed while the profile/auto-join hand-off is still resolving, and
  // whenever the invite was accepted by THIS user — otherwise a brand-new
  // signup sees a one-frame "Invite Already Used" error before we redirect
  // them onward to /complete-profile.
  if (
    isPendingInvite &&
    pendingInviteData &&
    pendingInviteData.status !== "pending" &&
    !profileLoading &&
    !needsProfileCompletion &&
    !acceptedInviteIsOurs &&
    !alreadyMemberOfInviteScope &&
    (!membershipCheckEnabled || membershipChecked)

  ) {

    return (
      <JoinTeamStatusCard
        tone="error"
        title="Invite Already Used"
        description={
          <>This invite link has already been used. Contact your {pendingInviteData?.team_id ? "team admin" : "club admin"} for a new invite.</>
        }
        actions={<Button onClick={() => navigate("/")}>Go to Home</Button>}
      />
    );
  }

  // Check if invite is expired or maxed out (for regular team invites)
  const isExpired = !isPendingInvite && invite?.expires_at && new Date(invite.expires_at) < new Date();
  const isMaxedOut = !isPendingInvite && invite?.max_uses && invite.uses_count >= invite.max_uses;

  if (isExpired) {
    return (
      <JoinTeamStatusCard
        tone="error"
        title="Invite Expired"
        description="This invite link has expired. Please ask your team admin for a new invite."
        actions={<Button onClick={() => navigate("/")}>Go to Home</Button>}
      />
    );
  }

  if (isMaxedOut) {
    return (
      <JoinTeamStatusCard
        tone="error"
        title="Invite Link Used"
        description="This invite link has reached its usage limit. Please ask your team admin for a new invite."
        actions={<Button onClick={() => navigate("/")}>Go to Home</Button>}
      />
    );
  }

  // Check if user already has all selectable roles
  const availableRoles = selectableRoles.filter(role => !existingRoles.includes(role));
  const allRolesAssigned = !!invite?.role && existingRoles.includes(invite.role as AppRole);

  if (allRolesAssigned && !showChildStep) {
    return (
      <JoinTeamStatusCard
        tone="success"
        title="Already a Full Member"
        description={<>You already have all available roles in {inviteEntityName}.</>}
        actions={
          <div className="space-y-2">
            {invite?.role === "parent" && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowChildStep(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Link a child to {inviteEntityName}
              </Button>
            )}
            <Button className="w-full" onClick={() => navigate(inviteDestination)}>
              View {inviteEntityLabel}
            </Button>
          </div>
        }
      />
    );
  }

  // Notify team admins + coaches when a parent joins via a link
  // but skips the child-linking step, so someone can manually link them.
  const notifyAdminsOfUnlinkedParent = async () => {
    if (!user || !invite?.team_id) return;
    try {
      const parentName = userProfile?.display_name || user.email?.split("@")[0] || "A parent";
      const { data: staff } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("team_id", invite.team_id)
        .in("role", ["team_admin", "coach"]);
      const clubId = invite.teams?.club_id;
      let clubAdmins: { user_id: string }[] = [];
      if (clubId) {
        const { data } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("club_id", clubId)
          .is("team_id", null)
          .eq("role", "club_admin");
        clubAdmins = data || [];
      }
      const recipientIds = Array.from(
        new Set(
          [...(staff || []), ...clubAdmins]
            .map((r) => r.user_id)
            .filter((id) => id && id !== user.id)
        )
      );
      if (recipientIds.length === 0) return;
      const message = `${parentName} joined ${inviteEntityName} as a parent but hasn't linked a child yet — tap to link them.`;
      const rows = recipientIds.map((uid) => ({
        user_id: uid,
        type: "membership",
        message,
        related_id: invite.team_id,
      }));
      await supabase.from("notifications").insert(rows);
    } catch (err) {
      console.error("[JoinTeam] Failed to notify admins of unlinked parent:", err);
    }
  };

  // True when this parent already has a child (owned or guardian-linked) on
  // the team — used to avoid nagging admins when an existing member reopens
  // a parent join link and skips the child step.
  const parentHasChildOnTeam = async (): Promise<boolean> => {
    if (!user || !invite?.team_id) return false;
    try {
      const [{ data: own }, { data: guarded }] = await Promise.all([
        supabase.from("children").select("id").eq("parent_id", user.id),
        supabase.from("child_guardians").select("child_id").eq("guardian_id", user.id),
      ]);
      const ids = [
        ...(own || []).map((c: any) => c.id),
        ...(guarded || []).map((g: any) => g.child_id),
      ];
      if (ids.length === 0) return false;
      const { data: assignments } = await supabase
        .from("child_team_assignments")
        .select("child_id")
        .eq("team_id", invite.team_id)
        .in("child_id", ids);
      return (assignments || []).length > 0;
    } catch {
      return false;
    }
  };

  // Detect mini-league parent shareable join link (no team_id, child assigns to mini league)
  const leagueLinkMiniLeagueId =
    isPendingInvite &&
    (pendingInviteData?.metadata as any)?.kind === "mini_league_parent_join_link"
      ? ((pendingInviteData?.metadata as any)?.mini_league_id as string | undefined) ?? null
      : null;

  // Add child step for parent role (regular invite links + league parent join link)
  const handleAddChild = async () => {
    if (!user) return;
    if (!invite?.team_id && !leagueLinkMiniLeagueId) return;
    setAddingChild(true);
    try {
      let addedLabel = "";
      if (linkExistingChildId) {
        // Find existing child name for the summary
        const existing = (existingTeamChildren as any[]).find(c => c.id === linkExistingChildId);
        addedLabel = existing?.name || "Child";
        // Link existing child as guardian (team flow only)
        const { error: guardErr } = await supabase.from("child_guardians").insert({
          child_id: linkExistingChildId,
          guardian_id: user.id,
          relationship_type: "parent",
          is_primary: false,
        });
        if (guardErr && !guardErr.message?.includes("duplicate")) {
          throw guardErr;
        }
        toast({ title: `Linked to ${addedLabel}!` });
      } else if (childName.trim()) {
        addedLabel = childName.trim();
        // Create new child
        const { data: newChild, error: childErr } = await supabase
          .from("children")
          .insert({
            parent_id: user.id,
            name: addedLabel,
            year_of_birth: childYearOfBirth ? parseInt(childYearOfBirth) : null,
          })
          .select("id")
          .single();

        let effectiveChildId = newChild?.id as string | undefined;

        if (childErr) {
          // The server blocks a second child with the same name for this parent.
          // Reuse the child they already have rather than failing the join.
          const isDuplicate =
            childErr.code === "23505" ||
            childErr.message?.includes("duplicate_child_for_parent");
          if (!isDuplicate) throw childErr;

          const { data: existingOwn } = await supabase
            .from("children")
            .select("id, name")
            .eq("parent_id", user.id);
          const target = addedLabel.toLowerCase();
          effectiveChildId = (existingOwn ?? []).find(
            (c: any) => c.name?.toLowerCase().trim() === target
          )?.id;
          if (!effectiveChildId) throw childErr;
        }

        if (effectiveChildId) {
          if (leagueLinkMiniLeagueId) {
            // Assign to mini league
            const { error: leagueErr } = await supabase
              .from("child_mini_league_assignments")
              .insert({
                child_id: effectiveChildId,
                mini_league_id: leagueLinkMiniLeagueId,
                ability_rating: 3,
              });
            if (leagueErr && !leagueErr.message?.includes("duplicate")) {
              console.error("[JoinTeam] Failed to assign child to league:", leagueErr.message);
            }
          } else if (invite?.team_id) {
            // Assign to team
            await supabase.from("child_team_assignments").insert({
              child_id: effectiveChildId,
              team_id: invite.team_id,
            });
          }
        }
        toast({ title: `${addedLabel} added to ${inviteEntityName}!` });
      }


      // Track the added child and reset the form so a sibling can be added next
      setAddedChildren(prev => [...prev, addedLabel]);
      setChildName("");
      setChildYearOfBirth("");
      setLinkExistingChildId(null);
      // Refresh the "existing children on team" list so the just-linked child
      // disappears from the choices.
      queryClient.invalidateQueries({ queryKey: membershipKeys.teamChildrenForLinking(invite?.team_id) });
    } catch (err) {
      console.error("[JoinTeam] Error adding child:", err);
      toast({ title: "Failed to add child", variant: "destructive" });
    } finally {
      setAddingChild(false);
    }
  };

  const handleFinishChildStep = () => {
    setShowChildStep(false);
    setJoined(true);
  };

  const handleSkipChildStep = async () => {
    if (addedChildren.length > 0) {
      // They've already added at least one — treat skip as "done"
      handleFinishChildStep();
      return;
    }
    if (!leagueLinkMiniLeagueId) {
      // Team flow: nudge admins to link the parent's child manually — but only
      // when the parent genuinely has no child on this team yet. Existing
      // members reopening a parent link usually already do.
      const alreadyLinked = await parentHasChildOnTeam();
      if (alreadyLinked) {
        toast({
          title: "You're all set",
          description: "Your child is already linked to this team.",
        });
      } else {
        await notifyAdminsOfUnlinkedParent();
        toast({
          title: "Team admins notified",
          description: "They'll help link your child to the team.",
        });
      }
    } else {
      toast({
        title: "You can add your child anytime",
        description: "Tap your profile to add a child later.",
      });
    }
    setShowChildStep(false);
    setJoined(true);
  };

  // Progress step is derived from real component state (not just stored
  // context) so the child step and success screens show the right position.
  const getCurrentStep = (): "view" | "install" | "auth" | "profile" | "done" => {
    if (joined) return "done";
    if (showChildStep) return "profile";
    const storedContext = getInviteFlowContext();
    if (storedContext?.currentStep && storedContext.currentStep !== "view") {
      return storedContext.currentStep;
    }
    return "view";
  };

  if (showChildStep) {
    // handleAddChild early-returns without either of these — never show a
    // tappable button that would silently do nothing.
    const canAddChild = !!invite?.team_id || !!leagueLinkMiniLeagueId;
    return (
      <JoinTeamChildStepCard
        currentStep={getCurrentStep()}
        isExistingUser={!!user}
        inviteEntityName={inviteEntityName}
        addedChildren={addedChildren}
        existingTeamChildren={existingTeamChildren}
        linkExistingChildId={linkExistingChildId}
        childName={childName}
        childYearOfBirth={childYearOfBirth}
        canAddChild={canAddChild}
        addingChild={addingChild}
        showSkipConfirm={showSkipConfirm}
        onToggleExistingChild={(childId) => {
          setLinkExistingChildId(linkExistingChildId === childId ? null : childId);
          if (linkExistingChildId !== childId) setChildName("");
        }}
        onChildNameChange={setChildName}
        onChildYearOfBirthChange={setChildYearOfBirth}
        onAddChild={() => void handleAddChild()}
        onFinish={handleFinishChildStep}
        onOpenSkipConfirmChange={setShowSkipConfirm}
        onSkipConfirm={() => void handleSkipChildStep()}
      />
    );
  }

  // Joined successfully
  if (joined) {
    const isNative = !!(window as any).Capacitor?.isNativePlatform?.();

    return (
      <div className="min-h-screen flex flex-col bg-background">
        <InviteFlowProgress
          currentStep="done"
          isExistingUser={!!user}
          className="fixed top-0 left-0 right-0"
        />
        <div className="flex-1 flex items-center justify-center p-4 pt-16">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 space-y-6">
            {/* Success message */}
            <div className="text-center">
              <CheckCircle className="h-12 w-12 text-primary mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">Welcome to the {inviteEntityLabel}!</h2>
              <p className="text-muted-foreground">
                You've successfully joined {inviteEntityName}.
              </p>
              {clubSwitchName && (
                <p className="text-sm text-muted-foreground mt-2">
                  We've switched you to {clubSwitchName}.
                </p>
              )}
            </div>

            {/* App store download - only show if not a native app */}
            {!isNative && (
              <div className="border-t border-border pt-4">
                <AppStoreDownloadGuide compact />
              </div>
            )}

            <Button onClick={() => navigate(inviteDestination)} className="w-full" size="lg">
              View {inviteEntityLabel}
            </Button>
          </CardContent>
        </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Fixed progress indicator at top */}
      <InviteFlowProgress 
        currentStep={getCurrentStep()} 
        isExistingUser={!!user}
        className="fixed top-0 left-0 right-0"
      />
      
      <div className="flex-1 flex items-center justify-center p-4 pt-16">
        <JoinTeamInviteCard
          inviteEntityName={inviteEntityName}
          inviteEntityLabel={inviteEntityLabel}
          inviteClubName={invite?.teams?.clubs?.name}
          entityLogoUrl={invite.teams?.logo_url || invite.teams?.clubs?.logo_url || undefined}
          entityInitial={(invite.teams?.name || invite.teams?.clubs?.name)?.charAt(0)?.toUpperCase() || "T"}
          isPendingInvite={isPendingInvite}
          invitedLabel={pendingInviteData?.invited_label}
          invitedEmail={pendingInviteData?.invited_email}
          isSignedIn={!!user}
          invitedEmailHasAccount={invitedEmailHasAccount}
          nameValidationError={nameValidationError}
          nameMismatchDescription={showNameMismatchInfo
            ? `This invite was addressed to ${pendingInviteData?.invited_label}. You can accept it as ${userProfile?.display_name}.`
            : null}
          otherMembershipClubName={otherMembershipClubName}
          addedClubName={invite?.teams?.clubs?.name || inviteEntityName}
          roleLabel={roleLabels[invite.role as AppRole]}
          joinButtonDisabled={joinMutation.isPending || (user && profileLoading) || (user && selectedRoles.length === 0 && !needsProfileCompletion) || (user && !!nameValidationError && !emailMatches)}
          joinButtonLoading={joinMutation.isPending || !!(user && profileLoading)}
          joinButtonLabel={
            nameValidationError && !emailMatches
              ? "Cannot Join - Name Mismatch"
              : needsProfileCompletion
                ? "Complete Profile to Join"
                : `Join as ${roleLabels[invite.role as AppRole]}`
          }
          onCreateAccountClick={handleCreateAccountClick}
          onSignInClick={handleSignInClick}
          onJoinClick={handleJoinClick}
          onCancel={() => navigate("/")}
        />
      </div>

      {/* Photo Consent Dialog for Parents */}
      <PhotoConsentDialog
        open={showPhotoConsent}
        onConsentGiven={handlePhotoConsentGiven}
        onDecline={handlePhotoConsentDeclined}
      />
    </div>
  );
}
