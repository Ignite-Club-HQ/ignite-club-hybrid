import { useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { toast } from "sonner";

export type PinnedChatType = "team" | "club" | "group" | "dm";

export interface PinnedMessageRecord {
  id: string;
  message_id: string;
  pinned_by: string;
  created_at: string;
}

export interface PinnedMessageWithContent extends PinnedMessageRecord {
  text: string | null;
  image_url: string | null;
  author_id: string;
  author_name: string | null;
  author_avatar: string | null;
}

const MESSAGE_TABLE: Record<PinnedChatType, "team_messages" | "club_messages" | "group_messages" | "direct_messages"> = {
  team: "team_messages",
  club: "club_messages",
  group: "group_messages",
  dm: "direct_messages",
};

export const PIN_LIMIT = 3;

export function pinnedQueryKey(chatType: PinnedChatType, chatId: string) {
  return ["pinned-messages", chatType, chatId] as const;
}

export function usePinnedMessages(
  chatType: PinnedChatType,
  chatId: string | undefined,
  options?: { enabled?: boolean },
) {
  const queryClient = useQueryClient();
  const enabledOpt = options?.enabled ?? true;

  const query = useQuery({
    queryKey: pinnedQueryKey(chatType, chatId ?? ""),
    enabled: enabledOpt && !!chatId,
    queryFn: async (): Promise<PinnedMessageWithContent[]> => {
      if (!chatId) return [];

      const { data: pins, error } = await supabase
        .from("pinned_messages")
        .select("id, message_id, pinned_by, created_at")
        .eq("chat_type", chatType)
        .eq("chat_id", chatId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      if (!pins || pins.length === 0) return [];

      const messageIds = pins.map((p) => p.message_id);
      const table = MESSAGE_TABLE[chatType];

      const { data: messages } = await supabase
        .from(table)
        .select("id, text, image_url, author_id, deleted_at")
        .in("id", messageIds);

      const messageMap = new Map((messages ?? []).map((m: any) => [m.id, m]));

      const authorIds = Array.from(
        new Set(
          (messages ?? [])
            .map((m: any) => m.author_id)
            .filter((v): v is string => !!v),
        ),
      );

      const { data: profiles } = authorIds.length
        ? await selectCachedProfilesByIds(authorIds)
        : { data: [] as any[] };

      const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

      return pins
        .map((pin) => {
          const msg = messageMap.get(pin.message_id) as any;
          if (!msg || msg.deleted_at) return null;
          const profile = profileMap.get(msg.author_id) as any;
          return {
            ...pin,
            text: msg.text ?? null,
            image_url: msg.image_url ?? null,
            author_id: msg.author_id,
            author_name: profile?.display_name ?? null,
            author_avatar: profile?.avatar_url ?? null,
          } satisfies PinnedMessageWithContent;
        })
        .filter((p): p is PinnedMessageWithContent => p !== null);
    },
  });

  // Realtime subscription
  useEffect(() => {
    if (!chatId) return;
    const channel = supabase
      .channel(`pinned-${chatType}-${chatId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pinned_messages",
          filter: `chat_id=eq.${chatId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: pinnedQueryKey(chatType, chatId) });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatType, chatId, queryClient]);

  const pins = query.data ?? [];

  const pinnedMessageIds = useMemo(
    () => new Set(pins.map((p) => p.message_id)),
    [pins],
  );

  const pin = useMutation({
    mutationFn: async (messageId: string) => {
      if (!chatId) throw new Error("Missing chat id");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from("pinned_messages").insert({
        chat_type: chatType,
        chat_id: chatId,
        message_id: messageId,
        pinned_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Message pinned");
      queryClient.invalidateQueries({ queryKey: pinnedQueryKey(chatType, chatId ?? "") });
    },
    onError: (err: any) => {
      const msg = err?.message ?? "";
      if (msg.includes("Pin limit") || msg.includes("at most 3")) {
        toast.error("Pin limit reached", {
          description: "Unpin a message before pinning a new one (max 3).",
        });
      } else if (msg.includes("duplicate") || err?.code === "23505") {
        toast.info("This message is already pinned");
      } else {
        toast.error("Couldn't pin message", { description: msg });
      }
    },
  });

  const unpin = useMutation({
    mutationFn: async (messageId: string) => {
      if (!chatId) throw new Error("Missing chat id");
      const { error } = await supabase
        .from("pinned_messages")
        .delete()
        .eq("chat_type", chatType)
        .eq("chat_id", chatId)
        .eq("message_id", messageId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Message unpinned");
      queryClient.invalidateQueries({ queryKey: pinnedQueryKey(chatType, chatId ?? "") });
    },
    onError: (err: any) => {
      toast.error("Couldn't unpin message", { description: err?.message });
    },
  });

  return {
    pins,
    pinnedMessageIds,
    isLoading: query.isLoading,
    pin: pin.mutate,
    unpin: unpin.mutate,
    isPinning: pin.isPending,
    isUnpinning: unpin.isPending,
    canPinMore: pins.length < PIN_LIMIT,
  };
}
