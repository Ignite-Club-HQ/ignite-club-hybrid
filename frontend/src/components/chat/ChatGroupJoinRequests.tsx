import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface ChatGroupJoinRequestsProps {
  groupId: string;
  enabled?: boolean;
}

/**
 * Visible to existing members of an Operations/Volunteers chat group.
 * Lists pending join requests with approve/reject actions. RLS scopes the
 * underlying SELECT to group members only.
 */
export function ChatGroupJoinRequests({ groupId, enabled = true }: ChatGroupJoinRequestsProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["chat-group-join-requests", groupId],
    enabled: enabled && !!user?.id && !!groupId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_group_join_requests" as any)
        .select("id, user_id, message, created_at")
        .eq("group_id", groupId)
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as any[];
      if (rows.length === 0) return [] as any[];
      const userIds = rows.map((r) => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", userIds);
      const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      return rows.map((r) => ({ ...r, profile: byId.get(r.user_id) || null }));
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["chat-group-join-requests", groupId] });
    queryClient.invalidateQueries({ queryKey: ["group-members", groupId] });
    queryClient.invalidateQueries({ queryKey: ["chat-participants"] });
  };

  const approveMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await (supabase as any).rpc("approve_chat_group_join_request", {
        _request_id: requestId,
      });
      if (error) throw error;
      // Notify the requester (in-app + push). Best-effort; never block UI.
      await supabase.functions
        .invoke("notify-join-request-decision", {
          body: { requestId, decision: "approved" },
        })
        .catch((e) => console.warn("[join-request] notify failed", e));
    },
    onSuccess: () => {
      toast.success("Request approved");
      invalidate();
    },
    onError: (err: any) => toast.error(err?.message ?? "Could not approve"),
  });

  const rejectMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await (supabase as any).rpc("reject_chat_group_join_request", {
        _request_id: requestId,
      });
      if (error) throw error;
      await supabase.functions
        .invoke("notify-join-request-decision", {
          body: { requestId, decision: "rejected" },
        })
        .catch((e) => console.warn("[join-request] notify failed", e));
    },
    onSuccess: () => {
      toast.success("Request rejected");
      invalidate();
    },
    onError: (err: any) => toast.error(err?.message ?? "Could not reject"),
  });

  if (isLoading || requests.length === 0) return null;

  return (
    <div className="px-3 py-2 border-b border-border/40">
      <div className="flex items-center gap-1.5 mb-2">
        <UserPlus className="h-3.5 w-3.5 text-primary" />
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Pending requests · {requests.length}
        </h4>
      </div>
      <ul className="space-y-1.5">
        {requests.map((r: any) => {
          const name = r.profile?.full_name || "Member";
          const initials = name.slice(0, 2).toUpperCase();
          const busy = approveMutation.isPending || rejectMutation.isPending;
          return (
            <li
              key={r.id}
              className="flex items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5"
            >
              <Avatar className="h-8 w-8 shrink-0">
                {r.profile?.avatar_url && <AvatarImage src={r.profile.avatar_url} alt={name} />}
                <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium truncate">{name}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  Requested {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-destructive hover:bg-destructive/10"
                disabled={busy}
                onClick={() => rejectMutation.mutate(r.id)}
                aria-label="Reject request"
              >
                <X className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="default"
                className="h-7 w-7"
                disabled={busy}
                onClick={() => approveMutation.mutate(r.id)}
                aria-label="Approve request"
              >
                {approveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
