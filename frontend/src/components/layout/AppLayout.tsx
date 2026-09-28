import { useEffect, useState, useMemo, Suspense } from "react";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import { AppHeader } from "./AppHeader";
import { BottomNav } from "./BottomNav";
import { DesktopNavRail } from "./DesktopNavRail";
import { DesktopMessagesRail } from "./DesktopMessagesRail";
import { DesktopProGate } from "./DesktopProGate";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { useClubScopeGuard } from "@/hooks/useClubScopeGuard";
import { useChatRouteOverscrollLock } from "@/hooks/useChatRouteOverscrollLock";
import { useTrackPresence } from "@/hooks/useUserPresence";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { SkipToContent } from "@/components/SkipToContent";
import { NativeNotificationPrompt } from "@/components/NativeNotificationPrompt";
const PendingInviteWelcomeDialog = lazyWithRetry(() => import("@/components/PendingInviteWelcomeDialog").then(m => ({ default: m.PendingInviteWelcomeDialog })));
import { useAdMobInit } from "@/hooks/useAdMob";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import igniteIcon from "@/assets/ignite-icon.png";
import { Capacitor } from "@capacitor/core";
import { mark as coldMark } from "@/lib/coldStartMarks";
import { sweepStaleDeletedTeams } from "@/lib/staleDeletedTeamSweep";
import { useLaunchIntentPending } from "@/hooks/useLaunchIntentPending";
import { useInviteFlowSweeper } from "@/hooks/useInviteFlowSweeper";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

const LazyDeepLinkGate = lazyWithRetry(() => import("@/components/DeepLinkGate"));

