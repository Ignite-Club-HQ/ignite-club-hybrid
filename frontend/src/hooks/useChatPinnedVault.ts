import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type PinnedVaultChatType = "team" | "club" | "group";

export interface PinnedVaultTarget {
  vault_file_id?: string | null;
  vault_folder_id?: string | null;
  root_scope?: "team" | "club" | null;
  root_id?: string | null;
}

export interface PinnedVaultRecord extends PinnedVaultTarget {
  id: string;
  chat_type: PinnedVaultChatType;
  chat_id: string;
  enabled: boolean;
  set_by: string;
  updated_at: string;
}

export function pinnedVaultKey(chatType: PinnedVaultChatType, chatId: string) {
  return ["chat-pinned-vault", chatType, chatId] as const;
}

export function useChatPinnedVault(
  chatType: PinnedVaultChatType,
  chatId: string | undefined,
  options?: { enabled?: boolean; subscribe?: boolean },
) {
  const qc = useQueryClient();
  const enabledOpt = options?.enabled ?? true;
  // Owns the realtime channel. Default true preserves existing behaviour for
  // page-level consumers; secondary consumers (e.g. PinVaultSheet) pass false
  // to avoid a duplicate channel-name collision when both mount simultaneously.
  const subscribeOpt = options?.subscribe ?? true;

  const query = useQuery({
    queryKey: pinnedVaultKey(chatType, chatId ?? ""),
    enabled: enabledOpt && !!chatId,
    queryFn: async (): Promise<PinnedVaultRecord | null> => {
      if (!chatId) return null;
      const { data, error } = await supabase
        .from("chat_pinned_vault")
        .select("*")
        .eq("chat_type", chatType)
        .eq("chat_id", chatId)
        .maybeSingle();
      if (error) throw error;
      return (data as PinnedVaultRecord | null) ?? null;
    },
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    if (!chatId || !enabledOpt || !subscribeOpt) return;
    const channel = supabase
      .channel(`chat-pinned-vault-${chatType}-${chatId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_pinned_vault",
          filter: `chat_id=eq.${chatId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: pinnedVaultKey(chatType, chatId) });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatType, chatId, qc, enabledOpt, subscribeOpt]);

  const save = useMutation({
    mutationFn: async (input: PinnedVaultTarget & { enabled?: boolean }) => {
      if (!chatId) throw new Error("Missing chat id");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const row = {
        chat_type: chatType,
        chat_id: chatId,
        vault_file_id: input.vault_file_id ?? null,
        vault_folder_id: input.vault_folder_id ?? null,
        root_scope: input.root_scope ?? null,
        root_id: input.root_id ?? null,
        enabled: input.enabled ?? false,
        set_by: user.id,
      };

      const { error } = await supabase
        .from("chat_pinned_vault")
        .upsert(row, { onConflict: "chat_type,chat_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pinnedVaultKey(chatType, chatId ?? "") });
      toast.success("Pinned vault updated");
    },
    onError: (err: any) => {
      toast.error("Couldn't pin vault", { description: err?.message });
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!chatId) throw new Error("Missing chat id");
      const { error } = await supabase
        .from("chat_pinned_vault")
        .update({ enabled })
        .eq("chat_type", chatType)
        .eq("chat_id", chatId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pinnedVaultKey(chatType, chatId ?? "") });
    },
    onError: (err: any) => {
      toast.error("Couldn't update pinned vault", { description: err?.message });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!chatId) throw new Error("Missing chat id");
      const { error } = await supabase
        .from("chat_pinned_vault")
        .delete()
        .eq("chat_type", chatType)
        .eq("chat_id", chatId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pinnedVaultKey(chatType, chatId ?? "") });
      toast.success("Pinned vault removed");
    },
    onError: (err: any) => {
      toast.error("Couldn't remove pinned vault", { description: err?.message });
    },
  });

  return {
    record: query.data ?? null,
    isLoading: query.isLoading,
    save: save.mutate,
    isSaving: save.isPending,
    toggleEnabled: toggleEnabled.mutate,
    remove: remove.mutate,
  };
}
