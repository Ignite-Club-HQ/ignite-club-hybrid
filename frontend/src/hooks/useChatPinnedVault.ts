import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { withFeatureBackend } from "@/live/featureRouter";
import {
  getLivePinnedVault,
  setLivePinnedVault,
  clearLivePinnedVault,
  type LivePinnedVault,
} from "@/live/features/vault";
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

function livePinToRecord(pin: LivePinnedVault): PinnedVaultRecord {
  return {
    id: `${pin.chat_type}:${pin.chat_id}`,
    chat_type: pin.chat_type as PinnedVaultChatType,
    chat_id: pin.chat_id,
    vault_file_id: pin.vault_file_id.length ? pin.vault_file_id[0] : null,
    vault_folder_id: pin.vault_folder_id.length ? pin.vault_folder_id[0] : null,
    root_scope: (pin.root_scope.length ? pin.root_scope[0] : null) as "team" | "club" | null,
    root_id: pin.root_id.length ? pin.root_id[0] : null,
    enabled: pin.enabled,
    set_by: pin.set_by.toText(),
    updated_at: new Date(Number(pin.updated_at_ms)).toISOString(),
  };
}

export function useChatPinnedVault(
  chatType: PinnedVaultChatType,
  chatId: string | undefined,
  options?: { enabled?: boolean; subscribe?: boolean; clubId?: string | null },
) {
  const qc = useQueryClient();
  const enabledOpt = options?.enabled ?? true;
  // Owns the realtime channel. Default true preserves existing behaviour for
  // page-level consumers; secondary consumers (e.g. PinVaultSheet) pass false
  // to avoid a duplicate channel-name collision when both mount simultaneously.
  const subscribeOpt = options?.subscribe ?? true;
  const clubIdOpt = options?.clubId ?? null;

  const query = useQuery({
    queryKey: pinnedVaultKey(chatType, chatId ?? ""),
    enabled: enabledOpt && !!chatId,
    queryFn: async (): Promise<PinnedVaultRecord | null> => {
      if (!chatId) return null;
      return withFeatureBackend("vault", {
        supabase: async () => {
          const { data, error } = await supabase
            .from("chat_pinned_vault")
            .select("*")
            .eq("chat_type", chatType)
            .eq("chat_id", chatId)
            .maybeSingle();
          if (error) throw error;
          return (data as PinnedVaultRecord | null) ?? null;
        },
        icp: async (ctx) => {
          const pin = await getLivePinnedVault(ctx, chatType, chatId);
          return pin ? livePinToRecord(pin) : null;
        },
      });
    },
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    if (!chatId || !enabledOpt || !subscribeOpt) return;
    // Realtime is Supabase-only; the canister path relies on query invalidation.
    if (isFeatureRoutedToIcp("vault")) return;
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
      return withFeatureBackend("vault", {
        supabase: async () => {
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
        icp: async (ctx) => {
          const clubId = clubIdOpt ?? query.data?.root_id ?? null;
          if (!clubId) throw new Error("Missing club id for pinned vault");
          await setLivePinnedVault(ctx, chatType, chatId, {
            clubId,
            vaultFileId: input.vault_file_id ?? null,
            vaultFolderId: input.vault_folder_id ?? null,
            rootScope: input.root_scope ?? null,
            rootId: input.root_id ?? null,
            enabled: input.enabled ?? false,
          });
        },
      });
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
      return withFeatureBackend("vault", {
        supabase: async () => {
          const { error } = await supabase
            .from("chat_pinned_vault")
            .update({ enabled })
            .eq("chat_type", chatType)
            .eq("chat_id", chatId);
          if (error) throw error;
        },
        icp: async (ctx) => {
          const existing = await getLivePinnedVault(ctx, chatType, chatId);
          if (!existing) throw new Error("No pinned vault to update");
          await setLivePinnedVault(ctx, chatType, chatId, {
            clubId: existing.club,
            vaultFileId: existing.vault_file_id.length ? existing.vault_file_id[0] : null,
            vaultFolderId: existing.vault_folder_id.length ? existing.vault_folder_id[0] : null,
            rootScope: (existing.root_scope.length ? existing.root_scope[0] : null) as "team" | "club" | null,
            rootId: existing.root_id.length ? existing.root_id[0] : null,
            enabled,
          });
        },
      });
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
      return withFeatureBackend("vault", {
        supabase: async () => {
          const { error } = await supabase
            .from("chat_pinned_vault")
            .delete()
            .eq("chat_type", chatType)
            .eq("chat_id", chatId);
          if (error) throw error;
        },
        icp: async (ctx) => {
          await clearLivePinnedVault(ctx, chatType, chatId);
        },
      });
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
