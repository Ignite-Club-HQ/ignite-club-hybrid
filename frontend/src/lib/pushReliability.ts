/**
 * Push Notification Reliability Utilities
 * 
 * This module provides enhanced reliability features for push notifications:
 * - Exponential backoff retry logic
 * - Offline queue for subscription attempts
 * - Platform-specific strategies
 * - Structured logging with correlation IDs
 * - Stale subscription cleanup
 */

// ============================================
// STRUCTURED LOGGING
// ============================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface PushLogEntry {
  timestamp: string;
  level: LogLevel;
  correlationId: string;
  action: string;
  details?: Record<string, unknown>;
  platform?: string;
  userId?: string;
}

const LOG_STORAGE_KEY = 'push_reliability_logs';
const MAX_LOGS = 100;

// Generate a correlation ID for tracking related operations
export function generateCorrelationId(): string {
  return `push_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// Get current correlation ID from session or create new one
export function getOrCreateCorrelationId(): string {
  try {
    let id = sessionStorage.getItem('push_correlation_id');
    if (!id) {
      id = generateCorrelationId();
      sessionStorage.setItem('push_correlation_id', id);
    }
    return id;
  } catch {
    return generateCorrelationId();
  }
}

// Clear correlation ID (call when operation complete)
export function clearCorrelationId(): void {
  try {
    sessionStorage.removeItem('push_correlation_id');
  } catch {
    // Ignore
  }
}

// Structured logging with persistence
export function logPush(
  level: LogLevel,
  action: string,
  details?: Record<string, unknown>,
  correlationId?: string
): void {
  const entry: PushLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    correlationId: correlationId || getOrCreateCorrelationId(),
    action,
    details,
    platform: detectPlatformDetailed(),
  };

  // Console output
  const prefix = `[Push:${entry.correlationId.slice(-6)}]`;
  switch (level) {
    case 'debug':
      console.debug(prefix, action, details || '');
      break;
    case 'info':
      console.log(prefix, action, details || '');
      break;
    case 'warn':
      console.warn(prefix, action, details || '');
      break;
    case 'error':
      console.error(prefix, action, details || '');
      break;
  }

  // Persist logs for debugging
  persistLog(entry);
}

function persistLog(entry: PushLogEntry): void {
  try {
    const logs: PushLogEntry[] = JSON.parse(localStorage.getItem(LOG_STORAGE_KEY) || '[]');
    logs.push(entry);
    // Keep only recent logs
    while (logs.length > MAX_LOGS) {
      logs.shift();
    }
    localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logs));
  } catch {
    // Storage full or unavailable
  }
}

export function getRecentLogs(): PushLogEntry[] {
  try {
    return JSON.parse(localStorage.getItem(LOG_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function clearLogs(): void {
  try {
    localStorage.removeItem(LOG_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

// ============================================
// PLATFORM DETECTION
// ============================================

export type PushPlatform = 'ios-pwa' | 'ios-safari' | 'android-chrome' | 'android-samsung' | 'android-firefox' | 'android-other' | 'desktop-chrome' | 'desktop-firefox' | 'desktop-safari' | 'desktop-edge' | 'desktop-other' | 'unknown';

export interface PlatformInfo {
  platform: PushPlatform;
  supportsNativePush: boolean;
  requiresPWA: boolean;
  pushService: 'fcm' | 'apns' | 'mozilla' | 'unknown';
  reliabilityRating: 1 | 2 | 3 | 4 | 5; // 5 = most reliable
  notes: string;
}

export function detectPlatformDetailed(): PushPlatform {
  const ua = navigator.userAgent.toLowerCase();
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true;

  // iOS detection
  if (/iphone|ipad|ipod/.test(ua)) {
    return isStandalone ? 'ios-pwa' : 'ios-safari';
  }

  // Android detection - order matters (Samsung Internet contains "chrome" in UA)
  if (/android/.test(ua)) {
    // Samsung Internet browser detection (SamsungBrowser in UA)
    if (/samsungbrowser/.test(ua)) return 'android-samsung';
    if (/chrome/.test(ua) && !/edge|edg/.test(ua)) return 'android-chrome';
    if (/firefox/.test(ua)) return 'android-firefox';
    return 'android-other';
  }

  // Desktop detection
  if (/chrome/.test(ua) && !/edge|edg/.test(ua)) return 'desktop-chrome';
  if (/firefox/.test(ua)) return 'desktop-firefox';
  if (/safari/.test(ua) && /mac/.test(ua)) return 'desktop-safari';
  if (/edge|edg/.test(ua)) return 'desktop-edge';

  return 'desktop-other';
}

export function getPlatformInfo(): PlatformInfo {
  const platform = detectPlatformDetailed();

  const platformConfigs: Record<PushPlatform, Omit<PlatformInfo, 'platform'>> = {
    'ios-pwa': {
      supportsNativePush: true,
      requiresPWA: true,
      pushService: 'apns',
      reliabilityRating: 4,
      notes: 'iOS 16.4+ PWA. May need resubscription after 7 days of inactivity due to ITP.',
    },
    'ios-safari': {
      supportsNativePush: false,
      requiresPWA: true,
      pushService: 'apns',
      reliabilityRating: 1,
      notes: 'Must install as PWA (Add to Home Screen) for push support.',
    },
    'android-chrome': {
      supportsNativePush: true,
      requiresPWA: false,
      pushService: 'fcm',
      reliabilityRating: 5,
      notes: 'Most reliable. Uses Firebase Cloud Messaging.',
    },
    'android-samsung': {
      supportsNativePush: true,
      requiresPWA: false,
      pushService: 'fcm',
      reliabilityRating: 4,
      notes: 'Samsung Internet uses FCM. May need permission granted in browser settings first.',
    },
    'android-firefox': {
      supportsNativePush: true,
      requiresPWA: false,
      pushService: 'mozilla',
      reliabilityRating: 3,
      notes: 'Mozilla Push Service. May have delivery delays and background throttling.',
    },
    'android-other': {
      supportsNativePush: true,
      requiresPWA: false,
      pushService: 'fcm',
      reliabilityRating: 4,
      notes: 'Brave, etc. Generally reliable.',
    },
    'desktop-chrome': {
      supportsNativePush: true,
      requiresPWA: false,
      pushService: 'fcm',
      reliabilityRating: 5,
      notes: 'Highly reliable. Uses Firebase Cloud Messaging.',
    },
    'desktop-firefox': {
      supportsNativePush: true,
      requiresPWA: false,
      pushService: 'mozilla',
      reliabilityRating: 4,
      notes: 'Mozilla Push Service. Generally reliable on desktop.',
    },
    'desktop-safari': {
      supportsNativePush: true,
      requiresPWA: false,
      pushService: 'apns',
      reliabilityRating: 4,
      notes: 'macOS 13+ Safari. Uses Apple Push Notification service.',
    },
    'desktop-edge': {
      supportsNativePush: true,
      requiresPWA: false,
      pushService: 'fcm',
      reliabilityRating: 5,
      notes: 'Uses Firebase Cloud Messaging via Chromium.',
    },
    'desktop-other': {
      supportsNativePush: true,
      requiresPWA: false,
      pushService: 'unknown',
      reliabilityRating: 3,
      notes: 'Unknown browser. Push support may vary.',
    },
    'unknown': {
      supportsNativePush: false,
      requiresPWA: false,
      pushService: 'unknown',
      reliabilityRating: 1,
      notes: 'Unable to detect platform.',
    },
  };

  return {
    platform,
    ...platformConfigs[platform],
  };
}

// ============================================
// EXPONENTIAL BACKOFF RETRY
// ============================================

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

export async function withExponentialBackoff<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  shouldRetry: (error: Error, attempt: number) => boolean = () => true,
  correlationId?: string
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | null = null;
  const cid = correlationId || getOrCreateCorrelationId();

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    try {
      logPush('debug', `Attempt ${attempt}/${cfg.maxAttempts}`, undefined, cid);
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      logPush('warn', `Attempt ${attempt} failed`, {
        error: lastError.message,
        errorName: lastError.name,
      }, cid);

      if (attempt === cfg.maxAttempts || !shouldRetry(lastError, attempt)) {
        break;
      }

      const delay = Math.min(
        cfg.baseDelayMs * Math.pow(cfg.backoffMultiplier, attempt - 1),
        cfg.maxDelayMs
      );
      
      logPush('debug', `Waiting ${delay}ms before retry`, undefined, cid);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('All retry attempts failed');
}

// ============================================
// OFFLINE QUEUE
// ============================================

interface QueuedOperation {
  id: string;
  type: 'subscribe' | 'unsubscribe' | 'revalidate';
  userId: string;
  timestamp: number;
  attempts: number;
  lastAttempt?: number;
  error?: string;
}

const OFFLINE_QUEUE_KEY = 'push_offline_queue';
const MAX_QUEUE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getOfflineQueue(): QueuedOperation[] {
  try {
    const queue: QueuedOperation[] = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
    // Filter out old entries
    const now = Date.now();
    return queue.filter(op => now - op.timestamp < MAX_QUEUE_AGE_MS);
  } catch {
    return [];
  }
}

export function addToOfflineQueue(operation: Omit<QueuedOperation, 'id' | 'timestamp' | 'attempts'>): void {
  try {
    const queue = getOfflineQueue();
    
    // Don't add duplicates
    if (queue.some(op => op.type === operation.type && op.userId === operation.userId)) {
      logPush('debug', 'Operation already in queue', { type: operation.type });
      return;
    }

    queue.push({
      ...operation,
      id: generateCorrelationId(),
      timestamp: Date.now(),
      attempts: 0,
    });

    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    logPush('info', 'Added to offline queue', { type: operation.type });
  } catch {
    // Storage unavailable
  }
}

export function removeFromOfflineQueue(id: string): void {
  try {
    const queue = getOfflineQueue();
    const filtered = queue.filter(op => op.id !== id);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(filtered));
  } catch {
    // Ignore
  }
}

export function updateQueueOperation(id: string, updates: Partial<QueuedOperation>): void {
  try {
    const queue = getOfflineQueue();
    const idx = queue.findIndex(op => op.id === id);
    if (idx >= 0) {
      queue[idx] = { ...queue[idx], ...updates };
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    }
  } catch {
    // Ignore
  }
}

export function clearOfflineQueue(): void {
  try {
    localStorage.removeItem(OFFLINE_QUEUE_KEY);
  } catch {
    // Ignore
  }
}

// ============================================
// SUBSCRIPTION FRESHNESS TRACKING
// ============================================

const SUBSCRIPTION_FRESHNESS_KEY = 'push_subscription_freshness';
const FRESHNESS_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours (reduced from 4)

// iOS ITP can evict data after 7 days of inactivity
// We proactively renew at 5 days to be safe
const IOS_RENEWAL_THRESHOLD_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

interface SubscriptionFreshness {
  lastValidated: number;
  lastSuccessfulPush?: number;
  consecutiveFailures: number;
  endpoint?: string;
  createdAt?: number; // When subscription was first created
  lastRenewal?: number; // When subscription was last renewed
}

export function getSubscriptionFreshness(): SubscriptionFreshness | null {
  try {
    const data = localStorage.getItem(SUBSCRIPTION_FRESHNESS_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export function updateSubscriptionFreshness(updates: Partial<SubscriptionFreshness>): void {
  try {
    const current = getSubscriptionFreshness() || {
      lastValidated: 0,
      consecutiveFailures: 0,
      createdAt: Date.now(),
    };
    localStorage.setItem(SUBSCRIPTION_FRESHNESS_KEY, JSON.stringify({
      ...current,
      ...updates,
    }));
  } catch {
    // Ignore
  }
}

export function markSubscriptionValidated(endpoint?: string): void {
  const current = getSubscriptionFreshness();
  updateSubscriptionFreshness({
    lastValidated: Date.now(),
    consecutiveFailures: 0,
    endpoint,
    // Set createdAt if not already set
    createdAt: current?.createdAt || Date.now(),
  });
}

export function markSubscriptionRenewed(): void {
  updateSubscriptionFreshness({
    lastRenewal: Date.now(),
    consecutiveFailures: 0,
    createdAt: Date.now(), // Reset creation time on renewal
  });
}

export function markSubscriptionFailed(): void {
  const current = getSubscriptionFreshness();
  updateSubscriptionFreshness({
    consecutiveFailures: (current?.consecutiveFailures || 0) + 1,
  });
}

export function needsRevalidation(): boolean {
  const freshness = getSubscriptionFreshness();
  if (!freshness) return true;
  
  const age = Date.now() - freshness.lastValidated;
  
  // Revalidate if:
  // - More than threshold time has passed
  // - There have been consecutive failures
  return age > FRESHNESS_THRESHOLD_MS || freshness.consecutiveFailures > 0;
}

/**
 * Check if iOS PWA subscription needs proactive renewal
 * iOS ITP can evict localStorage/session data after 7 days of inactivity
 */
export function needsIOSProactiveRenewal(): boolean {
  const platform = detectPlatformDetailed();
  
  // Only applies to iOS PWA
  if (platform !== 'ios-pwa') return false;
  
  const freshness = getSubscriptionFreshness();
  if (!freshness) return true; // No record, needs renewal
  
  const createdAt = freshness.createdAt || freshness.lastRenewal || freshness.lastValidated;
  const age = Date.now() - createdAt;
  
  // Renew if subscription is older than threshold (5 days)
  return age > IOS_RENEWAL_THRESHOLD_MS;
}

export function clearSubscriptionFreshness(): void {
  try {
    localStorage.removeItem(SUBSCRIPTION_FRESHNESS_KEY);
  } catch {
    // Ignore
  }
}

// ============================================
// SERVICE WORKER UPDATE CHECK
// ============================================

export async function checkServiceWorkerUpdate(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return false;

    // Force update check
    await registration.update();
    
    // Check if there's a waiting worker
    if (registration.waiting) {
      logPush('info', 'New service worker waiting to activate');
      return true;
    }

    return false;
  } catch (error) {
    logPush('warn', 'Failed to check SW update', { error: String(error) });
    return false;
  }
}

export async function activateWaitingServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      logPush('info', 'Activated waiting service worker');
    }
  } catch (error) {
    logPush('warn', 'Failed to activate waiting SW', { error: String(error) });
  }
}

// ============================================
// PERMISSION STATE TRACKING
// ============================================

const PERMISSION_STATE_KEY = 'push_permission_state';

export function getStoredPermissionState(): NotificationPermission | null {
  try {
    return localStorage.getItem(PERMISSION_STATE_KEY) as NotificationPermission | null;
  } catch {
    return null;
  }
}

export function storePermissionState(state: NotificationPermission): void {
  try {
    localStorage.setItem(PERMISSION_STATE_KEY, state);
  } catch {
    // Ignore
  }
}

export function permissionWasRevoked(): boolean {
  const stored = getStoredPermissionState();
  const current = typeof Notification !== 'undefined' ? Notification.permission : 'default';
  
  // Permission was revoked if we had 'granted' and now have 'denied'
  return stored === 'granted' && current === 'denied';
}

// ============================================
// DIAGNOSTIC EXPORT
// ============================================

export interface PushDiagnostics {
  platform: PlatformInfo;
  permission: NotificationPermission;
  permissionWasRevoked: boolean;
  freshness: SubscriptionFreshness | null;
  offlineQueue: QueuedOperation[];
  recentLogs: PushLogEntry[];
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  isStandalone: boolean;
}

export async function getPushDiagnostics(): Promise<PushDiagnostics> {
  const hasSW = 'serviceWorker' in navigator;
  const hasPush = 'PushManager' in window;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true;

  return {
    platform: getPlatformInfo(),
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
    permissionWasRevoked: permissionWasRevoked(),
    freshness: getSubscriptionFreshness(),
    offlineQueue: getOfflineQueue(),
    recentLogs: getRecentLogs().slice(-20),
    hasServiceWorker: hasSW,
    hasPushManager: hasPush,
    isStandalone,
  };
}
