import { useEffect, useRef, useCallback } from "react";
import { subscribeToPushNotifications, resetPushNotifications } from "@/lib/pushNotifications";
import {
  logPush,
  generateCorrelationId,
  needsRevalidation,
  needsIOSProactiveRenewal,
  markSubscriptionValidated,
  markSubscriptionRenewed,
  checkServiceWorkerUpdate,
  activateWaitingServiceWorker,
  permissionWasRevoked,
  getPlatformInfo,
} from "@/lib/pushReliability";
import {
  verifySubscriptionHealth,
  cleanupStaleSubscriptions,
  handlePermissionRevoked,
  processOfflineQueue,
  resilientSubscribe,
} from "@/lib/pushSubscriptionSync";

// How often to validate subscription (every 2 hours - reduced from 4)
const VALIDATION_INTERVAL_MS = 2 * 60 * 60 * 1000;
// Debounce visibility changes
const VISIBILITY_DEBOUNCE_MS = 1500;
// SW update check interval (every 30 minutes)
const SW_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Enhanced push subscription health check with improved reliability
 * 
 * Features:
 * - Aggressive validation on visibility change
 * - Stale subscription cleanup
 * - Service worker update checks
 * - Offline queue processing
 * - Platform-aware handling
 */
export function usePushSubscriptionHealth(userId: string | undefined) {
  const isValidating = useRef(false);
  const visibilityTimeout = useRef<NodeJS.Timeout | null>(null);
  const lastValidation = useRef<number>(0);

  /**
   * Validate subscription health and resubscribe if needed
   */
  const validateSubscription = useCallback(async (force = false): Promise<boolean> => {
    if (!userId || isValidating.current) return false;

    // Skip if recently validated (unless forced)
    if (!force && !needsRevalidation()) {
      const elapsed = Date.now() - lastValidation.current;
      if (elapsed < VALIDATION_INTERVAL_MS) {
        return true;
      }
    }

    isValidating.current = true;
    const correlationId = generateCorrelationId();
    logPush('info', 'Starting subscription validation', { force }, correlationId);

    try {
      // Check if permission was revoked
      if (permissionWasRevoked()) {
        logPush('warn', 'Permission revoked, cleaning up', undefined, correlationId);
        await handlePermissionRevoked(userId);
        return false;
      }

      // Check if iOS PWA needs proactive renewal (before 7-day ITP expiry)
      if (needsIOSProactiveRenewal()) {
        logPush('info', 'iOS proactive renewal triggered', undefined, correlationId);
        
        // Reset and resubscribe to get fresh subscription
        await resetPushNotifications(userId, false);
        const result = await subscribeToPushNotifications(userId, true);
        
        if (result.success) {
          markSubscriptionRenewed();
          lastValidation.current = Date.now();
          logPush('info', 'iOS proactive renewal succeeded', undefined, correlationId);
          return true;
        } else {
          logPush('warn', 'iOS proactive renewal failed', { error: result.error }, correlationId);
          // Continue with normal validation
        }
      }

      // Verify health of current subscription
      const health = await verifySubscriptionHealth(userId);

      if (health.healthy) {
        lastValidation.current = Date.now();
        return true;
      }

      // Subscription is unhealthy - attempt to fix
      logPush('info', 'Subscription unhealthy, resubscribing', { reason: health.reason }, correlationId);

      // Clean up stale entries first
      if (health.dbHasSubscription && !health.endpointsMatch) {
        await cleanupStaleSubscriptions(userId);
      }

      // Attempt resubscription with resilience
      const result = await resilientSubscribe(userId, (uid) => subscribeToPushNotifications(uid, true));

      if (result.success || result.queued) {
        lastValidation.current = Date.now();
        return result.success;
      }

      logPush('warn', 'Resubscription failed', { error: result.error }, correlationId);
      return false;
    } catch (error) {
      logPush('error', 'Validation error', { error: String(error) }, correlationId);
      return false;
    } finally {
      isValidating.current = false;
    }
  }, [userId]);

  /**
   * Force resubscribe with full reliability
   */
  const validateAndResubscribe = useCallback(async () => {
    if (!userId) return false;
    logPush('info', 'Manual resubscription triggered');
    
    const result = await resilientSubscribe(userId, subscribeToPushNotifications);
    return result.success;
  }, [userId]);

  useEffect(() => {
    if (!userId || !('serviceWorker' in navigator)) return;

    const platform = getPlatformInfo();
    logPush('info', 'Push health hook initialized', {
      platform: platform.platform,
      reliability: platform.reliabilityRating,
    });

    // Listen for subscription change messages from service worker
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') {
        logPush('info', 'SW reported subscription changed, revalidating');
        validateSubscription(true);
      }
      
      if (event.data?.type === 'PUSH_SUBSCRIPTION_RENEWED') {
        logPush('info', 'SW auto-renewed subscription');
        markSubscriptionValidated(event.data.subscription?.endpoint);
      }

      if (event.data?.type === 'PONG') {
        logPush('debug', 'SW keepalive confirmed');
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);

    // Initial validation after short delay
    const initialTimer = setTimeout(() => validateSubscription(false), 2000);

    // Periodic validation
    const intervalTimer = setInterval(() => {
      validateSubscription(false);
    }, VALIDATION_INTERVAL_MS);

    // Validate when app becomes visible (aggressive for mobile)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (visibilityTimeout.current) {
          clearTimeout(visibilityTimeout.current);
        }
        
        // iOS PWA needs more aggressive revalidation
        const delay = platform.platform === 'ios-pwa' ? 500 : VISIBILITY_DEBOUNCE_MS;
        
        visibilityTimeout.current = setTimeout(() => {
          logPush('debug', 'App became visible, validating');
          validateSubscription(false);
        }, delay);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Validate when coming back online + process queue
    const handleOnline = async () => {
      logPush('info', 'Device came online');
      
      // Process any queued operations
      await processOfflineQueue((uid) => subscribeToPushNotifications(uid, true));
      
      // Then validate current subscription
      validateSubscription(true);
    };
    window.addEventListener('online', handleOnline);

    // Check for SW updates periodically
    const swUpdateTimer = setInterval(async () => {
      const hasUpdate = await checkServiceWorkerUpdate();
      if (hasUpdate) {
        logPush('info', 'SW update available, activating');
        await activateWaitingServiceWorker();
        // Revalidate after SW update
        setTimeout(() => validateSubscription(true), 2000);
      }
    }, SW_UPDATE_CHECK_INTERVAL_MS);

    // Send keepalive ping to SW periodically
    const sendKeepalive = async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (registration.active) {
          registration.active.postMessage({ type: 'PING' });
        }
      } catch {
        // Ignore errors
      }
    };
    
    const keepaliveTimer = setInterval(sendKeepalive, 60000);

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleMessage);
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
      clearInterval(keepaliveTimer);
      clearInterval(swUpdateTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      if (visibilityTimeout.current) {
        clearTimeout(visibilityTimeout.current);
      }
    };
  }, [userId, validateSubscription]);

  return { 
    validateAndResubscribe,
    validateSubscription: () => validateSubscription(true),
  };
}
