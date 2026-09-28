import { useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

const LAST_SYNC_KEY = "notifications-last-sync";
const LAST_SHOWN_KEY = "notifications-last-shown";
const SYNC_COOLDOWN_MS = 30 * 1000; // Don't sync more than every 30 seconds
const MAX_NOTIFICATIONS_TO_SHOW = 3; // Don't spam user with too many notifications

interface MissedNotification {
  id: string;
  message: string;
  type: string;
  created_at: string;
}

/**
 * Enhanced missed notification sync
 * - Syncs unread notifications when app opens
 * - Shows local browser notifications for missed push notifications
 * - Deduplicates to avoid showing the same notification twice
 */
export function useMissedNotificationSync(userId: string | undefined) {
  const isShowing = useRef(false);

  /**
   * Get IDs of notifications we've already shown locally
   */
  const getShownNotificationIds = useCallback((): Set<string> => {
    try {
      const stored = localStorage.getItem(LAST_SHOWN_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        // Clean up entries older than 24 hours
        const now = Date.now();
        const validEntries = Object.entries(data).filter(
          ([_, timestamp]) => now - (timestamp as number) < 24 * 60 * 60 * 1000
        );
        return new Set(validEntries.map(([id]) => id));
      }
    } catch {
      // localStorage not available or invalid data
    }
    return new Set();
  }, []);

  /**
   * Mark a notification as shown locally
   */
  const markNotificationShown = useCallback((notificationId: string) => {
    try {
      const stored = localStorage.getItem(LAST_SHOWN_KEY);
      const data = stored ? JSON.parse(stored) : {};
      
      // Clean up old entries
      const now = Date.now();
      const cleanedData: Record<string, number> = {};
      for (const [id, timestamp] of Object.entries(data)) {
        if (now - (timestamp as number) < 24 * 60 * 60 * 1000) {
          cleanedData[id] = timestamp as number;
        }
      }
      
      cleanedData[notificationId] = now;
      localStorage.setItem(LAST_SHOWN_KEY, JSON.stringify(cleanedData));
    } catch {
      // localStorage not available
    }
  }, []);

  /**
   * Show a local browser notification
   */
  const showLocalNotification = useCallback(async (notification: MissedNotification): Promise<boolean> => {
    // Check if notifications are supported and permitted
    if (!('Notification' in window)) {
      return false;
    }

    if (Notification.permission !== 'granted') {
      return false;
    }

    // Don't show if document is visible (user is already looking at app)
    if (document.visibilityState === 'visible') {
      console.log('[NotificationSync] Skipping local notification - app is visible');
      return false;
    }

    try {
      // Try to use service worker for notification (more reliable)
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        
        await registration.showNotification('Ignite', {
          body: notification.message,
          icon: '/ignite-logo.png',
          badge: '/badge-96.png',
          tag: `missed-${notification.id}`,
          data: { 
            url: '/notifications',
            notificationId: notification.id,
            isMissed: true
          },
          requireInteraction: false,
          silent: false
        });
        
        console.log('[NotificationSync] Showed local notification via SW:', notification.id);
        return true;
      } else {
        // Fallback to direct Notification API
        const browserNotification = new Notification('Ignite', {
          body: notification.message,
          icon: '/ignite-logo.png',
          tag: `missed-${notification.id}`
        });
        
        browserNotification.onclick = () => {
          window.focus();
          window.location.href = '/notifications';
          browserNotification.close();
        };
        
        console.log('[NotificationSync] Showed local notification via API:', notification.id);
        return true;
      }
    } catch (error) {
      console.error('[NotificationSync] Failed to show local notification:', error);
      return false;
    }
  }, []);

  /**
   * Sync and show missed notifications
   */
  const syncMissedNotifications = useCallback(async (forceShow = false) => {
    if (!userId) return;
    if (isShowing.current) return;

    try {
      // Check cooldown
      let lastSync: string | null = null;
      try {
        lastSync = localStorage.getItem(LAST_SYNC_KEY);
      } catch {
        // localStorage not available
      }
      
      if (!forceShow && lastSync && (Date.now() - parseInt(lastSync, 10)) < SYNC_COOLDOWN_MS) {
        return;
      }

      isShowing.current = true;

      // Fetch unread notifications from the last 2 hours (for missed notifications)
      const twoHoursAgo = new Date();
      twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);

      const { data: unreadNotifications, error } = await supabase
        .from("notifications")
        .select("id, message, type, created_at")
        .eq("user_id", userId)
        .eq("is_read", false)
        .gte("created_at", twoHoursAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) {
        console.error("[NotificationSync] Error fetching notifications:", error);
        return;
      }

      try {
        localStorage.setItem(LAST_SYNC_KEY, Date.now().toString());
      } catch {
        // localStorage not available
      }

      if (!unreadNotifications || unreadNotifications.length === 0) {
        return;
      }

      console.log(`[NotificationSync] Found ${unreadNotifications.length} unread notification(s)`);

      // Filter out notifications we've already shown
      const shownIds = getShownNotificationIds();
      const newNotifications = unreadNotifications.filter(n => !shownIds.has(n.id));

      if (newNotifications.length === 0) {
        console.log('[NotificationSync] All notifications already shown locally');
        return;
      }

      console.log(`[NotificationSync] ${newNotifications.length} new notification(s) to show`);

      // Only show notifications if app is NOT visible (user might have missed push)
      if (document.visibilityState !== 'visible' || forceShow) {
        // Limit number of notifications to avoid spam
        const toShow = newNotifications.slice(0, MAX_NOTIFICATIONS_TO_SHOW);
        
        for (const notification of toShow) {
          const shown = await showLocalNotification(notification);
          if (shown) {
            markNotificationShown(notification.id);
          }
          // Small delay between notifications
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        // If there are more notifications, show a summary
        if (newNotifications.length > MAX_NOTIFICATIONS_TO_SHOW) {
          const remaining = newNotifications.length - MAX_NOTIFICATIONS_TO_SHOW;
          try {
            if ('serviceWorker' in navigator) {
              const registration = await navigator.serviceWorker.ready;
              await registration.showNotification('Ignite', {
                body: `You have ${remaining} more notification${remaining > 1 ? 's' : ''}`,
                icon: '/ignite-logo.png',
                badge: '/badge-96.png',
                tag: 'missed-summary',
                data: { url: '/notifications' }
              });
            }
          } catch (e) {
            console.warn('[NotificationSync] Failed to show summary notification:', e);
          }
        }
      } else {
        // App is visible, just mark as "seen" for deduplication
        // (Push should have already shown these or user is looking at app)
        for (const notification of newNotifications) {
          markNotificationShown(notification.id);
        }
      }
    } catch (error) {
      console.error("[NotificationSync] Error syncing notifications:", error);
    } finally {
      isShowing.current = false;
    }
  }, [userId, getShownNotificationIds, showLocalNotification, markNotificationShown]);

  // Sync on mount and when app becomes visible
  useEffect(() => {
    if (!userId) return;

    // Sync after a short delay on mount
    const mountTimer = setTimeout(() => syncMissedNotifications(false), 3000);

    // Sync when app becomes visible (user comes back to tab/app)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Small delay to let push notifications settle
        setTimeout(() => syncMissedNotifications(false), 1000);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Sync when coming back online
    const handleOnline = () => {
      console.log('[NotificationSync] Device came online');
      syncMissedNotifications(true);
    };
    window.addEventListener("online", handleOnline);

    // Also sync when page gets focus (more reliable than visibility)
    const handleFocus = () => {
      syncMissedNotifications(false);
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      clearTimeout(mountTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener('focus', handleFocus);
    };
  }, [userId, syncMissedNotifications]);

  return { syncMissedNotifications: () => syncMissedNotifications(true) };
}
