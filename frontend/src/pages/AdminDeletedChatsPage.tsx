import { useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RotateCcw, Trash2, Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { PageLoading } from "@/components/ui/page-loading";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";

interface DeletedGroup {
  id: string;
  name: string;
  deleted_at: string;
  deleted_by: string | null;
  created_by: string;
  club_id: string | null;
  team_id: string | null;
  mini_league_id: string | null;
  membership_mode: string;
  deleter_name?: string | null;
  creator_name?: string | null;
  club_name?: string | null;
}

const RETENTION_DAYS = 30;

import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabDeletedChats } from "@/lab/fixtureDataLayer";

export default function AdminDeletedChatsPage() {
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  if (useIcpLab) {
    return <IcpLabAdminDeletedChatsPage />;
  }
  return <SupabaseAdminDeletedChatsPage />;
}

/** Read-only synthetic deleted-chat list; recovery and moderation mutations remain unavailable until messaging_domain is wired here. */
function IcpLabAdminDeletedChatsPage() {
  const navigate = useNavigate();
  const deletedChats = getLocalLabDeletedChats("club-icp-001");

  return (
    <div className="container max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">Deleted Chats</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Showing synthetic ICP lab deleted-conversation records. Recovery and permanent deletion are disabled.
      </p>
      <div className="space-y-2">
        {deletedChats.map((chat) => (
          <Card key={chat.id}>
            <CardContent className="p-4">
              <p className="text-sm font-medium">{chat.conversation_type} conversation</p>
              <p className="text-xs text-muted-foreground">{chat.message_count} messages, deleted by {chat.deleted_by}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SupabaseAdminDeletedChatsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [purgeTarget, setPurgeTarget] = useState<DeletedGroup | null>(null);

  const { data: access, isLoading: checkingAccess } = useQuery({
    queryKey: ["deleted-chats-access", user?.id],
    queryFn: async () => {
      if (!user?.id) return { isAppAdmin: false, clubAdminClubs: [] as string[] };
      const { data } = await supabase
        .from("user_roles")
        .select("role, club_id")
        .eq("user_id", user.id)
        .in("role", ["app_admin", "club_admin"]);
      const rows = data ?? [];
      return {
        isAppAdmin: rows.some((r) => r.role === "app_admin"),
        clubAdminClubs: rows
          .filter((r) => r.role === "club_admin" && r.club_id)
          .map((r) => r.club_id as string),
      };
    },
    enabled: !!user?.id,
  });

  const isAppAdmin = !!access?.isAppAdmin;
  const isClubAdmin = (access?.clubAdminClubs.length ?? 0) > 0;
  const hasAccess = isAppAdmin || isClubAdmin;

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ["admin-deleted-chats"],
    queryFn: async (): Promise<DeletedGroup[]> => {
      // RLS scopes results: app admins see all, club admins see only their clubs
      const { data, error } = await supabase
        .from("chat_groups")
        .select(
          "id,name,deleted_at,deleted_by,created_by,club_id,team_id,mini_league_id,membership_mode"
        )
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false });
      if (error) throw error;

      const rows = (data ?? []) as any as DeletedGroup[];
      const userIds = Array.from(
        new Set(rows.flatMap((r) => [r.deleted_by, r.created_by]).filter(Boolean))
      ) as string[];
      const clubIds = Array.from(new Set(rows.map((r) => r.club_id).filter(Boolean))) as string[];

      const [profilesRes, clubsRes] = await Promise.all([
        userIds.length
          ? selectCachedProfilesByIds(userIds)
          : Promise.resolve({ data: [] as any[] }),
        clubIds.length
          ? supabase.from("clubs").select("id, name").in("id", clubIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const nameMap = new Map<string, string>((profilesRes.data ?? []).map((p: any) => [p.id as string, (p.display_name ?? "") as string]));
      const clubMap = new Map<string, string>(
        (clubsRes.data ?? []).map((c: any): [string, string] => [c.id, c.name]),
      );
      return rows.map((r) => ({
        ...r,
        deleter_name: r.deleted_by ? nameMap.get(r.deleted_by) ?? null : null,
        creator_name: nameMap.get(r.created_by) ?? null,
        club_name: r.club_id ? clubMap.get(r.club_id) ?? null : null,
      }));
    },
    enabled: hasAccess,
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("chat_groups")
        .update({ deleted_at: null, deleted_by: null } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Chat restored");
      queryClient.invalidateQueries({ queryKey: ["admin-deleted-chats"] });
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups"] });
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups-with-messages"] });
    },
    onError: (e: any) => toast.error("Restore failed: " + (e?.message ?? "Unknown error")),
  });

  const purgeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("chat_groups").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Chat permanently deleted");
      setPurgeTarget(null);
      queryClient.invalidateQueries({ queryKey: ["admin-deleted-chats"] });
    },
    onError: (e: any) => toast.error("Delete failed: " + (e?.message ?? "Unknown error")),
  });

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return groups;
    const q = searchQuery.toLowerCase();
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.deleter_name?.toLowerCase().includes(q) ||
        g.creator_name?.toLowerCase().includes(q) ||
        g.club_name?.toLowerCase().includes(q)
    );
  }, [groups, searchQuery]);

  if (checkingAccess) return <PageLoading />;

  if (!hasAccess) {
    return (
      <div className="py-6 space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Deleted chats</h1>
        </div>
        <p className="text-muted-foreground">Access denied. App admin or club admin role required.</p>
      </div>
    );
  }

  const scopeLabel = (g: DeletedGroup) =>
    g.mini_league_id
      ? "Mini-league"
      : g.team_id
      ? "Team"
      : g.club_id
      ? "Club"
      : "Personal";

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Deleted chats</h1>
          <p className="text-sm text-muted-foreground">
            {isAppAdmin
              ? `Restore chats removed by mistake. Items older than ${RETENTION_DAYS} days are eligible for permanent deletion.`
              : "Restore chats from your club that were removed by mistake."}
          </p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name or person..."
          className="pl-9"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">
          {searchQuery ? "No matching chats" : "No deleted chats"}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((g) => {
            const deletedDate = new Date(g.deleted_at);
            const ageDays = Math.floor(
              (Date.now() - deletedDate.getTime()) / (1000 * 60 * 60 * 24)
            );
            const daysLeft = Math.max(0, RETENTION_DAYS - ageDays);
            return (
              <Card key={g.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium truncate">{g.name}</p>
                        <Badge variant="outline" className="text-xs">
                          {scopeLabel(g)}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {g.membership_mode}
                        </Badge>
                        {g.club_name && (
                          <Badge variant="secondary" className="text-xs">
                            {g.club_name}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Deleted {formatDistanceToNow(deletedDate, { addSuffix: true })}
                        {g.deleter_name ? ` by ${g.deleter_name}` : ""} ·{" "}
                        {format(deletedDate, "MMM d, yyyy 'at' h:mm a")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Created by {g.creator_name ?? "Unknown"} ·{" "}
                        {daysLeft > 0
                          ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left in retention`
                          : "Retention expired"}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      className="gap-2"
                      onClick={() => restoreMutation.mutate(g.id)}
                      disabled={restoreMutation.isPending}
                    >
                      <RotateCcw className="h-4 w-4" />
                      Restore
                    </Button>
                    {isAppAdmin && (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="gap-2"
                        onClick={() => setPurgeTarget(g)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete permanently
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog
        open={!!purgeTarget}
        onOpenChange={(open) => !open && setPurgeTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete "{purgeTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The chat group and all of its messages will be
              removed forever.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => purgeTarget && purgeMutation.mutate(purgeTarget.id)}
              disabled={purgeMutation.isPending}
            >
              {purgeMutation.isPending ? "Deleting..." : "Delete forever"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
