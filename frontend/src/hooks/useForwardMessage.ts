import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfileById } from "@/lib/profileCache";
import { toast } from "sonner";

/** A chat group the current user can forward INTO. */
export interface ForwardDestinationGroup {
  id: string;
  name: string;
  club_id: string | null;
  team_id: string | null;
  club_name?: string | null;
}

/**
 * Lists all chat_groups the current user is a member of, sorted by name.
 * Used as forward-message destinations. v1 supports group chats only.
 */
export function useForwardDestinations(userId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["forward-destinations", userId],
    enabled: !!userId && enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<ForwardDestinationGroup[]> => {
      // 1) membership → group ids
      const { data: memberships, error: memErr } = await supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", userId!);
      if (memErr) throw memErr;
      const ids = (memberships ?? []).map((m) => m.group_id);
      if (ids.length === 0) return [];

      // 2) live group rows (filter deleted + closed-to-forwarding + personal groups)
      const { data: groups, error: gErr } = await supabase
        .from("chat_groups")
        .select("id, name, club_id, team_id, deleted_at")
        .in("id", ids)
        .is("deleted_at", null)
        .not("club_id", "is", null);
      if (gErr) throw gErr;

      const clubIds = Array.from(
        new Set((groups ?? []).map((g) => g.club_id).filter(Boolean) as string[]),
      );
      let clubMap = new Map<string, string>();
      if (clubIds.length > 0) {
        const { data: clubs } = await supabase
          .from("clubs")
          .select("id, name")
          .in("id", clubIds);
        clubMap = new Map((clubs ?? []).map((c) => [c.id, c.name as string]));
      }

      return (groups ?? [])
        .map((g) => ({
          id: g.id,
          name: g.name,
          club_id: g.club_id,
          team_id: g.team_id,
          club_name: g.club_id ? (clubMap.get(g.club_id) ?? null) : null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

export interface ForwardSourceMessage {
  text: string;
  imageUrl?: string | null;
  /** Original author id (preserved on forwarded copies). */
  authorId: string;
  /** Optional short label such as "Committee" — shown above the forwarded copy. */
  sourceLabel?: string | null;
}

/**
 * Forwards a single source message into the selected chat groups by
 * creating a fresh row in group_messages per destination, stamping the
 * forwarded_* attribution columns. Same-author / same-image: the storage
 * URL is reused (chat-attachments are publicly addressable).
 *
 * v1: group chat destinations only.
 */
export function useForwardMessageMutation(currentUserId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      source: ForwardSourceMessage;
      destinationGroupIds: string[];
    }) => {
      if (!currentUserId) throw new Error("Not signed in");
      const { source, destinationGroupIds } = args;
      if (destinationGroupIds.length === 0) return { forwarded: 0 };

      const now = new Date().toISOString();
      const rows = destinationGroupIds.map((groupId) => ({
        group_id: groupId,
        author_id: currentUserId,
        text: source.text ?? "",
        image_url: source.imageUrl ?? null,
        forwarded_from_user_id: source.authorId,
        forwarded_at: now,
        forwarded_source_label: source.sourceLabel ?? null,
      }));

      const { data: inserted, error } = await supabase
        .from("group_messages")
        .insert(rows)
        .select("id, group_id");
      if (error) throw error;

      // Notify the original author (best-effort, never blocks success).
      if (source.authorId && source.authorId !== currentUserId) {
        try {
          const [{ data: forwarder }, { data: groups }] = await Promise.all([
            selectCachedProfileById(currentUserId),
            supabase.from("chat_groups").select("id, name, club_id").in("id", destinationGroupIds),
          ]);
          const forwarderName = forwarder?.display_name?.trim() || "Someone";
          const groupMap = new Map((groups ?? []).map((g) => [g.id, g]));
          const preview = (source.text || "").trim().slice(0, 60) || (source.imageUrl ? "a photo" : "your message");

          const notificationRows = (inserted ?? []).map((m) => {
            const g = groupMap.get(m.group_id);
            return {
              user_id: source.authorId,
              type: "message_forwarded",
              message: `${forwarderName} forwarded your message "${preview}" to ${g?.name ?? "a group chat"}`,
              related_id: m.id,
              club_id: g?.club_id ?? null,
            };
          });
          if (notificationRows.length > 0) {
            await supabase.from("notifications").insert(notificationRows);
          }
        } catch (e) {
          // Non-fatal — author just won't get a forward notification
          console.warn("[forward] failed to notify original author", e);
        }
      }

      return { forwarded: destinationGroupIds.length };
    },
    onSuccess: ({ forwarded }) => {
      toast.success(
        forwarded === 1
          ? "Message forwarded"
          : `Forwarded to ${forwarded} chats`,
      );
      // Invalidate group message caches so destination chats refresh if open.
      queryClient.invalidateQueries({ queryKey: ["group-messages"] });
      queryClient.invalidateQueries({ queryKey: ["messages-page-inbox"] });
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups-with-messages"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to forward message");
    },
  });
}
