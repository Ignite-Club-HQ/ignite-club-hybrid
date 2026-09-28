import { useState, useEffect, useRef } from "react";
import { useCallback } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Download, Flag, MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { downloadMedia, isDownloadInFlight } from "@/lib/downloadImage";
import { useIOSScrollLock } from "@/hooks/useIOSScrollLock";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";
import { usePinchZoom } from "@/hooks/usePinchZoom";
import { Capacitor } from "@capacitor/core";
import { applyStatusBarForViewer, refreshStatusBar } from "@/lib/statusBarControl";
import { isVideoUrl } from "@/lib/videoUtils";
import {
  TAP_MAX_HOLD_MS,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_DIST,
  TAP_SLOP,
  MULTI_FINGER_SUPPRESS_MS,
} from "./fullscreenImageViewerConfig";

/**
 * Install a fullscreen tap-shield + document-level capture swallow for ~700ms
 * to absorb the synthetic tap-through that Radix Dropdown emits when it
 * closes — without this, the tap leaks to the chat bubble below and opens
 * its long-press action sheet (View Image / Reply / Pin / Delete).
 *
 * Allows the programmatic `<a download>` click that downloadImage() fires on
 * web to pass through, so downloads still work.
 */
function installTapShield(durationMs = 700) {
  const shield = document.createElement("div");
  shield.setAttribute("data-tap-shield", "1");
  shield.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;background:transparent;touch-action:none;-webkit-user-select:none;user-select:none;";
  const swallow = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
    (ev as any).stopImmediatePropagation?.();
  };
  const events = [
    "touchstart", "touchmove", "touchend", "touchcancel",
    "pointerdown", "pointermove", "pointerup", "pointercancel",
    "mousedown", "mousemove", "mouseup", "click", "contextmenu",
  ];
  events.forEach((evt) =>
    shield.addEventListener(evt, swallow, { passive: false, capture: true }),
  );
  const docSwallow = (ev: Event) => {
    const t = ev.target as HTMLElement | null;
    if (t && shield.contains(t)) return;
    if (
      ev.type === "click" &&
      t &&
      t.tagName === "A" &&
      (t as HTMLAnchorElement).hasAttribute("download")
    ) {
      return;
    }
    swallow(ev);
  };
  const docEvents: Array<[string, AddEventListenerOptions]> = [
    ["click", { capture: true }],
    ["contextmenu", { capture: true }],
    ["touchstart", { capture: true, passive: false }],
    ["touchmove", { capture: true, passive: false }],
    ["touchend", { capture: true, passive: false }],
    ["touchcancel", { capture: true, passive: false }],
    ["pointerdown", { capture: true }],
    ["pointerup", { capture: true }],
    ["pointercancel", { capture: true }],
    ["mousedown", { capture: true }],
    ["mouseup", { capture: true }],
  ];
  docEvents.forEach(([evt, opts]) =>
    document.addEventListener(evt, docSwallow, opts),
  );
  document.body.appendChild(shield);
  window.setTimeout(() => {
    shield.remove();
    docEvents.forEach(([evt, opts]) =>
      document.removeEventListener(evt, docSwallow, opts as any),
    );
  }, durationMs);
}

interface FullscreenImageViewerProps {
  src: string;
  alt?: string;
  onClose: () => void;
  onReport?: () => void;
  onBlockUser?: () => void;
  onForward?: () => void;
  showActions?: boolean;
}

