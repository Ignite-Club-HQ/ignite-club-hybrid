import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

/**
 * Hook to check if pitch board notifications are enabled for the current user.
 * Returns enabled status.
 *
 * Race guard: when the authenticated user changes mid-flight (account switch),
 * an in-flight preference request for the previous user must NOT overwrite
 * state that now belongs to the new user. We use an effect-scoped `cancelled`
 * flag AND re-check the current user id before applying the result.
 */
export function usePitchBoardNotifications() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(true); // Default to enabled

  useEffect(() => {
    if (!user?.id) return;
    const requestUserId = user.id;
    let cancelled = false;

    const loadPreference = async () => {
      const { data } = await supabase
        .from("notification_preferences")
        .select("pitch_board_enabled")
        .eq("user_id", requestUserId)
        .single();

      // Drop stale responses from a previous account.
      if (cancelled) return;
      if (data) {
        setEnabled(data.pitch_board_enabled ?? true);
      }
    };

    loadPreference();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  return { pitchBoardNotificationsEnabled: enabled };
}

/**
 * Standalone function to check pitch board notification preference.
 * Use when you don't have access to React hooks.
 */
export async function checkPitchBoardNotificationsEnabled(userId: string): Promise<boolean> {
  if (!userId) return true; // Default to enabled if no user

  try {
    const { data } = await supabase
      .from("notification_preferences")
      .select("pitch_board_enabled")
      .eq("user_id", userId)
      .single();

    return data?.pitch_board_enabled ?? true;
  } catch {
    return true; // Default to enabled on error
  }
}
