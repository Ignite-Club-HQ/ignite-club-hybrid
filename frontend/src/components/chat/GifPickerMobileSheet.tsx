import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

import { GifGrid } from "@/components/chat/GifGrid";
import { useNativeKeyboardBottomInset } from "@/hooks/useNativeKeyboardBottomInset";

/**
 * Mobile GIPHY bottom sheet — fully keyboard-aware.
 *
 * Root issue on Android native: a fixed element can remain visually pinned to
 * the layout viewport bottom while the soft keyboard is effectively changing
 * the visible bottom edge through native insets / visual viewport updates.
 *
 * Fix: compute the actual keyboard top and position the sheet with an explicit
 * `top` value, not a `bottom` value. This makes the panel track the real
 * visible area above the keyboard across viewport models.
 */
/**
 * Sheet sizing — always span from TOP_GAP down to the keyboard top (or the
 * visible viewport bottom when the keyboard is closed). This guarantees we
 * give as many rows of GIFs as the screen allows, instead of capping the
 * sheet at a fixed default height.
 */
const SHEET_MIN_HEIGHT = 280;
const TOP_GAP = 56; // leave room for status bar / notch
const KEYBOARD_GAP = 0;
const KEYBOARD_OPEN_THRESHOLD = 80;
const isNativeAndroid =
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

interface GifPickerMobileSheetProps {
  open: boolean;
  onClose: () => void;
  onSelect: (gifUrl: string) => void;
}

