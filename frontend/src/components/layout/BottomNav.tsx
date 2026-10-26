import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Home, Calendar, MessageCircle, Image } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useNavMessagesBadgeCount } from "@/hooks/useNavMessagesBadgeCount";
import { Capacitor } from "@capacitor/core";
import {
  IOS_LAYOUT_RESET_EVENT,
  IOS_NAV_GUARD_EVENT,
  readSafeAreaInsetBottomPx,
} from "@/lib/iosLayoutStability";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import { useNativeKeyboardHeight } from "@/hooks/useNativeKeyboardHeight";
import { prefetchRoute, warmMainRoutes } from "@/lib/routePrefetch";

const navItems = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/messages", icon: MessageCircle, label: "Messages" },
  { to: "/events", icon: Calendar, label: "Schedule" },
  { to: "/media", icon: Image, label: "Media" },
];

const MIN_NATIVE_BOTTOM_INSET_PX = 20;
const IOS_NATIVE_BOTTOM_INSET_PX = 0;
const IOS_WEB_BOTTOM_INSET_PX = 0;
const MAX_IOS_NATIVE_BOTTOM_INSET_PX = 60;
const DEFAULT_NAV_GUARD_MS = 900;

export function BottomNav() {
  // Warm page code after the shell paints, rather than waiting for the tap.
  // This does not start page data reads or mount inactive pages.
  useEffect(() => { warmMainRoutes(); }, []);
  // Club-filtered Messages badge count, shared with the desktop rail. Works
  // in both Supabase and ICP modes — see the hook for the backend branches.
  const unreadMessagesCount = useNavMessagesBadgeCount();

  const location = useLocation();
  const isKeyboardOpen = useKeyboardOpen();
  const nativeKbHeight = useNativeKeyboardHeight();

  const isChatThreadRoute = useMemo(() => {
    const path = location.pathname;
    if (path === "/messages/broadcast") return true;
    if (/^\/messages\/club\/[^/]+$/.test(path)) return true;
    if (/^\/messages\/club-admin\/[^/]+$/.test(path)) return true;
    if (/^\/messages\/dm\/[^/]+$/.test(path)) return true;
    if (/^\/groups\/[^/]+$/.test(path)) return true;
    if (/^\/messages\/[^/]+$/.test(path) && path !== "/messages" && path !== "/messages/welcome") return true;
    return false;
  }, [location.pathname]);

  // Hide the nav whenever the on-screen keyboard is up so it doesn't cover
  // the focused input on form pages (and stays out of the way in chat threads).
  // Safety override: if no editable element is focused, never treat the
  // keyboard as open — protects against missed Capacitor keyboardDidHide
  // events on Android after fast navigation away from a chat thread.
  const [hasEditableFocus, setHasEditableFocus] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const isEditable = (el: Element | null) => {
      if (!el) return false;
      const tag = el.tagName;
      const editable =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
        (el as HTMLElement).isContentEditable === true;
      if (!editable) return false;
      // Kept background tabs stay mounted but hidden (display:none +
      // aria-hidden). If their chat composer still holds focus after
      // switching tabs, counting it would keep the nav translated off-screen
      // whenever the keyboard height is stuck — taps then land where the nav
      // used to be and "nothing happens".
      if ((el as HTMLElement).closest('[aria-hidden="true"], .hidden')) return false;
      return true;
    };
    const update = () => setHasEditableFocus(isEditable(document.activeElement));
    update();
    document.addEventListener("focusin", update, true);
    document.addEventListener("focusout", update, true);
    return () => {
      document.removeEventListener("focusin", update, true);
      document.removeEventListener("focusout", update, true);
    };
  }, [location.pathname]);

  const shouldHideNav = (isKeyboardOpen || nativeKbHeight > 0) && hasEditableFocus;

  const isNativePlatform = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();
  const isNativeIOS = isNativePlatform && platform === "ios";
  const isAndroidNative = isNativePlatform && platform === "android";

  const isIOSEnvironment = useMemo(() => {
    if (typeof navigator === "undefined") return platform === "ios";
    const userAgent = navigator.userAgent;
    const iOSDevice = /iPad|iPhone|iPod/.test(userAgent);
    const iPadOSDesktopMode = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    return iOSDevice || iPadOSDesktopMode || platform === "ios";
  }, [platform]);

  const shouldStabilizeIOSLayout = isIOSEnvironment;

  const nativeInsetFloorPx = useMemo(() => {
    if (!shouldStabilizeIOSLayout) return MIN_NATIVE_BOTTOM_INSET_PX;
    if (isNativeIOS) return IOS_NATIVE_BOTTOM_INSET_PX;
    return IOS_WEB_BOTTOM_INSET_PX;
  }, [isNativeIOS, shouldStabilizeIOSLayout]);

  const [nativeSafeInsetPx, setNativeSafeInsetPx] = useState(nativeInsetFloorPx);
  const [, setNavInteractionLocked] = useState(false);
  const navGuardTimeoutRef = useRef<number | null>(null);

  const resolveBottomInsetPx = useCallback(() => {
    if (!shouldStabilizeIOSLayout) return nativeInsetFloorPx;
    if (!isNativeIOS) return nativeInsetFloorPx;

    const measuredInset = readSafeAreaInsetBottomPx();
    return Math.max(nativeInsetFloorPx, Math.min(measuredInset, MAX_IOS_NATIVE_BOTTOM_INSET_PX));
  }, [isNativeIOS, nativeInsetFloorPx, shouldStabilizeIOSLayout]);

  const lockNavInteractions = useCallback((durationMs = DEFAULT_NAV_GUARD_MS) => {
    if (typeof window === "undefined") return;
    if (navGuardTimeoutRef.current !== null) window.clearTimeout(navGuardTimeoutRef.current);
    setNavInteractionLocked(true);
    navGuardTimeoutRef.current = window.setTimeout(() => {
      setNavInteractionLocked(false);
      navGuardTimeoutRef.current = null;
    }, Math.max(250, durationMs));
  }, []);

  useEffect(() => {
    setNativeSafeInsetPx(resolveBottomInsetPx());
  }, [nativeInsetFloorPx, resolveBottomInsetPx]);

  useEffect(() => {
    if (!shouldStabilizeIOSLayout || typeof window === "undefined") return;

    const handleOrientationChange = () => {
      setNativeSafeInsetPx(resolveBottomInsetPx());
      lockNavInteractions(DEFAULT_NAV_GUARD_MS);
    };

    window.addEventListener("orientationchange", handleOrientationChange);
    return () => window.removeEventListener("orientationchange", handleOrientationChange);
  }, [lockNavInteractions, nativeInsetFloorPx, resolveBottomInsetPx, shouldStabilizeIOSLayout]);

  useEffect(() => {
    if (!shouldStabilizeIOSLayout || typeof window === "undefined" || typeof document === "undefined") return;

    const handleViewportResume = () => {
      if (document.visibilityState === "hidden") return;
      setNativeSafeInsetPx(resolveBottomInsetPx());
      lockNavInteractions(1200);
    };

    window.addEventListener("focus", handleViewportResume);
    window.addEventListener("pageshow", handleViewportResume);
    document.addEventListener("visibilitychange", handleViewportResume);

    return () => {
      window.removeEventListener("focus", handleViewportResume);
      window.removeEventListener("pageshow", handleViewportResume);
      document.removeEventListener("visibilitychange", handleViewportResume);
    };
  }, [lockNavInteractions, nativeInsetFloorPx, resolveBottomInsetPx, shouldStabilizeIOSLayout]);

  useEffect(() => {
    if (!shouldStabilizeIOSLayout || typeof window === "undefined") return;

    const resetToFloor = (durationMs = DEFAULT_NAV_GUARD_MS) => {
      setNativeSafeInsetPx(resolveBottomInsetPx());
      lockNavInteractions(durationMs);
    };

    const handleLayoutReset = () => resetToFloor(1200);
    const handleNavGuard = (event: Event) => {
      const ce = event as CustomEvent<{ durationMs?: number }>;
      resetToFloor(ce.detail?.durationMs ?? DEFAULT_NAV_GUARD_MS);
    };

    window.addEventListener(IOS_LAYOUT_RESET_EVENT, handleLayoutReset);
    window.addEventListener(IOS_NAV_GUARD_EVENT, handleNavGuard as EventListener);

    return () => {
      window.removeEventListener(IOS_LAYOUT_RESET_EVENT, handleLayoutReset);
      window.removeEventListener(IOS_NAV_GUARD_EVENT, handleNavGuard as EventListener);
    };
  }, [lockNavInteractions, nativeInsetFloorPx, resolveBottomInsetPx, shouldStabilizeIOSLayout]);

  useEffect(() => {
    if (!shouldStabilizeIOSLayout) return;
    lockNavInteractions(700);
    setNativeSafeInsetPx(resolveBottomInsetPx());
    // After leaving a chat thread on iOS, the document/window can be left
    // scrolled (composer focus + Keyboard.setScroll interactions), which
    // pushes the fixed bottom nav partly below the home-indicator area on
    // the destination page. Force the outer window back to the top across
    // a short settle window so labels never sit clipped under the indicator.
    if (typeof window === "undefined") return;
    const win = window;
    const doc = typeof document !== "undefined" ? document : null;
    const resetWindow = () => {
      if (typeof win.scrollTo === "function") {
        win.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
      if (doc) {
        doc.documentElement.scrollTop = 0;
        doc.body.scrollTop = 0;
      }
    };
    resetWindow();
    requestAnimationFrame(resetWindow);
    const t1 = win.setTimeout(resetWindow, 120);
    const t2 = win.setTimeout(resetWindow, 360);
    return () => {
      win.clearTimeout(t1);
      win.clearTimeout(t2);
    };
  }, [shouldStabilizeIOSLayout, location.pathname, lockNavInteractions, nativeInsetFloorPx, resolveBottomInsetPx]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && navGuardTimeoutRef.current !== null) {
        window.clearTimeout(navGuardTimeoutRef.current);
        navGuardTimeoutRef.current = null;
      }
    };
  }, []);

  const nativeInsetFloor = `${nativeSafeInsetPx}px`;
  // For native iOS, use the live CSS env() value as the source of truth so the nav
  // tracks the real home-indicator inset without JS measurement lag and without
  // any extra hard-coded floor that would push the bar away from the bottom edge.
  // On native iOS, guarantee at least 8px below the labels so the home-indicator
  // region never visually crowds the nav text on devices that report a small or
  // zero safe-area-inset-bottom (e.g., landscape, iPad, older form factors).
  const navBottomInset = isNativeIOS
    ? "max(env(safe-area-inset-bottom, 0px), 8px)"
    : shouldStabilizeIOSLayout
      ? nativeInsetFloor
      : isAndroidNative
        ? "max(env(safe-area-inset-bottom, 0px), 1rem)"
        : "max(env(safe-area-inset-bottom, 0px), 8px)";

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.style.setProperty("--bottom-nav-safe-inset", navBottomInset);
    root.style.setProperty("--bottom-nav-safe-inset-px", nativeInsetFloor);
    // When nav is hidden (keyboard open on chat), set offset to 0 so chat viewport expands
    root.style.setProperty(
      "--bottom-nav-offset",
      shouldHideNav ? "0px" : `calc(4rem + ${navBottomInset})`
    );
  }, [navBottomInset, nativeInsetFloor, shouldHideNav]);

  const gpuLayerStyle = shouldStabilizeIOSLayout
    ? { willChange: "transform", backfaceVisibility: "hidden" as const }
    : {};

  const hideTransform = shouldHideNav ? "translateY(100%)" : "translate3d(0,0,0)";

  return (
    <>
      {isNativePlatform && !shouldHideNav && (
        <div
          className="fixed bottom-0 left-0 right-0 z-[49] bg-card pointer-events-none lg:hidden"
          style={{
            height: `calc(4rem + ${navBottomInset})`,
            transform: "translate3d(0,0,0)",
            touchAction: "none",
            overscrollBehavior: "contain",
            ...gpuLayerStyle,
          }}
        />
      )}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card transition-transform duration-200 ease-out lg:hidden"
        style={{
          paddingBottom: navBottomInset,
          transform: hideTransform,
          touchAction: "none",
          overscrollBehavior: "contain",
          ...gpuLayerStyle,
        }}
        onTouchMove={(e) => {
          // Prevent Android WebView from treating drags on the bottom nav as
          // page-pull gestures (which scroll the whole app off-screen).
          if (e.cancelable) e.preventDefault();
        }}
        aria-label="Main navigation"
        aria-hidden={shouldHideNav}
      >
        <div className="flex items-center justify-around min-h-[4rem] max-w-lg mx-auto px-2">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              aria-label={label}
              aria-current={undefined}
              onPointerDown={() => prefetchRoute(to)}
              onPointerEnter={() => prefetchRoute(to)}
              onFocus={() => prefetchRoute(to)}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center justify-center flex-1 py-2 transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground",
                )
              }
            >
              {({ isActive }) => (
                <span aria-current={isActive ? "page" : undefined} className="flex flex-col items-center">
                  <div className={cn("p-1.5 rounded-xl transition-all relative", isActive && "bg-primary/10")}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                    {label === "Messages" && unreadMessagesCount > 0 && (
                      <span
                        className={cn(
                          "absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full font-semibold text-[9px] leading-none ring-2 ring-card text-white tabular-nums",
                          "bg-[hsl(0_72%_55%)]",
                          unreadMessagesCount > 9
                            ? "min-w-[16px] h-[15px] px-1"
                            : "w-[15px] h-[15px]"
                        )}
                        aria-label={`${unreadMessagesCount} unread messages`}
                      >
                        {unreadMessagesCount > 9 ? "9+" : unreadMessagesCount}
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-medium mt-0.5">{label}</span>
                </span>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}
