import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Hand, Loader2, Plus, X } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds, selectCachedProfileById } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { withFeatureBackend } from "@/live/featureRouter";
import {
  listLiveMatchGoalkeepers,
  setLiveMatchGoalkeeper,
  removeLiveMatchGoalkeeper,
} from "@/live/features/events";

interface Props {
  eventId: string;
  teamId?: string | null;
  isAdmin: boolean;
  rsvps: any[];
}

export default function MatchGoalkeepersSelector({ eventId, teamId, isAdmin, rsvps }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  // events_domain has a per-match goalkeeper-assignment store
  // (set_match_goalkeeper/list_match_goalkeepers/remove_match_goalkeeper,
  // one row per "period" slot); ICP sessions assign a free period slot per
  // keeper the same way Supabase's unordered `match_goalkeepers` rows allow
  // more than one goalkeeper per match.
  const isIcp = resolveAuthBackend() === "icp";
  const effectiveIsAdmin = isAdmin;
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data: keepers = [], isLoading } = useQuery({
    queryKey: ["match-goalkeepers", eventId, (rsvps || []).length],
    queryFn: () => withFeatureBackend("events", {
      supabase: async () => {
        const { data, error } = await supabase
          .from("match_goalkeepers" as any)
          .select(`*`)
          .eq("event_id", eventId);
        if (error) throw error;
        const rows: any[] = data || [];
        const userIds = rows.map((r) => r.user_id).filter(Boolean);
        const childIds = rows.map((r) => r.child_id).filter(Boolean);
        const profileMap = new Map<string, any>();
        const childMap = new Map<string, any>();
        if (userIds.length) {
          const { data: profs } = await selectCachedProfilesByIds(userIds);
          (profs || []).forEach((p: any) => profileMap.set(p.id, p));
        }
        if (childIds.length) {
          const { data: kids } = await supabase
            .from("children")
            .select("id, name")
            .in("id", childIds);
          (kids || []).forEach((c: any) => childMap.set(c.id, c));
        }
        // Fallback to rsvp-embedded child names if RLS blocks direct children read
        (rsvps || []).forEach((r: any) => {
          if (r.child_id && r.children && !childMap.has(r.child_id)) {
            childMap.set(r.child_id, r.children);
          }
        });
        return rows.map((r) => ({
          ...r,
          profiles: r.user_id ? profileMap.get(r.user_id) : null,
          children: r.child_id ? childMap.get(r.child_id) : null,
        }));
      },
      icp: async (ctx) => {
        const rows = await listLiveMatchGoalkeepers(ctx, eventId);
        const result = [];
        for (const row of rows) {
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
          result.push({
            id: `${row.event_id}:${row.period}`,
            event_id: row.event_id,
            period: row.period,
            user_id: isChild ? null : row.ref_id,
            child_id: isChild ? row.ref_id : null,
            profiles: profile,
            children,
          });
        }
        return result;
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

  const nextFreePeriod = () => {
    const used = new Set(keepers.map((k: any) => k.period).filter(Boolean));
    let n = 1;
    while (used.has(String(n))) n += 1;
    return String(n);
  };

  const addMutation = useMutation({
    mutationFn: async ({ userId, childId }: { userId?: string; childId?: string }) => {
      await withFeatureBackend("events", {
        supabase: async () => {
          const { error } = await supabase.from("match_goalkeepers" as any).insert({
            event_id: eventId,
            user_id: userId || null,
            child_id: childId || null,
            assigned_by: user!.id,
          } as any);
          if (error) throw error;
        },
        icp: async (ctx) => {
          const refKind = userId ? "account" : "child";
          const refId = (userId || childId)!;
          await setLiveMatchGoalkeeper(ctx, eventId, refKind, refId, nextFreePeriod());
        },
      }, { eventId: eventId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["match-goalkeepers", eventId] });
      setPendingId(null);
      toast({ title: "Goalkeeper added 🧤" });
    },
    onError: (e: Error) => {
      setPendingId(null);
      toast({ title: e.message || "Failed to add goalkeeper", variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (row: any) => {
      await withFeatureBackend("events", {
        supabase: async () => {
          const { error } = await supabase.from("match_goalkeepers" as any).delete().eq("id", row.id);
          if (error) throw error;
        },
        icp: async (ctx) => {
          await removeLiveMatchGoalkeeper(ctx, eventId, row.period);
        },
      }, { eventId: eventId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["match-goalkeepers", eventId] });
      toast({ title: "Goalkeeper removed" });
    },
  });

  const goingPlayers = (rsvps || []).filter((r) => r.status === "going");
  const goingChildren = goingPlayers.filter((r) => r.child_id);
  const goingMembers = goingPlayers.filter(
    (r) => !r.child_id && r.user_id && (isIcp || playerUserIds.includes(r.user_id))
  );

  const assignedUserIds = new Set(keepers.filter((k: any) => k.user_id).map((k: any) => k.user_id));
  const assignedChildIds = new Set(keepers.filter((k: any) => k.child_id).map((k: any) => k.child_id));

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Hand className="h-5 w-5 text-emerald-500" />
            Goalkeeper{keepers.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          {keepers.length > 0 ? (
            <div className="space-y-2">
              {keepers.map((k: any) => (
                <div key={k.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9 ring-2 ring-emerald-500">
                      {k.profiles?.avatar_url && <AvatarImage src={k.profiles.avatar_url} />}
                      <AvatarFallback className="bg-emerald-500/20 text-emerald-700">
                        {(k.profiles?.display_name || k.children?.name || "?").charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">
                        {k.profiles?.display_name || k.children?.name}
                      </span>
                    </div>
                  </div>
                  {effectiveIsAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive h-8 w-8"
                      onClick={() => removeMutation.mutate(k)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            !effectiveIsAdmin && (
              <p className="text-sm text-muted-foreground">No goalkeeper recorded</p>
            )
          )}

          {effectiveIsAdmin && (
            <Button
              variant="outline"
              className="w-full border-emerald-500/50 text-emerald-700 hover:bg-emerald-500/10"
              onClick={() => setOpen(true)}
              disabled={goingPlayers.length === 0}
            >
              <Plus className="h-4 w-4 mr-2" />
              {keepers.length > 0 ? "Add another goalkeeper" : "Mark goalkeeper"}
            </Button>
          )}
        </CardContent>
      </Card>

      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader className="text-left border-b pb-4">
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <Hand className="h-5 w-5 text-emerald-500" />
              Mark goalkeeper
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="max-h-[60vh] overflow-y-auto overscroll-contain">
            <div className="p-4 space-y-2">
              <p className="text-sm text-muted-foreground mb-2">
                Pick the player(s) who played in goal during this match.
              </p>

              {goingMembers.map((rsvp: any) => {
                const already = assignedUserIds.has(rsvp.user_id);
                const isPending = addMutation.isPending && pendingId === rsvp.user_id;
                return (
                  <Button
                    key={rsvp.id}
                    variant="outline"
                    className="w-full justify-start h-auto py-3"
                    disabled={already || addMutation.isPending}
                    onClick={async () => {
                      setPendingId(rsvp.user_id);
                      await addMutation.mutateAsync({ userId: rsvp.user_id });
                    }}
                  >
                    <Avatar className="h-9 w-9 mr-3">
                      <AvatarImage src={rsvp.profiles?.avatar_url} />
                      <AvatarFallback>
                        {rsvp.profiles?.display_name?.charAt(0)?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{rsvp.profiles?.display_name || "Unknown"}</span>
                    {isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin ml-auto" />
                    ) : already ? (
                      <Badge className="ml-auto" variant="secondary">Added</Badge>
                    ) : null}
                  </Button>
                );
              })}

              {goingChildren.map((rsvp: any) => {
                const already = assignedChildIds.has(rsvp.child_id);
                const isPending = addMutation.isPending && pendingId === rsvp.child_id;
                return (
                  <Button
                    key={rsvp.id}
                    variant="outline"
                    className="w-full justify-start h-auto py-3"
                    disabled={already || addMutation.isPending}
                    onClick={async () => {
                      setPendingId(rsvp.child_id);
                      await addMutation.mutateAsync({ childId: rsvp.child_id });
                    }}
                  >
                    <Avatar className="h-9 w-9 mr-3">
                      <AvatarFallback className="bg-secondary">
                        {rsvp.children?.name?.charAt(0)?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{rsvp.children?.name || "Unknown"}</span>
                    <Badge variant="outline" className="ml-2 text-xs">Child</Badge>
                    {isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin ml-auto" />
                    ) : already ? (
                      <Badge className="ml-auto" variant="secondary">Added</Badge>
                    ) : null}
                  </Button>
                );
              })}

              {goingMembers.length === 0 && goingChildren.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No players RSVP'd as "Going" yet.
                </p>
              )}
            </div>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
