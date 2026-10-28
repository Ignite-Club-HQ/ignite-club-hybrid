import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shield, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfileById } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { withFeatureBackend } from "@/live/featureRouter";
import { withReadDeadline } from "@/live/readDeadline";
import {
  listLiveMatchCaptains,
  setLiveMatchCaptain,
  removeLiveMatchCaptain,
} from "@/live/features/events";
import { readPlayerOfMatchAdults, readProfileSummaries } from "@/lib/playerOfMatchReads";

interface MatchCaptainSelectorProps {
  eventId: string;
  clubId?: string | null;
  teamId?: string | null;
  isAdmin: boolean;
  rsvps: any[];
}

export default function MatchCaptainSelector({
  eventId,
  clubId,
  teamId,
  isAdmin,
  rsvps,
}: MatchCaptainSelectorProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // events_domain has a per-match captain-assignment store
  // (set_match_captain/list_match_captains/remove_match_captain); ICP
  // sessions resolve the captain the same way Supabase ones do.
  const isIcp = isFeatureRoutedToIcp("events");
  const effectiveIsAdmin = isAdmin;
  const [selectDialogOpen, setSelectDialogOpen] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data: captain, isLoading, error: captainError, refetch: refetchCaptain } = useQuery({
    queryKey: ["match-captain", eventId, user?.id, isIcp, clubId],
    enabled: !!user && !!eventId,
    queryFn: ({ signal }) => withReadDeadline(withFeatureBackend("events", {
      supabase: async () => {
        const { data, error } = await supabase
          .from("match_captains")
          .select(`*, children:child_id (id, name)`)
          .eq("event_id", eventId)
          .maybeSingle();
        if (error) throw error;
        if (!data) return null;

        let profile = null;
        if (data.user_id) {
          const { data: profileData } = await selectCachedProfileById(data.user_id);
          profile = profileData;
        }
        return { ...data, profiles: profile };
      },
      icp: async (ctx) => {
        const rows = await listLiveMatchCaptains(ctx, eventId);
        const row = rows.find((r) => r.role === "captain") ?? rows[0];
        if (!row) return null;
        const isChild = row.ref_kind === "child";
        let profile = null;
        let children = null;
        if (isChild) {
          // Child names are PII and already decrypted into the event roster
          // the page passes in as `rsvps`; reuse that instead of a Supabase
          // children read, which strict ICP transport blocks.
          const match = rsvps.find((r) => r.child_id === row.ref_id);
          children = match?.children ?? null;
        } else {
          profile = rsvps.find((r) => !r.child_id && r.user_id?.replace(/^principal:/, "") === row.ref_id.replace(/^principal:/, ""))?.profiles ?? null;
        }
        return {
          id: `${row.event_id}:${row.ref_kind}:${row.ref_id}:${row.role}`,
          event_id: row.event_id,
          user_id: isChild ? null : row.ref_id,
          child_id: isChild ? row.ref_id : null,
          profiles: profile,
          children,
        };
      },
    }, clubId ? { clubId } : { eventId }), "Captain details", 30_000, signal),
    staleTime: 60_000,
    retry: isIcp ? false : 1,
    refetchOnWindowFocus: false,
    retryDelay: 500,
  });

  // Player-role eligibility is routed: Supabase reads user_roles, ICP reads
  // on-chain role grants (the previous direct query was disabled in ICP,
  // leaving no selectable adults).
  const { data: playerUserIds = [] } = useQuery({
    queryKey: ["team-player-user-ids", clubId, teamId, isIcp, user?.id],
    queryFn: () => readPlayerOfMatchAdults(clubId ?? "", teamId),
    enabled: !!user && !!teamId && !!clubId,
  });

  // ICP rosters carry no profile enrichment, so hydrate adult names/avatars
  // on-chain for the pick list instead of showing "Unknown".
  const goingAdultIds = useMemo(
    () => (rsvps || [])
      .filter((r) => r.status === "going" && !r.child_id && r.user_id)
      .map((r) => r.user_id as string),
    [rsvps],
  );
  const { data: seasonCaptain, isLoading: isSeasonCaptainLoading, error: seasonCaptainError, refetch: refetchSeasonCaptain } = useQuery({
    queryKey: ["team-season-captain", teamId, isIcp, user?.id, clubId],
    enabled: !!user && !!teamId && captain === null && !captainError,
    queryFn: async ({ signal }) => {
      if (!teamId) return null;
      return withReadDeadline(withFeatureBackend("membership", {
      supabase: async () => {
        const { data, error } = await supabase
          .from("team_captains")
          .select("user_id")
          .eq("team_id", teamId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (!data?.user_id) return null;
        const { data: profile } = await selectCachedProfileById(data.user_id);
        return { user_id: data.user_id, profiles: profile, isSeasonCaptain: true };
      },
      icp: async (ctx) => {
        const { listLiveTeamCaptains } = await import("@/live/features/club");
        const captains = await listLiveTeamCaptains(ctx, teamId);
        const principal = captains[0]?.user?.toText?.() ?? String(captains[0]?.user ?? "");
        if (!principal) return null;
        return {
          user_id: principal,
          profiles: rsvps.find((r) => !r.child_id && r.user_id?.replace(/^principal:/, "") === principal)?.profiles ?? null,
          isSeasonCaptain: true,
        };
      },
    }, clubId ? { clubId } : { teamId }), "Season captain details", 30_000, signal);
    },
    staleTime: 5 * 60_000,
    retry: isIcp ? false : 1,
    refetchOnWindowFocus: false,
    retryDelay: 500,
  });

  const profileIds = [...new Set([...goingAdultIds, captain?.user_id, seasonCaptain?.user_id]
    .filter((id): id is string => !!id).map((id) => id.replace(/^principal:/, "")))];
  const { data: adultProfiles } = useQuery({
    queryKey: ["roster-profile-names", eventId, user?.id, isIcp, profileIds.join(",")],
    queryFn: ({ signal }) => withReadDeadline(readProfileSummaries(profileIds, clubId), "Captain names", 12_000, signal),
    enabled: !!user && isIcp && profileIds.length > 0,
    staleTime: 60_000,
    retry: false,
  });
  const adultName = (id: string | null | undefined) =>
    id ? adultProfiles?.get(id.replace(/^principal:/, ""))?.display_name : null;
  const adultAvatar = (id: string | null | undefined) =>
    id ? adultProfiles?.get(id.replace(/^principal:/, ""))?.avatar_url : null;

  const assignMutation = useMutation({
    mutationFn: async ({ userId, childId }: { userId?: string; childId?: string }) => {
      await withFeatureBackend("events", {
        supabase: async () => {
          // Replace any existing captain for this event
          await supabase.from("match_captains").delete().eq("event_id", eventId);
          const { error } = await supabase.from("match_captains").insert({
            event_id: eventId,
            user_id: userId || null,
            child_id: childId || null,
            assigned_by: user?.id,
          } as any);
          if (error) throw error;
        },
        icp: async (ctx) => {
          const existing = await listLiveMatchCaptains(ctx, eventId);
          await Promise.all(
            existing
              .filter((r) => r.role === "captain")
              .map((r) => removeLiveMatchCaptain(ctx, eventId, r.ref_kind, r.ref_id, "captain" as const)),
          );
          const refKind = userId ? "account" : "child";
          const refId = userId || childId;
          if (!refId) throw new Error("Choose a player first.");
          await setLiveMatchCaptain(ctx, eventId, refKind, refId, "captain");
        },
      }, { eventId: eventId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["match-captain", eventId] });
      setSelectDialogOpen(false);
      setPendingId(null);
      toast({ title: "Captain assigned 🛡️" });
    },
    onError: (e: Error) => {
      setPendingId(null);
      toast({ title: e.message || "Failed to assign captain", variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      if (!captain) return;
      await withFeatureBackend("events", {
        supabase: async () => {
          const { error } = await supabase
            .from("match_captains")
            .delete()
            .eq("id", captain.id);
          if (error) throw error;
        },
        icp: async (ctx) => {
          const refKind = captain.child_id ? "child" : "account";
          const refId = captain.child_id || captain.user_id;
          await removeLiveMatchCaptain(ctx, eventId, refKind, refId, "captain");
        },
      }, { eventId: eventId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["match-captain", eventId] });
      setRemoveDialogOpen(false);
      toast({ title: "Captain removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove captain", variant: "destructive" });
    },
  });

  const goingPlayers = rsvps?.filter((r) => r.status === "going") || [];
  const goingChildren = goingPlayers.filter((r) => r.child_id);
  const goingMembers = goingPlayers.filter(
    (r) => !r.child_id && r.user_id && playerUserIds.includes(r.user_id.replace(/^principal:/, ""))
  );

  const displayedCaptain = captain ?? seasonCaptain;
  const displayedRsvp = displayedCaptain ? rsvps.find(r => displayedCaptain.child_id
    ? r.child_id === displayedCaptain.child_id
    : !r.child_id && r.user_id?.replace(/^principal:/, "") === displayedCaptain.user_id?.replace(/^principal:/, "")) : null;
  const displayedName = displayedCaptain?.profiles?.display_name || displayedRsvp?.profiles?.display_name ||
    displayedCaptain?.children?.name || displayedRsvp?.children?.name || adultName(displayedCaptain?.user_id) || "Team captain";
  const displayedAvatar = displayedCaptain?.profiles?.avatar_url || displayedRsvp?.profiles?.avatar_url || adultAvatar(displayedCaptain?.user_id);

  return (
    <>
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-5 w-5 text-blue-500" />
            Captain
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading && !displayedCaptain ? (
            <Loader2 aria-label="Checking captain" className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : displayedCaptain ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10 ring-2 ring-blue-500">
                  {displayedAvatar && (
                    <AvatarImage src={displayedAvatar} />
                  )}
                  <AvatarFallback className="bg-blue-500/20 text-blue-600">
                    {displayedName
                      .charAt(0)
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">
                    {displayedName}
                  </span>
                  {displayedCaptain.isSeasonCaptain && <Badge variant="secondary">Season captain</Badge>}
                </div>
              </div>
              {effectiveIsAdmin && !displayedCaptain.isSeasonCaptain && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectDialogOpen(true)}
                  >
                    Change
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={() => setRemoveDialogOpen(true)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          ) : captainError ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">We couldn’t check the captain assignment. Please try again.</p>
              <p className="text-xs text-muted-foreground">The match captain check did not complete. {(() => {
                const message = captainError instanceof Error ? captainError.message : String(captainError);
                if (/deadline|timed? ?out|too long/i.test(message)) return "The club service took too long to reply.";
                if (/forbidden|denied|access changed/i.test(message)) return "The club service could not confirm access to this event.";
                if (/not found|unavailable/i.test(message)) return "The event could not be confirmed by its club service.";
                if (/session|identity|authenticated/i.test(message)) return "Your sign-in session could not be confirmed.";
                return "The club service did not return a confirmed result.";
              })()}</p>
              <Button variant="outline" onClick={() => void refetchCaptain()}>Try again</Button>
            </div>
          ) : seasonCaptainError ? (
            // The match check confirmed no match captain; only the optional
            // season-captain display failed, so admins can still assign one.
            <div className="space-y-2">
              {effectiveIsAdmin && (
                <Button
                  variant="outline"
                  className="w-full border-blue-500/50 text-blue-600 hover:bg-blue-500/10"
                  onClick={() => setSelectDialogOpen(true)}
                  disabled={goingPlayers.length === 0}
                >
                  <Shield className="h-4 w-4 mr-2" />
                  Assign Captain
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                No match captain yet. The team’s season captain couldn’t be shown right now.{" "}
                <button type="button" className="underline" onClick={() => void refetchSeasonCaptain()}>Try again</button>
              </p>
            </div>
          ) : isSeasonCaptainLoading ? (
            <Loader2 aria-label="Checking season captain" className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : effectiveIsAdmin ? (
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full border-blue-500/50 text-blue-600 hover:bg-blue-500/10"
                onClick={() => setSelectDialogOpen(true)}
                disabled={goingPlayers.length === 0}
              >
                <Shield className="h-4 w-4 mr-2" />
                Assign Captain
              </Button>
              {goingPlayers.length === 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  No players RSVP'd as "Going" yet
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No captain assigned yet
            </p>
          )}
        </CardContent>
      </Card>

      <ResponsiveDialog open={selectDialogOpen} onOpenChange={setSelectDialogOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader className="text-left border-b pb-4">
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-blue-500" />
              Assign Captain
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="max-h-[60vh] overflow-y-auto overscroll-contain">
            <div className="p-4 space-y-2">
              <p className="text-sm text-muted-foreground mb-2">
                Pick the player who will captain this match.
              </p>

              {goingMembers.map((rsvp: any) => (
                <Button
                  key={rsvp.id}
                  variant="outline"
                  className="w-full justify-start h-auto py-4"
                  onClick={() => {
                    setPendingId(rsvp.user_id);
                    assignMutation.mutate({ userId: rsvp.user_id });
                  }}
                  disabled={assignMutation.isPending}
                >
                  <Avatar className="h-10 w-10 mr-3">
                    <AvatarImage src={rsvp.profiles?.avatar_url || adultAvatar(rsvp.user_id) || undefined} />
                    <AvatarFallback>
                      {(rsvp.profiles?.display_name || adultName(rsvp.user_id))?.charAt(0)?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-base">{rsvp.profiles?.display_name || adultName(rsvp.user_id) || "Unknown"}</span>
                  {assignMutation.isPending && pendingId === rsvp.user_id && (
                    <Loader2 className="h-4 w-4 animate-spin ml-auto" />
                  )}
                </Button>
              ))}

              {goingChildren.map((rsvp: any) => (
                <Button
                  key={rsvp.id}
                  variant="outline"
                  className="w-full justify-start h-auto py-4"
                  onClick={() => {
                    setPendingId(rsvp.child_id);
                    assignMutation.mutate({ childId: rsvp.child_id });
                  }}
                  disabled={assignMutation.isPending}
                >
                  <Avatar className="h-10 w-10 mr-3">
                    <AvatarFallback className="bg-secondary">
                      {rsvp.children?.name?.charAt(0)?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-base">{rsvp.children?.name || "Unknown"}</span>
                  <Badge variant="outline" className="ml-2 text-xs">Child</Badge>
                  {assignMutation.isPending && pendingId === rsvp.child_id && (
                    <Loader2 className="h-4 w-4 animate-spin ml-auto" />
                  )}
                </Button>
              ))}

              {goingMembers.length + goingChildren.length === 0 && (
                <p className="text-center text-muted-foreground py-8">
                  No eligible players found. Only members with the "Player" role and children on the team can be selected.
                </p>
              )}
            </div>
          </div>
          <div className="p-4 border-t">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setSelectDialogOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Captain?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the captain assignment for this match.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeMutation.mutate()}
              className="bg-destructive text-destructive-foreground"
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Remove"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
