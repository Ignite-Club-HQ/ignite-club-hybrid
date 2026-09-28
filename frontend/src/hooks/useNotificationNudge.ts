import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Capacitor } from "@capacitor/core";

const NUDGE_DISMISSED_PREFIX = "notification-nudge-dismissed-";
const NUDGE_STATUS_PREFIX = "notification-nudge-status-";
const NUDGE_COOLDOWN_DAYS = 7;

const getDismissKey = (context: string, userId: string) => `${NUDGE_DISMISSED_PREFIX}${context}-${userId}`;
const getStatusKey = (context: string, userId: string) => `${NUDGE_STATUS_PREFIX}${context}-${userId}`;

const readCachedPushStatus = (context: string, userId: string | undefined) => {
  if (!userId || typeof window === "undefined") return null;

  const cached = localStorage.getItem(getStatusKey(context, userId));
  if (cached === "enabled") return true;
  if (cached === "disabled") return false;
  return null;
};

const writeCachedPushStatus = (context: string, userId: string | undefined, enabled: boolean) => {
  if (!userId || typeof window === "undefined") return;
  localStorage.setItem(getStatusKey(context, userId), enabled ? "enabled" : "disabled");
};

/**
 * Hook to determine if a user should be nudged to enable push notifications.
 * Checks FCM tokens (native) and push_subscriptions (web) to determine reachability.
 * Returns dismissal handlers with a 7-day cooldown.
 */
export function useNotificationNudge(userId: string | undefined, context: string = "general") {
  // Start as null (loading) — never show nudge while loading
  const [hasPushEnabled, setHasPushEnabled] = useState<boolean | null>(() => readCachedPushStatus(context, userId));
  const [isDismissed, setIsDismissed] = useState(false);
  const [isLoading, setIsLoading] = useState(() => readCachedPushStatus(context, userId) === null);

  useEffect(() => {
    if (!userId) {
      setHasPushEnabled(null);
      setIsLoading(false);
      return;
    }

    const cachedStatus = readCachedPushStatus(context, userId);
    setHasPushEnabled(cachedStatus);
    setIsLoading(cachedStatus === null);

    const dismissKey = getDismissKey(context, userId);
    const dismissedAt = localStorage.getItem(dismissKey);
    if (dismissedAt) {
      const elapsed = Date.now() - parseInt(dismissedAt, 10);
      if (elapsed < NUDGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000) {
        setIsDismissed(true);
        setHasPushEnabled(true); // Don't show nudge
        setIsLoading(false);
        return;
      }
      // Cooldown expired, remove
      localStorage.removeItem(dismissKey);
    }

    setIsDismissed(false);

    let cancelled = false;

    const checkPushStatus = async () => {
      try {
        // Verify we have an active session before querying
        const { data: sessionData } = await supabase.auth.getSession();
        if (cancelled) return;

        if (!sessionData?.session) {
          setHasPushEnabled(cachedStatus);
          setIsLoading(false);
          return;
        }

        const isNative = Capacitor.isNativePlatform();
        let nextHasPushEnabled: boolean | null = null;
        let lookupErrored = false;

        if (isNative) {
          // Check device-level permission first — if granted, don't nudge
          let permissionGranted = false;
          try {
            const { PushNotifications } = await import("@capacitor/push-notifications");
            const permResult = await PushNotifications.checkPermissions();
            permissionGranted = permResult.receive === "granted";
          } catch {
            permissionGranted = false;
          }

          if (permissionGranted) {
            nextHasPushEnabled = true;
          } else {
            // Permission not granted — check DB as fallback
            const { data, error } = await supabase
              .from("fcm_tokens" as any)
              .select("id")
              .eq("user_id", userId)
              .limit(1);
            if (error) {
              lookupErrored = true;
            } else {
              nextHasPushEnabled = !!data && data.length > 0;
            }
          }
        } else {
          // Check push_subscriptions for web/PWA
          const { data, error } = await supabase
            .from("push_subscriptions")
            .select("id")
            .eq("user_id", userId)
            .limit(1);
          if (error) {
            lookupErrored = true;
          } else {
            nextHasPushEnabled = !!data && data.length > 0;
          }
        }

        if (cancelled) return;

        if (lookupErrored) {
          // Lookup failed — status is UNKNOWN, not "disabled".
          // Preserve the cached value if we have one; otherwise assume enabled
          // for this render only to avoid a false enable-notifications nudge.
          // Do NOT write a "disabled" cache entry.
          setHasPushEnabled(cachedStatus ?? true);
          setIsLoading(false);
          return;
        }

        setHasPushEnabled(nextHasPushEnabled);
        if (nextHasPushEnabled !== null) {
          writeCachedPushStatus(context, userId, nextHasPushEnabled);
        }
      } catch {
        if (cancelled) return;
        // On thrown exception, preserve cached value when available; otherwise
        // assume enabled to avoid a false nudge. Do not cache.
        setHasPushEnabled(cachedStatus ?? true);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void checkPushStatus();

    return () => {
      cancelled = true;
    };
  }, [userId, context]);

  const dismiss = useCallback(() => {
    if (!userId) return;
    const dismissKey = getDismissKey(context, userId);
    localStorage.setItem(dismissKey, Date.now().toString());
    setIsDismissed(true);
  }, [userId, context]);

  // Never show nudge while still loading — prevents false flash
  const shouldShowNudge = !isLoading && hasPushEnabled === false && !isDismissed;

  return { shouldShowNudge, hasPushEnabled, dismiss, isLoading };
}
