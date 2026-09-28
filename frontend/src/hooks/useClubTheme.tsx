import { createContext, useContext, useEffect, useLayoutEffect, useState, useCallback, ReactNode } from "react";
import { useQuery, keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { purgeClubScopedQueryCache } from "@/lib/clubScopeCachePurge";
import { guardClubListResult, resetClubListEmptyGuard } from "@/lib/clubListEmptyGuard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "next-themes";
import { preloadLogo } from "@/components/ui/logo-image";
import { consumeAuthThemeHint } from "@/lib/authThemeHint";
import {
  clearAppliedNotificationClubSwitch,
  getAppliedNotificationClubSwitch,
} from "@/lib/notificationClubSwitch";


interface HSLColor {
  h: number;
  s: number;
  l: number;
}

interface ClubTheme {
  clubId: string;
  clubName: string;
  logoUrl: string | null;
  showLogoInHeader: boolean;
  showNameInHeader: boolean;
  logoOnlyMode: boolean;
  sport: string | null;
  // Light mode colors
  primary: HSLColor | null;
  secondary: HSLColor | null;
  accent: HSLColor | null;
  // Dark mode colors
  darkPrimary: HSLColor | null;
  darkSecondary: HSLColor | null;
  darkAccent: HSLColor | null;
}

// Cache structure - includes logoUrl for instant header display
interface CachedThemeData {
  clubId: string;
  clubName: string;
  logoUrl: string | null;
  showLogoInHeader: boolean;
  showNameInHeader: boolean;
  logoOnlyMode: boolean;
  sport: string | null;
  primary: HSLColor | null;
  secondary: HSLColor | null;
  accent: HSLColor | null;
  darkPrimary: HSLColor | null;
  darkSecondary: HSLColor | null;
  darkAccent: HSLColor | null;
}

// Helper to convert full theme to cacheable version (includes logoUrl for instant display)
const toCacheableTheme = (theme: ClubTheme): CachedThemeData => ({
  clubId: theme.clubId,
  clubName: theme.clubName,
  logoUrl: theme.logoUrl,
  showLogoInHeader: theme.showLogoInHeader,
  showNameInHeader: theme.showNameInHeader,
  logoOnlyMode: theme.logoOnlyMode,
  sport: theme.sport,
  primary: theme.primary,
  secondary: theme.secondary,
  accent: theme.accent,
  darkPrimary: theme.darkPrimary,
  darkSecondary: theme.darkSecondary,
  darkAccent: theme.darkAccent,
});

// Safe localStorage setter that handles quota errors
const safeSetItem = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    // Quota exceeded - try to clear old theme data first
    console.warn('localStorage quota exceeded, clearing old theme data');
    try {
      // Clear all theme data keys
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith(STORAGE_KEY_PREFIX) || k.startsWith(STORAGE_DATA_KEY_PREFIX))) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      // Retry
      localStorage.setItem(key, value);
    } catch {
      // Still failed - just skip caching
      console.warn('Failed to cache theme data');
    }
  }
};

interface FreeClubData {
  id: string;
  name: string;
  logo_url: string | null;
}

interface ClubThemeContextType {
  availableClubThemes: ClubTheme[];
  activeClubTheme: string | null; // club ID or null - also acts as content filter
  activeThemeData: ClubTheme | null;
  activeFreeClubData: FreeClubData | null;
  setActiveClubTheme: (clubId: string | null) => void;
  isLoading: boolean;
  isThemeReady: boolean; // True when theme loading from DB is complete
  // Club filter helpers - when a theme is active, content is filtered to that club
  activeClubFilter: string | null; // Same as activeClubTheme - for semantic clarity
  activeClubTeamIds: string[]; // Team IDs belonging to the active club (for filtering)
}

const ClubThemeContext = createContext<ClubThemeContextType>({
  availableClubThemes: [],
  activeClubTheme: null,
  activeThemeData: null,
  activeFreeClubData: null,
  setActiveClubTheme: () => {},
  isLoading: false,
  isThemeReady: false,
  activeClubFilter: null,
  activeClubTeamIds: [],
});

const STORAGE_KEY_PREFIX = "ignite-club-theme-";
const STORAGE_DATA_KEY_PREFIX = "ignite-club-theme-data-";
const NO_CLUB_THEME_SENTINEL = "__ignite_no_club__";

const getStorageKey = (userId: string) => `${STORAGE_KEY_PREFIX}${userId}`;
const getStorageDataKey = (userId: string) => `${STORAGE_DATA_KEY_PREFIX}${userId}`;
const isNoClubThemePreference = (value: string | null) => value === NO_CLUB_THEME_SENTINEL;

// Track last applied signature to avoid redundant CSS variable writes
let lastAppliedThemeSignature: string | null = null;

// Helper to clear ALL theme-related inline CSS properties from document root
const clearAllThemeCSS = () => {
  const root = document.documentElement;
  root.style.removeProperty("--primary");
  root.style.removeProperty("--primary-foreground");
  root.style.removeProperty("--secondary");
  root.style.removeProperty("--secondary-foreground");
  root.style.removeProperty("--accent");
  root.style.removeProperty("--accent-foreground");
  root.style.removeProperty("--ring");
  root.style.removeProperty("--rsvp-selected");
  root.style.removeProperty("--rsvp-selected-foreground");
  root.style.removeProperty("--background");
  root.style.removeProperty("--card");
  root.style.removeProperty("--card-foreground");
  root.style.removeProperty("--border");
  root.style.removeProperty("--input");
  root.style.removeProperty("--muted");
  root.style.removeProperty("--popover");
  root.style.removeProperty("--popover-foreground");
  // Reset throttle signature so next applyThemeCSS will run
  lastAppliedThemeSignature = null;
};

