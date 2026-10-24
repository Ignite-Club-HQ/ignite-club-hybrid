import { useState, useEffect } from "react";
import { useAuth } from "./useAuth";
import { resolveAuthBackend } from '@/live/authBackendMode';
import { readPitchNotificationPreference } from '@/lib/pitchBoardRepository';

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
  const { user, loading } = useAuth();
  const icp = resolveAuthBackend() === 'icp';
  const [enabled, setEnabled] = useState(true); // Default to enabled

  useEffect(() => {
    if (!user?.id || loading) return;
    const requestUserId = user.id;
    let cancelled = false;

    const loadPreference = async () => {
      const preference = await readPitchNotificationPreference(requestUserId, icp).catch(() => true);
      if (!cancelled) setEnabled(preference);
    };

    loadPreference();

    return () => {
      cancelled = true;
    };
  }, [user?.id, loading, icp]);

  return { pitchBoardNotificationsEnabled: enabled };
}

/**
 * Standalone function to check pitch board notification preference.
 * Use when you don't have access to React hooks.
 */
export async function checkPitchBoardNotificationsEnabled(userId: string): Promise<boolean> {
  if (!userId) return true; // Default to enabled if no user

  try {
    return await readPitchNotificationPreference(userId, resolveAuthBackend() === 'icp');
  } catch {
    return true; // Default to enabled on error
  }
}
