import { useState, useEffect, lazy, Suspense } from "react";
import { LogoImage } from "@/components/ui/logo-image";
import { Bell, Flame, User, LogOut, Loader2, Moon, Sun, Check, Building2, Lock, UserCog, Settings, ChevronDown } from "lucide-react";
import { useTheme } from "next-themes";
import { useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SwipeableDropdownContent } from "@/components/ui/swipeable-dropdown-content";
import { useAuth } from "@/hooks/useAuth";
import { useIsAppAdmin } from "@/hooks/useIsAppAdmin";
import { useClubTheme } from "@/hooks/useClubTheme";
import { guardClubListResult } from "@/lib/clubListEmptyGuard";
import { useLogoAccentColor } from "@/hooks/useLogoAccentColor";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ClubThemeToggle } from "@/components/ClubThemeToggle";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
// Lazy-loaded: only app admins render this dialog, so its Radix Select
// dependency (~49KB) should not enter every visitor's initial chunk.
const DemoLoginSection = lazy(() =>
  import("@/components/DemoLoginSection").then((m) => ({ default: m.DemoLoginSection })),
);
import igniteIcon from "@/assets/ignite-icon.png";
import { NotificationIcon } from "@/components/NotificationIcon";
import { setPendingChatJump, withChatJumpNonce } from "@/lib/pendingChatJump";
import { filterClubScopedNotifications } from "@/lib/filterClubScopedNotifications";
import { resolveTeamInviteRoute } from "@/lib/resolveNotificationRoute";
import {
  ClubSwitcherHint,
  hasSeenClubSwitcherHint,
  markClubSwitcherHintSeen,
} from "@/components/layout/ClubSwitcherHint";
import { invalidateNotificationSurfaces } from "@/lab/notificationCachePolicy";
import { notificationKeys } from "@/lab/notificationQueryKeys";

// Preload Ignite icon so it's instantly available when switching from club theme
const preloadedIgniteIcon = new Image();
preloadedIgniteIcon.src = igniteIcon;

// Helper to pick the best color from palette based on background contrast
function getBestContrastColor(
  primary: { h: number; s: number; l: number } | null | undefined,
  secondary: { h: number; s: number; l: number } | null | undefined,
  accent: { h: number; s: number; l: number } | null | undefined,
  isDark: boolean
): string | undefined {
  const bgLightness = isDark ? 6 : 96;
  const minContrast = 40;
  
  const getContrast = (color: { h: number; s: number; l: number } | null | undefined) => 
    color ? Math.abs(color.l - bgLightness) : 0;
  
  const toHsl = (color: { h: number; s: number; l: number }) => 
    `hsl(${color.h}, ${color.s}%, ${color.l}%)`;
  
  // Check primary first
  if (primary && getContrast(primary) >= minContrast) {
    return toHsl(primary);
  }
  
  // Try secondary
  if (secondary && getContrast(secondary) >= minContrast) {
    return toHsl(secondary);
  }
  
  // Try accent
  if (accent && getContrast(accent) >= minContrast) {
    return toHsl(accent);
  }
  
  // Fallback to primary anyway if nothing else works
  if (primary) return toHsl(primary);
  
  return undefined;
}