// Apply theme CSS from theme data based on current mode
const applyThemeCSS = (theme: ClubTheme | null, isDarkMode: boolean) => {
  const root = document.documentElement;

  // Build a stable signature representing the resolved theme + mode
  const signature = !theme || theme.logoOnlyMode
    ? `none|${isDarkMode}`
    : JSON.stringify({
        c: theme.clubId,
        d: isDarkMode,
        p: isDarkMode ? (theme.darkPrimary || theme.primary) : theme.primary,
        s: isDarkMode ? (theme.darkSecondary || theme.secondary) : theme.secondary,
        a: isDarkMode ? (theme.darkAccent || theme.accent) : theme.accent,
        lo: theme.logoOnlyMode,
      });

  // Skip if nothing changed since the last application
  if (signature === lastAppliedThemeSignature) {
    return;
  }
  lastAppliedThemeSignature = signature;

  if (!theme || theme.logoOnlyMode) {
    clearAllThemeCSS();
    return;
  }

  // Choose colors based on mode - fall back to light colors if dark not set
  const primary = isDarkMode ? (theme.darkPrimary || theme.primary) : theme.primary;
  const secondary = isDarkMode ? (theme.darkSecondary || theme.secondary) : theme.secondary;
  const accent = isDarkMode ? (theme.darkAccent || theme.accent) : theme.accent;

  if (primary) {
    const cssValue = `${primary.h} ${primary.s}% ${primary.l}%`;
    root.style.setProperty("--primary", cssValue);
    const fgL = primary.l > 50 ? 10 : 98;
    root.style.setProperty("--primary-foreground", `${primary.h} 10% ${fgL}%`);
    root.style.setProperty("--ring", cssValue);

    // RSVP "selected" state must follow the club identity too — otherwise the
    // Going / Maybe / Can't go buttons keep the default Ignite blue while the
    // rest of the card is club-branded.
    const rsvpL = Math.min(Math.max(primary.l, isDarkMode ? 44 : 34), isDarkMode ? 58 : 50);
    const rsvpS = Math.max(primary.s, 40);
    root.style.setProperty("--rsvp-selected", `${primary.h} ${rsvpS}% ${rsvpL}%`);
    root.style.setProperty("--rsvp-selected-foreground", `${primary.h} 10% ${rsvpL > 55 ? 12 : 98}%`);
  }


  if (secondary) {
    root.style.setProperty("--secondary", `${secondary.h} ${secondary.s}% ${secondary.l}%`);
    const fgL = secondary.l > 50 ? 20 : 90;
    root.style.setProperty("--secondary-foreground", `${secondary.h} 40% ${fgL}%`);
  }

  if (accent) {
    root.style.setProperty("--accent", `${accent.h} ${accent.s}% ${accent.l}%`);
    // Ensure strong contrast: dark foreground on light accents, light on dark accents
    // Use a wider threshold to handle mid-range lightness values
    const fgL = accent.l >= 45 ? 15 : 90;
    root.style.setProperty("--accent-foreground", `${accent.h} 50% ${fgL}%`);
  }

  // Club-themed light mode polish: apply subtle branded tints to background, cards, borders
  // This makes light mode feel more branded without changing layout or the default Ignite theme
  if (!isDarkMode && primary) {
    const h = primary.h;
    // Soft blue-grey/cool tinted page background
    root.style.setProperty("--background", `${h} 12% 95%`);
    // Cards slightly whiter than page background for separation
    root.style.setProperty("--card", `${h} 8% 99%`);
    root.style.setProperty("--card-foreground", `${h} 10% 10%`);
    // Subtly clearer borders
    root.style.setProperty("--border", `${h} 14% 82%`);
    root.style.setProperty("--input", `${h} 14% 82%`);
    // Tinted muted backgrounds
    root.style.setProperty("--muted", `${h} 10% 91%`);
    root.style.setProperty("--popover", `${h} 8% 98%`);
    root.style.setProperty("--popover-foreground", `${h} 10% 10%`);
  } else {
    // Dark mode or no club theme in light mode - restore defaults
    root.style.removeProperty("--background");
    root.style.removeProperty("--card");
    root.style.removeProperty("--card-foreground");
    root.style.removeProperty("--border");
    root.style.removeProperty("--input");
    root.style.removeProperty("--muted");
    root.style.removeProperty("--popover");
    root.style.removeProperty("--popover-foreground");
  }
};

