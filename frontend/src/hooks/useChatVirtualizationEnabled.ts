import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const QUERY_KEY = ["app-setting", "chat_virtualization_enabled"] as const;

/**
 * App-admin kill-switch for chat message virtualisation.
 *
 * Reads the `chat_virtualization_enabled` row from `public.app_settings` and
 * subscribes to realtime UPDATE events on that row so toggles in
 * /admin/settings propagate to active sessions immediately (no 5-minute wait).
 *
 * Defaults to ENABLED on any error/missing row so a transient fetch failure
 * never silently downgrades every chat to the basic fallback scroller.
 */
export function useChatVirtualizationEnabled(): boolean {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data: row } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "chat_virtualization_enabled")
        .maybeSingle();
      // Treat anything that isn't an explicit `false` as enabled.
      return row?.value !== false && row?.value !== "false";
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  // Realtime subscription — flips propagate within ~1s instead of waiting for
  // the 5-minute staleTime. Single shared channel; the postgres_changes filter
  // ensures we only react to the row we care about.
  useEffect(() => {
    let channel:
      | {
          unsubscribe?: () => void;
        }
      | undefined;

    try {
      channel = supabase
        .channel("app-settings-chat-virt")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "app_settings",
            filter: "key=eq.chat_virtualization_enabled",
          },
          () => {
            queryClient.invalidateQueries({ queryKey: QUERY_KEY });
          },
        )
        .subscribe();
    } catch (error) {
      console.warn(
        "[useChatVirtualizationEnabled] Realtime unavailable; defaulting to enabled until refresh.",
        error,
      );
      return;
    }

    return () => {
      if (!channel) return;
      try {
        supabase.removeChannel(channel);
      } catch {
        /* ignore */
      }
    };
  }, [queryClient]);

  // While loading or on error, assume enabled (safe default).
  return data !== false;
}
