import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X, Loader2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import type { Database } from "@/integrations/supabase/types";
import { defaultRsvpAudienceForTeam } from "@/lib/teamAgeDefaults";
import { withFeatureBackend } from "@/live/featureRouter";
import { approveLiveTeamCreationRequest, listLiveTeamCreationRequests, rejectLiveTeamCreationRequest } from "@/live/features/club";

type AppRole = Database["public"]["Enums"]["app_role"];

interface PendingTeamRequestsProps {
  clubId: string;
}

export function PendingTeamRequests({ clubId }: PendingTeamRequestsProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["team-creation-requests", clubId],
    queryFn: async () =>
      withFeatureBackend("membership", {
        icp: async (ctx) => {
          const live = await listLiveTeamCreationRequests(ctx, clubId);
          return live
            .filter((r) => r.status === "pending")
            .sort((a, b) => Number(b.created_at_ms - a.created_at_ms))
            .map((r) => ({
              id: r.id,
              club_id: r.club_id,
              name: r.name,
              status: r.status,
              requested_by: r.requested_by.toText(),
              created_at: new Date(Number(r.created_at_ms)).toISOString(),
              level_age: r.age_group[0] ?? null,
              // Fields the canister record does not carry stay empty; the
              // ICP approve path only flips status (see mutation below).
              description: null as string | null,
              logo_url: null as string | null,
              team_type: null as string | null,
              folder_id: null as string | null,
              class_day: null as string | null,
              class_time: null as string | null,
              class_duration_minutes: null as number | null,
              class_capacity: null as number | null,
              requester: undefined as { display_name: string | null } | undefined,
            }));
        },
        supabase: async () => {
      const { data, error } = await supabase
        .from("team_creation_requests")
        .select("*")
        .eq("club_id", clubId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Fetch requester profiles
      if (!data || data.length === 0) return [];
      const requestRows = data as Database["public"]["Tables"]["team_creation_requests"]["Row"][];
      const userIds = [...new Set(requestRows.map(r => r.requested_by))];
      const { data: profiles } = await selectCachedProfilesByIds(userIds);

      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
      return requestRows.map(r => ({
        ...r,
        requester: profileMap.get(r.requested_by),
      }));
        },
      }),
    enabled: !!clubId,
  });

  const approveMutation = useMutation({
    mutationFn: async (request: (typeof requests)[0]) =>
      withFeatureBackend("membership", {
        icp: async (ctx) => {
          // NEEDS-CANISTER: team creation and role grant still have no
          // canister counterpart. Notification is best-effort.
          await approveLiveTeamCreationRequest(ctx, request.id);
          try {
            const { fanOutLiveNotifications } = await import("@/live/features/notifications");
            await fanOutLiveNotifications(ctx, {
              userIds: [request.requested_by],
              clubId,
              kind: "team_approved",
              body: `Your team "${request.name}" has been approved!`,
              idempotencyKeyPrefix: `team-approval-${request.id}-${Date.now()}`,
              // No teamId available yet as team creation is not canister-side
              relatedId: clubId, 
            });
          } catch (e) {
            console.error("Failed to send ICP notification:", e);
          }
        },
        supabase: async () => {
      // Create the team
      const { data: team, error: teamError } = await supabase
        .from("teams")
        .insert({
          name: request.name,
          club_id: clubId,
          level_age: request.level_age,
          description: request.description,
          logo_url: request.logo_url,
          team_type: request.team_type || "mixed",
          folder_id: request.folder_id,
          created_by: request.requested_by,
          default_rsvp_audience: defaultRsvpAudienceForTeam(request.name, request.level_age),
          ...(request.class_day ? {
            class_day: request.class_day,
            class_time: request.class_time,
            class_duration_minutes: request.class_duration_minutes,
            class_capacity: request.class_capacity,
          } : {}),
        })
        .select()
        .single();

      if (teamError) throw teamError;

      // Assign requester as team_admin
      await supabase.from("user_roles").insert({
        user_id: request.requested_by,
        role: "team_admin" as AppRole,
        club_id: clubId,
        team_id: team.id,
      });

      // Mark request as approved
      await supabase
        .from("team_creation_requests")
        .update({
          status: "approved",
          reviewed_by: user!.id,
          reviewed_at: new Date().toISOString(),
        } as any)
        .eq("id", request.id);

      // Create notification
      await supabase.from("notifications").insert({
        user_id: request.requested_by,
        type: "team_approved",
        message: `Your team "${request.name}" has been approved!`,
        related_id: team.id,
      });

        },
      }),
    onSuccess: (_team, request) => {
      toast({
        title: "Team Approved!",
        description: `"${request.name}" has been created and ${request.requester?.display_name || 'the requester'} assigned as admin.`,
      });
      queryClient.invalidateQueries({ queryKey: ["team-creation-requests", clubId] });
      queryClient.invalidateQueries({ queryKey: ["club-teams", clubId] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to approve team request. Please try again.",
        variant: "destructive",
      });
      console.error("Approve error:", error);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ requestId, reason }: { requestId: string; reason: string }) =>
      withFeatureBackend("membership", {
        icp: async (ctx) => {
          // NEEDS-CANISTER: rejection + notification has no club_domain counterpart yet
          // beyond flipping the request's status.
          await rejectLiveTeamCreationRequest(ctx, requestId);
        },
        supabase: async () => {
          const request = requests.find(r => r.id === requestId);

          await supabase
            .from("team_creation_requests")
            .update({
              status: "rejected",
              rejection_reason: reason || null,
              reviewed_by: user!.id,
              reviewed_at: new Date().toISOString(),
            } as any)
            .eq("id", requestId);

          if (request) {
            await supabase.from("notifications").insert({
              user_id: request.requested_by,
              type: "team_rejected",
              message: `Your team request "${request.name}" was declined.${reason ? ` Reason: ${reason}` : ''}`,
            });
          }
        },
      }),
    onSuccess: () => {
      toast({ title: "Request declined" });
      setRejectingId(null);
      setRejectionReason("");
      queryClient.invalidateQueries({ queryKey: ["team-creation-requests", clubId] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to decline request.", variant: "destructive" });
    },
  });

  if (isLoading || requests.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-semibold">Pending Team Requests</h3>
        <Badge variant="secondary" className="text-xs">{requests.length}</Badge>
      </div>

      {requests.map((request) => (
        <Card key={request.id} className="overflow-hidden border-amber-500/30">
          <CardContent className="p-3 space-y-3">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10 shrink-0">
                <AvatarImage src={request.logo_url || undefined} />
                <AvatarFallback className="bg-primary/10 text-primary text-sm">
                  {request.name.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{request.name}</p>
                <p className="text-xs text-muted-foreground">
                  Requested by {request.requester?.display_name || "Unknown"}
                  {request.level_age && ` · ${request.level_age}`}
                  {request.team_type && ` · ${request.team_type}`}
                </p>
              </div>
            </div>

            {request.description && (
              <p className="text-xs text-muted-foreground line-clamp-2">{request.description}</p>
            )}

            {rejectingId === request.id ? (
              <div className="space-y-2">
                <Textarea
                  placeholder="Reason for declining (optional)"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows={2}
                  className="text-sm"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    className="flex-1"
                    onClick={() => rejectMutation.mutate({ requestId: request.id, reason: rejectionReason })}
                    disabled={rejectMutation.isPending}
                  >
                    {rejectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm Decline"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setRejectingId(null); setRejectionReason(""); }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => approveMutation.mutate(request)}
                  disabled={approveMutation.isPending}
                >
                  {approveMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Check className="h-4 w-4 mr-1" />
                      Approve
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRejectingId(request.id)}
                >
                  <X className="h-4 w-4 mr-1" />
                  Decline
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
