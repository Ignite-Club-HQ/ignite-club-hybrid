import { createContext, useContext, useEffect, useState, useRef, ReactNode, useCallback } from "react";
import { User, Session } from "@supabase/supabase-js";
import { useQueryClient, onlineManager } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { subscribeToPushNotifications } from "@/lib/pushNotifications";
import { prefetchUserData } from "@/lib/prefetchData";
import { clearProfileCache } from "@/lib/profileCache";
import { clearRolesCache } from "@/lib/rolesCache";
import { clearClubTeamCache } from "@/lib/clubTeamCache";
import { clearUserScopedCaches } from "@/lib/clearUserScopedCaches";
import { revokeAllForUser } from "@/lib/realtimeChannelRegistry";
import { setAuthThemeHint } from "@/lib/authThemeHint";
import { mark as coldMark } from "@/lib/coldStartMarks";


import { syncPasskeyAccountsFromDatabase } from "@/hooks/usePasskey";
import { MESSAGE_NOTIFICATION_TYPES } from "@/lib/notificationTypes";
import { fetchUnreadMessageCounts, getTotalUnreadMessageCount } from "@/lib/unreadMessageCounts";
import { markProfileCompleted } from "@/components/InviteFlowProgress";
import { isNativePlatform, unregisterNativePush } from "@/lib/nativePush";
import { isTransientAuthFailure } from "@/lib/authRecoveryClassification";
import { refreshSessionOnce } from "@/lib/refreshSessionOnce";
import { notificationKeys } from "@/lab/notificationQueryKeys";
// Value exports (signInWithInternetIdentity/signOutInternetIdentity) are loaded
// dynamically at call time below. That module statically imports the ICP
// agent/candid SDK and its crypto dependencies (~480KB), which must not enter
// every page's initial chunk — only IcpAuthProvider (ICP lab auth mode) needs it.
import type { InternetIdentitySession } from "@/lab/internetIdentityAuth";


interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  ignite_points: number;
  theme_preference: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  profileLoading: boolean;
  profileError: boolean;
  initialized: boolean; // True only after first auth check completes
  /** 'restoring' until the stored session has been resolved one way or the other. */
  sessionRestoration: "restoring" | "authenticated" | "signed_out";
  profileResolved: boolean; // True only after profile has been fetched from server at least once
  unreadCount: number;
  unreadMessagesCount: number;
  signUp: (email: string, password: string) => Promise<{ error: Error | null; needsEmailConfirmation?: boolean }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshUnreadCount: () => Promise<void>;
  clearUnreadCount: () => void;
  decrementUnreadCount: (n: number) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const PROFILE_CACHE_KEY = 'ignite_cached_profile';

interface CachedProfileData {
  profile: Profile;
  userId: string;
  cachedAt: number;
}

// Profile cache now includes userId to prevent cross-user cache collisions
export function getCachedProfile(userId?: string): Profile | null {
  try {
    const cached = localStorage.getItem(PROFILE_CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached) as CachedProfileData;
      // CRITICAL: Only return cache if userId matches
      // This prevents stale cache from wrong user causing login issues
      if (userId && data.userId !== userId) {
        console.log('[Auth] Cached profile userId mismatch, clearing stale cache');
        localStorage.removeItem(PROFILE_CACHE_KEY);
        return null;
      }
      // Also validate cache structure has expected fields
      if (data.profile && data.profile.id) {
        return data.profile;
      }
      // Legacy format - clear it
      localStorage.removeItem(PROFILE_CACHE_KEY);
    }
  } catch {
    // Ignore parse errors, clear invalid cache
    localStorage.removeItem(PROFILE_CACHE_KEY);
  }
  return null;
}

