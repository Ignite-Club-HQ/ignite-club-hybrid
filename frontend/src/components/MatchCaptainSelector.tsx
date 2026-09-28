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
  const [selectDialogOpen, setSelectDialogOpen] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data: captain, isLoading } = useQuery({
    queryKey: ["match-captain", eventId],
    queryFn: async () => {
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
    enabled: !!teamId,
  });

  const assignMutation = useMutation({
    mutationFn: async ({ userId, childId }: { userId?: string; childId?: string }) => {
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
      const { error } = await supabase
        .from("match_captains")
        .delete()
        .eq("id", captain.id);
      if (error) throw error;
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
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-5 w-5 text-blue-500" />
            Captain
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {captain ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10 ring-2 ring-blue-500">
                  {captain.profiles?.avatar_url && (
                    <AvatarImage src={captain.profiles.avatar_url} />
                  )}
                  <AvatarFallback className="bg-blue-500/20 text-blue-600">
                    {(captain.profiles?.display_name || captain.children?.name || "?")
                      .charAt(0)
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">
                    {captain.profiles?.display_name || captain.children?.name}
                  </span>
                </div>
              </div>
              {isAdmin && (
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
          ) : isAdmin ? (
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
