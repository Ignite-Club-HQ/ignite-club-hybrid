import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePushSubscriptionHealth } from "@/hooks/usePushSubscriptionHealth";
import { useMissedNotificationSync } from "@/hooks/useMissedNotificationSync";
import { clearStalePushLocks } from "@/lib/pushNotifications";
import { useNativePush } from "@/hooks/useNativePush";
import { useRealtimePerfSampler } from "@/hooks/useRealtimePerfSampler";
import { getPlatform, isNativePlatform } from "@/lib/nativePush";
import { consumePendingWebPushNav } from "@/lib/webNotificationLaunchHandler";
import { preloadMessageFromNotification } from "@/lib/notificationPreload";
import { captureJumpFromNotification, normalizeNotificationChatUrl, getJumpTarget } from "@/lib/pendingChatJump";
import { suppressChatScope } from "@/lib/pushTapSuppression";
import { mark as coldMark } from "@/lib/coldStartMarks";
import { requestClubSwitchForNotification } from "@/lib/notificationClubSwitch";
import { useNotificationClubSwitch } from "@/hooks/useNotificationClubSwitch";


const APP_STORE_URL = "https://reference.invalid";
const PLAY_STORE_URL = "https://reference.invalid";

function getNativeStoreUrl() {
  return getPlatform() === "ios" ? APP_STORE_URL : PLAY_STORE_URL;
}

/**
 * Component that manages push notification health checks and missed notification sync.
 * Handles both web push (for browsers) and native push (for Capacitor apps).
 * Must be placed inside AuthProvider.
 */
