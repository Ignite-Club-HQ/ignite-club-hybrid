/**
 * Native Push Notifications using Capacitor + Firebase Cloud Messaging
 * 
 * This module handles push notifications for native Android/iOS apps
 * wrapped with Capacitor. Falls back gracefully when running in web browser.
 * 
 * IMPORTANT: Firebase must be properly configured with google-services.json (Android)
 * or GoogleService-Info.plist (iOS) for push notifications to work.
 * Without these files, attempting to use Firebase plugins will crash the app.
 */

import { supabase } from '@/integrations/supabase/client';
import { isNotificationPrefetchEnabled } from './notificationPrefetchFlag';
import { prefetchChatChunkForUrl } from './chatChunkPrefetch';

// Lazy load Capacitor core to prevent crashes if not available
let Capacitor: any = null;
let capacitorLoaded = false;

// Lazy load plugins to prevent import-time crashes when Firebase isn't configured
let PushNotifications: any = null;
let FirebaseMessaging: any = null;
let pluginsChecked = false;
let pluginsAvailable = false;
let firebaseLoadFailed = false;

// Keep the optional native Firebase plugin out of the web bundle. Capacitor
// resolves this module inside native builds where the plugin is installed.
const loadOptionalNativeModule = (specifier: string) =>
  new Function('moduleName', 'return import(moduleName)')(specifier) as Promise<any>;

// Safely load Capacitor core
async function loadCapacitor(): Promise<boolean> {
  if (capacitorLoaded) return Capacitor !== null;
  
  try {
    const capacitorModule = await import('@capacitor/core');
    Capacitor = capacitorModule.Capacitor;
    capacitorLoaded = true;
    return true;
  } catch (err) {
    console.warn('[NativePush] Capacitor not available:', err);
    capacitorLoaded = true;
    return false;
  }
}

