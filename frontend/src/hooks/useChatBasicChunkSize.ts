import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const QUERY_KEY = ["app-setting", "chat_basic_chunk_size"] as const;
const DEFAULT_CHUNK = 100;
const MIN_CHUNK = 10;
const MAX_CHUNK = 500;

/**
 * App-admin tunable chunk size for `BasicChatMessageList`.
 *
 * Controls both the initial number of rendered messages AND the size of each
 * "Load earlier messages" reveal step. Stored in `app_settings.chat_basic_chunk_size`
 * as a JSON number. Falls back to 100 on any error/missing/invalid value.
 *
 * Realtime UPDATE subscription so toggles in /admin/settings propagate to
 * active sessions immediately.
 */
export function useChatBasicChunkSize(): number {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data: row } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "chat_basic_chunk_size")
        .maybeSingle();
      const raw = row?.value;
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n) || n <= 0) return DEFAULT_CHUNK;
      return Math.min(MAX_CHUNK, Math.max(MIN_CHUNK, Math.floor(n)));
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const channel = supabase
      .channel("app-settings-chat-basic-chunk")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "app_settings",
          filter: "key=eq.chat_basic_chunk_size",
        },
        () => {
          queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        },
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        /* ignore */
      }
    };
  }, [queryClient]);

  return data ?? DEFAULT_CHUNK;
}
