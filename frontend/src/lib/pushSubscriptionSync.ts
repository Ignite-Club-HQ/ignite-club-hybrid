/**
 * Push Subscription Synchronization
 * 
 * Handles syncing browser push subscriptions with the database,
 * cleaning up stale entries, and ensuring consistency.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  logPush,
  generateCorrelationId,
  markSubscriptionValidated,
  markSubscriptionFailed,
  getPlatformInfo,
  withExponentialBackoff,
  addToOfflineQueue,
  removeFromOfflineQueue,
  getOfflineQueue,
  updateQueueOperation,
  storePermissionState,
  permissionWasRevoked,
  clearSubscriptionFreshness,
} from "./pushReliability";

// ============================================
// STALE SUBSCRIPTION CLEANUP
// ============================================

/**
 * Remove database subscriptions that no longer exist in the browser
 */
export async function cleanupStaleSubscriptions(userId: string): Promise<{ removed: number; error?: string }> {
  const correlationId = generateCorrelationId();
  logPush('info', 'Starting stale subscription cleanup', { userId }, correlationId);

  try {
    // Get current browser subscription
    let browserEndpoint: string | null = null;
    
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        browserEndpoint = subscription?.endpoint || null;
      } catch (e) {
        logPush('warn', 'Could not get browser subscription', { error: String(e) }, correlationId);
      }
    }

    // Get all DB subscriptions for this user
    const { data: dbSubscriptions, error: fetchError } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint')
      .eq('user_id', userId);

    if (fetchError) {
      logPush('error', 'Failed to fetch DB subscriptions', { error: fetchError.message }, correlationId);
      return { removed: 0, error: fetchError.message };
    }

    if (!dbSubscriptions || dbSubscriptions.length === 0) {
      logPush('info', 'No DB subscriptions to clean', undefined, correlationId);
      return { removed: 0 };
    }

    // Find stale subscriptions (in DB but not matching browser)
    const staleIds: string[] = [];
    for (const sub of dbSubscriptions) {
      if (!browserEndpoint || sub.endpoint !== browserEndpoint) {
        staleIds.push(sub.id);
      }
    }

    if (staleIds.length === 0) {
      logPush('info', 'No stale subscriptions found', undefined, correlationId);
      return { removed: 0 };
    }

    // Delete stale subscriptions
    const { error: deleteError } = await supabase
      .from('push_subscriptions')
      .delete()
      .in('id', staleIds);

    if (deleteError) {
      logPush('error', 'Failed to delete stale subscriptions', { error: deleteError.message }, correlationId);
      return { removed: 0, error: deleteError.message };
    }

    logPush('info', 'Cleaned up stale subscriptions', { count: staleIds.length }, correlationId);
    return { removed: staleIds.length };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logPush('error', 'Cleanup failed', { error: msg }, correlationId);
    return { removed: 0, error: msg };
  }
}

/**
 * Handle case where user revoked notification permission
 * Cleans up DB and local state
 */
export async function handlePermissionRevoked(userId: string): Promise<void> {
  const correlationId = generateCorrelationId();
  logPush('info', 'Handling permission revocation', { userId }, correlationId);

  try {
    // Clear DB subscriptions
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId);

    // Clear local state
    clearSubscriptionFreshness();
    
    // Update stored permission
    storePermissionState('denied');

    logPush('info', 'Cleaned up after permission revocation', undefined, correlationId);
  } catch (error) {
    logPush('error', 'Error handling permission revocation', { error: String(error) }, correlationId);
  }
}

// ============================================
// OFFLINE QUEUE PROCESSING
// ============================================

/**
 * Process any queued subscription operations
 * Call this when device comes back online
 */
export async function processOfflineQueue(
  subscribeHandler: (userId: string) => Promise<{ success: boolean; error?: string }>
): Promise<{ processed: number; failed: number }> {
  const queue = getOfflineQueue();
  if (queue.length === 0) {
    return { processed: 0, failed: 0 };
  }

  const correlationId = generateCorrelationId();
  logPush('info', 'Processing offline queue', { count: queue.length }, correlationId);

  let processed = 0;
  let failed = 0;

  for (const operation of queue) {
    // Skip if too many attempts
    if (operation.attempts >= 3) {
      logPush('warn', 'Operation exceeded max attempts, removing', { id: operation.id }, correlationId);
      removeFromOfflineQueue(operation.id);
      failed++;
      continue;
    }

    try {
      updateQueueOperation(operation.id, {
        attempts: operation.attempts + 1,
        lastAttempt: Date.now(),
      });

      if (operation.type === 'subscribe' || operation.type === 'revalidate') {
        const result = await subscribeHandler(operation.userId);
        if (result.success) {
          removeFromOfflineQueue(operation.id);
          processed++;
          logPush('info', 'Queue operation succeeded', { id: operation.id }, correlationId);
        } else {
          updateQueueOperation(operation.id, { error: result.error });
          failed++;
        }
      } else if (operation.type === 'unsubscribe') {
        // Handle unsubscribe
        await supabase
          .from('push_subscriptions')
          .delete()
          .eq('user_id', operation.userId);
        removeFromOfflineQueue(operation.id);
        processed++;
      }
    } catch (error) {
      updateQueueOperation(operation.id, { error: String(error) });
      failed++;
    }
  }

  logPush('info', 'Queue processing complete', { processed, failed }, correlationId);
  return { processed, failed };
}

// ============================================
// SUBSCRIPTION VERIFICATION
// ============================================

/**
 * Verify subscription is valid in both browser and database
 * Returns true if healthy, false if needs resubscription
 */