export function FullscreenImageViewer({ src, alt = "Image", onClose, onReport, onBlockUser, onForward, showActions = false }: FullscreenImageViewerProps) {
  const [loaded, setLoaded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const { signedUrl } = useSignedPhotoUrl(src);
  const effectiveSrc = signedUrl || src;
  const {
    scale,
    translateX,
    translateY,
    onTouchStart: pinchTouchStart,
    onTouchMove: pinchTouchMove,
    onTouchEnd: pinchTouchEnd,
    resetZoom,
    onDoubleClick: pinchDoubleClick,
  } = usePinchZoom(1, 4);
  const [isAnimating, setIsAnimating] = useState(false);
  // Snap-back animation params, recomputed per double-tap based on pan distance.
  const [snapAnim, setSnapAnim] = useState({ duration: 220, easing: "cubic-bezier(0.32, 0.72, 0, 1)" });
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  // Timestamp (ms) until which any synthesized React onDoubleClick should be
  // ignored because a 3+ finger system gesture just ended. Browsers can fire
  // a synthetic dblclick after multi-touch — this poisons that path.
  const multiFingerSuppressUntilRef = useRef<number>(0);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Track pending animation timers so we can clear them on unmount. Without
  // this, a snap-back timeout firing after teardown (e.g. between tests, or
  // when the viewer closes mid-animation) calls setIsAnimating on an unmounted
  // tree — which reaches into React internals that touch `window` and throws
  // "window is not defined" in jsdom, surfacing as an unhandled error in CI.
  const animTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      animTimersRef.current.forEach((t) => clearTimeout(t));
      animTimersRef.current.clear();
    };
  }, []);
  const scheduleAnimEnd = useCallback((delay: number) => {
    const id = setTimeout(() => {
      animTimersRef.current.delete(id);
      if (isMountedRef.current) setIsAnimating(false);
    }, delay);
    animTimersRef.current.add(id);
  }, []);

  // Lock body scroll to prevent iOS viewport shift
  useIOSScrollLock(true);

  // Trigger smooth animated zoom toggle on double-tap.
  // When the image is panned/zoomed, this performs a snap-back animation that
  // smoothly returns the image to 1× centered. Duration scales with how far
  // the image was panned so short snaps feel snappy and large snaps feel
  // weighted; the ease-out-back curve gives a subtle "settle" at the end.
  const triggerZoomToggle = useCallback(() => {
    const isPannedOrZoomed = scale > 1 || translateX !== 0 || translateY !== 0;
    if (isPannedOrZoomed) {
      // Distance from center, used to scale the snap-back duration.
      const dist = Math.hypot(translateX, translateY);
      // 220ms baseline up to 360ms for a long fling-back.
      const duration = Math.min(360, 220 + dist * 0.3);
      // Soft ease-out-back: smooth deceleration with a tiny overshoot then settle.
      setSnapAnim({ duration, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      setIsAnimating(true);
      resetZoom();
      scheduleAnimEnd(duration + 20);
    } else {
      // Zoom-in toggle (1× → 2.2×) keeps the snappier baseline curve.
      setSnapAnim({ duration: 220, easing: "cubic-bezier(0.32, 0.72, 0, 1)" });
      setIsAnimating(true);
      pinchDoubleClick({} as React.MouseEvent);
      scheduleAnimEnd(240);
    }
  }, [pinchDoubleClick, resetZoom, scale, translateX, translateY, scheduleAnimEnd]);

  // Stable ref to triggerZoomToggle so the touch-listener effect below can
  // call the latest version WITHOUT having to re-run (and thus tear down +
  // re-attach the non-passive touch listeners) every time scale/translate
  // changes. On iOS, removing a touchmove listener mid-gesture causes the
  // WebView to fall back to its native pinch handler, which silently
  // hijacks the gesture — that's why pinch worked on Android but not iOS.
  const triggerZoomToggleRef = useRef(triggerZoomToggle);
  triggerZoomToggleRef.current = triggerZoomToggle;

  // Attach native non-passive touch listeners so preventDefault() actually
  // works on iOS (React's synthetic touch listeners are passive).
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    // Gesture-arbitration thresholds live in fullscreenImageViewerConfig.ts
    // so tests and future per-device tuning share a single source of truth.

    // Per-gesture arbitration flags. Reset on touchstart of the first finger
    // and whenever a second finger lands. Ensures only one gesture (pinch,
    // drag, long-press, OR double-tap) "wins" any given touch sequence.
    let gestureHadMultiTouch = false;
    // 3+ finger gestures (system gestures: iOS app switcher swipe, Android
    // split-screen, accessibility, screenshots) must NEVER trigger zoom.
    // Once tripped, this flag suppresses double-tap arbitration AND the
    // React synthetic onDoubleClick handler until the next clean single-tap
    // sequence begins.
    let gestureHadMultiFinger = false;
    let gestureMoved = false;
    let gestureStartX = 0;
    let gestureStartY = 0;
    let gestureStartTime = 0;

    const handleStart = (e: globalThis.TouchEvent) => {
      // Stop propagation so the viewer's gesture sequence is fully isolated
      // from any chat / swipe-to-reply / long-press handlers on ancestors.
      // Combined with the React portal below this guarantees iOS pinch never
      // races against a parent's onPointerDown(preventDefault).
      e.stopPropagation();
      // Track the peak finger count for this whole gesture sequence — a
      // 3-finger swipe that briefly drops to 1 finger as the user lifts
      // must still be treated as a system gesture, not a tap candidate.
      if (e.touches.length >= 3) {
        gestureHadMultiFinger = true;
        gestureHadMultiTouch = true;
        lastTapRef.current = null;
        // Bail before forwarding to pinch-zoom — 3+ fingers is never a pinch.
        return;
      }
      if (e.touches.length === 1) {
        // Fresh single-finger sequence — start tracking for tap/drag/long-press.
        gestureHadMultiTouch = false;
        gestureHadMultiFinger = false;
        gestureMoved = false;
        gestureStartX = e.touches[0].clientX;
        gestureStartY = e.touches[0].clientY;
        gestureStartTime = Date.now();
      } else if (e.touches.length === 2) {
        // Pinch started — kill any pending tap candidate so the pinch can't
        // accidentally trigger a double-tap when fingers lift.
        gestureHadMultiTouch = true;
        lastTapRef.current = null;
      }
      pinchTouchStart(e as unknown as React.TouchEvent);
    };
    const handleMove = (e: globalThis.TouchEvent) => {
      e.stopPropagation();
      if (e.touches.length >= 3) {
        // Promoted to a system multi-finger gesture mid-sequence.
        gestureHadMultiFinger = true;
        gestureHadMultiTouch = true;
        lastTapRef.current = null;
        return;
      }
      if (e.touches.length === 2) {
        gestureHadMultiTouch = true;
        lastTapRef.current = null;
      } else if (e.touches.length === 1 && !gestureMoved) {
        const dx = e.touches[0].clientX - gestureStartX;
        const dy = e.touches[0].clientY - gestureStartY;
        if (Math.hypot(dx, dy) > TAP_SLOP) {
          gestureMoved = true;
        }
      }
      pinchTouchMove(e as unknown as React.TouchEvent);
    };
    const handleEnd = (e: globalThis.TouchEvent) => {
      // Stop propagation so chat-message swipe-to-reply / long-press handlers
      // on ancestor DOM nodes (the viewer is rendered as a portal but legacy
      // call sites may still nest it) can't intercept the gesture finalisation.
      e.stopPropagation();
      pinchTouchEnd(e);
      const heldMs = Date.now() - gestureStartTime;
      const wasLongPress = heldMs >= TAP_MAX_HOLD_MS;
      // Detect double-tap on touchend, but only if the gesture was a true
      // single-finger short tap (no pinch, no 3+ finger system gesture, no
      // drag, no long-press). This prevents double-tap from firing during
      // pinch-zoom, at the tail of a pan, after a long press, or after the
      // user lifts a 3-finger system gesture.
      if (
        e.changedTouches.length === 1 &&
        e.touches.length === 0 &&
        !gestureHadMultiTouch &&
        !gestureHadMultiFinger &&
        !gestureMoved &&
        !wasLongPress
      ) {
        const t = e.changedTouches[0];
        const now = Date.now();
        const last = lastTapRef.current;
        if (
          last &&
          now - last.time < DOUBLE_TAP_MS &&
          Math.hypot(t.clientX - last.x, t.clientY - last.y) < DOUBLE_TAP_DIST
        ) {
          e.preventDefault();
          triggerZoomToggleRef.current();
          lastTapRef.current = null;
          return;
        }
        lastTapRef.current = { time: now, x: t.clientX, y: t.clientY };
      } else if (e.touches.length === 0) {
        // Sequence ended as a pinch, drag, long-press, or 3+ finger system
        // gesture — invalidate any tap candidate so the next genuine tap
        // can't pair with this one. Also expose the multi-finger flag to
        // the React onDoubleClick handler via the ref below.
        lastTapRef.current = null;
        if (gestureHadMultiFinger) {
          // Briefly poison the React synthetic double-click path too —
          // some browsers synthesize dblclick after multi-touch ends.
          multiFingerSuppressUntilRef.current = Date.now() + MULTI_FINGER_SUPPRESS_MS;
        }
      }
    };
    const handleCancel = (e: globalThis.TouchEvent) => {
      e.stopPropagation();
      pinchTouchEnd(e);
      lastTapRef.current = null;
      gestureHadMultiTouch = false;
      gestureHadMultiFinger = false;
      gestureMoved = false;
    };
    node.addEventListener("touchstart", handleStart, { passive: false });
    node.addEventListener("touchmove", handleMove, { passive: false });
    node.addEventListener("touchend", handleEnd, { passive: false });
    node.addEventListener("touchcancel", handleCancel, { passive: false });
    return () => {
      node.removeEventListener("touchstart", handleStart);
      node.removeEventListener("touchmove", handleMove);
      node.removeEventListener("touchend", handleEnd);
      node.removeEventListener("touchcancel", handleCancel);
    };
    // IMPORTANT: only re-attach when the pinch hook's stable callbacks change.
    // triggerZoomToggle is intentionally NOT in deps — it's invoked via a ref
    // above so this effect doesn't re-run on every scale/translate update,
    // which would tear down the touch listeners mid-gesture and break iOS
    // pinch-zoom (Android is more tolerant of this churn).
  }, [pinchTouchStart, pinchTouchMove, pinchTouchEnd]);

  // Force status bar to light icons on black background, restore on unmount
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    applyStatusBarForViewer();
    return () => {
      refreshStatusBar();
    };
  }, []);

  useEffect(() => {
    // NOTE: do NOT reset `loaded` to false here. `effectiveSrc` flips from
    // the raw URL to the signed URL once `useSignedPhotoUrl` resolves, and
    // resetting `loaded` made the image fade to opacity-0 then back in,
    // producing a visible "vanish then reappear" flash. The <img> swaps its
    // src in place; if the new URL fails we leave the old frame visible.
    resetZoom();
  }, [effectiveSrc, resetZoom]);

  const handleDoubleClick = useCallback(() => {
    // Suppress React's synthetic double-click if a 3+ finger system gesture
    // just ended — those are never meant to zoom the image.
    if (Date.now() < multiFingerSuppressUntilRef.current) return;
    triggerZoomToggle();
  }, [triggerZoomToggle]);

  const handleViewerClick = useCallback(() => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    if (scale === 1) onClose();
  }, [menuOpen, onClose, scale]);

  const handleMediaClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (menuOpen) setMenuOpen(false);
  }, [menuOpen]);

  // Use max(safe-area, 1.75rem) so action icons always clear the Android
  // status bar even inside in-app browsers (Messenger, etc.) where
  // env(safe-area-inset-top) reports 0.
  const safeTop = "max(env(safe-area-inset-top), 1.75rem)";

  // Render via a portal to document.body so the viewer escapes the chat
  // message subtree. Inside the chat tree, ancestor handlers (swipe-to-reply,
  // long-press timers, onPointerDown(preventDefault) on message bubbles)
  // intercept touch events on iOS WebView and starve the pinch gesture.
  // Portalling guarantees the viewer's touch sequence is owned exclusively
  // by its own listeners.
  const content = (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[1000005] bg-black flex items-center justify-center overscroll-none"
      style={{
        touchAction: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
        // Radix Dialog/Sheet sets pointer-events:none on <body> while open.
        // Since the viewer is portalled to <body>, it inherits that and
        // becomes click-through. Force pointer-events:auto so taps on the
        // image (and overlay buttons) register when launched from a Sheet/Dialog.
        // Keep this above our Dialog z-[1000001] as shared-media thumbnails
        // can launch it from ChatDetailsSheet and ChatMediaViewer.
        pointerEvents: 'auto',
      }}
      onClick={handleViewerClick}
      onDoubleClick={handleDoubleClick}
    >
      <div
        className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 pb-3 bg-gradient-to-b from-black/70 to-transparent"
        style={{ paddingTop: `calc(${safeTop} + 0.5rem)` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: back/close */}
        <Button
          variant="ghost"
          size="icon"
          className="text-white hover:bg-white/20 bg-black/40 rounded-full h-11 w-11"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>

        {/* Right: actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            disabled={isDownloading}
            className="text-white hover:bg-white/20 bg-black/40 rounded-full h-11 w-11 disabled:opacity-60"
            aria-label="Download"
            onClick={async (e) => {
              e.stopPropagation();
              if (isDownloading || isDownloadInFlight(effectiveSrc)) return;
              setIsDownloading(true);
              try {
                const kind = isVideoUrl(effectiveSrc) ? "video" : "photo";
                await downloadMedia(effectiveSrc, kind);
              } finally {
                setIsDownloading(false);
              }
            }}
          >
            {isDownloading ? (
              <div className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <Download className="h-5 w-5" />
            )}
          </Button>
          <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20 bg-black/40 rounded-full h-11 w-11"
                aria-label="More options"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={8}
              className="z-[1000006] min-w-[180px]"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
            >
              {showActions && onReport && (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    installTapShield();
                    onClose();
                    requestAnimationFrame(() => {
                      requestAnimationFrame(() => {
                        setTimeout(() => onReport(), 60);
                      });
                    });
                  }}
                >
                  <Flag className="h-4 w-4 mr-2" />
                  Report
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!loaded && (
        <div className="animate-pulse bg-muted/20 rounded w-64 h-64" />
      )}
      {isVideoUrl(effectiveSrc) ? (
        <video
          src={effectiveSrc}
          className={`w-screen h-[100dvh] object-contain transition-opacity duration-100 ${loaded ? "opacity-100" : "opacity-0"}`}
          controls
          autoPlay
          playsInline
          onClick={handleMediaClick}
          onLoadedData={() => setLoaded(true)}
        />
      ) : (
        <img
          src={effectiveSrc}
          alt={alt}
          className={`max-w-[100vw] max-h-[100dvh] w-auto h-auto object-contain transition-opacity duration-100 ${loaded ? "opacity-100" : "opacity-0"}`}
          style={{
            transform: `scale(${scale}) translate(${translateX / scale}px, ${translateY / scale}px)`,
            transition: isAnimating ? `transform ${snapAnim.duration}ms ${snapAnim.easing}` : "none",
            touchAction: 'none',
            willChange: 'transform',
          }}
          onClick={handleMediaClick}
          onLoad={() => setLoaded(true)}
          draggable={false}
        />
      )}
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