export function ClubThemeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // Safely access auth context - may not be available during HMR or initial render
  let user = null;
  let authLoading = true; // Assume loading until we know for sure
  try {
    const auth = useAuth();
    user = auth.user;
    authLoading = auth.loading;
  } catch (e) {
    // AuthProvider not yet available (HMR or render order issue)
    console.warn('[ClubThemeProvider] AuthProvider not available yet');
  }
  
  const { resolvedTheme } = useTheme();
  
  // CRITICAL: Read theme from DOM class first, then localStorage
  // During Google OAuth return, useAuth updates DOM class synchronously when profile is fetched,
  // but localStorage and next-themes may still have stale values from the previous user.
  // The DOM class is the authoritative source after auth updates it.
  const getEffectiveTheme = useCallback((): 'light' | 'dark' => {
    if (typeof window !== 'undefined') {
      const isDarkClass = document.documentElement.classList.contains('dark');
      if (isDarkClass) return 'dark';
      if (document.documentElement.classList.contains('light')) return 'light';
      
      const stored = localStorage.getItem('app-theme');
      if (stored === 'dark' || stored === 'light') {
        return stored;
      }
    }
    return 'light';
  }, []);
  
  // REACTIVE dark mode state: track DOM class changes via MutationObserver
  // This ensures club theme CSS is immediately re-applied when theme toggles,
  // preventing the "washed out" flash on first toggle.
  const [isDarkMode, setIsDarkMode] = useState(() => getEffectiveTheme() === "dark");
  
  useEffect(() => {
    // Sync on mount
    setIsDarkMode(getEffectiveTheme() === "dark");
    
    const observer = new MutationObserver(() => {
      setIsDarkMode(getEffectiveTheme() === "dark");
    });
    
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    
    return () => observer.disconnect();
  }, [getEffectiveTheme]);

  // SYNCHRONOUS INITIALIZATION: Read from localStorage during initial state setup
  // This ensures theme is available immediately on first render, not after an effect
  const getInitialThemeState = (): { themeId: string | null; themeData: ClubTheme | null } => {
    if (typeof window === 'undefined' || !user?.id) {
      return { themeId: null, themeData: null };
    }
    
    const storedId = localStorage.getItem(getStorageKey(user.id));
    const storedData = localStorage.getItem(getStorageDataKey(user.id));
    
    if (isNoClubThemePreference(storedId)) {
      return { themeId: null, themeData: null };
    }

    if (storedId && storedData) {
      try {
        const parsedData = JSON.parse(storedData) as CachedThemeData;
        if (parsedData.clubId === storedId) {
          const themeFromCache: ClubTheme = { 
            ...parsedData, 
            logoUrl: parsedData.logoUrl ?? null, 
            sport: parsedData.sport ?? null 
          };
          // Apply theme CSS immediately during initialization
          // CRITICAL: Use getEffectiveTheme() instead of resolvedTheme here because
          // resolvedTheme is undefined during initial render before next-themes hydrates
          applyThemeCSS(themeFromCache, getEffectiveTheme() === "dark");
          return { themeId: storedId, themeData: themeFromCache };
        }
      } catch {
        // Invalid cache
      }
    }
    
    if (storedId) {
      return { themeId: storedId, themeData: null };
    }
    
    return { themeId: null, themeData: null };
  };

  // Use lazy initialization to read from localStorage synchronously
  const [activeClubTheme, setActiveClubThemeStateRaw] = useState<string | null>(() => {
    const pinned = getAppliedNotificationClubSwitch();
    if (pinned) return pinned;
    return getInitialThemeState().themeId;
  });

  /**
   * Guarded state setter.
   *
   * This provider re-asserts `activeClubTheme` from localStorage / the profile
   * row in several async bootstrap paths (fresh-login restore, the layout-effect
   * sync, the DB load, the CSS effect's fallback). On a notification tap for a
   * DIFFERENT club those late writes raced the switch and dragged the filter
   * back to the previously selected club — the app ended up showing a
   * Bridgewater thread while filtered to Basket Range.
   *
   * While a notification-driven switch is pinned (short TTL), no bootstrap path
   * may point the filter anywhere else. Explicit user selection via
   * `setActiveClubTheme` clears the pin first, so the club picker is unaffected.
   */
  const setActiveClubThemeState = (next: string | null) => {
    const pinned = getAppliedNotificationClubSwitch();
    if (pinned && next !== pinned) {
      console.log('[ClubTheme] ignoring bootstrap club write while notification switch is pinned', { next, pinned });
      return;
    }
    setActiveClubThemeStateRaw(next);
  };
  const [cachedThemeData, setCachedThemeData] = useState<ClubTheme | null>(() => {
    return getInitialThemeState().themeData;
  });

  // Track if we've checked for default theme for this user session
  const [hasCheckedDefault, setHasCheckedDefault] = useState(false);
  // Track if we're loading theme from database
  const [isLoadingFromDb, setIsLoadingFromDb] = useState(false);
  // Track if we've ever started the DB load for this user session
  const [hasStartedDbLoad, setHasStartedDbLoad] = useState(false);
  // Track the last user ID to detect user switches (e.g., Google OAuth to different account)
  const [lastUserId, setLastUserId] = useState<string | null>(null);
  // Track if we're in the middle of a user switch - prevents isThemeReady from being true prematurely
  const [isUserSwitching, setIsUserSwitching] = useState(false);
  // Track if cached theme was applied on fresh login - allows instant rendering without waiting for DB
  const [hasCacheAppliedOnLogin, setHasCacheAppliedOnLogin] = useState(false);

  // CRITICAL: Detect user switch and reset ALL theme state
  // Only clear cache on actual user SWITCH (different user ID), not fresh login (same user returning)
  // Fresh login: restore from localStorage cache for instant logo display
  useLayoutEffect(() => {
    const isFreshLogin = user?.id && !lastUserId;
    const isUserSwitch = user?.id && lastUserId && user.id !== lastUserId;
    
    if (isUserSwitch) {
      console.log('[ClubTheme] User switch detected, clearing theme state');
      setIsUserSwitching(true);
      setHasCacheAppliedOnLogin(false);
      clearAllThemeCSS();
      setActiveClubThemeState(null);
      setCachedThemeData(null);
      setHasCheckedDefault(false);
      setHasStartedDbLoad(false);
      setIsLoadingFromDb(true);
      
      // Clear localStorage for the OLD user's cache to prevent cross-contamination
      if (lastUserId) {
        localStorage.removeItem(getStorageKey(lastUserId));
        localStorage.removeItem(getStorageDataKey(lastUserId));
      }
    } else if (isFreshLogin) {
      console.log('[ClubTheme] Fresh login detected, restoring from cache if available');
      // On fresh login, try to restore from cache immediately for instant logo
      const storedId = localStorage.getItem(getStorageKey(user.id));
      const storedData = localStorage.getItem(getStorageDataKey(user.id));
      
      let cacheApplied = false;
      if (isNoClubThemePreference(storedId)) {
        setActiveClubThemeState(null);
        setCachedThemeData(null);
        localStorage.removeItem(getStorageDataKey(user.id));
        clearAllThemeCSS();
        cacheApplied = true;
      } else if (storedId && storedData) {
        try {
          const parsedData = JSON.parse(storedData) as CachedThemeData;
          if (parsedData.clubId === storedId) {
            const themeFromCache: ClubTheme = { 
              ...parsedData, 
              logoUrl: parsedData.logoUrl ?? null, 
              sport: parsedData.sport ?? null 
            };
            setActiveClubThemeState(storedId);
            setCachedThemeData(themeFromCache);
            applyThemeCSS(themeFromCache, getEffectiveTheme() === "dark");
            cacheApplied = true;
            
            // Preload the logo image so it's ready when the header renders.
            // Use LogoImage's shared cache so the visible <img> reuses the decoded entry
            // instead of issuing a fresh fetch + decode on mount.
            if (themeFromCache.logoUrl) {
              preloadLogo(themeFromCache.logoUrl);
            }
          }
        } catch {
          // Invalid cache, will be populated from DB
        }
      } else if (!storedId) {
        // No cached theme for this user = they use Ignite Mode, also instant-ready
        cacheApplied = true;
      }
      
      setHasCacheAppliedOnLogin(cacheApplied);
      setHasCheckedDefault(false);
      setHasStartedDbLoad(false);
      setIsLoadingFromDb(true);
    }
    
    // Update lastUserId after handling
    if (user?.id !== lastUserId) {
      setLastUserId(user?.id ?? null);
    }
  }, [user?.id, lastUserId]);

  // Re-read from localStorage when the authenticated user changes.
  // Use useLayoutEffect to ensure this runs synchronously before browser paint
  // This handles subsequent updates after initial render
  useLayoutEffect(() => {
    if (user?.id && typeof window !== "undefined") {
      const storedId = localStorage.getItem(getStorageKey(user.id));
      const storedData = localStorage.getItem(getStorageDataKey(user.id));
      
      // If localStorage has theme data for THIS user, sync state
      if (isNoClubThemePreference(storedId)) {
        setActiveClubThemeState(null);
        setCachedThemeData(null);
        localStorage.removeItem(getStorageDataKey(user.id));
        clearAllThemeCSS();
      } else if (storedId) {
        setActiveClubThemeState(storedId);
        
        if (storedData) {
          try {
            const parsedData = JSON.parse(storedData) as CachedThemeData;
            if (parsedData.clubId === storedId) {
              const themeFromCache: ClubTheme = { 
                ...parsedData, 
                logoUrl: parsedData.logoUrl ?? null, 
                sport: parsedData.sport ?? null 
              };
              setCachedThemeData(themeFromCache);
              applyThemeCSS(themeFromCache, isDarkMode);
            }
          } catch {
            // Invalid cache
          }
        }
      } else {
        // No cache for this user - clear any stale state
        setActiveClubThemeState(null);
        setCachedThemeData(null);
      }
    }
  }, [user?.id, isDarkMode]);

  // Ensure loading state is set when user becomes available (before DB fetch)
  useEffect(() => {
    if (user?.id && !hasStartedDbLoad) {
      setIsLoadingFromDb(true);
      setHasStartedDbLoad(true);
    }
    // Reset when user logs out
    if (!user?.id && hasStartedDbLoad) {
      setHasStartedDbLoad(false);
    }
  }, [user?.id, hasStartedDbLoad]);

  // Load theme preference from database for cross-device sync
  // The localStorage read is handled by the effect above (triggered by localStorageVersion)
  useEffect(() => {
    if (user?.id && typeof window !== "undefined") {
      const storedId = localStorage.getItem(getStorageKey(user.id));
      
      // Load theme preference from database (cross-device sync)
      const loadThemeFromDb = async () => {
        setIsLoadingFromDb(true);
        try {
          // Short-circuit the profiles round-trip when useAuth.fetchProfile
          // just retrieved active_club_theme_id during the SIGNED_IN gate.
          const hint = consumeAuthThemeHint(user.id);
          let data: { active_club_theme_id: string | null } | null = null;
          let error: unknown = null;
          if (hint) {
            data = { active_club_theme_id: hint.value };
          } else {
            const res = await supabase
              .from('profiles')
              .select('active_club_theme_id')
              .eq('id', user.id)
              .single();
            data = res.data as any;
            error = res.error;
          }

          if (!error && data) {
            // A notification tap is a newer, explicit user action than this
            // async profile read. If the read started before the tap, resolve
            // the remainder of this load against the pinned club instead of
            // restoring the old profile club's cache, CSS and localStorage.
            const notificationPinnedClub = getAppliedNotificationClubSwitch();
            if (notificationPinnedClub && data.active_club_theme_id !== notificationPinnedClub) {
              data = { active_club_theme_id: notificationPinnedClub };
            }
            const storedPreference = localStorage.getItem(getStorageKey(user.id));

            if (isNoClubThemePreference(storedPreference)) {
              // Same-device explicit "All Clubs" choice wins over any older DB value.
              // This prevents logout/login from resurrecting a previous club filter.
              if (data.active_club_theme_id) {
                supabase
                  .from('profiles')
                  .update({ active_club_theme_id: null })
                  .eq('id', user.id)
                  .then(({ error }) => {
                    if (error) console.error('Failed to sync no-club preference:', error);
                  });
              }
              localStorage.removeItem(getStorageDataKey(user.id));
              setActiveClubThemeState(null);
              setCachedThemeData(null);
              clearAllThemeCSS();
              setHasCheckedDefault(true);
              return;
            }

            if (storedPreference && storedPreference !== data.active_club_theme_id) {
              // Local selection is the last same-device action. If the user logs out
              // immediately after switching clubs, the DB update may not have won
              // the race; never let an older DB value select a different club.
              data = { active_club_theme_id: storedPreference };
              supabase
                .from('profiles')
                .update({ active_club_theme_id: storedPreference })
                .eq('id', user.id)
                .then(({ error }) => {
                  if (error) console.error('Failed to sync local club preference:', error);
                });
            }

            // We successfully fetched profile data
            if (data.active_club_theme_id) {
              // Database has a club theme preference - use it (overrides localStorage for cross-device sync)
              setActiveClubThemeState(data.active_club_theme_id);
              safeSetItem(getStorageKey(user.id), data.active_club_theme_id);
              // User has explicit preference - don't auto-set
              setHasCheckedDefault(true);
              
              // Check if we have FRESH localStorage data that matches the DB preference
              const freshStoredData = localStorage.getItem(getStorageDataKey(user.id));
              let themeApplied = false;
              
              if (freshStoredData) {
                try {
                  const parsedData = JSON.parse(freshStoredData) as CachedThemeData;
                  // Only use cached data if it matches the club ID from database
                  if (parsedData.clubId === data.active_club_theme_id) {
                    const themeFromCache: ClubTheme = { 
                      ...parsedData, 
                      logoUrl: parsedData.logoUrl ?? null, 
                      sport: parsedData.sport ?? null 
                    };
                    setCachedThemeData(themeFromCache);
                    applyThemeCSS(themeFromCache, isDarkMode);
                    themeApplied = true;
                  }
                } catch {
                  // Invalid cache, will fetch from server
                }
              }
              
              // If no valid cache or cache didn't match, fetch from server
              if (!themeApplied) {
                const { data: clubData } = await supabase
                  .from('clubs')
                  .select(`
                    id, name, logo_url, show_logo_in_header, show_name_in_header, logo_only_mode, sport,
                    theme_primary_h, theme_primary_s, theme_primary_l,
                    theme_dark_primary_h, theme_dark_primary_s, theme_dark_primary_l,
                    theme_secondary_h, theme_secondary_s, theme_secondary_l,
                    theme_dark_secondary_h, theme_dark_secondary_s, theme_dark_secondary_l,
                    theme_accent_h, theme_accent_s, theme_accent_l,
                    theme_dark_accent_h, theme_dark_accent_s, theme_dark_accent_l
                  `)
                  .eq('id', data.active_club_theme_id)
                  .single();
                
                if (clubData) {
                  const themeData: ClubTheme = {
                    clubId: clubData.id,
                    clubName: clubData.name,
                    logoUrl: clubData.logo_url,
                    showLogoInHeader: clubData.show_logo_in_header ?? false,
                    showNameInHeader: clubData.show_name_in_header ?? true,
                    logoOnlyMode: clubData.logo_only_mode ?? false,
                    sport: clubData.sport,
                    primary: clubData.theme_primary_h !== null ? { h: clubData.theme_primary_h, s: clubData.theme_primary_s!, l: clubData.theme_primary_l! } : null,
                    secondary: clubData.theme_secondary_h !== null ? { h: clubData.theme_secondary_h, s: clubData.theme_secondary_s!, l: clubData.theme_secondary_l! } : null,
                    accent: clubData.theme_accent_h !== null ? { h: clubData.theme_accent_h, s: clubData.theme_accent_s!, l: clubData.theme_accent_l! } : null,
                    darkPrimary: clubData.theme_dark_primary_h !== null ? { h: clubData.theme_dark_primary_h, s: clubData.theme_dark_primary_s!, l: clubData.theme_dark_primary_l! } : null,
                    darkSecondary: clubData.theme_dark_secondary_h !== null ? { h: clubData.theme_dark_secondary_h, s: clubData.theme_dark_secondary_s!, l: clubData.theme_dark_secondary_l! } : null,
                    darkAccent: clubData.theme_dark_accent_h !== null ? { h: clubData.theme_dark_accent_h, s: clubData.theme_dark_accent_s!, l: clubData.theme_dark_accent_l! } : null,
                  };
                  console.log('[ClubTheme] DB load complete - applying theme CSS:', {
                    clubId: themeData.clubId,
                    primary: themeData.primary,
                    darkPrimary: themeData.darkPrimary,
                    isDarkMode,
                    logoOnlyMode: themeData.logoOnlyMode,
                  });
                  safeSetItem(getStorageDataKey(user.id), JSON.stringify(toCacheableTheme(themeData)));
                  setCachedThemeData(themeData);
                  applyThemeCSS(themeData, isDarkMode);
                  // Preload logo image for instant header display
                  if (themeData.logoUrl) { const img = new Image(); img.src = themeData.logoUrl; }
                  console.log('[ClubTheme] Applied theme CSS from DB load');
                }
              }
            } else {
              // Database has null/undefined active_club_theme_id.
              // Only write the explicit "no club" sentinel when the user
              // previously had a real club selected on this device (i.e.
              // localStorage already had a value). For brand-new users
              // (storedPreference === null) we must NOT pin them to the
              // sentinel — the invite-accept flow on CompleteProfilePage
              // is about to seed their active club from the invite, and
              // a sentinel here would race it and win.
              const hadPriorPreference = storedPreference !== null;
              if (hadPriorPreference) {
                console.log('[ClubTheme] DB has no active club theme - syncing local sentinel to match');
                safeSetItem(getStorageKey(user.id), NO_CLUB_THEME_SENTINEL);
                localStorage.removeItem(getStorageDataKey(user.id));
              } else {
                console.log('[ClubTheme] DB has no active club theme and no local preference - leaving unset for invite seeding');
              }
              setActiveClubThemeState(null);
              setCachedThemeData(null);
              setHasCheckedDefault(true);
            }
          } else if (storedId) {
            // Have localStorage but failed to fetch DB - use localStorage, don't auto-set
            setHasCheckedDefault(true);
          }
          // If no data and no storedId, hasCheckedDefault stays false and auto-set may occur
        } catch (err) {
          console.error('Failed to load club theme from database:', err);
        } finally {
          setIsLoadingFromDb(false);
          setIsUserSwitching(false); // Clear switching flag - theme is now ready
        }
      };
      
      loadThemeFromDb();
    }
  }, [user?.id, isDarkMode]);


  // Clear theme CSS on logout (but keep localStorage preference for re-login)
  useEffect(() => {
    if (!user) {
      setActiveClubThemeState(null);
      // Clear CSS variables but DON'T remove localStorage - restore on re-login
      clearAllThemeCSS();
      // Drop the empty-guard bookkeeping so the next user starts clean.
      resetClubListEmptyGuard();
    }
  }, [user]);


  // Fetch all Pro clubs that the user belongs to with custom themes.
  // Resilience: throw on Supabase errors + `keepPreviousData` so a transient
  // reconnect refetch (partial embed, RLS hiccup, network blip) never
  // overwrites a good cached list with an empty one — that was previously
  // causing the club selector to disappear + theme to drop after coming back
  // online.
  const { data: availableClubThemes = [], isLoading, isSuccess: isClubThemesSuccess, isError: isClubThemesError } = useQuery({
    queryKey: ["club-themes", user?.id],
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    queryFn: async () => {
      if (!user?.id) return [];

      // Get user's clubs through their roles
      const { data: userRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user.id)
        .not("club_id", "is", null);

      if (rolesError) throw rolesError;
      const clubIds = [...new Set((userRoles || []).map(r => r.club_id).filter(Boolean))];

      // Also get clubs from teams
      const { data: teamRoles, error: teamRolesError } = await supabase
        .from("user_roles")
        .select("team_id, teams!inner(club_id)")
        .eq("user_id", user.id)
        .not("team_id", "is", null);
      if (teamRolesError) throw teamRolesError;

      if (teamRoles) {
        teamRoles.forEach(r => {
          const teamClubId = (r.teams as any)?.club_id;
          if (teamClubId && !clubIds.includes(teamClubId)) {
            clubIds.push(teamClubId);
          }
        });
      }

      if (!clubIds.length) return guardClubListResult(`club-themes:${user.id}`, []);

      // Fetch clubs with theme settings (left join on subscriptions)
      const { data: clubs, error: clubsError } = await supabase
        .from("clubs")
        .select(`
          id,
          name,
          logo_url,
          show_logo_in_header,
          show_name_in_header,
          logo_only_mode,
          sport,
          is_pro,
          theme_enabled,
          theme_primary_h,
          theme_primary_s,
          theme_primary_l,
          theme_secondary_h,
          theme_secondary_s,
          theme_secondary_l,
          theme_accent_h,
          theme_accent_s,
          theme_accent_l,
          theme_dark_primary_h,
          theme_dark_primary_s,
          theme_dark_primary_l,
          theme_dark_secondary_h,
          theme_dark_secondary_s,
          theme_dark_secondary_l,
          theme_dark_accent_h,
          theme_dark_accent_s,
          theme_dark_accent_l,
          club_subscriptions(is_pro, is_pro_football, expires_at)
        `)
        .in("id", clubIds)
        .is("deleted_at", null);

      if (clubsError) throw clubsError;
      if (!clubs) return [];

      // Filter to only Pro clubs with theme data that have theme enabled
      return guardClubListResult(`club-themes:${user.id}`, clubs
        .filter(club => {
          // Handle both array and single object subscription data
          const subs = club.club_subscriptions as any;
          const sub = Array.isArray(subs) && subs.length > 0 ? subs[0] : 
                     (subs && !Array.isArray(subs) ? subs : null);
          const hasProFromSub = sub && (sub.is_pro || sub.is_pro_football) && 
            (!sub.expires_at || new Date(sub.expires_at) > new Date());
          // Check club.is_pro flag directly (synced by trigger)
          const hasPro = club.is_pro === true || hasProFromSub === true;
          const hasTheme = club.theme_primary_h !== null;
          const themeEnabled = (club as any).theme_enabled !== false; // Default to true
          return hasPro && hasTheme && themeEnabled;
        })
        .map(club => ({
          clubId: club.id,
          clubName: club.name,
          logoUrl: club.logo_url,
          showLogoInHeader: club.show_logo_in_header ?? false,
          showNameInHeader: club.show_name_in_header ?? true,
          logoOnlyMode: club.logo_only_mode ?? false,
          sport: club.sport,
          primary: club.theme_primary_h !== null ? {
            h: club.theme_primary_h!,
            s: club.theme_primary_s!,
            l: club.theme_primary_l!,
          } : null,
          secondary: club.theme_secondary_h !== null ? {
            h: club.theme_secondary_h!,
            s: club.theme_secondary_s!,
            l: club.theme_secondary_l!,
          } : null,
          accent: club.theme_accent_h !== null ? {
            h: club.theme_accent_h!,
            s: club.theme_accent_s!,
            l: club.theme_accent_l!,
          } : null,
          darkPrimary: club.theme_dark_primary_h !== null ? {
            h: club.theme_dark_primary_h!,
            s: club.theme_dark_primary_s!,
            l: club.theme_dark_primary_l!,
          } : null,
          darkSecondary: club.theme_dark_secondary_h !== null ? {
            h: club.theme_dark_secondary_h!,
            s: club.theme_dark_secondary_s!,
            l: club.theme_dark_secondary_l!,
          } : null,
          darkAccent: club.theme_dark_accent_h !== null ? {
            h: club.theme_dark_accent_h!,
            s: club.theme_dark_accent_s!,
            l: club.theme_dark_accent_l!,
          } : null,
        })));

    },
    retry: 3,
    enabled: !!user?.id,
  });

  // ALL clubs the user belongs to (Pro + free) — used to validate active club
  // selections that aren't themed and to display free club names in the header.
  const { data: userClubs = [], isLoading: isUserClubsLoading, isSuccess: isUserClubsSuccess }= useQuery<{ id: string; name: string; logo_url: string | null }[]>({
    queryKey: ["user-clubs-for-switcher", user?.id],
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    queryFn: async () => {
      if (!user?.id) return [];
      const [rolesRes, teamRolesRes] = await Promise.all([
        supabase.from("user_roles").select("club_id").eq("user_id", user.id).not("club_id", "is", null),
        supabase.from("user_roles").select("teams!inner(club_id)").eq("user_id", user.id).not("team_id", "is", null),
      ]);
      // Propagate errors so react-query keeps prior data on a transient
      // reconnect failure — otherwise the club dropdown briefly empties out.
      if (rolesRes.error) throw rolesRes.error;
      if (teamRolesRes.error) throw teamRolesRes.error;
      const ids = new Set<string>();
      (rolesRes.data || []).forEach((r: any) => r.club_id && ids.add(r.club_id));
      (teamRolesRes.data || []).forEach((r: any) => {
        const cid = r.teams?.club_id;
        if (cid) ids.add(cid);
      });
      if (!ids.size) return guardClubListResult(`user-clubs:${user.id}`, []);
      const { data: clubs, error: clubsError } = await supabase
        .from("clubs")
        .select("id, name, logo_url")
        .in("id", Array.from(ids))
        .is("deleted_at", null);
      if (clubsError) throw clubsError;
      return guardClubListResult(
        `user-clubs:${user.id}`,
        (clubs || []).map(c => ({ id: c.id, name: c.name, logo_url: c.logo_url })),
      );
    },
    retry: 3,
    enabled: !!user?.id,

  });

  // Establish an explicit default for users who haven't set a preference yet.
  // Never auto-pick the first available club: multi-club users must not come
  // back from logout with a different club selected just because ordering or
  // DB/local cache hydration changed.
  useEffect(() => {
    if (!user?.id || hasCheckedDefault || isLoading || isLoadingFromDb) return;
    
    // Check if user has any stored preference (including explicit "none")
    const hasStoredPreference = localStorage.getItem(getStorageKey(user.id)) !== null;
    
    if (!hasStoredPreference) {
      safeSetItem(getStorageKey(user.id), NO_CLUB_THEME_SENTINEL);
      localStorage.removeItem(getStorageDataKey(user.id));
      setActiveClubThemeState(null);
      setCachedThemeData(null);
      clearAllThemeCSS();
    }
    
    setHasCheckedDefault(true);
  }, [user?.id, isLoading, isLoadingFromDb, hasCheckedDefault]);

  const setActiveClubTheme = (clubId: string | null) => {
    // Explicit selection (club picker, or an applied notification switch) is
    // always authoritative: drop any pin so it cannot block this write, then
    // set state directly rather than through the guarded setter.
    const pinned = getAppliedNotificationClubSwitch();
    if (pinned && pinned !== clubId) clearAppliedNotificationClubSwitch();
    const changed = clubId !== activeClubTheme;
    setActiveClubThemeStateRaw(clubId);
    // Drop every club-scoped cache entry so the previous club's teams, chats,
    // events, media and vault rows cannot paint under the new club's chrome.
    if (changed) purgeClubScopedQueryCache(queryClient);
    if (user?.id) {
      const key = getStorageKey(user.id);
      const dataKey = getStorageDataKey(user.id);
      if (clubId) {
        safeSetItem(key, clubId);
        // Also cache the theme data for instant loading
        const themeData = availableClubThemes.find(t => t.clubId === clubId);
        if (themeData) {
          safeSetItem(dataKey, JSON.stringify(toCacheableTheme(themeData)));
          setCachedThemeData(themeData);
        } else {
          // Free / non-themed club — keep selection as active filter but clear theme overrides
          localStorage.removeItem(dataKey);
          setCachedThemeData(null);
          clearAllThemeCSS();
        }
      } else {
        safeSetItem(key, NO_CLUB_THEME_SENTINEL);
        localStorage.removeItem(dataKey);
        setCachedThemeData(null);
        clearAllThemeCSS();
      }
      
      // Save preference to database for cross-device sync
      supabase
        .from('profiles')
        .update({ active_club_theme_id: clubId })
        .eq('id', user.id)
        .then(({ error }) => {
          if (error) console.error('Failed to save club theme preference:', error);
        });
    }
  };

  // Apply theme CSS variables - only when user is logged in
  // Re-apply when dark/light mode changes
  useEffect(() => {
    const root = document.documentElement;

    // CRITICAL: Don't do anything while loading from DB or switching users
    // This prevents race condition where CSS is cleared before DB load completes
    if (isLoadingFromDb || isUserSwitching) {
      console.log('[ClubTheme] Skipping CSS effect - still loading/switching');
      return;
    }

    // Don't apply theme if not logged in
    if (!user) {
      clearAllThemeCSS();
      return;
    }

    // CRITICAL: Don't clear CSS if localStorage has theme data that React state hasn't caught up with yet
    // This prevents race condition where CompleteProfilePage sets theme but state hasn't updated
    if (!activeClubTheme) {
      // Check localStorage before clearing - might have theme data that state hasn't synced yet
      const storedId = localStorage.getItem(getStorageKey(user.id));
      const storedData = localStorage.getItem(getStorageDataKey(user.id));
      
      if (storedId && storedData) {
        // localStorage has theme data - apply it instead of clearing
        try {
          const parsedData = JSON.parse(storedData) as CachedThemeData;
          if (parsedData.clubId === storedId && parsedData.primary) {
            // Apply the cached theme instead of clearing
            const themeFromCache: ClubTheme = { 
              ...parsedData, 
              logoUrl: parsedData.logoUrl ?? null, 
              sport: parsedData.sport ?? null 
            };
            applyThemeCSS(themeFromCache, isDarkMode);
            // Update state to sync with localStorage
            setActiveClubThemeState(storedId);
            setCachedThemeData(themeFromCache);
            return;
          }
        } catch {
          // Invalid cache, fall through to clear
        }
      }
      
      // No localStorage data - safe to clear theme overrides
      clearAllThemeCSS();
      return;
    }

    // Try to find theme from server data first
    const theme = availableClubThemes.find(t => t.clubId === activeClubTheme);

    // Fall back to cached theme ONLY while the server query has not yet
    // succeeded — this keeps the theme visible on cold-start before the query
    // resolves. Once the query has succeeded and the club is not in the themed
    // (Pro) list, we must NOT apply cached colours: doing so would let a free
    // club keep Pro branding after a downgrade / trial expiry.
    const canUseCache = !isClubThemesSuccess;
    const themeToApply = theme || (canUseCache ? cachedThemeData : null);

    if (!themeToApply) {
      // If server data is loaded and this club isn't themed, clear overrides.
      if (isClubThemesSuccess && !availableClubThemes.some(t => t.clubId === activeClubTheme)) {
        clearAllThemeCSS();
      }
      return;
    }


    // Skip applying colors if logo-only mode is enabled
    if (themeToApply.logoOnlyMode) {
      clearAllThemeCSS();
      return;
    }

    // DEBUG: Log what we're applying
    console.log('[ClubTheme] CSS effect applying theme:', {
      source: theme ? 'availableClubThemes' : 'cachedThemeData',
      clubId: themeToApply.clubId,
      isDarkMode,
      primary: themeToApply.primary,
      darkPrimary: themeToApply.darkPrimary,
      resolvedTheme,
    });

    applyThemeCSS(themeToApply, isDarkMode);
  }, [activeClubTheme, availableClubThemes, cachedThemeData, user, isDarkMode, isLoadingFromDb, isUserSwitching, resolvedTheme, isClubThemesSuccess]);

  // Validate theme data only. This must never change activeClubTheme: the club
  // filter is user-controlled and can only be changed through setActiveClubTheme.
  useEffect(() => {
    if (!activeClubTheme) return;
    // Wait until the themed-clubs query has finished — otherwise we'd evict
    // a still-valid themed cache before server data arrives.
    if (isLoading || isUserClubsLoading) return;
    // CRITICAL: Only evict when BOTH queries have actually succeeded with data.
    // If either query errored (e.g. transient network drop after token refresh),
    // `availableClubThemes` is the default empty array — evicting here would
    // permanently wipe the theme until app restart. Bail out and let the next
    // successful refetch (on reconnect) re-validate.
    if (!isClubThemesSuccess || !isUserClubsSuccess) return;
    if (isClubThemesError) return;
    const inThemed = availableClubThemes.some(t => t.clubId === activeClubTheme);

    if (!inThemed) {
      // Club is not in the themed (Pro + theme_enabled) list. Even if the user
      // still owns the club (free plan or theme disabled), we must evict any
      // stale cached theme so free clubs don't keep Pro colours after a
      // downgrade / trial expiry. The apply-effect above already refuses to
      // fall back to cache once the themed query succeeded, but we also drop
      // the persisted cache here to keep localStorage consistent.


      // Club is free/non-themed/inaccessible for theme rendering.
      // Evict any stale themed cache so the header drops the logo + colours
      // and renders the free-club branch (name only, default Ignite icon).
      if (cachedThemeData) {
        setCachedThemeData(null);
        clearAllThemeCSS();
        if (user?.id) {
          localStorage.removeItem(getStorageDataKey(user.id));
        }
      }
    }
  }, [activeClubTheme, availableClubThemes, userClubs, isLoading, isUserClubsLoading, isClubThemesSuccess, isUserClubsSuccess, isClubThemesError, cachedThemeData, user?.id]);

  // Cache theme data when server data becomes available
  useEffect(() => {
    if (user?.id && activeClubTheme && availableClubThemes.length > 0) {
      const serverTheme = availableClubThemes.find(t => t.clubId === activeClubTheme);
      if (serverTheme) {
        safeSetItem(getStorageDataKey(user.id), JSON.stringify(toCacheableTheme(serverTheme)));
        setCachedThemeData(serverTheme);
      }
    }
  }, [user?.id, activeClubTheme, availableClubThemes]);

  // Use server data if available. Fall back to cached data whenever the
  // themed-clubs query hasn't produced a match — this covers both the initial
  // load AND background refetches after reconnect where a transient partial
  // response can briefly drop the active club from `availableClubThemes`.
  // The eviction effect above is the only path that clears `cachedThemeData`
  // when the club is genuinely gone (missing from userClubs too).
  const serverThemeMatch = activeClubTheme
    ? availableClubThemes.find(t => t.clubId === activeClubTheme) ?? null
    : null;
  const matchingCachedTheme = cachedThemeData?.clubId === activeClubTheme
    ? cachedThemeData
    : null;
  const activeThemeData = activeClubTheme
    ? serverThemeMatch ?? matchingCachedTheme
    : null;

  // Free club data: when a club is selected but has no theme (Pro + theme required)
  const activeFreeClubData = activeClubTheme && !activeThemeData
    ? userClubs.find(c => c.id === activeClubTheme) ?? null
    : null;

  // Pre-warm the club logo decode cache the instant we know the URL.
  // The header consults the same module-level cache, so when AppHeader
  // mounts after login the logo paints synchronously instead of flashing
  // in after a network round-trip + decode.
  useEffect(() => {
    const url = activeThemeData?.logoUrl;
    if (url) {
      void import("@/components/ui/logo-image").then(({ preloadLogo }) => preloadLogo(url));
    }
    // Also warm any other available club logos so switching clubs is instant.
    availableClubThemes.forEach((t) => {
      if (t.logoUrl) {
        void import("@/components/ui/logo-image").then(({ preloadLogo }) => preloadLogo(t.logoUrl!));
      }
    });
  }, [activeThemeData?.logoUrl, availableClubThemes]);

  // Fetch teams belonging to the active club (for content filtering)
  const { data: activeClubTeamIds = [] } = useQuery({
    queryKey: ["active-club-teams", activeClubTheme],
    queryFn: async () => {
      if (!activeClubTheme) return [];
      const { data, error } = await supabase
        .from("teams")
        .select("id")
        .eq("club_id", activeClubTheme);
      if (error) return [];
      return data.map(t => t.id);
    },
    enabled: !!activeClubTheme,
    staleTime: 300000, // Cache for 5 minutes
  });

  // Theme is ready when:
  // - Auth is DONE loading AND there's no user (truly anonymous) - no theme to load
  // - OR user exists AND we have valid cached theme data in state (from localStorage)
  // - OR user exists AND we've started AND finished loading from DB
  // This prevents flash of default theme on first login
  // CRITICAL: We must wait for auth to finish loading before claiming "no user"
  // CRITICAL: During user switch/fresh login, we must wait until isUserSwitching is cleared
  // CRITICAL: hasLocalThemeData should only be trusted when NOT user switching
  const hasLocalThemeData = activeClubTheme !== null && cachedThemeData !== null;
  const dbLoadComplete = hasStartedDbLoad && !isLoadingFromDb;
  // Only trust cached data if we're not switching users - otherwise wait for DB
  const themeIsReady = !isUserSwitching && (
    (!authLoading && !user?.id) || // No user - no theme to load
    dbLoadComplete || // DB load is complete - theme is authoritative
    hasCacheAppliedOnLogin || // Fresh login with cached theme applied - render instantly
    (!isLoadingFromDb && hasLocalThemeData && !authLoading) // Have cache AND not loading
  );
  
  // Debug logging for theme readiness
  if (typeof window !== 'undefined' && user?.id) {
    console.log('[ClubTheme] Ready check:', {
      isUserSwitching,
      authLoading,
      hasLocalThemeData,
      dbLoadComplete,
      isLoadingFromDb,
      hasStartedDbLoad,
      themeIsReady,
      activeClubTheme,
      hasCachedData: !!cachedThemeData,
    });
  }

  return (
    <ClubThemeContext.Provider value={{
      availableClubThemes,
      activeClubTheme,
      activeThemeData,
      activeFreeClubData,
      setActiveClubTheme,
      isLoading,
      isThemeReady: themeIsReady,
      activeClubFilter: activeClubTheme,
      activeClubTeamIds,
    }}>
      {children}
    </ClubThemeContext.Provider>
  );
}

export function useClubTheme() {
  return useContext(ClubThemeContext);
}

/**
 * Synchronously check localStorage for cached club theme data.
 * Use this for initial render to prevent gradient flash before React hydrates.
 * Returns true if user has an active club theme cached.
 */
export function hasClubThemeCached(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    // Check for any cached theme data - means user has club theme active
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_DATA_KEY_PREFIX)) {
        const data = localStorage.getItem(key);
        if (data) return true;
      }
    }
  } catch {
    // localStorage not available
  }
  return false;
}