export async function verifySubscriptionHealth(userId: string): Promise<{
  healthy: boolean;
  browserHasSubscription: boolean;
  dbHasSubscription: boolean;
  endpointsMatch: boolean;
  reason?: string;
}> {
  const correlationId = generateCorrelationId();
  logPush('info', 'Verifying subscription health', { userId }, correlationId);

  const result = {
    healthy: false,
    browserHasSubscription: false,
    dbHasSubscription: false,
    endpointsMatch: false,
    reason: undefined as string | undefined,
  };

  try {
    // Check permission first
    if (permissionWasRevoked()) {
      result.reason = 'Permission was revoked';
      await handlePermissionRevoked(userId);
      return result;
    }

    // Check browser subscription
    let browserEndpoint: string | null = null;
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        browserEndpoint = subscription?.endpoint || null;
        result.browserHasSubscription = !!browserEndpoint;
      } catch (e) {
        logPush('warn', 'Could not get browser subscription', { error: String(e) }, correlationId);
      }
    }

    // Check database subscription
    const { data: dbSub, error } = await supabase
      .from('push_subscriptions')
      .select('endpoint')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logPush('warn', 'DB query failed', { error: error.message }, correlationId);
      result.reason = 'Database error';
      return result;
    }

    result.dbHasSubscription = !!dbSub?.endpoint;

    // Check if endpoints match
    if (browserEndpoint && dbSub?.endpoint) {
      result.endpointsMatch = browserEndpoint === dbSub.endpoint;
    }

    // Determine health
    if (result.browserHasSubscription && result.dbHasSubscription && result.endpointsMatch) {
      result.healthy = true;
      markSubscriptionValidated(browserEndpoint!);
      logPush('info', 'Subscription is healthy', undefined, correlationId);
    } else {
      if (!result.browserHasSubscription) {
        result.reason = 'No browser subscription';
      } else if (!result.dbHasSubscription) {
        result.reason = 'No database subscription';
      } else if (!result.endpointsMatch) {
        result.reason = 'Endpoint mismatch';
      }
      markSubscriptionFailed();
      logPush('warn', 'Subscription unhealthy', { reason: result.reason }, correlationId);
    }

    return result;
  } catch (error) {
    result.reason = String(error);
    logPush('error', 'Health check failed', { error: result.reason }, correlationId);
    return result;
  }
}

// ============================================
// RESILIENT SUBSCRIPTION
// ============================================

/**
 * Subscribe with enhanced reliability
 * - Retries with exponential backoff
 * - Queues for offline processing
 * - Handles platform-specific quirks
 */
export async function resilientSubscribe(
  userId: string,
  subscribeHandler: (userId: string) => Promise<{ success: boolean; error?: string }>
): Promise<{ success: boolean; error?: string; queued?: boolean }> {
  const correlationId = generateCorrelationId();
  const platform = getPlatformInfo();
  
  logPush('info', 'Starting resilient subscribe', { 
    userId, 
    platform: platform.platform,
    reliability: platform.reliabilityRating,
  }, correlationId);

  // Force clear any stale lock before attempting - this is a deliberate retry so lock shouldn't block
  try {
    const { forceUnlockPushSubscription } = await import('@/lib/pushNotifications');
    forceUnlockPushSubscription();
    logPush('debug', 'Cleared push lock before resilient subscribe', undefined, correlationId);
  } catch (e) {
    // Ignore - function might not be available
  }

  // Check if offline
  if (!navigator.onLine) {
    addToOfflineQueue({ type: 'subscribe', userId });
    logPush('info', 'Device offline, queued for later', undefined, correlationId);
    return { success: false, queued: true, error: 'Device offline. Will retry when online.' };
  }

  // Platform-specific pre-checks
  if (!platform.supportsNativePush) {
    if (platform.requiresPWA) {
      return { 
        success: false, 
        error: 'Please install this app (Add to Home Screen) to enable push notifications.',
      };
    }
    return { 
      success: false, 
      error: 'Push notifications are not supported on this browser/platform.',
    };
  }

  // Determine retry behavior based on error type
  const shouldRetry = (error: Error, attempt: number): boolean => {
    // Don't retry permission errors
    if (error.name === 'NotAllowedError' || error.message.includes('permission')) {
      return false;
    }
    // Always retry network errors
    if (error.message.includes('network') || error.message.includes('offline')) {
      return true;
    }
    // Retry AbortError up to 3 times
    if (error.name === 'AbortError' && attempt < 3) {
      return true;
    }
    // Default: retry first 2 attempts
    return attempt < 2;
  };

  try {
    const result = await withExponentialBackoff(
      () => subscribeHandler(userId),
      { maxAttempts: 3, baseDelayMs: 1500, maxDelayMs: 10000 },
      (error) => shouldRetry(error, 0),
      correlationId
    );

    if (result.success) {
      markSubscriptionValidated();
      logPush('info', 'Resilient subscribe succeeded', undefined, correlationId);
    } else {
      markSubscriptionFailed();
      logPush('warn', 'Resilient subscribe failed', { error: result.error }, correlationId);
    }

    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    markSubscriptionFailed();
    
    // Queue for retry if it seems like a transient error
    if (msg.includes('network') || msg.includes('timeout') || msg.includes('AbortError')) {
      addToOfflineQueue({ type: 'subscribe', userId });
      logPush('info', 'Queued for retry after error', { error: msg }, correlationId);
      return { success: false, queued: true, error: `${msg} - Will retry automatically.` };
    }

    logPush('error', 'Resilient subscribe error', { error: msg }, correlationId);
    return { success: false, error: msg };
  }
}