// Check if we're on a native platform (must be called after loadCapacitor)
function checkIsNative(): boolean {
  if (!Capacitor) return false;
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

async function loadPlugins(): Promise<boolean> {
  // Only check once to avoid repeated failures
  if (pluginsChecked) {
    // Even if plugins were checked, retry Firebase if it failed previously
    // (timing issue on cold start can cause first check to fail)
    if (pluginsAvailable && !FirebaseMessaging && !firebaseLoadFailed) {
      await tryLoadFirebase();
    }
    return pluginsAvailable;
  }
  pluginsChecked = true;
  
  // First ensure Capacitor is loaded
  const capacitorOk = await loadCapacitor();
  if (!capacitorOk || !checkIsNative()) {
    console.log('[NativePush] Not a native platform, skipping plugin load');
    return false;
  }
  
  try {
    // Load PushNotifications first - this is less likely to crash
    if (!PushNotifications) {
      const pushModule = await import('@capacitor/push-notifications');
      PushNotifications = pushModule.PushNotifications;
    }
    
    // Try loading Firebase
    await tryLoadFirebase();
    
    pluginsAvailable = PushNotifications !== null;
    return pluginsAvailable;
  } catch (err) {
    console.warn('[NativePush] Failed to load plugins:', err);
    return false;
  }
}

// Separate function so Firebase can be retried independently
async function tryLoadFirebase(): Promise<void> {
  if (FirebaseMessaging || firebaseLoadFailed) return;
  
  try {
    const fcmModule = await loadOptionalNativeModule('@capacitor-firebase/messaging');
    FirebaseMessaging = fcmModule.FirebaseMessaging;
    
    // Test if Firebase is actually usable
    await FirebaseMessaging.checkPermissions();
    console.log('[NativePush] Firebase Messaging loaded and available');
  } catch (fcmErr: any) {
    const msg = fcmErr?.message || String(fcmErr);
    console.warn('[NativePush] Firebase Messaging not available:', msg);
    
    // Only permanently give up if it's a definitive failure (missing config)
    // Transient failures (timing) should be retried
    if (msg.includes('not implemented') || msg.includes('not installed')) {
      firebaseLoadFailed = true;
    }
    FirebaseMessaging = null;
  }
}

// Platform detection - safe synchronous checks
export function isNativePlatform(): boolean {
  // Check window.Capacitor which is injected by Capacitor in native WebViews
  // This works synchronously without needing dynamic imports
  const windowCapacitor = (window as any).Capacitor;
  
  if (windowCapacitor) {
    // Cache it for later use
    if (!Capacitor) {
      Capacitor = windowCapacitor;
      capacitorLoaded = true;
    }
    try {
      const isNative = windowCapacitor.isNativePlatform?.() ?? false;
      console.log('[NativePush] isNativePlatform check (window.Capacitor):', isNative);
      return isNative;
    } catch {
      return false;
    }
  }
  
  // Fallback to cached Capacitor if already loaded via async
  if (capacitorLoaded && Capacitor) {
    const isNative = checkIsNative();
    console.log('[NativePush] isNativePlatform check (cached):', isNative);
    return isNative;
  }
  
  // Not loaded yet and no window.Capacitor - assume web
  console.log('[NativePush] isNativePlatform: no Capacitor detected, assuming web');
  return false;
}

export function getPlatform(): 'android' | 'ios' | 'web' {
  if (!Capacitor) return 'web';
  try {
    const platform = Capacitor.getPlatform();
    if (platform === 'android') return 'android';
    if (platform === 'ios') return 'ios';
  } catch {
    // Capacitor not properly initialized
  }
  return 'web';
}

// FCM token types (since table is new and not in generated types yet)
interface FCMToken {
  id: string;
  user_id: string;
  token: string;
  platform: 'android' | 'ios';
  created_at: string;
  updated_at: string;
}

// Get native app version info
async function getAppVersion(): Promise<{ version: string; build: string } | null> {
  try {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    return { version: info.version, build: info.build };
  } catch {
    return null;
  }
}

// Store FCM token in database
async function saveFCMToken(userId: string, token: string): Promise<boolean> {
  console.log('[NativePush] Saving FCM token for user:', userId);
  
  try {
    const platform = getPlatform();
    const versionInfo = await getAppVersion();
    
    // IMPORTANT: Use security definer RPC to remove this token from other users.
    // Direct .delete() is blocked by RLS since users can't delete other users' rows.
    await supabase.rpc('cleanup_fcm_token_for_user', {
      p_token: token,
      p_user_id: userId,
    });
    
    // Use direct upsert - 'as any' needed since fcm_tokens is new and not in generated types
    const { error: insertError } = await supabase
      .from('fcm_tokens' as any)
      .upsert(
        {
          user_id: userId,
          token,
          platform,
          app_version: versionInfo?.version ?? null,
          build_number: versionInfo?.build ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,token' }
      );
    
    if (insertError && !insertError.message?.includes('duplicate')) {
      console.error('[NativePush] Error saving token:', insertError);
      return false;
    }
    
    console.log('[NativePush] Token saved successfully');
    return true;
  } catch (err) {
    console.error('[NativePush] Error in saveFCMToken:', err);
    return false;
  }
}

// Remove FCM token from database
async function removeFCMToken(userId: string, token: string): Promise<void> {
  try {
    await supabase
      .from('fcm_tokens' as any)
      .delete()
      .eq('user_id', userId)
      .eq('token', token);
  } catch (err) {
    console.error('[NativePush] Error removing token:', err);
  }
}

// Request permission for native push notifications
export async function requestNativePermission(): Promise<'granted' | 'denied' | 'prompt'> {
  if (!isNativePlatform()) {
    console.log('[NativePush] Not a native platform, skipping');
    return 'denied';
  }

  try {
    const loaded = await loadPlugins();
    if (!loaded || !PushNotifications) {
      console.warn('[NativePush] Plugins not available');
      return 'denied';
    }
    
    const result = await PushNotifications.requestPermissions();
    console.log('[NativePush] Permission result:', result.receive);
    
    if (result.receive === 'granted') {
      return 'granted';
    } else if (result.receive === 'denied') {
      return 'denied';
    }
    return 'prompt';
  } catch (err) {
    console.error('[NativePush] Error requesting permission:', err);
    return 'denied';
  }
}

// Check current permission status
export async function checkNativePermission(): Promise<'granted' | 'denied' | 'prompt'> {
  if (!isNativePlatform()) {
    return 'denied';
  }

  try {
    const loaded = await loadPlugins();
    if (!loaded || !PushNotifications) return 'denied';
    
    const result = await PushNotifications.checkPermissions();
    if (result.receive === 'granted') return 'granted';
    if (result.receive === 'denied') return 'denied';
    return 'prompt';
  } catch {
    return 'denied';
  }
}

// Check for launch notification (notification that opened the app from cold start)
export async function getLaunchNotification(): Promise<any | null> {
  if (!isNativePlatform()) return null;
  
  try {
    const loaded = await loadPlugins();
    if (!loaded || !PushNotifications) return null;
    
    // This returns the notification that was used to launch the app
    const launchNotification = await PushNotifications.getDeliveredNotifications();
    console.log('[NativePush] Checking for launch notification, delivered:', launchNotification);
    
    // On Android, we can also check the launch URL from App plugin
    return null; // Capacitor doesn't directly expose this, but pushNotificationActionPerformed should fire
  } catch (err) {
    console.warn('[NativePush] Error checking launch notification:', err);
    return null;
  }
}

// Initialize native push notifications
export async function initializeNativePush(userId: string): Promise<{ success: boolean; error?: string }> {
  console.log('[NativePush] initializeNativePush called with userId:', userId);
  
  if (!isNativePlatform()) {
    console.log('[NativePush] Not a native platform, returning early');
    return { success: false, error: 'Not a native platform' };
  }

  console.log('[NativePush] Initializing for user:', userId);

  try {
    // Load plugins first
    console.log('[NativePush] Loading plugins...');
    const loaded = await loadPlugins();
    console.log('[NativePush] Plugins loaded:', loaded);
    
    if (!loaded) {
      return { success: false, error: 'Failed to load push plugins' };
    }

    // Request permission
    console.log('[NativePush] Requesting permission...');
    let permission: 'granted' | 'denied' | 'prompt';
    try {
      permission = await requestNativePermission();
      console.log('[NativePush] Permission result:', permission);
    } catch (permErr) {
      console.warn('[NativePush] Permission request failed:', permErr);
      return { success: false, error: 'Push plugin not available' };
    }
    
    if (permission !== 'granted') {
      return { success: false, error: 'Push notification permission denied' };
    }

    // Create the default notification channel on Android 8+
    // Without this, FCM messages targeting channel_id 'default' are silently dropped
    if (getPlatform() === 'android') {
      try {
        await PushNotifications.createChannel({
          id: 'default',
          name: 'Default',
          description: 'Default notification channel',
          importance: 5, // IMPORTANCE_HIGH
          visibility: 1, // PUBLIC
          sound: 'default',
          vibration: true,
        });
        console.log('[NativePush] Android default channel created');
      } catch (chanErr) {
        console.warn('[NativePush] Failed to create channel (may already exist):', chanErr);
      }
    }

    // Get FCM token
    // IMPORTANT: On iOS, PushNotifications.register() triggers APNs registration.
    // The 'registration' event returns the APNs device token, NOT the FCM token.
    // We must use FirebaseMessaging.getToken() to get the actual FCM token.
    // On Android, PushNotifications.register() returns the FCM token directly,
    // but we use FirebaseMessaging.getToken() on both platforms for consistency.
    let token: string | undefined;
    const platform = getPlatform();

    // Set up registration event listener to know when APNs registration completes (iOS)
    // or to get the FCM token directly (Android)
    let regHandle: any = null;
    let errHandle: any = null;
    const registrationComplete = new Promise<string | undefined>((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[NativePush] Registration event timed out after 15s');
        resolve(undefined);
      }, 15000);

      const cleanup = () => {
        clearTimeout(timeout);
        // Remove listeners to prevent accumulation on repeated calls (e.g. app resume)
        regHandle?.then?.((h: any) => h.remove()).catch(() => {});
        errHandle?.then?.((h: any) => h.remove()).catch(() => {});
      };

      regHandle = PushNotifications.addListener('registration', (result: any) => {
        cleanup();
        const t = result?.value || result?.token;
        if (platform === 'ios') {
          // On iOS this is the APNs token, NOT the FCM token - log but don't use it
          console.log('[NativePush] iOS APNs registration complete (token received, will use FirebaseMessaging.getToken() for FCM token)');
          resolve(undefined); // Signal registration is done, but don't return APNs token
        } else {
          // On Android, this IS the FCM token
          console.log('[NativePush] Android registration event received FCM token:', t ? t.substring(0, 20) + '...' : 'none');
          resolve(t);
        }
      });
      regHandle?.catch?.(() => { cleanup(); resolve(undefined); });

      errHandle = PushNotifications.addListener('registrationError', (err: any) => {
        cleanup();
        console.error('[NativePush] Registration error event:', JSON.stringify(err));
        resolve(undefined);
      });
      errHandle?.catch?.(() => {});
    });

    // Register with push service (triggers APNs on iOS, FCM on Android)
    console.log('[NativePush] Registering with push service...');
    try {
      await PushNotifications.register();
      console.log('[NativePush] Register call completed');
    } catch (regErr) {
      console.warn('[NativePush] Registration failed:', regErr);
      return { success: false, error: 'Push registration failed' };
    }

    // Wait for native registration to complete
    const registrationToken = await registrationComplete;
    
    if (platform === 'android' && registrationToken) {
      // Android: registration event gave us the FCM token directly
      token = registrationToken;
    }

    // iOS (always) and Android (fallback): Use FirebaseMessaging.getToken() for the FCM token
    // On iOS, this is the ONLY way to get the FCM token after APNs registration
    if (!token && FirebaseMessaging) {
      console.log(`[NativePush] Getting FCM token via FirebaseMessaging.getToken() (platform: ${platform})...`);
      // iOS needs more retries because APNs→FCM token exchange is async
      const maxRetries = platform === 'ios' ? 10 : 3;
      const retryDelayMs = platform === 'ios' ? 1500 : 1000;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const tokenResult = await FirebaseMessaging.getToken();
          token = tokenResult.token;
          if (token) {
            console.log(`[NativePush] Got FCM token via getToken() on attempt ${attempt}/${maxRetries}: ${token.substring(0, 20)}...`);
            break;
          } else {
            console.warn(`[NativePush] getToken() attempt ${attempt}/${maxRetries} returned empty token`);
          }
        } catch (tokenErr: any) {
          console.warn(`[NativePush] getToken() attempt ${attempt}/${maxRetries} failed:`, tokenErr?.message || tokenErr);
        }

        if (attempt < maxRetries) {
          console.log(`[NativePush] Waiting ${retryDelayMs}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
      }
    } else if (!token && !FirebaseMessaging) {
      console.error('[NativePush] FirebaseMessaging not available - cannot get FCM token');
    }
    
    if (!token) {
      console.error('[NativePush] Failed to get FCM token via all methods');
      return { success: false, error: `Failed to get FCM token on ${platform} - ${platform === 'ios' ? 'APNs-to-FCM exchange may have failed' : 'registration failed'}` };
    }

    console.log('[NativePush] Got FCM token:', token.substring(0, 20) + '...');

    // Save token to database
    const saved = await saveFCMToken(userId, token);
    if (!saved) {
      return { success: false, error: 'Failed to save FCM token' };
    }

    return { success: true };
  } catch (err) {
    console.error('[NativePush] Unexpected error initializing:', err);
    return { success: false, error: String(err) };
  }
}

// Setup push notification listeners
export function setupNativePushListeners(
  onNotificationReceived?: (notification: any) => void,
  onNotificationAction?: (notification: any) => void,
  onTokenRefresh?: (token: string) => void
): () => void {
  if (!isNativePlatform()) {
    return () => {};
  }

  // If plugins haven't been loaded yet, we can't set up listeners
  if (!PushNotifications) {
    console.warn('[NativePush] Cannot setup listeners - plugins not loaded');
    return () => {};
  }

  console.log('[NativePush] Setting up listeners');

  let receivedListener: Promise<any> | null = null;
  let actionListener: Promise<any> | null = null;
  let tokenListener: Promise<any> | null = null;

  try {
    receivedListener = PushNotifications.addListener(
      'pushNotificationReceived',
      (notification: any) => {
        console.log('[NativePush] Notification received:', notification);
        
        // Handle force_update_prompt in foreground too
        const data = notification?.data;
        if (data?.force_update_prompt === 'true') {
          console.log('[NativePush] Force update prompt detected in foreground notification');
          window.dispatchEvent(new CustomEvent('force-update-prompt', {
            detail: { storeUrl: data?.store_url },
          }));
          return;
        }

        // PERF: warm the target chat page's JS chunk NOW (on receive), not
        // later when the user taps. Gated by the app-admin kill-switch
        // `notification_prefetch_enabled` so we can disable remotely without
        // shipping a new build. See the chat_open_perf audit — Android
        // tap→chunk-loaded was p50 379ms / p95 1.2s because prefetch fired
        // on the same tick as navigate.
        try {
          if (isNotificationPrefetchEnabled()) {
            const rawUrl = data?.url || data?.link || data?.path;
            if (rawUrl) prefetchChatChunkForUrl(rawUrl);
          }
        } catch {
          // Never let a perf hint break notification delivery.
        }

        onNotificationReceived?.(notification);
      }
    );
  } catch (err) {
    console.warn('[NativePush] Failed to add received listener:', err);
  }

  // BUG-1 fix: the `pushNotificationActionPerformed` listener is registered
  // exactly ONCE in src/lib/notificationLaunchHandler.ts. Do NOT register a
  // second listener here — duplicate registrations caused 2-3 navigate()
  // calls per tap and a broken back stack. The `onNotificationAction`
  // callback is intentionally ignored; navigation, force-update prompts and
  // external URL handling are all centralized in the launch handler.
  void onNotificationAction;


  try {
    if (FirebaseMessaging) {
      tokenListener = FirebaseMessaging.addListener(
        'tokenReceived',
        (event: any) => {
          console.log('[NativePush] Token refreshed');
          onTokenRefresh?.(event.token);
        }
      );
    }
  } catch (err) {
    console.warn('[NativePush] Failed to add token listener:', err);
  }

  return () => {
    receivedListener?.then(l => l.remove()).catch(() => {});
    actionListener?.then(l => l.remove()).catch(() => {});
    tokenListener?.then(l => l.remove()).catch(() => {});
  };
}

// Unregister from push notifications
export async function unregisterNativePush(userId: string): Promise<void> {
  if (!isNativePlatform()) return;

  try {
    const loaded = await loadPlugins();
    if (!loaded || !FirebaseMessaging) return;
    
    const tokenResult = await FirebaseMessaging.getToken();
    if (tokenResult.token) {
      await removeFCMToken(userId, tokenResult.token);
    }

    await FirebaseMessaging.deleteToken();
    console.log('[NativePush] Unregistered successfully');
  } catch (err) {
    console.error('[NativePush] Error unregistering:', err);
  }
}

// Check if native push is available and enabled
export async function isNativePushAvailable(): Promise<boolean> {
  if (!isNativePlatform()) return false;
  
  try {
    const permission = await checkNativePermission();
    return permission === 'granted';
  } catch {
    return false;
  }
}
