import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const QUERY_KEY = ["app-setting", "chat_recap_enabled"] as const;

/**
 * App-admin master kill-switch for the AI Chat Recap feature.
 *
 * Reads the `chat_recap_enabled` row from `public.app_settings` and subscribes
 * to realtime changes so toggles in /admin/settings propagate to active
 * sessions within ~1s.
 *
 * Defaults to ENABLED when the row is missing or the fetch fails, so a
 * transient error never turns the feature off unexpectedly.
 */
export function useChatRecapGloballyEnabled(): boolean {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data: row } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "chat_recap_enabled")
        .maybeSingle();
      return row?.value !== false && row?.value !== "false";
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    // Unique channel name per hook instance: multiple components mount this
    // hook, and reusing one channel name makes the second `.on()` land after
    // the shared channel already subscribed, which throws.
    const channel = supabase
      .channel(`app-settings-chat-recap-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "app_settings",
          filter: "key=eq.chat_recap_enabled",
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


  return data !== false;
}