export function PushNotificationManager() {
  // Safely get auth context - component must be inside AuthProvider
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Merge preloaded notification messages directly into the live React Query
  // cache so an already-mounted chat page reflects the new push instantly,
  // not just on cold mount (placeholderData only runs when there's no data).
  useEffect(() => {
    const handler = (e: Event) => {
      try {
        const { kind, targetId, message } = (e as CustomEvent).detail || {};
        if (!kind || !targetId || !message) return;
        const queryKey =
          kind === "team" ? ["team-messages", targetId]
          : kind === "club" ? ["club-messages", targetId]
          : kind === "group" ? ["group-messages", targetId]
          : kind === "dm" ? ["dm-messages", targetId]
          : kind === "broadcast" ? ["broadcast-messages"]
          : kind === "club_admin" ? ["club-admin-messages", targetId]
          : null;
        if (!queryKey) return;
        queryClient.setQueryData(queryKey, (old: any) => {
          if (!old) return old; // no live query — placeholderData will pick it up on mount
          const list: any[] = Array.isArray(old) ? old : (old.messages || []);
          if (list.some((m) => m?.id === message.id)) return old;
          const nextList = [...list, message];
          if (Array.isArray(old)) return nextList;
          return { ...old, messages: nextList };
        });
      } catch (err) {
        console.warn("[PushManager] preload-message merge failed:", err);
      }
    };
    window.addEventListener("ignite:preload-message", handler);
    return () => window.removeEventListener("ignite:preload-message", handler);
  }, [queryClient]);


  // Initialize native push for Capacitor apps (no-op on web)
  useNativePush(user?.id);

  // Move the global club filter to the club that owns a tapped notification
  // (user-driven; never switches on its own).
  useNotificationClubSwitch();

  // Sample realtime delivery latency (10% of sessions, batched writes)
  useRealtimePerfSampler(user?.id);

  // React to centralized notification taps for cross-cutting concerns.
  // Navigation is performed by notificationLaunchHandler.ts. The active club
  // filter IS moved here — but only in response to this explicit user tap, and
  // only to a club the user is verified to belong to.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const isPitchBoard = !!detail.isPitchBoard;
      const type = detail.type;

      // A tap on a notification from a different club must bring the whole app
      // to that club, not just open the thread.
      try { requestClubSwitchForNotification(detail.data, detail.path); } catch { /* noop */ }

      if (isPitchBoard) {
        if (type) {
          try { localStorage.setItem("pitch-board-open-source", type); } catch {}
        }
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent("open-pitch-board", { detail: { notificationType: type } }));
        }, 500);
      }
    };

    window.addEventListener("ignite:notification-tapped", handler);
    return () => window.removeEventListener("ignite:notification-tapped", handler);
  }, []);

  
  // Helper to navigate from a push notification URL
  const navigateToUrl = (url: string) => {
    try {
      // Check if external URL (e.g. App Store / Play Store)
      if (url.startsWith('http://') || url.startsWith('https://')) {
        const parsed = new URL(url);
        const appDomains = ['ignite.invalid', 'lovable.app', 'lovableproject.com', 'localhost'];
        const isExternal = !appDomains.some(d => parsed.hostname.endsWith(d));
        if (isExternal) {
          console.log('[PushManager] External URL detected, opening in new tab:', url);
          window.open(url, '_blank');
          return;
        }
        navigate(parsed.pathname + parsed.search + parsed.hash);
      } else {
        navigate(url);
      }
    } catch (err) {
      console.error('[PushManager] Error navigating:', err);
      navigate(url);
    }
  };

  // Listen for SW notification click navigation via multiple channels
  // BroadcastChannel is more reliable than postMessage for PWA clients resuming from suspension
  useEffect(() => {
    if (isNativePlatform()) return;

    // Drain any URL stashed by the early web launch handler (handles taps that
    // fired before this component mounted, e.g. during auth bootstrap).
    try { coldMark("pending_nav_consume_attempt"); } catch {}
    const pending = consumePendingWebPushNav();
    if (pending) {
      console.log('[PushManager] Consuming pending web push nav:', pending);
      try { coldMark("route_navigate"); } catch {}
      navigateToUrl(pending);
    }

    const handlePayload = (payload: any) => {
      if (!payload?.url) return;
      const url = normalizeNotificationChatUrl(payload.data || payload, payload.url) || payload.url;
      // Preload message cache so chat renders the new push at first paint.
      try { preloadMessageFromNotification(payload.data || payload); } catch {}
      try { captureJumpFromNotification(payload.data || payload, url); } catch {}
      // Suppress bottom-nav badge for the tapped scope for ~1.5s to avoid
      // "flash count then vanish" as the RPC and read-receipt race.
      try {
        const target = getJumpTarget(payload.data || payload, url);
        if (target) suppressChatScope(target.kind, target.targetId, 1800);
      } catch {}
      try { requestClubSwitchForNotification(payload.data || payload, url); } catch {}
      navigateToUrl(url);
    };

    // Primary: BroadcastChannel (works even when client is resuming from suspension)
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('push-nav');
      bc.onmessage = (event) => {
        console.log('[PushManager] BroadcastChannel navigation received:', event.data?.url);
        handlePayload(event.data);
      };
    } catch (e) {
      console.warn('[PushManager] BroadcastChannel not available:', e);
    }

    // Backup: SW postMessage
    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === 'NOTIFICATION_CLICK_NAVIGATE' && event.data?.url) {
        console.log('[PushManager] SW postMessage navigation received:', event.data.url);
        handlePayload(event.data);
      }
    };

    navigator.serviceWorker?.addEventListener('message', handleSWMessage);
    return () => {
      bc?.close();
      navigator.serviceWorker?.removeEventListener('message', handleSWMessage);
    };
  }, [navigate]);

  // Native fallback: if Android drops push tap payload on legacy builds,
  // show the update prompt on app open whenever an unread system_update exists.
  useEffect(() => {
    if (!user?.id || !isNativePlatform()) return;

    let cancelled = false;
    let removeAppStateListener: (() => void) | undefined;

    const checkPendingSystemUpdate = async () => {
      try {
        const { data, error } = await supabase
          .from("notifications")
          .select("id")
          .eq("user_id", user.id)
          .eq("type", "system_update")
          .eq("is_read", false)
          .order("created_at", { ascending: false })
          .limit(1);

        if (error) {
          console.warn("[PushManager] Failed to check system update notifications:", error);
          return;
        }

        if (!data?.length || cancelled) return;

        console.log("[PushManager] Pending system update notification found, dispatching update prompt");
        window.dispatchEvent(new CustomEvent("force-update-prompt", {
          detail: { storeUrl: getNativeStoreUrl() },
        }));
      } catch (err) {
        console.warn("[PushManager] Error checking system update notifications:", err);
      }
    };

    void checkPendingSystemUpdate();

    void (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const listener = await App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) {
            void checkPendingSystemUpdate();
          }
        });
        removeAppStateListener = () => {
          void listener.remove();
        };
      } catch (err) {
        console.warn("[PushManager] App state listener unavailable:", err);
      }
    })();

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void checkPendingSystemUpdate();
      }
    };

    window.addEventListener("focus", checkPendingSystemUpdate);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      removeAppStateListener?.();
      window.removeEventListener("focus", checkPendingSystemUpdate);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [user?.id]);
  
  // Clear stale push locks on startup and visibility change (web only)
  useEffect(() => {
    // Skip web push management on native platforms
    if (isNativePlatform()) return;
    
    // Clear on mount
    clearStalePushLocks();
    
    // Also clear when app becomes visible (user returns to app)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        clearStalePushLocks();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);
  
  // Run push subscription health checks (web only - skip on native)
  usePushSubscriptionHealth(isNativePlatform() ? undefined : user?.id);
  
  // Sync missed notifications when app opens
  useMissedNotificationSync(user?.id);
  
  // This component renders nothing - it just runs hooks
  return null;
}