// Get cached profile with its userId for validation
function getCachedProfileWithUser(): { profile: Profile; userId: string } | null {
  try {
    const cached = localStorage.getItem(PROFILE_CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached) as CachedProfileData;
      if (data.profile && data.profile.id && data.userId) {
        return { profile: data.profile, userId: data.userId };
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}

// SYNCHRONOUS initialization: Check if we have a valid cached profile with display_name
// This runs ONCE at module load time to determine initial state
function getInitialAuthState(): { 
  profile: Profile | null; 
  initialized: boolean; 
  loading: boolean; 
  profileLoading: boolean;
  cachedUserId: string | null;
} {
  const cached = getCachedProfileWithUser();
  if (cached && cached.profile.display_name) {
    // We have a complete cached profile - start as "ready"
    // The async session check will validate this is still correct
    return {
      profile: cached.profile,
      initialized: true,
      loading: false,
      profileLoading: false,
      cachedUserId: cached.userId,
    };
  }
  // No valid cache - need to wait for async check
  return {
    profile: null,
    initialized: false,
    loading: true,
    profileLoading: true,
    cachedUserId: null,
  };
}

// Compute initial state once at module load
const initialAuthState = getInitialAuthState();

export function setCachedProfile(profile: Profile | null, userId?: string) {
  try {
    if (profile && userId) {
      const cacheData: CachedProfileData = {
        profile,
        userId,
        cachedAt: Date.now(),
      };
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(cacheData));
    } else {
      localStorage.removeItem(PROFILE_CACHE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const waitForSessionUser = useCallback(async (expectedUserId: string, maxAttempts = 8): Promise<Session | null> => {
    const stop = () => {};
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const { data, error } = await supabase.auth.getSession();
          const session = data.session;

          if (!error && session?.user?.id === expectedUserId && session.access_token) {
            return session;
          }
        } catch {
          // Ignore transient session restore errors while polling
        }

        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 120 * attempt));
        }
      }
      return null;
    } finally {
      stop();
    }
  }, []);
  
  // SYNCHRONOUS HYDRATION: Use pre-computed initial state from cache
  // This eliminates flash by starting with cached profile if available
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(initialAuthState.profile);
  const [loading, setLoading] = useState(initialAuthState.loading);
  const [profileLoading, setProfileLoading] = useState(initialAuthState.profileLoading);
  const [profileError, setProfileError] = useState(false);
  const [initialized, setInitialized] = useState(initialAuthState.initialized);
  // sessionRestoration distinguishes "we haven't finished restoring the stored
  // session yet" from "there is definitively no session". Without it, a cold
  // start with a cached profile reports initialized=true / user=null for a few
  // hundred ms and route guards flash the login screen before the restored
  // session lands (notification cold start was the worst offender).
  const [sessionRestoration, setSessionRestoration] =
    useState<"restoring" | "authenticated" | "signed_out">("restoring");
  // Cold-start instrumentation: fire the `auth_ready` mark exactly once
  // when `initialized` first flips true, regardless of which of the ~10
  // setInitialized(true) sites triggered it.
  useEffect(() => {
    if (initialized) coldMark("auth_ready");
  }, [initialized]);
  // profileResolved: true once the profile has been fetched from the server at least once
  // for the current session. Prevents routing to /complete-profile based on stale/missing cache.
  const [profileResolved, setProfileResolved] = useState(!!initialAuthState.profile?.display_name);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  // Track the cached userId we started with (for validation)
  const [cachedUserId] = useState(initialAuthState.cachedUserId);

  // Flag to track if this is a fresh login (not a page refresh)
  const [isFreshLogin, setIsFreshLogin] = useState(false);
  
  // Ref to track the current user ID for use inside stable callbacks
  const currentUserIdRef = useRef<string | null>(null);

  // CRITICAL FIX: applyTheme is now a direct parameter, not dependent on React state
  // This avoids stale closure issues during Google OAuth where isFreshLogin state
  // wasn't available in the callback at the right time
  const fetchProfile = useCallback(async (userId: string, retries = 5, applyTheme = false, retryOnMissing = false): Promise<Profile | null> => {
    setProfileError(false);
    const maxMissingProfileAttempts = retryOnMissing ? retries : 1;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Create a timeout promise to prevent hanging - increased to 15s for slow connections
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), 15000)
        );
        
        const fetchPromise = supabase
          .from("profiles")
          .select("id, display_name, avatar_url, ignite_points, theme_preference, events_view_mode, active_club_theme_id")
          .eq("id", userId)
          .maybeSingle();

        
        const result = await Promise.race([fetchPromise, timeoutPromise]);
        const { data, error } = result;
        
        if (error) {
          console.error(`Error fetching profile (attempt ${attempt}/${retries}):`, error);
          // Retry on any error - be more aggressive
          if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            continue;
          }
          setProfileError(true);
          return null;
        }
        
        if (data) {
          const profileData = data as Profile;
          setProfile(profileData);
          setProfileResolved(true);
          setCachedProfile(profileData, userId);
          setProfileError(false);
          // Hand the freshly-fetched active_club_theme_id to useClubTheme so it
          // can skip its own profiles round-trip on cold-login Gate 2.
          try {
            setAuthThemeHint(userId, (data as any).active_club_theme_id ?? null);
          } catch { /* noop */ }

          
          // HARD RULE: If profile has display_name, set the profileCompleted flag for this user
          // This ensures invite flow progress dots never appear for users with completed profiles
          if (profileData.display_name) {
            markProfileCompleted(userId);
          }
          
          // CRITICAL FIX: Apply theme when applyTheme=true (passed by caller)
          // The caller determines if this is a fresh login, not React state
          // This fixes Google OAuth where the closure captured stale isFreshLogin state
          // Only apply if profile has display_name - skip for incomplete profiles going to CompleteProfilePage
          if (applyTheme && profileData.display_name) {
            const root = window.document.documentElement;
            const themeToApply = profileData.theme_preference || 'light'; // Default to light for new users
            root.classList.remove('light', 'dark');
            root.classList.add(themeToApply);
            root.style.colorScheme = themeToApply;
            localStorage.setItem('app-theme', themeToApply);
            console.log('[Auth] Applied theme preference on fresh login:', themeToApply, '(was:', localStorage.getItem('app-theme'), ')');
          }
          
          return profileData;
        }
        
        const shouldRetryMissingProfile = retryOnMissing && attempt < maxMissingProfileAttempts;
        if (shouldRetryMissingProfile) {
          const delay = Math.min(300 * attempt, 1500);
          console.warn(`[Auth] Profile not available yet (attempt ${attempt}/${maxMissingProfileAttempts}), retrying...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // No profile found - this is okay for new users, not an error
        console.log('No profile found for user:', userId);
        setProfileResolved(true);
        return null;
      } catch (err: any) {
        console.error(`Exception fetching profile (attempt ${attempt}/${retries}):`, err);
        if (attempt < retries) {
          // Exponential backoff with jitter
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000) + Math.random() * 500;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        setProfileError(true);
        return null;
      }
    }
    setProfileError(true);
    return null;
  }, []); // No dependencies - applyTheme is a parameter, not state

  // MESSAGE_NOTIFICATION_TYPES imported from @/lib/notificationTypes

  const fetchUnreadCount = useCallback(async (userId: string) => {
    const [allResult, messageCounts] = await Promise.all([
      supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_read", false),
      fetchUnreadMessageCounts(userId),
    ]);

    setUnreadCount(allResult.count || 0);
    setUnreadMessagesCount(getTotalUnreadMessageCount(messageCounts));
  }, []);

  useEffect(() => {
    let mounted = true;
    let profileFetched = false;
    
    const handleSession = async (currentSession: Session | null, isInitial = false, applyTheme = false) => {
      const __hsStop = () => {};
      try {
      if (!mounted || !currentSession?.user) {
        console.log('[Auth] handleSession early exit - mounted:', mounted, 'hasUser:', !!currentSession?.user);
        return;
      }
      
      const userId = currentSession.user.id;
      console.log('[Auth] handleSession called - userId:', userId, 'isInitial:', isInitial, 'applyTheme:', applyTheme, 'profileFetched:', profileFetched);
      
      // CHECK: If we started with a cached profile, validate it's for this user
      // If userId mismatch, we need to clear and refetch - this is a USER SWITCH scenario
      const isUserSwitch = cachedUserId && cachedUserId !== userId;
      if (isUserSwitch) {
        console.log('[Auth] Session user differs from cached - clearing stale cache for user switch');
        setProfile(null);
        setProfileResolved(false);
        setCachedProfile(null);
        // Clear the old cache from localStorage too
        localStorage.removeItem(PROFILE_CACHE_KEY);
        // Reset the profileFetched flag since we're switching users
        profileFetched = false;
      }
      
      // Prevent duplicate fetches within same session (but allow user switches)
      // CRITICAL: For SIGNED_IN event (isInitial=false, applyTheme=true), we MUST proceed
      // even if profileFetched is true from a previous INITIAL_SESSION
      const shouldSkip = profileFetched && !isInitial && !isUserSwitch && !applyTheme;
      if (shouldSkip) {
        console.log('[Auth] handleSession skipping - already fetched');
        return;
      }
      profileFetched = true;
      
      // If we already have initialized=true from sync hydration AND userId matches (no switch),
      // AND this is NOT a fresh login (applyTheme=true means fresh login), just do background refresh
      // CRITICAL: For fresh logins (applyTheme=true), we must NOT skip - we need to apply theme
      if (!isUserSwitch && !applyTheme && initialized && profile?.display_name && cachedUserId === userId) {
        console.log('[Auth] handleSession - using cached profile, background refresh only');
        // Already ready from sync hydration - just background refresh
        fetchProfile(userId, 5, false).catch(() => {});
        // Prefetch other data
        setTimeout(() => {
          prefetchUserData(queryClient, userId).catch(console.error);
          fetchUnreadCount(userId).catch(console.error);
          const email = currentSession.user.email;
          const displayName = currentSession.user.user_metadata?.full_name || 
                             currentSession.user.user_metadata?.name;
          if (email) {
            syncPasskeyAccountsFromDatabase(userId, email, displayName).catch(console.error);
          }
        }, 100);
        return;
      }
      
      // Small delay to ensure session is fully propagated to Supabase
      // This helps with RLS policies that check auth.uid().
      // On non-fresh-login paths (page refresh / INITIAL_SESSION) we already
      // have a valid `currentSession` from getSession()/onAuthStateChange, so
      // skip the deliberate sleep + redundant getSession() polling that was
      // adding up to ~1.8s to cold-start before `initialized` could flip.
      const sessionAlreadyValid = !!currentSession?.access_token && currentSession.user?.id === userId;
      let stableSession: Session | null = null;
      if (applyTheme) {
        // Fresh login: JWT may not yet be propagated — keep the original poll.
        await new Promise(resolve => setTimeout(resolve, 100));
        stableSession = await waitForSessionUser(userId, 10);
      } else if (sessionAlreadyValid) {
        stableSession = currentSession;
      } else {
        // Defensive: short poll only when the session passed in is missing/stale.
        stableSession = await waitForSessionUser(userId, 3);
      }
      const sessionForBackgroundTasks = stableSession ?? currentSession;

      if (stableSession && mounted) {
        setSession(stableSession);
        setUser(stableSession.user);
        setSessionRestoration("authenticated");
      }
      
      // If we have a cached profile for THIS USER with display_name, TRUST IT immediately
      // This eliminates the flash on page refresh - no need to wait for server
      // NOTE: Don't use cache if this is a user switch (cache was just cleared)
      // CRITICAL: On fresh login (applyTheme=true), we must fetch to apply DB theme preference
      const cached = (isUserSwitch || applyTheme) ? null : getCachedProfile(userId);
      if (cached && cached.id === userId && cached.display_name) {
        // TRUST the cached profile - user is already set up
        setProfile(cached);
        setProfileResolved(true); // Cache with display_name is trustworthy
        setProfileLoading(false);
        setLoading(false);
        setInitialized(true);
        
        // Background refresh - update cache silently, no blocking
        fetchProfile(userId, 5, false).catch(() => {
          // Silent fail - we already have valid cached data
        });
      } else if (cached && cached.id === userId && !cached.display_name) {
        // Cached profile exists but no display_name - need to complete profile
        // Still trust the cache for immediate render
        setProfile(cached);
        setProfileLoading(false);
        setLoading(false);
        setInitialized(true);
        
        // Background refresh
        fetchProfile(userId, 5, false).catch(() => {});
      } else {
        // No cache, user switch, or fresh login - must fetch profile before proceeding
        console.log('[Auth] Fetching profile for user:', userId, isUserSwitch ? '(user switch)' : '', applyTheme ? '(fresh login)' : '');
        setProfileLoading(true);
        const __fpStop = () => {};
        try {
          const fetchedProfile = await fetchProfile(userId, 5, applyTheme, true);
          if (mounted) {
            setProfileLoading(false);
            setLoading(false);
            setInitialized(true);
            console.log('[Auth] Profile fetch complete, initialized:', !!fetchedProfile);
          }
        } catch (err) {
          console.error('[Auth] Profile fetch failed:', err);
          if (mounted) {
            setProfileLoading(false);
            setLoading(false);
            setInitialized(true); // Initialize even on error to prevent hang
          }
        } finally {
          __fpStop();
        }
      }
      // Background prefetch - fire and forget
      setTimeout(() => {
        prefetchUserData(queryClient, userId).catch(console.error);
        fetchUnreadCount(userId).catch(console.error);
        // Sync passkey accounts from database to restore any lost localStorage data
        const email = sessionForBackgroundTasks.user.email;
        const displayName = sessionForBackgroundTasks.user.user_metadata?.full_name || 
                           sessionForBackgroundTasks.user.user_metadata?.name;
        if (email) {
          syncPasskeyAccountsFromDatabase(userId, email, displayName).catch(console.error);
        }
      }, 100);
      } finally {
        __hsStop();
      }
    };
    
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, currentSession) => {
        if (!mounted) return;
        
        // Check if we're in a native app context
        const isNative = typeof (window as any).Capacitor !== 'undefined' && 
                         (window as any).Capacitor?.isNativePlatform?.();
        
        console.log('Auth state change:', event, currentSession?.user?.id, 'isNative:', isNative);
        
        const incomingUserId = currentSession?.user?.id ?? null;
        const previousUserId = currentUserIdRef.current || cachedUserId;
        
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        setSessionRestoration(currentSession?.user ? "authenticated" : "signed_out");
        currentUserIdRef.current = incomingUserId;
        // Keep client-perf logger in sync so slow-query rows are attributed.
        try {
          // dynamic import to avoid a hard load-order dependency
          import("@/lib/clientPerfLog").then(m => m.setClientPerfUserId(incomingUserId));
        } catch { /* ignore */ }
        
        if (event === 'PASSWORD_RECOVERY') {
          // Recovery session: do NOT treat as a fresh login (no cache clear,
          // no profile fetch redirect). Just hold the session and ensure the
          // user is on /reset-password so they can set a new password.
          console.log('[Auth] PASSWORD_RECOVERY event - routing to reset password');
          handleSession(currentSession, false, false);
          if (typeof window !== 'undefined' && window.location.pathname !== '/reset-password') {
            window.location.href = '/reset-password';
          }
        } else if (event === 'SIGNED_IN') {
          const isSameUserResuming = !!previousUserId && previousUserId === incomingUserId;
          
          if (isSameUserResuming) {
            // Same user resuming (e.g., phone lock/unlock, app background/foreground)
            // Do NOT clear query cache — this causes data to flash/disappear
            console.log('[Auth] SIGNED_IN event - same user resuming, skipping cache clear', isNative ? '(native app)' : '(web)');
            handleSession(currentSession, false, false);
          } else {
            // FRESH LOGIN or different user: Reset state to block AppLayout until profile is fetched
            console.log('[Auth] SIGNED_IN event - processing login', isNative ? '(native app)' : '(web)');
            // If we're on the reset password page, this SIGNED_IN is from the
            // recovery code exchange — do NOT redirect away or clear cache
            // aggressively, the user still needs to set their new password.
            const onResetPage = typeof window !== 'undefined' && window.location.pathname === '/reset-password';
            if (onResetPage) {
              console.log('[Auth] SIGNED_IN on /reset-password — treating as recovery, skipping cache clear');
              handleSession(currentSession, false, false);
            } else {
              // Clear all cached query data to force fresh fetches with the new session
              // This prevents stale/empty RLS results from a previous logged-out window
              queryClient.clear();
              // Also wipe per-user localStorage / in-memory caches (mediaCache,
              // profileCache, rolesCache, …) that live OUTSIDE React Query.
              // Without this, a different user logging in on the same device
              // sees the previous user's gallery photos, rosters, messages,
              // etc. on first paint until fresh data overrides them — a
              // cross-account data leak.
              try {
                clearUserScopedCaches();
                if (previousUserId) revokeAllForUser(previousUserId);
              } catch { /* noop */ }

              setIsFreshLogin(true);
              setInitialized(false);
              setLoading(true);
              setProfileLoading(true);
              setProfileResolved(false);
              handleSession(currentSession, false, true);
            }
          }
        } else if ((event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') && currentSession?.user) {
          // Page refresh or token refresh - don't override theme
          console.log('[Auth] Session restored:', event, isNative ? '(native app)' : '(web)');
          setIsFreshLogin(false);
          handleSession(currentSession, event === 'INITIAL_SESSION', false);

          if (event === 'TOKEN_REFRESHED') {
            // Push the fresh JWT into the realtime websocket so subscriptions
            // opened before the refresh don't keep authenticating with a stale
            // token (root cause of chat channels losing access mid-session).
            try { (supabase.realtime as any)?.setAuth?.(currentSession.access_token); } catch { /* noop */ }
            // Re-run only the queries that historically silently failed under
            // a stale token (Pro gate + events). A blanket
            // refetchQueries({ type: 'active' }) here causes a refetch storm
            // on Android mid-navigation and can stall the WebView. The global
            // 401 fetch interceptor (supabaseAuthRetry) already heals other
            // in-flight requests on the same refresh.
            try {
              queryClient.invalidateQueries({ queryKey: ['has-pro-access'] });
              queryClient.invalidateQueries({ queryKey: ['events'] });
            } catch { /* noop */ }
          }
        } else if (event === 'SIGNED_OUT') {
          console.log('[Auth] SIGNED_OUT event');
          // A refresh-token rotation race on app resume can fire a SPURIOUS
          // SIGNED_OUT immediately followed by SIGNED_IN for the same user.
          // Wiping React Query + every `ignite_*` localStorage cache in that
          // window destroys the last-good snapshots (Next Up, My Teams, …) and
          // the follow-up refetch can race a mid-rotation token, painting the
          // "set up your club" empty state. So VERIFY the sign-out is real
          // before doing anything destructive; state resets below are harmless
          // because a real session immediately re-populates them.
          setTimeout(() => {
            void (async () => {
              try {
                const { data } = await supabase.auth.getSession();
                const stillSignedIn = !!data?.session?.user?.id;
                if (stillSignedIn) {
                  console.log('[Auth] SIGNED_OUT was spurious (session still valid) — skipping cache wipe');
                  return;
                }
                queryClient.clear();
                clearUserScopedCaches();
                if (previousUserId) revokeAllForUser(previousUserId);
              } catch { /* noop */ }
            })();
          }, 400);


          profileFetched = false;
          setIsFreshLogin(false);
          setProfile(null);
          setProfileResolved(false);
          setCachedProfile(null);
          setUnreadCount(0);
          setUnreadMessagesCount(0);
          setProfileLoading(false);
          setLoading(false);
          setInitialized(true); // Stay initialized but with no user
        }

      }
    );

    // Check for existing session (initial load) with timeout
    // PWA launches can hang on getSession if network is slow/offline
    // Increased timeout for slower networks (e.g., mobile on 3G)
    const sessionTimeout = setTimeout(() => {
      if (mounted && loading) {
        // Check if we have a cached profile to fall back on
        const cachedFallback = getCachedProfileWithUser();
        if (cachedFallback && cachedFallback.profile.display_name) {
          console.warn('[Auth] Session check timed out - restoring from cache, will retry in background');
          setProfile(cachedFallback.profile);
          setLoading(false);
          setProfileLoading(false);
          setInitialized(true);
          
          // Background retry: silently re-check session after timeout
          // This handles transient Supabase latency spikes
          supabase.auth.getSession().then(async ({ data: { session: retrySession } }) => {
            if (!mounted) return;
            if (retrySession?.user) {
              console.log('[Auth] Background session retry succeeded');
              setSession(retrySession);
              setUser(retrySession.user);
              setSessionRestoration("authenticated");
              if (!profileFetched) {
                await handleSession(retrySession, true, false);
              }
            } else {
              setSessionRestoration("signed_out");
            }
          }).catch(e => {
            console.warn('[Auth] Background session retry failed:', e);
            setSessionRestoration("signed_out");
          });
        } else {
          console.warn('[Auth] Session check timed out, no cache available');
          setLoading(false);
          setProfileLoading(false);
          setInitialized(true);
          setSessionRestoration("signed_out");
        }
      }
    }, 10000); // 10 second timeout for slow connections

    const __initSessionStop = () => {};
    supabase.auth.getSession().then(async ({ data: { session: existingSession } }) => {
      __initSessionStop();
      clearTimeout(sessionTimeout);
      if (!mounted) return;
      
      console.log('Initial session check:', existingSession?.user?.id);
      
      setSession(existingSession);
      setUser(existingSession?.user ?? null);
      setSessionRestoration(existingSession?.user ? "authenticated" : "signed_out");
      
      if (existingSession?.user && !profileFetched) {
        // Initial page load - don't apply theme from profile (localStorage is source of truth)
        await handleSession(existingSession, true, false);
      } else {
        // No session - done loading
        if (mounted) {
          setProfileLoading(false);
          setLoading(false);
          setInitialized(true); // Mark as initialized
        }
      }
    }).catch(err => {
      __initSessionStop();
      clearTimeout(sessionTimeout);
      console.error('Error getting session:', err);
      if (mounted) {
        setLoading(false);
        setProfileLoading(false);
        setInitialized(true); // Mark as initialized even on error
        // Transient failure with a cached identity: stay in "restoring" so the
        // route guard shows the auth-check state instead of flashing /auth.
        // The resume/visibility recovery pass below resolves it either way.
        setSessionRestoration(cachedUserId ? "restoring" : "signed_out");
      }
    });

    return () => {
      mounted = false;
      clearTimeout(sessionTimeout);
      subscription.unsubscribe();
    };
  }, [fetchProfile, queryClient, waitForSessionUser]);

  // SESSION RECOVERY: Check session health when the app returns to the foreground.
  // On Android, forcing refreshSession() on every resume can race token rotation
  // and trigger refresh_token_not_found, which looks like a random logout.
  useEffect(() => {
    const isNative = typeof (window as any).Capacitor !== 'undefined' && 
                     (window as any).Capacitor?.isNativePlatform?.();
    let lastResumeCheck = 0;
    let recoveryInFlight = false;

    const recoverSession = async (source: string) => {
      const now = Date.now();
      if (recoveryInFlight || now - lastResumeCheck < 3000) return;
      lastResumeCheck = now;
      recoveryInFlight = true;

      console.log(`[Auth] ${source} - checking session health`);

      try {
        const hadCachedProfile = !!getCachedProfileWithUser();

        // First trust the stored session. This avoids unnecessary refresh-token
        // rotation on resume, which was the main source of Android logouts.
        const { data: currentData, error: currentError } = await supabase.auth.getSession();
        if (!currentError && currentData.session) {
          console.log(`[Auth] ${source} - session still valid`);
          setSession(currentData.session);
          setUser(currentData.session.user);
          setSessionRestoration("authenticated");
          return;
        }

        if (!hadCachedProfile) {
          console.log(`[Auth] ${source} - no prior session to recover`);
          return;
        }

        console.warn(`[Auth] ${source} - no active session found, attempting one-time refresh`);
        // Single-flight: never race the supabase-js autoRefresh timer or the
        // 401-retry interceptor — a rotated-token replay would look like a
        // logout.
        const { session: refreshedSession, error: refreshError } = await refreshSessionOnce(12000);
        const refreshData = { session: refreshedSession };

        if (!refreshError && refreshData.session) {
          console.log(`[Auth] ${source} - session recovered via refresh`);
          setSession(refreshData.session);
          setUser(refreshData.session.user);
          setSessionRestoration("authenticated");
          return;
        }

        const refreshCode = (refreshError as { code?: string } | null)?.code;
        const refreshMessage = refreshError?.message ?? "";
        const tokenMissing = refreshCode === 'refresh_token_not_found' || /refresh token not found/i.test(refreshMessage);

        // Give Supabase a brief moment in case another refresh path already won the race.
        await new Promise(resolve => setTimeout(resolve, 250));

        const { data: retryData, error: retryError } = await supabase.auth.getSession();
        if (!retryError && retryData.session) {
          console.log(`[Auth] ${source} - session restored after retry`);
          setSession(retryData.session);
          setUser(retryData.session.user);
          setSessionRestoration("authenticated");
          return;
        }

        // CRITICAL: never tear down the local session because the network was
        // unreachable. Clearing the cache + `setUser(null)` here is what made the
        // club switcher vanish and the theme fall back to Ignite after a coverage
        // drop, with no path back until relaunch.
        if (!tokenMissing && (isTransientAuthFailure(refreshError) || isTransientAuthFailure(retryError))) {
          console.warn(`[Auth] ${source} - refresh failed for network reasons; keeping session`, refreshError ?? retryError ?? null);
          return;
        }

        console.warn(`[Auth] ${source} - session unrecoverable`, refreshError ?? currentError ?? retryError ?? null);

        queryClient.clear();
        clearProfileCache();
        clearClubTeamCache();
        clearRolesCache();
        setUser(null);
        setSession(null);
        setSessionRestoration("signed_out");
        setProfile(null);
        setCachedProfile(null);
        setUnreadCount(0);
        setUnreadMessagesCount(0);
        setLoading(false);
        setProfileLoading(false);
        setInitialized(true);

        if (tokenMissing) {
          console.warn(`[Auth] ${source} - refresh token missing after resume; user must sign in again`);
        }
      } catch (err) {
        console.error(`[Auth] ${source} - error during recovery (possibly offline):`, err);
        // Network error - don't log out, user might just be offline
      } finally {
        recoveryInFlight = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        recoverSession('visibilitychange');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Coverage restored: re-run the health check so a session that could not be
    // verified while offline recovers without waiting for the next resume.
    const unsubscribeOnline = onlineManager.subscribe(() => {
      if (onlineManager.isOnline()) recoverSession('reconnect');
    });


    // Native apps: also listen for Capacitor App resume event
    // This fires more reliably than visibilitychange on Android
    let resumeListener: { remove: () => Promise<void> } | null = null;
    if (isNative) {
      import('@capacitor/app').then(({ App }) => {
        App.addListener('resume', () => {
          recoverSession('capacitor-resume');
        }).then(listener => {
          resumeListener = listener;
        }).catch(err => {
          console.warn('[Auth] Failed to attach resume listener:', err);
        });
      }).catch(() => {});
    }

    // Foreground heartbeat: every 4 minutes while the page is visible, check
    // session expiry and refresh proactively. Long focused sessions (e.g.
    // chatting for 30+ min on iOS) otherwise rely solely on supabase-js's
    // internal timer, which can be throttled in WKWebView and iframed previews.
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      supabase.auth.getSession().then(({ data }) => {
        const session = data.session;
        if (!session) return;
        const expiresAt = session.expires_at ?? 0;
        const nowSec = Math.floor(Date.now() / 1000);
        // Refresh when <2 min remaining.
        if (expiresAt - nowSec < 120) {
          refreshSessionOnce(12000).catch(() => { /* ignore — recovery path will pick up */ });
        }
      }).catch(() => {});
    }, 4 * 60 * 1000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribeOnline();

      resumeListener?.remove().catch(() => {});
      window.clearInterval(heartbeat);
    };
  }, [queryClient]);

  // Real-time notifications subscription and push registration
  useEffect(() => {
    if (!user) return;

    // Silently enable push notifications if permission already granted
    const setupPushNotifications = async () => {
      // Only attempt if notifications are supported and already permitted
      if (!('Notification' in window) || Notification.permission !== 'granted') {
        return; // Silently skip - user can enable via settings
      }
      
      try {
        // Use silent mode - don't prompt, just subscribe if already permitted
        const result = await subscribeToPushNotifications(user.id, true);
        if (result.success) {
          console.log('[Auth] Push notifications enabled on login');
        }
        // Don't log errors in silent mode - it's expected to fail if not set up
      } catch (error) {
        // Silently ignore errors in auto-setup
      }
    };
    
    setupPushNotifications();

    // RAF-throttled, deduped invalidations so a burst of notifications
    // doesn't chain refetches and freeze the UI on slow devices.
    const inboxRefreshState = { unread: 0, team: 0, club: 0, group: 0, dm: 0, broadcast: 0 } as Record<string, number>;
    const scheduleInboxRefresh = (key: keyof typeof inboxRefreshState, fn: () => void) => {
      if (inboxRefreshState[key]) return;
      inboxRefreshState[key] = requestAnimationFrame(() => {
        inboxRefreshState[key] = 0;
        fn();
      });
    };

    const channel = supabase
      .channel(`notifications-global:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          // Optimistic increment for instant UI feedback
          setUnreadCount((prev) => prev + 1);
          
          const notificationType = (payload.new as any)?.type;
          if (MESSAGE_NOTIFICATION_TYPES.includes(notificationType)) {
            setUnreadMessagesCount((prev) => prev + 1);

            // Keep the inbox previews + per-thread unread badges in sync.
            // The dedicated message-table realtime channel can miss events
            // (RLS race / throttling), but the user-filtered notifications
            // channel is reliable. We RAF-dedupe per query so a burst of
            // notifications fires at most one refetch per frame per query.
            scheduleInboxRefresh('unread', () => {
              queryClient.invalidateQueries({ queryKey: notificationKeys.messageUnreadFor(user.id) });
              queryClient.invalidateQueries({ queryKey: notificationKeys.clubUnread });
              queryClient.invalidateQueries({ queryKey: notificationKeys.clubMessageUnread });
            });
            if (notificationType === 'team_message') {
              scheduleInboxRefresh('team', () => queryClient.invalidateQueries({ queryKey: ["my-teams-with-messages", user.id] }));
            } else if (notificationType === 'club_message') {
              scheduleInboxRefresh('club', () => queryClient.invalidateQueries({ queryKey: ["member-clubs-with-messages", user.id] }));
            } else if (notificationType === 'group_message') {
              scheduleInboxRefresh('group', () => queryClient.invalidateQueries({ queryKey: ["my-chat-groups-with-messages", user.id] }));
            } else if (notificationType === 'direct_message') {
              scheduleInboxRefresh('dm', () => queryClient.invalidateQueries({ queryKey: ["dm-conversations", user.id] }));
            } else if (notificationType === 'broadcast') {
              scheduleInboxRefresh('broadcast', () => queryClient.invalidateQueries({ queryKey: ["latest-broadcast"] }));
            }
          }
          
          // Browser-level notifications are intentionally NOT fired here.
          // Push delivery is native-only (FCM/APNs via the Capacitor app); web
          // push is disabled. Firing showBrowserNotification from an open tab
          // produced Chrome-branded "ignite.invalid" alerts duplicating the
          // native app's notifications. In-app UI (bell + toasts) covers the
          // browser case.
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.new && (payload.new as any).is_read === true) {
            // RAF-dedupe: opening a thread with N unread messages fires N
            // UPDATE events back-to-back; without dedupe we'd chain N full
            // RPC round-trips and stall the badge for hundreds of ms.
            scheduleInboxRefresh('unread', () => {
              fetchUnreadCount(user.id);
              queryClient.invalidateQueries({ queryKey: notificationKeys.clubUnread });
              queryClient.invalidateQueries({ queryKey: notificationKeys.clubMessageUnread });
              queryClient.invalidateQueries({ queryKey: notificationKeys.messageUnread });
              queryClient.invalidateQueries({ queryKey: notificationKeys.recent });
            });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          scheduleInboxRefresh('unread', () => {
            fetchUnreadCount(user.id);
            queryClient.invalidateQueries({ queryKey: notificationKeys.clubUnread });
            queryClient.invalidateQueries({ queryKey: notificationKeys.clubMessageUnread });
            queryClient.invalidateQueries({ queryKey: notificationKeys.messageUnread });
            queryClient.invalidateQueries({ queryKey: notificationKeys.recent });
          });
        }
      )
      .subscribe();

    // Re-sync unread count from server when app becomes visible or focused.
    // visibility + focus often both fire on native resume, so debounce them
    // into a single invalidation window (~500 ms) to avoid duplicate RPCs.
    let resyncTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleResync = () => {
      if (resyncTimer) return;
      resyncTimer = setTimeout(() => {
        resyncTimer = null;
        fetchUnreadCount(user.id);
        queryClient.invalidateQueries({ queryKey: notificationKeys.clubUnread });
        queryClient.invalidateQueries({ queryKey: notificationKeys.clubMessageUnread });
        queryClient.invalidateQueries({ queryKey: notificationKeys.messageUnread });
        queryClient.invalidateQueries({ queryKey: notificationKeys.recent });
      }, 500);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') scheduleResync();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const handleFocus = () => scheduleResync();
    window.addEventListener('focus', handleFocus);

    return () => {
      supabase.removeChannel(channel);
      Object.keys(inboxRefreshState).forEach((k) => {
        if (inboxRefreshState[k]) cancelAnimationFrame(inboxRefreshState[k]);
      });
      if (resyncTimer) clearTimeout(resyncTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [user, queryClient]);

  const signUp = async (email: string, password: string) => {
    // Check for pending redirect (e.g., from invite link)
    let pendingRedirect: string | null = null;
    try {
      pendingRedirect = sessionStorage.getItem("redirectAfterAuth");
    } catch {
      pendingRedirect = null;
    }
    const redirectUrl = pendingRedirect 
      ? `${window.location.origin}${pendingRedirect}`
      : `${window.location.origin}/`;
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectUrl },
      });
      // When email confirmation is required, signUp resolves with no session.
      // Surface that explicitly so callers can tell the user what happens next
      // instead of silently doing nothing.
      const needsEmailConfirmation = !error && !data?.session;
      return { error: error as Error | null, needsEmailConfirmation };
    } catch (err) {
      console.error('[Auth] signUp error:', err);
      return { error: err as Error, needsEmailConfirmation: false };
    }
  };


  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error as Error | null };
    } catch (err) {
      console.error('[Auth] signIn error:', err);
      return { error: err as Error };
    }
  };

  const signInWithGoogle = async () => {
    // Check for pending redirect (e.g., from invite link)
    let pendingRedirect: string | null = null;
    try {
      pendingRedirect = sessionStorage.getItem("redirectAfterAuth");
    } catch {
      pendingRedirect = null;
    }
    
    // For native apps, use the published app URL for OAuth redirects
    // The WebView can't handle capacitor:// or ionic:// schemes for OAuth
    const isNative = typeof (window as any).Capacitor !== 'undefined' && 
                     (window as any).Capacitor?.isNativePlatform?.();
    
    // Use the published app URL for native, or current origin for web
    // For native: OAuth will redirect to the published URL, which triggers App Links
    // and brings the user back into the native app with the tokens
    const baseUrl = isNative 
      ? 'https://reference.invalid'
      : window.location.origin;
    
    const redirectUrl = pendingRedirect 
      ? `${baseUrl}${pendingRedirect}`
      : `${baseUrl}/`;
      
    console.log('[Auth] Google OAuth redirect URL:', redirectUrl, 'isNative:', isNative);
    
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
        // Skip the browser redirect - we'll handle token exchange in the app
        // This is needed for the native app to capture the callback
        skipBrowserRedirect: false,
      },
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    const currentUserId = user?.id;

    try {
      if (currentUserId && isNativePlatform()) {
        await unregisterNativePush(currentUserId);
      }
    } catch (error) {
      console.error('[Auth] Native push cleanup failed during sign out:', error);
    }

    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Sign out error:', error);
    }
    setUser(null);
    setSession(null);
    setSessionRestoration("signed_out");
    setProfile(null);
    setCachedProfile(null);
    currentUserIdRef.current = null; // Clear so re-login is treated as fresh (applies theme from DB)
    // Clear ALL React Query cache to prevent stale RLS data on re-login
    queryClient.clear();
    clearRolesCache(); // Clear cached user roles (security-critical)
    setUnreadCount(0);
    setUnreadMessagesCount(0);
  };

  const refreshProfile = useCallback(async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  }, [user, fetchProfile]);

  const refreshUnreadCount = useCallback(async () => {
    if (user) {
      await fetchUnreadCount(user.id);
    }
  }, [user, fetchUnreadCount]);

  const clearUnreadCount = useCallback(() => {
    setUnreadCount(0);
    setUnreadMessagesCount(0);
  }, []);

  const decrementUnreadCount = useCallback((n: number) => {
    if (!n || n <= 0) return;
    setUnreadCount((prev) => Math.max(0, prev - n));
    setUnreadMessagesCount((prev) => Math.max(0, prev - n));
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      loading,
      profileLoading,
      profileError,
      initialized,
      sessionRestoration,
      profileResolved,
      unreadCount,
      unreadMessagesCount,
      signUp,
      signIn,
      signInWithGoogle,
      signOut,
      refreshProfile,
      refreshUnreadCount,
      clearUnreadCount,
      decrementUnreadCount,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

/** Local ICP session seam for staged frontend migration work. */
export function IcpAuthProvider({ children, persona = "member" }: { children: ReactNode; persona?: string }) {
  const [session, setSession] = useState<InternetIdentitySession | null>(() => {
    try {
      const raw = localStorage.getItem("ignite_icp_internet_identity_session");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as InternetIdentitySession;
      return parsed?.provider === "internet-identity" && typeof parsed.principal === "string" ? parsed : null;
    } catch {
      localStorage.removeItem("ignite_icp_internet_identity_session");
      return null;
    }
  });
  const principal = session?.principal ?? null;
  const user = principal ? {
    id: principal,
    aud: "authenticated",
    role: "authenticated",
    email: `${principal}@internet-identity.ignite-icp.test`,
    app_metadata: { provider: "icp" },
    user_metadata: { display_name: "Internet Identity" },
    identities: [],
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  } as unknown as User : null;
  const profile = principal ? {
    id: principal,
    display_name: "Internet Identity",
    avatar_url: null,
    ignite_points: 0,
    theme_preference: null,
  } : null;
  // Preload the Internet Identity module and eagerly construct its auth
  // client as soon as this provider mounts (well before the user can click
  // sign-in). The signer transport used by `client.signIn()` only allows
  // opening its popup window synchronously within the same click event's
  // dispatch — any `await` beforehand (including a lazy `import()` or
  // client construction) yields back to the browser, which finishes the
  // click event before our code resumes, causing "Signer window should not
  // be opened outside of click handler". Warming here means `signInWithIcp`
  // below can reach the actual `signIn()` call with zero awaits in front of it.
  const internetIdentityModuleRef = useRef<typeof import("@/lab/internetIdentityAuth") | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const mod = await import("@/lab/internetIdentityAuth");
      if (cancelled) return;
      internetIdentityModuleRef.current = mod;
      void mod.warmInternetIdentityAuthClient();
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const signInWithIcp = async (): Promise<{ error: Error | null }> => {
    try {
      // Use the already-preloaded module reference when available so this
      // call chain reaches `signInWithInternetIdentity()` (and, inside it,
      // `client.signIn()`) synchronously — see the warm-up effect above.
      // The `??` short-circuits, so the fallback `import()` is never
      // evaluated (and never adds an await) on the common warmed path.
      const mod = internetIdentityModuleRef.current ?? (await import("@/lab/internetIdentityAuth"));
      const nextSession = await mod.signInWithInternetIdentity(
        typeof window !== "undefined" ? `${location.pathname}${location.search}${location.hash}` : undefined,
      );
      localStorage.setItem("ignite_icp_internet_identity_session", JSON.stringify(nextSession));
      setSession(nextSession);
      return { error: null };
    } catch (error) {
      return { error: error instanceof Error ? error : new Error("Internet Identity sign-in failed.") };
    }
  };
  const value = {
    user,
    session: null as Session | null,
    profile,
    loading: false,
    profileLoading: false,
    profileError: false,
    initialized: true,
    sessionRestoration: principal ? "authenticated" as const : "signed_out" as const,
    profileResolved: true,
    unreadCount: 0,
    unreadMessagesCount: 0,
    signUp: async () => ({ error: (await signInWithIcp()).error, needsEmailConfirmation: false }),
    signIn: async () => signInWithIcp(),
    signInWithGoogle: async () => signInWithIcp(),
    signOut: async () => {
      localStorage.removeItem("ignite_icp_internet_identity_session");
      setSession(null);
      const { signOutInternetIdentity } = await import("@/lab/internetIdentityAuth");
      await signOutInternetIdentity();
    },
    refreshProfile: async () => {},
    refreshUnreadCount: async () => {},
    clearUnreadCount: () => {},
    decrementUnreadCount: () => {},
  } satisfies AuthContextType;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
