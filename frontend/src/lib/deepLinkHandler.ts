import { App, URLOpenListenerEvent } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';
import { navigateApp } from '@/lib/appNavigator';
import {
  beginLaunchIntentResolution,
  markLaunchUrlReceived,
} from '@/lib/nativeLaunchIntent';
import { abandonPendingNotificationNavigation } from '@/lib/notificationLaunchHandler';

/**
 * Initialize deep link handling for native apps
 * This captures OAuth callbacks when the system browser redirects back to the app
 */
export function initDeepLinkHandler() {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  console.log('[DeepLink] Initializing deep link handler for native platform');

  // Cold start: when a link launches the app, `appUrlOpen` has already fired
  // (or fires before React mounts), so the launch URL must be read explicitly.
  // The read is async while React/Router mount synchronously, so it runs behind
  // an explicit readiness boundary (see `nativeLaunchIntent`) that stops the
  // protected "/" route from redirecting to generic /auth first. Transient
  // rejections are retried a bounded number of times.
  beginLaunchIntentResolution(
    () => App.getLaunchUrl(),
    (url) => handleDeepLinkUrl(url),
  );

  App.addListener('appUrlOpen', async (event: URLOpenListenerEvent) => {
    console.log('[DeepLink] App opened with URL:', event.url);
    // A URL from the OS settles the startup boundary immediately, even if the
    // launch-URL read is still pending or retrying.
    markLaunchUrlReceived();
    handleDeepLinkUrl(event.url);
  });
}

// Short-lived dedupe: one OS tap can arrive via both `getLaunchUrl` and
// `appUrlOpen`, which must produce a single navigation. A permanent record
// would swallow a genuine later tap on the same invite link, so entries expire.
const DEDUPE_WINDOW_MS = 4000;
let lastHandled: { url: string; at: number } | null = null;

/**
 * Invite/auth deep links must land on the Sign Up tab. The mode intent travels
 * in the URL (never sessionStorage, which throws in restricted webviews and
 * raced with AuthPage's mount). Existing query params and hash are preserved.
 */
const SIGNUP_INTENT_PATHS = [/^\/join(\/|$)/, /^\/join-club(\/|$)/, /^\/i(\/|$)/, /^\/auth(\/|$)/, /^\/claim-team(\/|$)/];

export function withSignupIntent(path: string, destination: string): string {
  if (!SIGNUP_INTENT_PATHS.some((re) => re.test(path))) return destination;
  const [beforeHash, hash] = destination.split('#');
  const [pathname, search] = beforeHash.split('?');
  const params = new URLSearchParams(search || '');
  if (!params.has('mode')) params.set('mode', 'signup');
  const qs = params.toString();
  return `${pathname}${qs ? `?${qs}` : ''}${hash ? `#${hash}` : ''}`;
}

