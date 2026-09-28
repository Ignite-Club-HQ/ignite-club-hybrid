/**
 * React hook for managing native push notifications
 * 
 * Handles:
 * - Automatic initialization when user logs in
 * - Token refresh handling
 * - Notification listeners
 * - Cleanup on logout
 * - Processing pending notification navigation from cold start
 * 
 * IMPORTANT: This hook is designed to fail gracefully if Firebase/FCM is not configured.
 * The native app will NOT crash if google-services.json or GoogleService-Info.plist is missing,
 * but push notifications simply won't work.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { queueChatInvalidation } from '@/lib/chatInvalidationQueue';
import { notificationKeys } from '@/lab/notificationQueryKeys';

import { mark as coldMark } from '@/lib/coldStartMarks';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { preloadMessageFromNotification } from '@/lib/notificationPreload';
import {
  processPendingNotificationNavigation,
  peekPendingNotificationNavigation,
  setNotificationNavigator,
  clearNotificationNavigator,
} from '@/lib/notificationLaunchHandler';

let capacitorAppModule: typeof import('@capacitor/app') | null = null;

async function loadCapacitorAppModule() {
  if (capacitorAppModule) return capacitorAppModule;

  try {
    capacitorAppModule = await import('@capacitor/app');
    return capacitorAppModule;
  } catch (err) {
    console.warn('[useNativePush] Failed to load Capacitor App module:', err);
    return null;
  }
}

// Lazy import everything to prevent crashes at module load time
let nativePushModule: typeof import('@/lib/nativePush') | null = null;
let moduleLoadAttempted = false;
let moduleLoadFailed = false;

const CHAT_NOTIFICATION_TYPES = new Set([
  'team_message',
  'club_message',
  'group_message',
  'direct_message',
  'club_admin_message',
  'broadcast',
  'message_reply',
  'message_mention',
]);

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function invalidateChatFromPush(queryClient: QueryClient, userId: string | undefined, data: any) {
  const notificationType = asString(data?.notificationType) || asString(data?.type);
  if (!notificationType || !CHAT_NOTIFICATION_TYPES.has(notificationType)) return;

  try {
    // Collected, then flushed in bounded dripped batches — a burst of pushes
    // must never fan out into a connection-pool-saturating refetch storm on
    // Android WebView. See src/lib/chatInvalidationQueue.ts.
    const keys: QueryKey[] = [];
    if (userId) {
      keys.push(
        notificationKeys.messageUnreadFor(userId),
        notificationKeys.chatGroupUnreadFor(userId),
        ['my-teams-with-messages', userId],
        ['member-clubs-with-messages', userId],
        ['my-chat-groups-with-messages', userId],
        ['dm-conversations', userId],
        ['club-admin-conversations', userId],
      );
    }
    keys.push(['latest-broadcast']);

    const teamId = asString(data?.team_id) || asString(data?.teamId);
    const clubId = asString(data?.club_id) || asString(data?.clubId);
    const groupId = asString(data?.group_id) || asString(data?.groupId);
    const conversationId = asString(data?.conversation_id) || asString(data?.conversationId);
    const contextId = asString(data?.context_id) || asString(data?.contextId);

    if (notificationType === 'team_message' && teamId) keys.push(['team-messages', teamId]);
    if (notificationType === 'club_message' && clubId) keys.push(['club-messages', clubId]);
    if (notificationType === 'group_message' && groupId) keys.push(['group-messages', groupId]);
    if (notificationType === 'direct_message' && conversationId) keys.push(['dm-messages', conversationId]);
    if (notificationType === 'club_admin_message' && (contextId || conversationId)) {
      keys.push(['club-admin-messages', contextId || conversationId]);
    }
    if (notificationType === 'broadcast') keys.push(['broadcast-messages']);
    if (notificationType === 'message_reply' || notificationType === 'message_mention') {
      if (teamId) keys.push(['team-messages', teamId]);
      if (clubId) keys.push(['club-messages', clubId]);
      if (groupId) keys.push(['group-messages', groupId]);
      if (conversationId) keys.push(['dm-messages', conversationId]);
      if (contextId) keys.push(['club-admin-messages', contextId]);
    }

    queueChatInvalidation(queryClient, keys);
  } catch (err) {
    console.warn('[useNativePush] Failed to invalidate chat push caches:', err);
  }
}


async function loadNativePushModule() {
  if (moduleLoadAttempted) {
    return !moduleLoadFailed ? nativePushModule : null;
  }
  
  moduleLoadAttempted = true;
  
  try {
    nativePushModule = await import('@/lib/nativePush');
    return nativePushModule;
  } catch (err) {
    console.warn('[useNativePush] Failed to load nativePush module:', err);
    moduleLoadFailed = true;
    return null;
  }
}

interface UseNativePushOptions {
  enabled?: boolean;
}

// (Helpers for URL normalization moved to notificationLaunchHandler.ts —
// this hook no longer routes notification taps directly. BUG-1 consolidation.)


export function useNativePush(userId: string | undefined, options: UseNativePushOptions = {}) {
  const { enabled = true } = options;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cleanupRef = useRef<(() => void) | null>(null);
  const initializedRef = useRef(false);
  const [isNative, setIsNative] = useState(false);
  const pendingNavProcessed = useRef(false);

  // Check if we're on native platform. The single Capacitor action listener
  // lives in notificationLaunchHandler.ts (installed at app start). Here we
  // only register a navigator so warm taps can navigate immediately. Cold-
  // start drain is deferred to the auth-gated effect below — navigating to
  // a chat route before auth/profile is hydrated causes downstream chat
  // hooks to throw on null context and unmounts the React tree (white screen).
  useEffect(() => {
    const nav: (path: string) => void = (path) => {
      try {
        navigate(path);
      } catch (err) {
        console.error('[useNativePush] navigator threw:', err);
      }
    };

    loadNativePushModule().then(mod => {
      if (!mod) return;
      try {
        const native = mod.isNativePlatform();
        setIsNative(native);
        if (native) setNotificationNavigator(nav);
      } catch {
        setIsNative(false);
      }
    });

    return () => {
      clearNotificationNavigator(nav);
    };
  }, [navigate]);



  // Save refreshed token to database
  const handleTokenRefresh = useCallback(async (token: string) => {
    if (!userId) return;
    
    console.log('[useNativePush] Token refreshed, saving...');
    try {
      const mod = await loadNativePushModule();
      if (!mod) return;
      
      const platform = mod.getPlatform();
      // Remove this token from any other users first using security definer function
      // (RLS prevents deleting other users' rows directly)
      await supabase.rpc('cleanup_fcm_token_for_user', {
        p_token: token,
        p_user_id: userId,
      });
      
      // Get app version info
      let appVersion: string | null = null;
      let buildNumber: string | null = null;
      try {
        const { App } = await import('@capacitor/app');
        const info = await App.getInfo();
        appVersion = info.version;
        buildNumber = info.build;
      } catch {}
      
      // Use 'as any' since table may not be in generated types yet
      await supabase
        .from('fcm_tokens' as any)
        .upsert(
          {
            user_id: userId,
            token,
            platform,
            app_version: appVersion,
            build_number: buildNumber,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: 'user_id,token',
          }
        );
    } catch (err) {
      console.error('[useNativePush] Error saving refreshed token:', err);
    }
  }, [userId]);

  // BUG-1 fix: the action-tap handler now lives exclusively in
  // notificationLaunchHandler.ts (single Capacitor listener). We no longer
  // register a per-hook listener nor pass an onNotificationAction callback
  // into setupNativePushListeners — that previously caused 2-3 navigate()
  // calls per tap and broke the back stack.


  // Once we have an authenticated user, consume any pending push-tap nav
  // that arrived during the auth bootstrap. Without this, Index's redirect
  // chain can swallow the navigate() call fired from the early action listener.
  useEffect(() => {
    if (!userId || !isNative) return;
    // Try immediately. Only schedule fallback retries if a URL is still
    // pending — prevents this effect's timers from racing with the cold-start
    // retry cascade above for already-drained navigations.
    const safeNavigate = (p: string) => {
      try { navigate(p); } catch (err) { console.error('[useNativePush] navigate failed:', err); }
    };
    const tryConsume = () => processPendingNotificationNavigation(safeNavigate);

    try { coldMark("pending_nav_consume_attempt"); } catch {}
    if (tryConsume()) {
      console.log('[useNativePush] Consumed pending nav after auth ready');
      return;
    }
    if (!peekPendingNotificationNavigation()) return;
    // Extended retry window: slow Android cold starts + auth bootstrap +
    // route mount can exceed 1s. Retry up to 4s so a stashed URL doesn't
    // get abandoned before the router is actually ready.
    const timers: ReturnType<typeof setTimeout>[] = [];
    const schedule = (delay: number, label: string) => {
      timers.push(setTimeout(() => {
        if (!peekPendingNotificationNavigation()) return;
        if (tryConsume()) console.log(`[useNativePush] Consumed pending nav post-auth (${label})`);
      }, delay));
    };
    schedule(250, "250ms");
    schedule(750, "750ms");
    schedule(1500, "1500ms");
    schedule(2500, "2500ms");
    schedule(4000, "4000ms");
    return () => { timers.forEach(clearTimeout); };

  }, [userId, isNative, navigate]);

  // Initialize native push when user is available
  useEffect(() => {
    if (!userId || !enabled || initializedRef.current) {
      return;
    }

    let cancelled = false;

    const init = async () => {
      try {
        const mod = await loadNativePushModule();
        if (!mod || cancelled) return;
        
        // Check if we're actually on a native platform
        if (!mod.isNativePlatform()) {
          console.log('[useNativePush] Not a native platform, skipping init');
          return;
        }

        console.log('[useNativePush] Initializing native push...');
        
        const result = await mod.initializeNativePush(userId);
        
        if (cancelled) return;
        
        if (result.success) {
          console.log('[useNativePush] Native push initialized successfully');
          initializedRef.current = true;
          
          // Setup listeners - wrap in try/catch
          try {
            cleanupRef.current = mod.setupNativePushListeners(
              // onNotificationReceived - show toast for foreground notifications
              (notification) => {
                const data = notification?.data || {};
                try {
                  preloadMessageFromNotification(data);
                  invalidateChatFromPush(queryClient, userId, data);
                } catch (preloadErr) {
                  console.warn('[useNativePush] Failed to preload foreground push:', preloadErr);
                }
                try {
                  toast(notification.title || 'New notification', {
                    description: notification.body,
                  });
                } catch (toastErr) {
                  console.warn('[useNativePush] Failed to show toast:', toastErr);
                }
              },
              // onNotificationAction - handled centrally in notificationLaunchHandler.ts (BUG-1)
              undefined,
              // onTokenRefresh - save new token
              handleTokenRefresh
            );
          } catch (listenerErr) {
            console.warn('[useNativePush] Failed to setup listeners:', listenerErr);
          }
        } else {
          console.warn('[useNativePush] Failed to initialize:', result.error);
        }
      } catch (err) {
        // Catch ANY error to prevent app crashes
        console.error('[useNativePush] Critical error during init:', err);
      }
    };

    init();

    return () => {
      cancelled = true;
      if (cleanupRef.current) {
        try {
          cleanupRef.current();
        } catch (err) {
          console.warn('[useNativePush] Error during cleanup:', err);
        }
        cleanupRef.current = null;
      }
    };
  }, [userId, enabled, handleTokenRefresh, queryClient]);

  // Refresh FCM token whenever the native app returns to foreground.
  // Use both Capacitor App resume events and document visibility as a fallback.
  useEffect(() => {
    if (!userId || !isNative) return;

    let disposed = false;
    let lastRefreshAt = 0;
    let resumeListener: { remove: () => Promise<void> } | null = null;

    const refreshPushRegistration = async (source: 'resume' | 'visibilitychange') => {
      const now = Date.now();
      if (now - lastRefreshAt < 5000) {
        console.log(`[useNativePush] Skipping duplicate refresh from ${source}`);
        return;
      }

      lastRefreshAt = now;

      try {
        const mod = await loadNativePushModule();
        if (!mod || !mod.isNativePlatform() || disposed) return;

        console.log(`[useNativePush] App foregrounded via ${source} - refreshing FCM token`);
        const result = await mod.initializeNativePush(userId);
        if (result.success) {
          console.log(`[useNativePush] FCM token refreshed via ${source}`);
        } else {
          console.warn(`[useNativePush] FCM token refresh via ${source} failed:`, result.error);
        }
      } catch (err) {
        console.warn(`[useNativePush] Error refreshing token via ${source}:`, err);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshPushRegistration('visibilitychange');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    void loadCapacitorAppModule().then((appMod) => {
      if (!appMod || disposed) return;

      appMod.App.addListener('resume', () => {
        void refreshPushRegistration('resume');
      }).then((listener) => {
        if (!disposed) {
          resumeListener = listener;
        } else {
          listener.remove().catch(() => {});
        }
      }).catch((err) => {
        console.warn('[useNativePush] Failed to attach resume listener:', err);
      });
    });

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      resumeListener?.remove().catch(() => {});
    };
  }, [userId, isNative]);

  // Cleanup on logout
  const cleanup = useCallback(async () => {
    if (!userId) return;
    
    try {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      
      const mod = await loadNativePushModule();
      if (mod) {
        await mod.unregisterNativePush(userId);
      }
      initializedRef.current = false;
    } catch (err) {
      console.error('[useNativePush] Error during cleanup:', err);
    }
  }, [userId]);

  return {
    isNative,
    cleanup,
  };
}
