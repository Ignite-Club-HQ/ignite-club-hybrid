import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const QUERY_KEY = ["app-setting", "free_club_polling_enabled"] as const;

/**
 * App-admin toggle that switches Free-tier clubs from Supabase Realtime
 * subscriptions to periodic polling for chat/message channels. Pro-tier clubs
 * are unaffected. Defaults to OFF (realtime for everyone) so enabling it is
 * an explicit opt-in from /admin/settings.
 *
 * Mirrors the useChatVirtualizationEnabled pattern: single-key cache + a
 * scoped realtime subscription so admin flips propagate within ~1s instead
 * of waiting the 5-minute staleTime.
 */
export function useFreeClubPollingEnabled(): boolean {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data: row } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "free_club_polling_enabled")
        .maybeSingle();
      return row?.value === true || row?.value === "true";
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const channel = supabase
      .channel("app-settings-free-club-polling")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "app_settings",
          filter: "key=eq.free_club_polling_enabled",
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

  return data === true;
}