export function GifPickerMobileSheet({ open, onClose, onSelect }: GifPickerMobileSheetProps) {
  const keyboardBottomInset = useNativeKeyboardBottomInset();
  const [layoutViewportHeight, setLayoutViewportHeight] = useState(() =>
    typeof window === "undefined" ? 0 : window.innerHeight,
  );
  const [visualViewportHeight, setVisualViewportHeight] = useState(() =>
    typeof window === "undefined" ? 0 : (window.visualViewport?.height ?? window.innerHeight),
  );
  const [visualViewportOffsetTop, setVisualViewportOffsetTop] = useState(() =>
    typeof window === "undefined" ? 0 : (window.visualViewport?.offsetTop ?? 0),
  );
  const [searchActive, setSearchActive] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);

  const rafRef = useRef<number | null>(null);
  const timeoutsRef = useRef<number[]>([]);
  const lastMeasuredKeyboardTopRef = useRef(0);
  const [safeAreaBottom, setSafeAreaBottom] = useState(0);

  // Read --safe-area-bottom (set by StatusBarManager) so we can stop the sheet
  // above the home indicator on iOS when the keyboard is closed.
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const read = () => {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue("--safe-area-bottom")
        .trim();
      const px = Number.parseFloat(raw || "0");
      setSafeAreaBottom(Number.isFinite(px) ? px : 0);
    };
    read();
    const id = window.setTimeout(read, 100);
    return () => window.clearTimeout(id);
  }, [open]);

  // Dismiss any existing soft keyboard when the sheet opens. On Android the
  // chat input is often still focused (so the keyboard remained visible), and
  // because Capacitor uses `Keyboard.resize: 'none'`, neither window.innerHeight
  // nor visualViewport shrinks — meaning our positioning math thinks the full
  // viewport is available and renders the sheet partially behind the keyboard.
  // Hiding it first guarantees a known-good baseline; the user can re-open it
  // by tapping the search field, at which point we reposition above it.
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && typeof active.blur === "function") active.blur();
    if (Capacitor.isNativePlatform()) {
      Keyboard.hide().catch(() => {});
    }
  }, [open]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;

    const measure = () => {
      setLayoutViewportHeight(window.innerHeight);
      setVisualViewportHeight(window.visualViewport?.height ?? window.innerHeight);
      setVisualViewportOffsetTop(window.visualViewport?.offsetTop ?? 0);
    };

    const scheduleSettle = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
      timeoutsRef.current.forEach((id) => window.clearTimeout(id));
      timeoutsRef.current = [50, 150, 300, 500].map((delay) => window.setTimeout(measure, delay));
    };

    measure();
    scheduleSettle();

    const vv = window.visualViewport;
    vv?.addEventListener("resize", scheduleSettle);
    vv?.addEventListener("scroll", scheduleSettle);
    window.addEventListener("resize", scheduleSettle);
    window.addEventListener("orientationchange", scheduleSettle);
    window.addEventListener("focusin", scheduleSettle);
    window.addEventListener("focusout", scheduleSettle);

    return () => {
      vv?.removeEventListener("resize", scheduleSettle);
      vv?.removeEventListener("scroll", scheduleSettle);
      window.removeEventListener("resize", scheduleSettle);
      window.removeEventListener("orientationchange", scheduleSettle);
      window.removeEventListener("focusin", scheduleSettle);
      window.removeEventListener("focusout", scheduleSettle);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      timeoutsRef.current.forEach((id) => window.clearTimeout(id));
      timeoutsRef.current = [];
    };
  }, [open]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const id = window.setTimeout(() => {
      setLayoutViewportHeight(window.innerHeight);
      setVisualViewportHeight(window.visualViewport?.height ?? window.innerHeight);
      setVisualViewportOffsetTop(window.visualViewport?.offsetTop ?? 0);
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, keyboardBottomInset]);

  useEffect(() => {
    if (!open) {
      setSearchActive(false);
      setInputFocused(false);
      lastMeasuredKeyboardTopRef.current = 0;
      return;
    }

    if (lastMeasuredKeyboardTopRef.current <= 0) {
      lastMeasuredKeyboardTopRef.current = layoutViewportHeight;
    }
  }, [layoutViewportHeight, open]);

  const { sheetTop, sheetBottom, keyboardOpen } = useMemo(() => {
    const visualViewportBottom = visualViewportOffsetTop + visualViewportHeight;
    const visualKeyboardHeight = Math.max(0, layoutViewportHeight - visualViewportBottom);
    const keyboardHeight = isNativeAndroid
      ? keyboardBottomInset
      : Math.max(keyboardBottomInset, visualKeyboardHeight);
    const isKeyboardOpen = keyboardHeight > KEYBOARD_OPEN_THRESHOLD;

    // Pin the sheet's bottom directly to the top of the keyboard (or to the
    // safe-area inset when the keyboard is closed). The sheet covers the
    // chat composer while open — eliminating the empty gap that previously
    // appeared between the GIF grid and the message input area.
    const bottomInset = isKeyboardOpen
      ? keyboardHeight
      : (isNativeAndroid ? 0 : safeAreaBottom);

    return {
      sheetTop: TOP_GAP,
      sheetBottom: bottomInset,
      keyboardOpen: isKeyboardOpen,
    };
  }, [
    keyboardBottomInset,
    layoutViewportHeight,
    safeAreaBottom,
    visualViewportHeight,
    visualViewportOffsetTop,
  ]);

  if (!open) return null;

  const focused = searchActive || inputFocused || keyboardOpen;

  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-[100000] transition-opacity duration-200 ${focused ? "bg-background/40" : "bg-background/15"}`}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      />

      <div
        className="fixed left-0 right-0 z-[100001] flex flex-col overflow-hidden rounded-t-2xl border-x border-t bg-popover text-popover-foreground shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
        style={{
          top: sheetTop,
          bottom: sheetBottom,
          paddingBottom: keyboardOpen ? 0 : "env(safe-area-inset-bottom, 0px)",
          transition:
            "top 180ms cubic-bezier(0.32, 0.72, 0, 1), bottom 180ms cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      >
        {/* Header */}
        <div className="relative flex items-center justify-between px-2 pt-1 pb-0.5 shrink-0">
          <div className="w-14" aria-hidden />
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const active = document.activeElement as HTMLElement | null;
              if (active && typeof active.blur === "function") active.blur();
              onClose();
            }}
            aria-label="Close GIF picker"
            className="w-14 h-7 flex items-center justify-center rounded-full text-sm font-medium text-primary hover:bg-accent active:scale-95 transition-all"
          >
            Done
          </button>
        </div>

        <div className="flex-1 min-h-0 px-3 pb-1 flex flex-col">
          <GifGrid
            active
            onSelect={onSelect}
            onQueryChange={(query) => setSearchActive(query.trim().length > 0)}
            onFocusChange={setInputFocused}
            scrollClassName="flex-1 min-h-0"
            gridClassName="grid-cols-3"
            className="flex-1 min-h-0"
          />
        </div>
      </div>
    </>,
    document.body,
  );
}