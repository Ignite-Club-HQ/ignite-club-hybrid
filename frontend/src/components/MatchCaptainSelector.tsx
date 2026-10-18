import { useState } from "react";
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
import { resolveAuthBackend } from "@/live/authBackendMode";
import { withFeatureBackend } from "@/live/featureRouter";
import {
  listLiveMatchCaptains,
  setLiveMatchCaptain,
  removeLiveMatchCaptain,
} from "@/live/features/events";

interface MatchCaptainSelectorProps {
  eventId: string;
  teamId?: string | null;
  isAdmin: boolean;
  rsvps: any[];
}

export default function MatchCaptainSelector({
  eventId,
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
  const isIcp = resolveAuthBackend() === "icp";
  const effectiveIsAdmin = isAdmin;
  const [selectDialogOpen, setSelectDialogOpen] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data: captain, isLoading } = useQuery({
    queryKey: ["match-captain", eventId],
    queryFn: () => withFeatureBackend("events", {
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
          const { data: kid } = await supabase.from("children").select("id, name").eq("id", row.ref_id).maybeSingle();
          children = kid;
        } else {
          const { data: profileData } = await selectCachedProfileById(row.ref_id);
          profile = profileData;
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
    }, { eventId: eventId }),
  });

  const { data: playerUserIds = [] } = useQuery({
    queryKey: ["team-player-user-ids", teamId],
    queryFn: async () => {
      if (!teamId) return [] as string[];
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("team_id", teamId)
        .eq("role", "player");
      if (error) throw error;
      return (data || []).map((r: any) => r.user_id);
    },
    enabled: !!teamId && !isIcp,
  });

  const { data: seasonCaptain, isLoading: isSeasonCaptainLoading } = useQuery({
    queryKey: ["team-season-captain", teamId, isIcp],
    enabled: !!teamId,
    queryFn: async () => withFeatureBackend("membership", {
      supabase: async () => {
        const { data, error } = await supabase
          .from("team_captains")
          .select("user_id")
          .eq("team_id", teamId!)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (!data?.user_id) return null;
        const { data: profile } = await selectCachedProfileById(data.user_id);
        return { user_id: data.user_id, profiles: profile, isSeasonCaptain: true };
      },
      icp: async (ctx) => {
        const [{ listLiveTeamCaptains }, { listLiveProfilesByIds }] = await Promise.all([
          import("@/live/features/club"),
          import("@/live/features/identityAccessClient"),
        ]);
        const captains = await listLiveTeamCaptains(ctx, teamId!);
        const principal = captains[0]?.user?.toText?.() ?? String(captains[0]?.user ?? "");
        if (!principal) return null;
        const [profile] = await listLiveProfilesByIds(ctx, [principal]);
        return {
          user_id: principal,
          profiles: profile ? { display_name: profile.display_name, avatar_url: profile.avatar_ref?.[0] ?? null } : null,
          isSeasonCaptain: true,
        };
      },
    }, { teamId: teamId! }),
  });

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
            assigned_by: user!.id,
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
          const refId = (userId || childId)!;
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
    (r) => !r.child_id && r.user_id && playerUserIds.includes(r.user_id)
  );

  if (isLoading || isSeasonCaptainLoading) {
    return (
      <Card>
        <CardContent className="p-4 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const displayedCaptain = captain ?? seasonCaptain;

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
          {displayedCaptain ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10 ring-2 ring-blue-500">
                  {displayedCaptain.profiles?.avatar_url && (
                    <AvatarImage src={displayedCaptain.profiles.avatar_url} />
                  )}
                  <AvatarFallback className="bg-blue-500/20 text-blue-600">
                    {(displayedCaptain.profiles?.display_name || displayedCaptain.children?.name || "?")
                      .charAt(0)
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">
                    {displayedCaptain.profiles?.display_name || displayedCaptain.children?.name || "Team captain"}
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
                    <AvatarImage src={rsvp.profiles?.avatar_url} />
                    <AvatarFallback>
                      {rsvp.profiles?.display_name?.charAt(0)?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-base">{rsvp.profiles?.display_name || "Unknown"}</span>
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