async function handleDeepLinkUrl(rawUrl: string) {
  const now = Date.now();
  if (
    lastHandled &&
    lastHandled.url === rawUrl &&
    now - lastHandled.at < DEDUPE_WINDOW_MS
  ) {
    console.log('[DeepLink] Duplicate URL ignored (within dedupe window):', rawUrl);
    return;
  }
  lastHandled = { url: rawUrl, at: now };


  {
    const event = { url: rawUrl };
    try {

      const url = new URL(event.url);
      
      // Check for OAuth callback tokens in hash or search params
      const hashParams = new URLSearchParams(url.hash.substring(1));
      const searchParams = url.searchParams;
      
      // Supabase OAuth returns tokens in the hash fragment
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      
      // PKCE flow returns code in search params
      const code = searchParams.get('code');
      
      if (accessToken && refreshToken) {
        console.log('[DeepLink] OAuth tokens found in hash, setting session...');
        
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        
        if (error) {
          console.error('[DeepLink] Error setting session:', error);
        } else {
          console.log('[DeepLink] Session set successfully, user:', data.user?.id);
          
          // Navigate to the intended path or home
          const pathWithQuery = `${url.pathname || '/'}${url.search || ''}`;
          if (pathWithQuery !== '/' && pathWithQuery !== '') {
            navigateApp(pathWithQuery);
          } else {
            // Force a refresh to trigger auth state change
            navigateApp('/');
          }
        }
      } else if (code) {
        // Determine the destination path so we can route password recovery
        // to the dedicated reset page instead of exchanging the code here
        // (the reset page needs the recovery session to call updateUser).
        const rawPath = url.pathname || '/';
        const isHttpLike = url.protocol === 'http:' || url.protocol === 'https:';
        let routePath = rawPath;
        if (!isHttpLike && url.host && !url.host.includes('.')) {
          routePath = `/${url.host}${rawPath === '/' ? '' : rawPath}`;
        }

        // Google Drive OAuth callback returns to /vault?code=... — this is NOT
        // a Supabase auth code. Hand it off to VaultPage to exchange via the
        // google-drive-import edge function instead of consuming it here.
        const isGoogleDriveCallback =
          routePath === '/vault' || url.host === 'vault';
        if (isGoogleDriveCallback) {
          console.log('[DeepLink] Google Drive OAuth code detected, saving for VaultPage');
          sessionStorage.setItem('googleDriveOAuthCode', code);
          navigateApp('/vault');
          return;
        }

        const isPasswordRecovery =
          routePath === '/reset-password' || url.host === 'reset-password';

        const isVerifyResetCode =
          routePath === '/verify-reset-code' || url.host === 'verify-reset-code';

        if (isVerifyResetCode) {
          // Supabase recovery email links land here when redirectTo points
          // at /verify-reset-code. We do NOT exchange the code — the user
          // enters the 6-digit OTP from the same email instead. Forward
          // any email/code params so the page can pre-fill them.
          console.log('[DeepLink] Verify-reset-code link detected, routing to /verify-reset-code');
          const fwd = new URLSearchParams(url.search);
          // Preserve the code param too in case we ever want auto-verify.
          if (!fwd.has('code')) fwd.set('code', code);
          navigateApp(`/verify-reset-code?${fwd.toString()}`);
          return;
        }

        if (isPasswordRecovery) {
          console.log('[DeepLink] Password recovery code detected, routing to /reset-password');
          // Preserve the code so ResetPasswordPage can exchange it
          navigateApp(`/reset-password?code=${encodeURIComponent(code)}`);
          return;
        }

        console.log('[DeepLink] OAuth code found, exchanging for session...');

        // Exchange the code for a session (PKCE flow)
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);

        if (error) {
          console.error('[DeepLink] Error exchanging code:', error);
        } else {
          console.log('[DeepLink] Code exchanged successfully, user:', data.user?.id);

          // Navigate to home after successful auth
          navigateApp('/');
        }
      } else {
        // Not an OAuth callback, handle as regular deep link navigation
        const rawPath = url.pathname || '/';
        const isHttpLike = url.protocol === 'http:' || url.protocol === 'https:';
        let path = rawPath;

        // Custom scheme links like igniteclubhq://events/123 have host="events", pathname="/123"
        if (!isHttpLike && url.host && !url.host.includes('.')) {
          path = `/${url.host}${rawPath === '/' ? '' : rawPath}`;
        }

        const fullSearch = url.search;
        const fullHash = url.hash;

        // Handle payment deep link callbacks
        if (path === '/payment-success' || url.host === 'payment-success') {
          console.log('[DeepLink] Payment success callback received');
          sessionStorage.setItem('paymentDeepLinkResult', 'success');
          // Navigate to home — Realtime listener handles actual status
          navigateApp('/');
          return;
        }
        if (path === '/payment-cancel' || url.host === 'payment-cancel') {
          console.log('[DeepLink] Payment cancel callback received');
          sessionStorage.setItem('paymentDeepLinkResult', 'cancel');
          navigateApp('/');
          return;
        }

        // Check for Google Drive OAuth callback (code param on /vault path)
        if (path === '/vault' && searchParams.get('code')) {
          const driveCode = searchParams.get('code');
          console.log('[DeepLink] Google Drive OAuth code detected, saving for VaultPage');
          sessionStorage.setItem('googleDriveOAuthCode', driveCode!);
          navigateApp('/vault');
          return;
        }

        // Check for Google Drive OAuth error
        if (path === '/vault' && searchParams.get('error')) {
          const driveError = searchParams.get('error');
          console.log('[DeepLink] Google Drive OAuth error:', driveError);
          sessionStorage.setItem('googleDriveOAuthError', driveError!);
          navigateApp('/vault');
          return;
        }

        if (path && path !== '/') {
          const destination = withSignupIntent(
            path,
            `${path}${fullSearch || ''}${fullHash || ''}`,
          );
          // An explicit deep link outranks any stashed push route, otherwise a
          // stale `/teams/:id` stash lands on top of the invite screen.
          try { abandonPendingNotificationNavigation(`deep link ${path}`); } catch {}
          console.log('[DeepLink] Navigating to path:', destination);
          navigateApp(destination);
        }

      }
    } catch (err) {
      console.error('[DeepLink] Error processing deep link:', err);
    }
  }
}