function LogoClubThemeDropdown() {
  const navigate = useNavigate();
  const { availableClubThemes, activeClubTheme, setActiveClubTheme } = useClubTheme();
  const defaultLogo = igniteIcon;
  const { user, signOut } = useAuth();
  // Fetch ALL user clubs (including non-Pro) to show with lock.
  // Resilience: `keepPreviousData` + explicit throw on error means a transient
  // reconnect refetch (e.g. RLS/token hiccup right after coming back online)
  // cannot wipe the dropdown by caching an empty result.
  const { data: allUserClubs = [] } = useQuery({
    queryKey: ["all-user-clubs-for-theme-v2", user?.id],
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    queryFn: async () => {
      if (!user?.id) return [];

      // Get club IDs from user roles
      const { data: clubRoles, error: clubRolesError } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user.id)
        .not("club_id", "is", null);
      if (clubRolesError) throw clubRolesError;

      const clubIds = [...new Set((clubRoles || []).map(r => r.club_id).filter(Boolean))];

      // Also get clubs from team roles
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

      if (!clubIds.length) return guardClubListResult(`all-user-clubs:${user.id}`, []);

      // Fetch clubs with subscription info (exclude soft-deleted clubs)
      const { data: clubs, error: clubsError } = await supabase
        .from("clubs")
        .select(`
          id,
          name,
          logo_url,
          is_pro,
          kind,
          theme_primary_h,
          theme_primary_s,
          theme_primary_l,
          theme_enabled,
          club_subscriptions(is_pro, is_pro_football, expires_at)
        `)
        .in("id", clubIds)
        .is("deleted_at", null)
        .neq("kind", "shell");
      if (clubsError) throw clubsError;

      if (!clubs) return [];

      const getClubPriority = (club: {
        isSelectable: boolean;
        hasPro: boolean;
        hasTheme: boolean;
        themeEnabled: boolean;
      }) => (
        (club.isSelectable ? 8 : 0) +
        (club.hasPro ? 4 : 0) +
        (club.hasTheme ? 2 : 0) +
        (club.themeEnabled ? 1 : 0)
      );

      const result = clubs.map(club => {
        // Handle both array and single object subscription data
        const subs = club.club_subscriptions as any;
        const sub = Array.isArray(subs) && subs.length > 0 ? subs[0] :
                   (subs && !Array.isArray(subs) ? subs : null);
        const hasProFromSub = sub && (sub.is_pro || sub.is_pro_football) &&
          (!sub.expires_at || new Date(sub.expires_at) > new Date());
        const hasPro = club.is_pro === true || hasProFromSub === true;
        const hasTheme = club.theme_primary_h !== null;
        const themeEnabled = (club as any).theme_enabled !== false; // Default to true
        // Only selectable if Pro AND has theme AND theme is enabled
        const isSelectable = hasPro && hasTheme && themeEnabled;

        return {
          clubId: club.id,
          clubName: club.name.trim(),
          logoUrl: club.logo_url,
          hasPro,
          hasTheme,
          themeEnabled,
          isSelectable,
        };
      });

      const dedupedClubs = new Map<string, (typeof result)[number]>();
      result.forEach((club) => {
        const normalizedName = club.clubName.toLowerCase().replace(/\s+/g, " ").trim();
        const existing = dedupedClubs.get(normalizedName);
        if (!existing || getClubPriority(club) > getClubPriority(existing)) {
          dedupedClubs.set(normalizedName, club);
        }
      });

      return guardClubListResult(`all-user-clubs:${user.id}`, Array.from(dedupedClubs.values()));
    },
    retry: 3,
    enabled: !!user?.id,
  });

  // Show every user club that isn't already in availableClubThemes as a
  // non-selectable entry (locked / no-theme / theme-disabled). Previously this
  // was `!hasPro` only, which silently hid Pro clubs that hadn't configured a
  // theme yet — so the dropdown looked empty for admins of brand-new Pro clubs.
  const availableClubIds = new Set(availableClubThemes.map(t => t.clubId));
  const lockedClubs = allUserClubs.filter(
    c => !c.isSelectable && !availableClubIds.has(c.clubId)
  );

  // NOTE: The "Resume setup" shortcut was intentionally removed from the club-theme
  // switcher. This dropdown is strictly for switching club themes — surfacing a
  // setup-wizard entry point here confused users. Resume-setup lives on the Home
  // empty-state / ClubSetupProgressCard only.

  return (
    <DropdownMenuContent align="start" className="w-56">




      <div className="px-2 py-1.5">
        <p className="text-sm font-medium">Club Themes</p>
        <p className="text-xs text-muted-foreground">Apply your club's colors</p>
      </div>
      <DropdownMenuSeparator />
      
      {/* Default theme option */}
      <DropdownMenuItem 
        onClick={() => setActiveClubTheme(null)}
        className="flex items-center gap-3 py-2"
      >
        <img 
          src={defaultLogo} 
          alt="Ignite" 
          className="h-8 w-8 rounded-lg object-cover"
        />
        <div className="flex-1">
          <p className="text-sm font-medium">All Clubs</p>
          <p className="text-xs text-muted-foreground">Default theme — all clubs view</p>
        </div>
        {!activeClubTheme && <Check className="h-4 w-4 text-primary" />}
      </DropdownMenuItem>
      
      {availableClubThemes.length > 0 && <DropdownMenuSeparator />}
      
      {/* Pro club themes */}
      {availableClubThemes.map((theme) => (
        <DropdownMenuItem
          key={theme.clubId}
          onClick={() => setActiveClubTheme(theme.clubId)}
          className="flex items-center gap-3 py-2"
        >
          <Avatar className="h-8 w-8">
            <AvatarImage src={theme.logoUrl || undefined} />
            <AvatarFallback 
              className="text-xs"
              style={{
                backgroundColor: theme.primary 
                  ? `hsl(${theme.primary.h}, ${theme.primary.s}%, ${theme.primary.l}%)`
                  : undefined,
                color: theme.primary && theme.primary.l > 50 ? '#1a1a1a' : '#fafafa',
              }}
            >
              {theme.clubName.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{theme.clubName}</p>
            {theme.primary && (
              <div className="flex gap-1 mt-0.5">
                <div 
                  className="h-3 w-3 rounded-full border border-border"
                  style={{ backgroundColor: `hsl(${theme.primary.h}, ${theme.primary.s}%, ${theme.primary.l}%)` }}
                />
                {theme.secondary && (
                  <div 
                    className="h-3 w-3 rounded-full border border-border"
                    style={{ backgroundColor: `hsl(${theme.secondary.h}, ${theme.secondary.s}%, ${theme.secondary.l}%)` }}
                  />
                )}
                {theme.accent && (
                  <div 
                    className="h-3 w-3 rounded-full border border-border"
                    style={{ backgroundColor: `hsl(${theme.accent.h}, ${theme.accent.s}%, ${theme.accent.l}%)` }}
                  />
                )}
              </div>
            )}
          </div>
          {activeClubTheme === theme.clubId && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>
      ))}

      {/* Locked clubs (non-Pro) */}
      {lockedClubs.length > 0 && (availableClubThemes.length > 0 || true) && <DropdownMenuSeparator />}
      {lockedClubs.map((club) => (
        <DropdownMenuItem
          key={club.clubId}
          onClick={() => setActiveClubTheme(club.clubId)}
          className="flex items-center gap-3 py-2"
        >
          <Avatar className="h-8 w-8">
            <AvatarImage src={club.logoUrl || undefined} />
            <AvatarFallback className="text-xs bg-muted text-muted-foreground">
              {club.clubName.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{club.clubName}</p>
            <div className="flex items-center gap-1 mt-0.5 text-muted-foreground">
              <Lock className="h-3 w-3" />
              <span className="text-xs">
                {!club.hasPro ? "Free — no club theme" : !club.hasTheme ? "No theme set" : "Theme disabled"}
              </span>
            </div>
          </div>
          {activeClubTheme === club.clubId && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  );
}

export function AppHeader() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile, unreadCount: globalUnreadCount, user, clearUnreadCount, refreshUnreadCount, signOut } = useAuth();
  const { activeThemeData, activeClubTheme, activeClubFilter, activeFreeClubData } = useClubTheme();
  const { setTheme, theme, resolvedTheme } = useTheme();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [demoLoginOpen, setDemoLoginOpen] = useState(false);
  const [isSavingTheme, setIsSavingTheme] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);

  // Multi-club detection for the one-shot club-switcher coach-mark. Cheap
  // (id-only reads, 60s staleTime) and skipped entirely once the hint has
  // already been seen for this user.
  //
  // The count MUST union every membership shape, not just `user_roles.club_id`:
  // parents/players carried in on a roster hold only team-scoped role rows
  // (club_id NULL), `team_memberships`, or `club_players` rows. Counting only
  // club-scoped roles reported "1 club" for a genuinely multi-club user, so the
  // hint never appeared after they joined a second club.
  const hintAlreadySeen = user?.id ? hasSeenClubSwitcherHint(user.id) : true;
  const { data: userClubCount = 0 } = useQuery({
    queryKey: ["user-club-count-for-switcher-hint", user?.id],
    enabled: !!user?.id && !hintAlreadySeen,
    staleTime: 60 * 1000,
    queryFn: async () => {
      if (!user?.id) return 0;
      const db = supabase as any;
      const [clubRoles, teamRoles, teamMemberships, clubPlayers] = await Promise.all([
        supabase.from("user_roles").select("club_id").eq("user_id", user.id).not("club_id", "is", null),
        supabase
          .from("user_roles")
          .select("team_id, teams!inner(club_id)")
          .eq("user_id", user.id)
          .not("team_id", "is", null),
        db
          .from("team_memberships")
          .select("teams!inner(club_id)")
          .eq("user_id", user.id)
          .eq("status", "active"),
        db.from("club_players").select("club_id").eq("user_id", user.id),
      ]);
      const ids = new Set<string>();
      (clubRoles.data || []).forEach((r: any) => r.club_id && ids.add(r.club_id));
      (clubPlayers.data || []).forEach((r: any) => r.club_id && ids.add(r.club_id));
      [...(teamRoles.data || []), ...(teamMemberships.data || [])].forEach((r: any) => {
        const clubId = r.teams?.club_id;
        if (clubId) ids.add(clubId);
      });
      return ids.size;
    },
  });

  // Only *persist* the "seen" flag when the coach-mark was actually on screen.
  // Otherwise a routine tap on the club logo (long before the user ever became
  // multi-club) would permanently burn the one-shot hint.
  const dismissClubSwitcherHint = () => {
    if (!hintVisible || hintDismissed) return;
    setHintDismissed(true);
    if (user?.id) markClubSwitcherHintSeen(user.id);
  };


  
  
  // Handle theme toggle with save to profile
  const handleThemeToggle = async () => {
    const currentTheme = getEffectiveTheme();
    const newTheme = currentTheme === "dark" ? "light" : "dark";
    
    console.log('[AppHeader] Theme toggle clicked, changing from', currentTheme, 'to', newTheme);
    
    // Apply to DOM immediately
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(newTheme);
    root.style.colorScheme = newTheme;
    localStorage.setItem('app-theme', newTheme);
    setTheme(newTheme); // Also update next-themes
    
    // Save to profile if logged in
    if (!user) {
      console.warn('[AppHeader] Cannot save theme - no user logged in');
      return;
    }
    
    if (isSavingTheme) {
      console.log('[AppHeader] Theme save already in progress');
      return;
    }
    
    console.log('[AppHeader] Saving theme to profile:', newTheme, 'for user:', user.id);
    setIsSavingTheme(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ theme_preference: newTheme })
        .eq('id', user.id);
      
      if (error) {
        console.error('[AppHeader] Failed to save theme preference:', error);
      } else {
        console.log('[AppHeader] Theme preference saved successfully:', newTheme);
      }
    } catch (err) {
      console.error('[AppHeader] Exception saving theme preference:', err);
    } finally {
      setIsSavingTheme(false);
    }
  };
  
  // CRITICAL: Read theme from DOM class FIRST, then localStorage, then next-themes
  // During Google OAuth return, useAuth updates DOM class synchronously when profile is fetched,
  // but localStorage and next-themes may still have stale values from the previous user.
  // The DOM class is the authoritative source after auth updates it.
  const getEffectiveTheme = (): 'light' | 'dark' => {
    if (typeof window !== 'undefined') {
      // First check DOM class - this is updated synchronously by useAuth on fresh login
      const isDarkClass = document.documentElement.classList.contains('dark');
      if (isDarkClass) return 'dark';
      if (document.documentElement.classList.contains('light')) return 'light';
      
      // Fallback to localStorage
      const stored = localStorage.getItem('app-theme');
      if (stored === 'dark' || stored === 'light') {
        return stored;
      }
      
      // Fallback to next-themes resolved value
      if (resolvedTheme === 'dark' || resolvedTheme === 'light') {
        return resolvedTheme;
      }
      
      // Check system preference as last resort
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    }
    return 'light';
  };
  
  // CRITICAL: Always use DOM-based theme detection instead of next-themes
  // next-themes can return stale values from localStorage that haven't been updated yet
  // The DOM class is the authoritative source - it's updated synchronously by useAuth on fresh login
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>(getEffectiveTheme);
  
  // Keep effectiveTheme in sync with DOM changes (from auth or manual toggles)
  useEffect(() => {
    const updateTheme = () => {
      const newTheme = getEffectiveTheme();
      setEffectiveTheme(newTheme);
    };
    
    // Watch for class changes on documentElement
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          updateTheme();
        }
      });
    });
    
    observer.observe(document.documentElement, { attributes: true });
    
    // Also sync immediately in case DOM changed before observer was set up
    updateTheme();
    
    return () => observer.disconnect();
  }, [resolvedTheme]);

  // Check if user is app admin (shared authoritative hook)
  const { isAppAdmin } = useIsAppAdmin();

  // Check if user has any vault-eligible club role (club_admin, league_admin, committee_member)
  const { data: hasVaultRole } = useQuery({
    queryKey: ["has-vault-role", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .in("role", ["club_admin", "league_admin", "committee_member"])
        .limit(1)
        .maybeSingle();
      return !!data;
    },
    enabled: !!user?.id,
  });

  // Show club logo if theme is active and showLogoInHeader is enabled
  const showClubLogo = activeThemeData?.showLogoInHeader && activeThemeData?.logoUrl;
  
  // CRITICAL: Only show club theme elements when theme is fully ready
  // During Google OAuth return, there's a brief moment where activeThemeData may have
  // stale values while the auth session is being established. Wait for isThemeReady
  // to prevent incorrect contrast colors during this transition.
  const { isThemeReady } = useClubTheme();
  // NOTE: Do NOT gate this on `isThemeReady`. On resume from inactivity
  // (phone unlock, tab refocus) auth/token refresh briefly flips readiness
  // to false; if we hid the club branch here, the button `key` below would
  // flip `club-<id>` → `ignite` → `club-<id>`, remounting <LogoImage> and
  // forcing a fresh <img> decode → visible blank logo for a beat.
  // `activeThemeData` is cached via keepPreviousData, so trust its presence
  // as the identity signal and let contrast colors re-settle in place.
  const shouldShowClubTheming = !!activeThemeData;

  // Parse club name to split into main name and suffix (e.g., "Bridgewater Soccer Club" -> ["Bridgewater", "Soccer Club"])
  const parseClubName = (name: string): { mainName: string; suffix: string } => {
    const suffixes = [
      'Soccer Club', 'Football Club', 'Cricket Club', 'Basketball Club', 'Basketball League', 'Tennis Club',
      'Rugby Club', 'Hockey Club', 'Netball Club', 'Volleyball Club', 'Baseball Club',
      'Swimming Club', 'Athletics Club', 'Golf Club', 'Rowing Club', 'Lacrosse Club',
      'SC', 'FC', 'CC', 'BC', 'TC', 'RC', 'HC', 'NC', 'AFC', 'United', 'City', 'Town'
    ];
    
    for (const suffix of suffixes) {
      if (name.toLowerCase().endsWith(suffix.toLowerCase())) {
        const mainName = name.slice(0, -suffix.length).trim();
        if (mainName) {
          return { mainName, suffix };
        }
      }
    }
    
    // No suffix found - render full name without a subtitle line
    return { mainName: name, suffix: '' };
  };

  const clubNameParts = activeThemeData ? parseClubName(activeThemeData.clubName) : null;

  const markAllAsRead = useMutation({
    mutationFn: async () => {
      if (!user?.id) return;

      // Only ever flips is_read — notifications are never deleted here so the
      // user keeps their full history and can still open them later.
      let listQ = supabase
        .from("notifications")
        .select("id, type, related_id, club_id")
        .eq("user_id", user.id)
        .eq("is_read", false)
        .limit(500);
      if (activeClubFilter) {
        listQ = listQ.or(`club_id.eq.${activeClubFilter},club_id.is.null`);
      }
      const { data: candidates, error: listErr } = await listQ;
      if (listErr) throw listErr;

      let toMark = candidates || [];
      if (activeClubFilter && toMark.length) {
        toMark = await filterClubScopedNotifications(toMark as any[], user.id, activeClubFilter);
      }

      const ids = toMark.map((n: any) => n.id);
      if (!ids.length) return;

      const { error: updErr } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .in("id", ids)
        .eq("user_id", user.id);
      if (updErr) throw updErr;
    },
    onMutate: () => {
      // Optimistically clear the badge and flip rows to read (keeping them visible)
      clearUnreadCount();
      queryClient.setQueriesData<any[]>(
        { queryKey: notificationKeys.recentFor(user?.id, activeClubFilter) },
        (old) => (old || []).map((n) => ({ ...n, is_read: true })),
      );
      queryClient.setQueriesData<number>(
        { queryKey: notificationKeys.clubUnreadFor(user?.id, activeClubFilter) },
        () => 0,
      );
    },
    onSuccess: () => {
      invalidateNotificationSurfaces(queryClient);
      setTimeout(() => refreshUnreadCount(), 300);
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.recent });
      queryClient.invalidateQueries({ queryKey: notificationKeys.clubUnread });
      refreshUnreadCount();
    },
  });


  const { data: recentNotifications = [], refetch: refetchRecentNotifications } = useQuery({
    queryKey: notificationKeys.recentFor(user?.id, activeClubFilter),
    queryFn: async () => {
      if (!user?.id) return [];
      let q = supabase
        .from("notifications")
        .select("id, message, type, created_at, is_read, related_id, club_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(40);
      // Include notifications scoped to the active club AND global ones (club_id IS NULL),
      // since some types like join_request / team_invite / role_request are intentionally
      // stored without a club_id and would otherwise be hidden by an active club filter.
      if (activeClubFilter) q = q.or(`club_id.eq.${activeClubFilter},club_id.is.null`);
      const { data, error } = await q;
      if (error) throw error;
      let rows = data || [];

      // DM notifications are stored with club_id = NULL (DMs aren't club-scoped),
      // so when a club filter is active we must hide DMs from senders who don't
      // share that club with the recipient. Otherwise filtering by Club A still
      // surfaces DMs from people only associated with Club B.
      if (activeClubFilter && rows.length) {
        rows = await filterClubScopedNotifications(rows, user.id, activeClubFilter);
      }


      return rows;
    },
    enabled: !!user?.id,
    // Realtime subscription in useAuth invalidates this key on new/updated
    // notifications, so a small staleTime is safe and prevents duplicate
    // fetches during rapid remounts (nav, resume, sheet toggles).
    staleTime: 30_000,
  });

  /**
   * Dropdown shows ONLY unread notifications (newest first). Full history
   * (read + unread) stays available via "View all notifications".
   */
  const DROPDOWN_MAX_UNREAD = 8;
  const dropdownUnread = recentNotifications
    .filter((n) => !n.is_read)
    .slice(0, DROPDOWN_MAX_UNREAD);



  // Per-club unread count (only when a club filter is active)
  const { data: clubUnreadCount = 0 } = useQuery({
    queryKey: notificationKeys.clubUnreadFor(user?.id, activeClubFilter),
    queryFn: async () => {
      if (!user?.id || !activeClubFilter) return 0;
      // Pull unread rows (capped) so we can drop DMs from senders who don't
      // share the active club — matches the popover's filtering logic.
      const { data } = await supabase
        .from("notifications")
        .select("id, type, related_id, club_id")
        .eq("user_id", user.id)
        .or(`club_id.eq.${activeClubFilter},club_id.is.null`)
        .eq("is_read", false)
        .limit(200);
      const filtered = await filterClubScopedNotifications(data || [], user.id, activeClubFilter);
      return filtered.length;
    },
    enabled: !!user?.id && !!activeClubFilter,
    // Realtime already invalidates this key when notifications change; polling
    // is only a safety net for missed events, so 60s is plenty.
    staleTime: 30_000,
    refetchInterval: 60_000,
  });


  // Effective unread count: club-scoped when a filter is on, otherwise global
  const unreadCount = activeClubFilter ? clubUnreadCount : globalUnreadCount;

  const markAsRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      invalidateNotificationSurfaces(queryClient);
    },
  });

  const openDirectMessageNotification = async (relatedId: string, createdAt?: string | null) => {
    // Current rows store related_id as the exact direct_messages.id.
    const { data: directMsg } = await supabase
      .from("direct_messages")
      .select("id, conversation_id")
      .eq("id", relatedId)
      .maybeSingle();
    if (directMsg?.conversation_id) {
      setPendingChatJump("dm", directMsg.conversation_id, directMsg.id);
      navigate(withChatJumpNonce(`/messages/dm/${directMsg.conversation_id}?message=${directMsg.id}`));
      return true;
    }

    // Backward compatibility: older DM notifications stored related_id as the
    // conversation id. Resolve the message nearest the notification timestamp
    // from the other participant, not the latest message in the thread.
    const { data: conversation } = await supabase
      .from("direct_conversations")
      .select("id")
      .eq("id", relatedId)
      .maybeSingle();
    if (!conversation) return false;

    const clickedAt = createdAt ? new Date(createdAt) : null;
    const upperBound = clickedAt && !Number.isNaN(clickedAt.getTime())
      ? new Date(clickedAt.getTime() + 30_000).toISOString()
      : null;

    let messageQuery = supabase
      .from("direct_messages")
      .select("id, conversation_id")
      .eq("conversation_id", relatedId)
      .is("deleted_at", null);
    if (user?.id) messageQuery = messageQuery.neq("author_id", user.id);
    if (upperBound) messageQuery = messageQuery.lte("created_at", upperBound);
    const { data: nearestMsg } = await messageQuery
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (nearestMsg?.id) {
      setPendingChatJump("dm", relatedId, nearestMsg.id);
      navigate(withChatJumpNonce(`/messages/dm/${relatedId}?message=${nearestMsg.id}`));
    } else {
      navigate(`/messages/dm/${relatedId}`);
    }
    return true;
  };

  const navigateWithFreshJump = (to: string) => navigate(withChatJumpNonce(to));

  const handleNotificationClick = async (notification: typeof recentNotifications[0]) => {
    try {
      console.log("[AppHeaderNotifTap] click", {
        notifId: notification.id,
        type: notification.type,
        related_id: notification.related_id,
        created_at: notification.created_at,
        is_read: notification.is_read,
      });
      // Mark as read in the background — do NOT block navigation on the network RTT.
      // The unread badge update can settle after the user has already landed on the thread.
      if (!notification.is_read) {
        void markAsRead.mutateAsync(notification.id).catch(() => {
          // Silent — the read state will reconcile on next inbox refetch.
        });
      }


      const relatedId = notification.related_id;
      if (!relatedId) {
        navigate("/notifications");
        return;
      }

      switch (notification.type) {
        case "message_reaction": {
          // Resolve the container in parallel — the reacted message lives in exactly
          // one of these tables, so fire all probes at once and use whichever wins.
          const [tMsgRes, cMsgRes, gMsgRes, dMsgRes, bMsgRes] = await Promise.all([
            supabase.from("team_messages").select("team_id").eq("id", relatedId).maybeSingle(),
            supabase.from("club_messages").select("club_id").eq("id", relatedId).maybeSingle(),
            supabase.from("group_messages").select("group_id").eq("id", relatedId).maybeSingle(),
            supabase.from("direct_messages").select("conversation_id").eq("id", relatedId).maybeSingle(),
            supabase.from("broadcast_messages").select("id").eq("id", relatedId).maybeSingle(),
          ]);
          const tMsg = tMsgRes.data;
          const cMsg = cMsgRes.data;
          const gMsg = gMsgRes.data;
          const dMsg = dMsgRes.data;
          const bMsg = bMsgRes.data;
          if (tMsg?.team_id) { navigateWithFreshJump(`/messages/${tMsg.team_id}?message=${relatedId}`); return; }
          if (cMsg?.club_id) { navigateWithFreshJump(`/messages/club/${cMsg.club_id}?message=${relatedId}`); return; }
          if (gMsg?.group_id) { navigateWithFreshJump(`/groups/${gMsg.group_id}?message=${relatedId}`); return; }
          if (dMsg?.conversation_id) { setPendingChatJump("dm", dMsg.conversation_id, relatedId); navigateWithFreshJump(`/messages/dm/${dMsg.conversation_id}?message=${relatedId}`); return; }
          if (bMsg) { navigateWithFreshJump(`/messages/broadcast?message=${relatedId}`); return; }
          // Backward-compat: very old rows stored container_id as related_id. Parallelize these too.
          const [teamCheckRes, clubCheckRes, groupCheckRes, convCheckRes] = await Promise.all([
            supabase.from("teams").select("id").eq("id", relatedId).maybeSingle(),
            supabase.from("clubs").select("id").eq("id", relatedId).maybeSingle(),
            supabase.from("chat_groups").select("id").eq("id", relatedId).maybeSingle(),
            supabase.from("direct_conversations").select("id").eq("id", relatedId).maybeSingle(),
          ]);
          if (teamCheckRes.data) { navigate(`/messages/${relatedId}`); return; }
          if (clubCheckRes.data) { navigate(`/messages/club/${relatedId}`); return; }
          if (groupCheckRes.data) { navigate(`/groups/${relatedId}`); return; }
          if (convCheckRes.data) { navigate(`/messages/dm/${relatedId}`); return; }
          navigate("/messages");
          return;
        }
        case "team_message":
        case "club_message":
        case "group_message":
        case "message_reply":
        case "message_mention":
        case "message_forwarded": {
          // Same container as message_reaction — resolve in parallel instead of
          // 4 sequential RTTs (DMs used to pay the full miss chain).
          const [teamMsgRes, clubMsgRes, groupMsgRes, dmMsgRes, broadcastMsgRes] = await Promise.all([
            supabase.from("team_messages").select("team_id").eq("id", relatedId).maybeSingle(),
            supabase.from("club_messages").select("club_id").eq("id", relatedId).maybeSingle(),
            supabase.from("group_messages").select("group_id").eq("id", relatedId).maybeSingle(),
            supabase.from("direct_messages").select("conversation_id").eq("id", relatedId).maybeSingle(),
            supabase.from("broadcast_messages").select("id").eq("id", relatedId).maybeSingle(),
          ]);
          const teamMessage = teamMsgRes.data;
          const clubMsg = clubMsgRes.data;
          const groupMsg = groupMsgRes.data;
          const dmMsg = dmMsgRes.data;
          const broadcastMsg = broadcastMsgRes.data;
          if (teamMessage?.team_id) {
            setPendingChatJump("team", teamMessage.team_id, relatedId);
            navigateWithFreshJump(`/messages/${teamMessage.team_id}?message=${relatedId}`);
            return;
          }
          if (clubMsg?.club_id) {
            setPendingChatJump("club", clubMsg.club_id, relatedId);
            navigateWithFreshJump(`/messages/club/${clubMsg.club_id}?message=${relatedId}`);
            return;
          }
          if (groupMsg?.group_id) {
            setPendingChatJump("group", groupMsg.group_id, relatedId);
            navigateWithFreshJump(`/groups/${groupMsg.group_id}?message=${relatedId}`);
            return;
          }
          if (dmMsg?.conversation_id) {
            setPendingChatJump("dm", dmMsg.conversation_id, relatedId);
            navigateWithFreshJump(`/messages/dm/${dmMsg.conversation_id}?message=${relatedId}`);
            return;
          }
          if (broadcastMsg) {
            setPendingChatJump("broadcast", null, relatedId);
            navigateWithFreshJump(`/messages/broadcast?message=${relatedId}`);
            return;
          }
          break;
        }


        case "club_admin_message": {
          // related_id is the club_admin_messages.id — resolve the conversation
          // and deep-link to the club-admin thread anchored on this message.
          const { data: caMsg } = await supabase
            .from("club_admin_messages")
            .select("conversation_id")
            .eq("id", relatedId)
            .maybeSingle();
          if (caMsg?.conversation_id) {
            setPendingChatJump("club_admin", caMsg.conversation_id, relatedId);
            navigateWithFreshJump(`/messages/club-admin/${caMsg.conversation_id}?message=${relatedId}`);
            return;
          }
          // Backward-compat: older rows stored conversation_id as related_id.
          const { data: caConv } = await supabase
            .from("club_admin_conversations")
            .select("id")
            .eq("id", relatedId)
            .maybeSingle();
          if (caConv) {
            navigate(`/messages/club-admin/${relatedId}`);
            return;
          }
          navigate("/messages");
          return;
        }
        case "broadcast":
          setPendingChatJump("broadcast", null, relatedId);
          navigateWithFreshJump(`/messages/broadcast?message=${relatedId}`);
          return;

        case "direct_message": {
          const opened = await openDirectMessageNotification(relatedId, notification.created_at);
          if (!opened) navigate("/messages");
          return;
        }
        case "event_invite":
        case "event_cancelled":
        case "event_updated":
        case "event_reminder":
        case "duty_assigned":
        case "duty_completed":

          navigate(`/events/${relatedId}`);
          return;
        case "photo_comment":
        case "photo_reaction": {
          const { data: photoCheck } = await supabase
            .from("photos")
            .select("id, deleted_at")
            .eq("id", relatedId)
            .maybeSingle();
          if (!photoCheck || photoCheck.deleted_at) {
            toast.info("This photo is no longer available.");
            return;
          }
          // Reactions/comments target a specific photo — open the lightbox.
          const suffix = notification.type === "photo_comment" ? "&comments=1" : "";
          navigate(`/media?photo=${relatedId}${suffix}`);
          return;
        }
        case "photo_uploaded": {
          // New uploads should land on the GALLERY (filtered to the team/club),
          // never fullscreen on a single photo.
          const { data: photoCheck } = await supabase
            .from("photos")
            .select("id, team_id, club_id, deleted_at")
            .eq("id", relatedId)
            .maybeSingle();
          if (!photoCheck || photoCheck.deleted_at) {
            navigate("/media");
            return;
          }
          if (photoCheck.team_id) {
            navigate(`/media?team=${photoCheck.team_id}`);
          } else if (photoCheck.club_id) {
            navigate(`/media?club=${photoCheck.club_id}`);
          } else {
            navigate("/media");
          }
          return;
        }
        case "photo_prompt_reminder": {
          // related_id is the event_id — open Media gallery filtered to team/event with upload sheet.
          const { data: ev } = await supabase
            .from("events")
            .select("id, team_id")
            .eq("id", relatedId)
            .maybeSingle();
          if (ev?.team_id) {
            navigate(`/media?team=${ev.team_id}&event=${ev.id}&upload=1`);
          } else {
            navigate(`/media?upload=1`);
          }
          return;
        }
        case "comment_reaction":
        case "comment_reply": {
          let targetPhotoId: string | null = null;
          if (notification.type === "comment_reply") {
            targetPhotoId = relatedId;
          } else {
            const { data: commentData } = await supabase
              .from("photo_comments")
              .select("photo_id")
              .eq("id", relatedId)
              .maybeSingle();
            targetPhotoId = commentData?.photo_id ?? null;
          }
          if (!targetPhotoId) {
            toast.info("This photo is no longer available.");
            return;
          }
          const { data: photoCheck2 } = await supabase
            .from("photos")
            .select("id, deleted_at")
            .eq("id", targetPhotoId)
            .maybeSingle();
          if (!photoCheck2 || photoCheck2.deleted_at) {
            toast.info("This photo is no longer available.");
            return;
          }
          // comment replies / reactions also belong on the comment screen
          navigate(`/media?photo=${targetPhotoId}&comments=1`);
          return;
        }
        case "join_request":
          navigate("/notifications");
          return;
        case "join_request_approved":
        case "join_request_denied":
        case "join_request_processed":
          if (relatedId) {
            const { data: clubCheckHeader } = await supabase
              .from("clubs")
              .select("id")
              .eq("id", relatedId)
              .maybeSingle();
            if (clubCheckHeader) {
              navigate(`/clubs/${relatedId}`);
            } else {
              navigate(`/teams/${relatedId}`);
            }
          } else {
            navigate("/notifications");
          }
          return;
        case "club_news":
          navigate(relatedId ? `/news/${relatedId}` : "/news");
          return;
        case "club_join":
          if (relatedId) {
            navigate(`/clubs/${relatedId}`);
          } else {
            navigate("/notifications");
          }
          return;
        case "team_invite": {
          // related_id may point at team_invites OR pending_invites (parent invites)
          const resolvedInvite = await resolveTeamInviteRoute(relatedId);
          if (resolvedInvite.kind === "navigate") {
            navigate(resolvedInvite.to);
          } else {
            toast.info("This invite is no longer available");
          }
          return;
        }
        case "role_assigned":
        case "invite_accepted":
        case "team_join":
          // Navigate to team page if related_id is available
          if (relatedId) {
            navigate(`/teams/${relatedId}`);
          } else {
            navigate("/notifications");
          }
          return;
        case "member_joined":
          if (relatedId) {
            const { data: miniLeagueCheckMJ } = await supabase
              .from("mini_leagues")
              .select("id")
              .eq("id", relatedId)
              .maybeSingle();
            if (miniLeagueCheckMJ) {
              navigate(`/mini-leagues/${relatedId}`);
            } else {
              const { data: clubCheckMJ } = await supabase
                .from("clubs")
                .select("id")
                .eq("id", relatedId)
                .maybeSingle();
              if (clubCheckMJ) {
                navigate(`/clubs/${relatedId}`);
              } else {
                navigate(`/teams/${relatedId}`);
              }
            }
          } else {
            navigate("/notifications");
          }
          return;
        case "rsvp":
        case "rsvp_update":
        case "rsvp_updated":
          navigate(`/events/${relatedId}`);
          return;
        case "pending_sub":
          localStorage.setItem('pitch-board-open-source', 'pending_sub');
          navigate("/");
          window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent('open-pitch-board', { detail: { notificationType: 'pending_sub' } }));
          }, 300);
          return;
        case "formation_change":
          if (relatedId) {
            navigate(`/teams/${relatedId}`);
          }
          return;
        case "fee_payment_request":
          if (relatedId) {
            navigate(`/pay-fees/${relatedId}`);
          }
          return;
        case "early_rsvp_points":
        case "attendance_points":
        case "duty_points":
        case "points_awarded":
        case "reward_redeemed":
        case "player_of_match":
          navigate("/profile?section=points-history");
          return;
        case "leaderboard_update":
        case "streak_progress":
        case "streak_bonus":
        case "reward_proximity":
        case "reward_unlocked":
          navigate("/leaderboard");
          return;
      }

      navigate("/notifications");
    } catch (error) {
      console.error("Error handling notification click:", error);
      navigate("/notifications");
    }
  };

  // Render notification icon using centralized component. Passing the
  // message lets reaction notifications render the actual reaction emoji
  // (👍, 🎉, 😂, …) rather than a generic heart.
  const renderNotificationIcon = (type: string, message?: string | null) => (
    <NotificationIcon type={type} mode="emoji" message={message} />
  );

  const freeClubNameParts = activeFreeClubData ? parseClubName(activeFreeClubData.name) : null;
  const freeClubAccent = useLogoAccentColor(activeFreeClubData?.logo_url, effectiveTheme === 'dark');

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background pt-safe">
      <div className="flex items-center justify-between h-14 px-4 lg:px-8 max-w-lg lg:max-w-none mx-auto">
        <div className="relative">
        <DropdownMenu onOpenChange={(open) => { if (open) dismissClubSwitcherHint(); }}>
          <DropdownMenuTrigger asChild>
            <button onPointerDown={dismissClubSwitcherHint} className="flex items-center gap-2.5 px-1.5 py-1 -ml-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg" key={shouldShowClubTheming ? `club-${activeThemeData?.clubId}` : activeFreeClubData ? `free-${activeFreeClubData.id}` : 'ignite'}>
              {shouldShowClubTheming ? (
                <>
                  {showClubLogo ? (
                    <div className="relative">
                      <LogoImage
                        src={activeThemeData.logoUrl!}
                        alt={activeThemeData.clubName}
                        className="h-8 w-8 shrink-0"
                        imgClassName="object-contain"
                        fallback={
                          <div className="p-1.5 rounded-lg bg-primary">
                            <Flame className="h-5 w-5 text-primary-foreground" />
                          </div>
                        }
                      />
                      <div className="absolute -bottom-1 -right-1 p-0.5 rounded-full shadow-sm" style={{ backgroundColor: 'hsl(160, 84%, 39%)' }}>
                        <Flame className="h-2.5 w-2.5" style={{ color: 'white' }} />
                      </div>
                    </div>
                  ) : (
                    <div className="p-1.5 rounded-lg bg-primary">
                      <Flame className="h-5 w-5 text-primary-foreground" />
                    </div>
                  )}
                  {activeThemeData.showNameInHeader && !activeThemeData.logoOnlyMode && clubNameParts?.mainName && (
                    <div className="flex flex-col leading-tight items-start">
                      <div className="flex items-center gap-1.5">
                      <span 
                          className="font-bold text-lg truncate max-w-[140px]"
                          style={{ 
                            color: getBestContrastColor(
                              effectiveTheme === 'dark' ? (activeThemeData?.darkPrimary || activeThemeData?.primary) : activeThemeData?.primary,
                              effectiveTheme === 'dark' ? (activeThemeData?.darkSecondary || activeThemeData?.secondary) : activeThemeData?.secondary,
                              effectiveTheme === 'dark' ? (activeThemeData?.darkAccent || activeThemeData?.accent) : activeThemeData?.accent,
                              effectiveTheme === 'dark'
                            )
                          }}
                        >
                          {clubNameParts.mainName}
                        </span>
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" strokeWidth={2.5} aria-hidden="true" />
                      </div>
                      {clubNameParts.suffix && (
                        <span className="text-[10px] text-muted-foreground -mt-1 text-left">{clubNameParts.suffix}</span>
                      )}
                    </div>
                  )}
                </>
              ) : activeFreeClubData && freeClubNameParts?.mainName ? (
                <>
                  <div
                    className="p-1.5 rounded-lg"
                    style={{ backgroundColor: 'hsl(var(--primary))' }}
                  >
                    <Flame className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex flex-col leading-tight items-start">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="font-bold text-lg truncate max-w-[200px]"
                        style={{ color: 'hsl(var(--primary))' }}
                      >
                        {freeClubNameParts.mainName}
                      </span>
                      <ChevronDown
                        className="h-3.5 w-3.5 shrink-0"
                        strokeWidth={2.5}
                        aria-hidden="true"
                        style={{ color: 'hsl(var(--primary))' }}
                      />
                    </div>
                    {freeClubNameParts.suffix && (
                      <span className="text-[10px] text-muted-foreground -mt-1 text-left">{freeClubNameParts.suffix}</span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <img
                    src={igniteIcon}
                    alt="Ignite"
                    width={40}
                    height={40}
                    className="h-9 w-9 sm:h-10 sm:w-10 shrink-0 rounded-full object-contain"
                    loading="eager"
                    decoding="sync"
                    fetchPriority="high"
                  />
                  <div className="flex flex-col items-start leading-none">
                    <div className="flex items-center">
                      <span className="font-bold text-[19px] tracking-tight text-gradient-emerald leading-none">Ignite</span>
                      <ChevronDown className="h-4 w-4 ml-1 text-muted-foreground/70 shrink-0" strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <span className="mt-1 text-[11px] font-medium tracking-wide text-muted-foreground leading-none">Club HQ</span>
                  </div>
                </>

              )}

            </button>
          </DropdownMenuTrigger>
          <LogoClubThemeDropdown />
        </DropdownMenu>
        {user?.id && !hintDismissed && (
          <ClubSwitcherHint
            userId={user.id}
            enabled={userClubCount > 1}
            onVisibleChange={setHintVisible}
            onDismiss={() => setHintDismissed(true)}
          />
        )}

        </div>

        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            className="hidden lg:inline-flex h-9 gap-2 px-2.5"
            onClick={() => navigate(activeClubTheme ? `/clubs/${activeClubTheme}` : "/clubs")}
          >
            <Building2 className="h-5 w-5" />
            <span className="text-sm">Clubs &amp; Teams</span>
          </Button>



          <DropdownMenu open={notificationsOpen} onOpenChange={(open) => {
              setNotificationsOpen(open);
              if (open) refetchRecentNotifications();
            }}>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="relative h-11 w-11"
                aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
              >
                <Bell 
                  className={`h-6 w-6 transition-colors duration-200 ${
                    unreadCount > 0 
                      ? 'text-primary animate-bell-ring' 
                      : 'text-muted-foreground'
                  }`}
                  strokeWidth={2}
                  aria-hidden="true" 
                />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 min-w-[15px] h-[15px] px-[3px] rounded-full bg-destructive text-[9px] font-bold leading-none flex items-center justify-center text-destructive-foreground ring-[1.5px] ring-background">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <SwipeableDropdownContent 
              className="w-80 bg-popover flex flex-col max-h-[80vh]" 
              align="end"
              onSwipeClose={() => setNotificationsOpen(false)}
            >
              <div className="flex items-center justify-between p-3 shrink-0">
                <p className="text-sm font-semibold">Notifications</p>
                <div className="flex items-center gap-2">
                  {dropdownUnread.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        markAllAsRead.mutate();
                      }}
                    >
                      <Check className="h-3 w-3 mr-1" />
                      Mark all as read
                    </Button>
                  )}
                </div>
              </div>
              <DropdownMenuSeparator className="shrink-0" />
              <div
                className="flex-1 overflow-y-auto overscroll-contain min-h-0"
                style={{ touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}
              >
                {dropdownUnread.length === 0 ? (
                  <div className="py-6 px-4 text-center text-sm text-muted-foreground">
                    You're all caught up
                  </div>
                ) : (
                  <>
                    {dropdownUnread.map((notification) => (
                      <DropdownMenuItem
                        key={notification.id}
                        className="flex items-start gap-3 py-3 px-3 cursor-pointer min-h-[60px] bg-primary/5 focus:bg-primary/10"
                        onSelect={(e) => {
                          e.preventDefault();
                          setNotificationsOpen(false);
                          handleNotificationClick(notification);
                        }}
                      >
                        {renderNotificationIcon(notification.type, notification.message)}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm line-clamp-2 font-medium text-foreground">
                            {notification.message}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                          </p>
                        </div>
                        <span className="h-2.5 w-2.5 rounded-full bg-primary shrink-0 mt-1.5" aria-label="Unread" />
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </div>

              <DropdownMenuSeparator className="shrink-0" />
              <DropdownMenuItem 
                onSelect={(e) => { e.preventDefault(); setNotificationsOpen(false); navigate("/notifications"); }}
                className="justify-center text-primary py-3 px-3 shrink-0"
              >
                <span className="text-sm font-medium">View all notifications</span>
              </DropdownMenuItem>
            </SwipeableDropdownContent>
          </DropdownMenu>

          {/* Account actions live in the avatar menu on all breakpoints */}
          <div>
            <DropdownMenu open={profileOpen} onOpenChange={setProfileOpen}>

              <DropdownMenuTrigger asChild>
                <Button 
                  variant="ghost" 
                  className="relative h-8 w-8 rounded-full p-0"
                  aria-label="Account menu"
                >
                  <Avatar 
                    className="h-8 w-8 border-2" 
                    style={{ 
                      borderColor: effectiveTheme === 'dark' ? 'hsla(160, 5%, 95%, 0.2)' : 'hsla(160, 10%, 10%, 0.2)'
                    }}
                  >
                    <AvatarImage src={profile?.avatar_url || undefined} />
                    <AvatarFallback 
                      className="text-xs"
                      style={{
                        backgroundColor: effectiveTheme === 'dark' ? 'hsla(160, 5%, 95%, 0.2)' : 'hsla(160, 10%, 10%, 0.2)',
                        color: effectiveTheme === 'dark' ? 'hsl(160 5% 95%)' : 'hsl(160 10% 10%)'
                      }}
                    >
                      {profile?.display_name?.charAt(0)?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
            <SwipeableDropdownContent 
              className="w-64 bg-popover" 
              align="end"
              onSwipeClose={() => setProfileOpen(false)}
            >
              <div className="flex items-center gap-3 p-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={profile?.avatar_url || undefined} />
                  <AvatarFallback className="bg-primary/20 text-primary text-sm">
                    {profile?.display_name?.charAt(0)?.toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col space-y-0.5">
                  <p className="text-sm font-medium">{profile?.display_name || "User"}</p>
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setProfileOpen(false); navigate("/profile"); }} className="py-3 px-3">
                <User className="mr-3 h-5 w-5" />
                <span className="text-sm">My Profile</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setProfileOpen(false); navigate("/settings"); }} className="py-3 px-3 lg:hidden">
                <Settings className="mr-3 h-5 w-5" />
                <span className="text-sm">Settings</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={(e) => { 
                e.preventDefault(); 
                setProfileOpen(false); 
                // In club mode, go directly to the club detail page
                if (activeClubTheme) {
                  navigate(`/clubs/${activeClubTheme}`);
                } else {
                  navigate("/clubs");
                }
              }} className="py-3 px-3 lg:hidden">
                <Building2 className="mr-3 h-5 w-5" />
                <span className="text-sm">My Clubs and Teams</span>
              </DropdownMenuItem>
              <DropdownMenuItem 
                onSelect={(e) => {
                  e.preventDefault();
                  setProfileOpen(false);
                  handleThemeToggle();
                }}
                className="py-3 px-3"
                disabled={isSavingTheme}
              >

                {effectiveTheme === "dark" ? (
                  <Sun className="mr-3 h-5 w-5" />
                ) : (
                  <Moon className="mr-3 h-5 w-5" />
                )}
                <span className="text-sm">{effectiveTheme === "dark" ? "Light Mode" : "Dark Mode"}</span>
              </DropdownMenuItem>

              {isAppAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onSelect={(e) => {
                      e.preventDefault();
                      setProfileOpen(false);
                      setDemoLoginOpen(true);
                    }}
                    className="py-3 px-3"
                  >
                    <UserCog className="mr-3 h-5 w-5" />
                    <span className="text-sm">Demo Accounts</span>
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onSelect={async (e) => {
                  e.preventDefault();
                  if (isSigningOut) return;
                  setIsSigningOut(true);
                  try {
                    await signOut();
                  } catch (error) {
                    console.error("Error signing out:", error);
                  } finally {
                    setIsSigningOut(false);
                    setProfileOpen(false);
                  }
                }}
                className="text-destructive focus:text-destructive py-3 px-3"
                disabled={isSigningOut}
              >
                {isSigningOut ? (
                  <Loader2 className="mr-3 h-5 w-5 animate-spin" />
                ) : (
                  <LogOut className="mr-3 h-5 w-5" />
                )}
                <span className="text-sm">{isSigningOut ? "Signing out..." : "Sign Out"}</span>
              </DropdownMenuItem>
            </SwipeableDropdownContent>
          </DropdownMenu>
          </div>
          {isAppAdmin && (
            <Suspense fallback={null}>
              <DemoLoginSection open={demoLoginOpen} onOpenChange={setDemoLoginOpen} />
            </Suspense>
          )}
        </div>
      </div>
    </header>
  );
}