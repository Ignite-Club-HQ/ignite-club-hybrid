import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * Pinch-zoom + zoom controls for PitchBoard.
 *
 * Owns `zoom` (1..3) which scales the pitch content size inside an
 * overflow-auto scroll container. All zoom paths (pinch, ctrl/cmd+wheel,
 * zoom buttons) keep the gesture anchor point stationary by correcting the
 * container's scroll position after each zoom commit — without this the view
 * zooms toward the top-left corner ("zooms off to the side").
 *
 * iOS gesture-handler rule: every helper here is synchronous and never awaits,
 * so it can be called directly inside React touch handlers without breaking
 * the user-gesture context (no Camera/getUserMedia involvement, but we follow
 * the same discipline for consistency with the wider codebase).
 *
 * Returns:
 * - zoom / setZoom / handleZoomIn / handleZoomOut / handleResetZoom
 * - pitchZoomScrollRef: callback ref — attach to the overflow-auto container
 *   that wraps the scaled pitch content. Also installs a native non-passive
 *   wheel listener so ctrl/cmd+wheel (trackpad pinch) zooms the pitch instead
 *   of the browser page (React onWheel is passive and cannot preventDefault).
 * - tryPinchStart(e): records pinch baseline when 2 fingers land. Returns
 *   `true` when the event was a 2-finger start (caller may early-return).
 * - tryPinchMove(e): consumes 2-finger moves and adjusts zoom, anchored on the
 *   pinch midpoint. Returns `true` when handled — caller MUST early-return so
 *   player-drag logic is skipped.
 * - tryPinchEnd(e): clears pinch baseline once fewer than 2 fingers remain.
 *   Always safe to call; never returns a value the caller has to branch on.
 */
export function usePitchBoardPinchZoom() {
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 3;

  const [zoom, setZoomState] = useState(1);
  const zoomRef = useRef(1);

  // Scroll container (the overflow-auto wrapper around the scaled pitch).
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const wheelHandlerRef = useRef<((e: WheelEvent) => void) | null>(null);

  // Active pinch baseline (distance + zoom when the second finger landed).
  const pinchRef = useRef<{ initialDist: number; initialZoom: number } | null>(null);

  // Pending scroll correction so the content point under the gesture anchor
  // stays put across the zoom commit. Applied in the layout effect below.
  const pendingAnchorRef = useRef<{
    px: number;
    py: number;
    contentX: number;
    contentY: number;
    ratio: number;
  } | null>(null);

  const clampZoom = (z: number, min: number = MIN_ZOOM) =>
    Math.min(Math.max(z, min), MAX_ZOOM);

  const applyZoom = useCallback(
    (
      next: number,
      anchor?: { clientX: number; clientY: number },
      min: number = MIN_ZOOM
    ) => {
      const el = scrollContainerRef.current;
      const prev = zoomRef.current;
      next = clampZoom(next, min);
      if (el && anchor && next > MIN_ZOOM && prev > 0) {
        const rect = el.getBoundingClientRect();
        const px = anchor.clientX - rect.left;
        const py = anchor.clientY - rect.top;
        pendingAnchorRef.current = {
          px,
          py,
          contentX: el.scrollLeft + px,
          contentY: el.scrollTop + py,
          ratio: next / prev,
        };
      } else {
        pendingAnchorRef.current = null;
      }
      zoomRef.current = next;
      setZoomState(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // After the zoomed content size commits, shift the scroll position so the
  // anchored content point stays under the gesture anchor.
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    const pending = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    if (!el) return;
    if (pending) {
      el.scrollLeft = pending.contentX * pending.ratio - pending.px;
      el.scrollTop = pending.contentY * pending.ratio - pending.py;
    } else if (zoom <= MIN_ZOOM) {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  const centerAnchor = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return undefined;
    const rect = el.getBoundingClientRect();
    return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  }, []);

  const handleZoomIn = useCallback(() => {
    applyZoom(zoomRef.current + 0.25, centerAnchor());
  }, [applyZoom, centerAnchor]);

  const handleZoomOut = useCallback(() => {
    // Legacy behaviour allowed shrinking below 1x down to 0.5 — preserved.
    const next = Math.max(zoomRef.current - 0.25, 0.5);
    applyZoom(next, next >= MIN_ZOOM ? centerAnchor() : undefined, 0.5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyZoom, centerAnchor]);

  const handleResetZoom = useCallback(() => {
    pendingAnchorRef.current = null;
    zoomRef.current = 1;
    setZoomState(1);
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    }
  }, []);

  // Wheel zoom (ctrl/cmd + wheel, i.e. trackpad pinch on desktop). Kept as a
  // React handler for API compatibility, but the native non-passive listener
  // installed by pitchZoomScrollRef is what actually guarantees preventDefault.
  const handleWheel = useCallback(
    (e: { ctrlKey: boolean; metaKey: boolean; deltaY: number; deltaMode: number; clientX: number; clientY: number }) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      applyZoom(zoomRef.current * Math.exp(-dy * 0.002), {
        clientX: e.clientX,
        clientY: e.clientY,
      });
    },
    [applyZoom]
  );

  // Callback ref for the scroll container. Re-runs on portrait/landscape
  // remounts so the native wheel listener always follows the live element.
  const pitchZoomScrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (scrollContainerRef.current && wheelHandlerRef.current) {
        scrollContainerRef.current.removeEventListener("wheel", wheelHandlerRef.current);
      }
      scrollContainerRef.current = el;
      wheelHandlerRef.current = null;
      if (el) {
        const handler = (e: WheelEvent) => {
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          handleWheel(e);
        };
        wheelHandlerRef.current = handler;
        el.addEventListener("wheel", handler, { passive: false });
      }
    },
    [handleWheel]
  );

  const getPinchDist = (touches: React.TouchList | TouchList) => {
    const t0 = touches[0];
    const t1 = touches[1];
    const dx = t1.clientX - t0.clientX;
    const dy = t1.clientY - t0.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getPinchCenter = (touches: React.TouchList | TouchList) => ({
    clientX: (touches[0].clientX + touches[1].clientX) / 2,
    clientY: (touches[0].clientY + touches[1].clientY) / 2,
  });

  const tryPinchStart = useCallback((e: React.TouchEvent): boolean => {
    if (e.touches.length === 2) {
      pinchRef.current = {
        initialDist: getPinchDist(e.touches),
        initialZoom: zoomRef.current,
      };
      return true;
    }
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tryPinchMove = useCallback(
    (e: React.TouchEvent): boolean => {
      const pinch = pinchRef.current;
      if (e.touches.length === 2 && pinch && pinch.initialDist > 0) {
        e.preventDefault();
        applyZoom(
          pinch.initialZoom * (getPinchDist(e.touches) / pinch.initialDist),
          getPinchCenter(e.touches)
        );
        return true;
      }
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyZoom]
  );

  const tryPinchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      pinchRef.current = null;
    }
  }, []);

  const setZoom = useCallback(
    (z: number) => applyZoom(z, centerAnchor()),
    [applyZoom, centerAnchor]
  );

  return {
    zoom,
    setZoom,
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
    handleWheel,
    pitchZoomScrollRef,
    tryPinchStart,
    tryPinchMove,
    tryPinchEnd,
  };
}