export function AppLayout() {
  const { user, profile, loading, profileLoading, profileError, refreshProfile, initialized, profileResolved, sessionRestoration } = useAuth();
  useAdMobInit();
  useActivityTracking();
  useTrackPresence(user?.id);
  // Retroactively reconcile pre-tombstone inbox snapshots (runs once per user).
  useEffect(() => {
    sweepStaleDeletedTeams(user?.id);
  }, [user?.id]);
  const { isThemeReady } = useClubTheme();
  // Bounce the user home if the open route belongs to a different club than the
  // active club filter (e.g. after switching club themes).
  useClubScopeGuard();
  // Drop the invite-flow banner as soon as the invite is definitively done
  // (profile complete + at least one membership), instead of waiting for TTL.
  useInviteFlowSweeper(user?.id, !!profile?.display_name);
  const launchIntentPending = useLaunchIntentPending();
  const location = useLocation();
  const [retrying, setRetrying] = useState(false);
  // Cold-start auth flash guard: while the stored session is still being
  // restored we must not redirect to /auth (the user IS signed in, we just
  // don't have the session object yet). Ceiling so a wedged restore can never
  // trap the user on a spinner.
  const [authRestoreExpired, setAuthRestoreExpired] = useState(false);
  useEffect(() => {
    if (sessionRestoration !== "restoring") return;
    // Re-arm on every new restore cycle (e.g. a token refresh triggering a
    // second restore); otherwise a prior expiry would leave the flag true and
    // flash /auth during a legitimate restore.
    setAuthRestoreExpired(false);
    const t = window.setTimeout(() => setAuthRestoreExpired(true), 8000);
    return () => window.clearTimeout(t);
  }, [sessionRestoration]);
  const isRestoringSession = sessionRestoration === "restoring" && !authRestoreExpired;
  const [themeTimeout, setThemeTimeout] = useState(false);
  
  const isChatThreadRoute = useMemo(() => {
    const path = location.pathname;

    if (path === "/messages/broadcast") return true;
    if (/^\/messages\/club\/[^/]+$/.test(path)) return true;
    if (/^\/messages\/club-admin\/[^/]+$/.test(path)) return true;
    if (/^\/messages\/dm\/[^/]+$/.test(path)) return true;
    if (/^\/groups\/[^/]+$/.test(path)) return true;

    // Team chat route: /messages/:teamId (exclude static routes)
    if (/^\/messages\/[^/]+$/.test(path) && path !== "/messages" && path !== "/messages/welcome") {
      return true;
    }

    return false;
  }, [location.pathname]);

  useChatRouteOverscrollLock(isChatThreadRoute);

  // BottomNav is now always visible — no need to reset the offset for chat routes

  const loadingLogo = useMemo(() => igniteIcon, []);
  const appViewportStyle = useMemo(
    () => (isChatThreadRoute
      ? { height: "var(--visual-vh, 100dvh)" }
      : { minHeight: "var(--stable-vh, 100dvh)" }),
    [isChatThreadRoute]
  );

  // Debug logging for profile state - must be before any conditional returns
  useEffect(() => {
    console.log('[AppLayout] Profile state:', {
      initialized,
      loading,
      profileLoading,
      profileError,
      profileResolved,
      hasProfile: !!profile,
      displayName: profile?.display_name,
      userId: user?.id,
      isThemeReady,
      themeTimeout
    });
  }, [initialized, loading, profileLoading, profileError, profileResolved, profile, user, isThemeReady, themeTimeout]);

  // Theme loading timeout - don't block forever waiting for theme
  useEffect(() => {
    if (profile && !isThemeReady && !themeTimeout) {
      const timer = setTimeout(() => {
        console.log('[AppLayout] Theme loading timeout - proceeding without waiting');
        setThemeTimeout(true);
      }, 1500); // 1.5 second timeout for theme loading
      return () => clearTimeout(timer);
    }
  }, [profile, isThemeReady, themeTimeout]);

  // Reset theme timeout when user changes
  useEffect(() => {
    setThemeTimeout(false);
  }, [user?.id]);

  // Auto-retry when profile error occurs
  useEffect(() => {
    if (profileError && !profile && user && !retrying) {
      const timer = setTimeout(async () => {
        setRetrying(true);
        await refreshProfile();
        setRetrying(false);
      }, 5000); // Auto-retry after 5 seconds
      return () => clearTimeout(timer);
    }
  }, [profileError, profile, user, retrying, refreshProfile]);

  // CRITICAL: Show loading screen FIRST before ANY routing decisions
  // This prevents any flash of wrong content during initialization
  const shouldWaitForTheme = profile && !isThemeReady && !themeTimeout;

  // Always wait for profile loading to complete before making routing decisions.
  // Previously we'd skip loading if cache had a valid profile, but on Android
  // the cache can be stale/empty during session restore causing a flash of
  // the complete-profile screen before the real profile loads.
  const isStillLoading = !initialized || loading || profileLoading;

  if (isStillLoading || shouldWaitForTheme) {
    // Show appropriate message based on auth state
    const loadingMessage = !initialized
      ? "Checking authentication..."
      : shouldWaitForTheme
        ? "Applying theme..."
        : "Loading your profile...";

    // PRE-RENDER NAV CHROME: as soon as we know there is a logged-in user
    // (session restored), render the AppHeader + BottomNav around a content
    // placeholder so the user never sees a blank splash after login while
    // the profile / club theme finish hydrating. AppHeader gracefully
    // handles partial profile data — it reads via optional chaining and
    // its queries are gated on `user?.id`. We still wait on the splash
    // when there's no `user` yet (cold app start, no session) so we don't
    // flash chrome to logged-out visitors.
    if (initialized && user) {
      return (
        <div className={`bg-background flex flex-col overscroll-none min-h-0 lg:pl-24 xl:pr-80`} style={appViewportStyle}>
          <SkipToContent />
          <DesktopNavRail />
          <AppHeader />
          <main
            id="main-content"
            aria-label="Main content"
            className="flex-1 pb-28 lg:pb-10 px-4 max-w-lg lg:max-w-4xl mx-auto w-full flex flex-col items-center justify-center gap-3"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{loadingMessage}</p>
          </main>
          <BottomNav />
        </div>
      );
    }

      return (
        <div className="flex flex-col items-center justify-center bg-background gap-4" style={appViewportStyle} role="status" aria-live="polite">
        <img src={loadingLogo} alt="Ignite" className="h-32 w-32 rounded-[2rem]" loading="eager" />
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{loadingMessage}</p>
      </div>
    );
  }

  // Gate has released: auth + profile + theme all ready, <Outlet /> can render.
  try { coldMark("app_layout_gate_open"); } catch {}

  // Check if there's a pending OAuth callback that needs to be processed
  // This prevents redirecting to /auth before the OAuth code can be handled
  const hasPendingOAuth = typeof window !== 'undefined' && (
    sessionStorage.getItem('googleDriveOAuthCode') || 
    sessionStorage.getItem('googleDriveOAuthError')
  );
  
  // Check if there's a Supabase OAuth callback in progress (tokens in URL hash)
  // This happens when returning from Google OAuth - Supabase client needs time to process
  const hasOAuthTokensInUrl = typeof window !== 'undefined' && (
    window.location.hash.includes('access_token') ||
    window.location.hash.includes('refresh_token') ||
    window.location.search.includes('code=')
  );

  // If there's a pending OAuth, immediately navigate to vault
  // This prevents the flash to home screen after Google Drive authentication
  if (hasPendingOAuth && typeof window !== 'undefined' && window.location.pathname !== '/vault') {
    return <Navigate to="/vault" replace />;
  }

  // DEEP LINK GATE: Before redirecting unauthenticated users to /auth,
  // check if this is an in-app browser (Messenger, WhatsApp, etc.) on a deep-linkable route.
  // Show the DeepLinkGate interstitial so they can bounce to the native app.
  const isDeepLinkRoute = /^\/(events\/[^/]+|media\/[^/]+|vault\/folder\/[^/]+|share)$/.test(location.pathname);
  const isNativePlatform = Capacitor.isNativePlatform();
  const userAgent = navigator.userAgent || "";
  const isInApp = !isNativePlatform && /FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|WhatsApp|LinkedInApp|Messenger/i.test(userAgent);

  if (!user && isDeepLinkRoute && isInApp && !hasPendingOAuth && !hasOAuthTokensInUrl) {
    return (
        <Suspense fallback={
          <div className="flex items-center justify-center bg-background" style={appViewportStyle}>
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      }>
        <LazyDeepLinkGate />
      </Suspense>
    );
  }

  // Session restore still in flight (cached profile present, no session object
  // yet) — show the auth-check state instead of flashing the login screen.
  if (!user && isRestoringSession && !hasPendingOAuth && !hasOAuthTokensInUrl) {
    return (
      <div className="flex flex-col items-center justify-center bg-background gap-4" style={appViewportStyle} role="status" aria-live="polite">
        <img src={loadingLogo} alt="Ignite" className="h-32 w-32 rounded-[2rem]" loading="eager" />
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Checking authentication...</p>
      </div>
    );
  }

  // NATIVE LAUNCH-INTENT BOUNDARY: on a cold start the launch URL (e.g. an
  // emailed /join/p/:token invite) is read asynchronously. Redirecting to
  // generic /auth before that resolves is what made the first invite tap show
  // the login screen. Hold the neutral startup screen until the launch intent
  // settles (bounded inside the module, so an ordinary launch can't hang).
  if (!user && launchIntentPending && !hasPendingOAuth && !hasOAuthTokensInUrl) {
    return (
      <div className="flex flex-col items-center justify-center bg-background gap-4" style={appViewportStyle} role="status" aria-live="polite">
        <img src={loadingLogo} alt="Ignite" className="h-32 w-32 rounded-[2rem]" loading="eager" />
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Starting up...</p>
      </div>
    );
  }

  // Preserve current destination for post-auth return (all protected routes, not just deep links)
  if (!user && !hasPendingOAuth && !hasOAuthTokensInUrl) {
    if (typeof window !== 'undefined') {
      const redirectPath = `${location.pathname}${location.search}${location.hash}`;
      if (redirectPath && redirectPath !== '/' && redirectPath !== '/auth') {
        sessionStorage.setItem("redirectAfterAuth", redirectPath);
      }
    }
    return <Navigate to="/auth" replace />;
  }

  // Show retry screen if profile fetch failed (don't redirect to complete-profile)
  if (profileError && !profile) {
      return (
        <div className="flex flex-col items-center justify-center bg-background gap-4" style={appViewportStyle} role="alert" aria-live="assertive">
        <img src={loadingLogo} alt="Ignite" className="h-32 w-32 rounded-[2rem]" loading="eager" />
        {retrying ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
            <p className="text-sm text-muted-foreground text-center px-4">
              Reconnecting to server...
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground text-center px-4">
              Unable to load your profile. The server may be temporarily unavailable.
            </p>
            <p className="text-xs text-muted-foreground">Auto-retrying in 5 seconds...</p>
            <Button onClick={async () => {
              setRetrying(true);
              await refreshProfile();
              setRetrying(false);
            }}>
              Retry Now
            </Button>
          </>
        )}
      </div>
    );
  }

  // Profile completion gate - redirect to complete-profile if:
  // 1. Profile exists but display_name is missing (existing user needs to complete)
  // 2. Profile is null after loading finished (new user needs to create profile)
  // CRITICAL: Only gate when profileResolved is true (server truth confirmed)
  // This prevents flashing complete-profile on Android when cache is empty but profile exists on server
  if (!profileLoading && !loading && profileResolved) {
    // If profile exists and has display_name, we're good - proceed to render
    if (profile?.display_name) {
      // Profile is complete, allow rendering
    } else if (profile && !profile.display_name) {
      // Profile exists but no display_name - needs completion
      console.log('[AppLayout] Redirecting to complete-profile: profile exists but no display_name');
      return <Navigate to="/complete-profile" replace />;
    } else if (!profile && !profileError) {
      // New user - profile doesn't exist yet, redirect to complete-profile to create it
      console.log('[AppLayout] Redirecting to complete-profile: no profile found');
      return <Navigate to="/complete-profile" replace />;
    }
  }

  // At this point, if we still don't have a profile, show loading
  // This should not happen since profileLoading is already false,
  // but guard against edge cases rather than flashing complete-profile
  if (!profile) {
    console.log('[AppLayout] Unexpected state: no profile after all checks, showing loading');
    return (
      <div className="flex flex-col items-center justify-center bg-background gap-4" style={appViewportStyle} role="status">
        <img src={loadingLogo} alt="Ignite" className="h-32 w-32 rounded-[2rem]" loading="eager" />
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading your profile...</p>
      </div>
    );
  }


  // Desktop (web, lg+): offset content for the fixed left nav rail, and at
  // xl+ for the fixed right messages rail. Content column widens from the
  // mobile max-w-lg to a comfortable desktop measure. Mobile/native unchanged.
  const mainClassName = isChatThreadRoute
    ? "flex-1 min-h-0 max-w-lg lg:max-w-3xl mx-auto w-full overflow-hidden px-0"
    : "flex-1 pb-28 lg:pb-10 px-4 lg:px-8 max-w-lg lg:max-w-4xl mx-auto w-full";

  return (
    <div className={`bg-background flex flex-col overscroll-none min-h-0 lg:pl-24 xl:pr-80`} style={appViewportStyle}>
      <SkipToContent />
      <DesktopNavRail />
      <AppHeader />
      <main id="main-content" aria-label="Main content" className={mainClassName}>
        {/*
          Local Suspense boundary. Every routed page is `lazy()`. Without a
          boundary HERE, a still-pending chunk import suspends the commit and
          bubbles to the App-level <Suspense>, which unmounts this ALREADY
          PAINTED layout (header + nav) and swaps in the bare PageLoader —
          then remounts everything when the chunk lands. That is the
          "reveal → flash → reveal again" seen when opening a chat from a push
          notification, where the chat chunk prefetch can lose the race with
          the auth/theme gate opening. Keeping the boundary inside <main>
          preserves the chrome and confines the fallback to the content area.
        */}
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center py-16" role="status" aria-label="Loading page">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
      <BottomNav />
      <DesktopMessagesRail />
      <DesktopProGate />
      <OfflineIndicator />
      <NativeNotificationPrompt userId={user?.id} />
      <Suspense fallback={null}><PendingInviteWelcomeDialog /></Suspense>
    </div>
  );
}
