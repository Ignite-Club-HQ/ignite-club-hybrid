import { useRef, useState, useCallback, TouchEvent, WheelEvent, MouseEvent } from "react";

interface PinchZoomState {
  scale: number;
  translateX: number;
  translateY: number;
}

interface UsePinchZoomReturn {
  scale: number;
  translateX: number;
  translateY: number;
  onTouchStart: (e: TouchEvent) => void;
  onTouchMove: (e: TouchEvent) => void;
  onTouchEnd: (e?: TouchEvent | globalThis.TouchEvent) => void;
  onWheel: (e: WheelEvent) => void;
  onMouseDown: (e: MouseEvent) => void;
  onMouseMove: (e: MouseEvent) => void;
  onMouseUp: () => void;
  onDoubleClick: (e: MouseEvent) => void;
  resetZoom: () => void;
  isPanningOrPinching: () => boolean;
}

export function usePinchZoom(minScale = 1, maxScale = 4): UsePinchZoomReturn {
  const [state, setState] = useState<PinchZoomState>({
    scale: 1,
    translateX: 0,
    translateY: 0,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const initialDistance = useRef<number | null>(null);
  const initialScale = useRef<number>(1);
  const initialCenter = useRef<{ x: number; y: number } | null>(null);
  const initialAngle = useRef<number | null>(null);
  const rotationLocked = useRef(false);
  const lastTranslate = useRef({ x: 0, y: 0 });
  const isPinching = useRef(false);

  // Single-finger pan state
  const panStart = useRef<{ x: number; y: number } | null>(null);
  const isPanning = useRef(false);

  // Mouse drag-to-pan state (desktop)
  const mousePanStart = useRef<{ x: number; y: number } | null>(null);
  const isMousePanning = useRef(false);

  const getDistance = (touch1: React.Touch, touch2: React.Touch): number => {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getCenter = (touch1: React.Touch, touch2: React.Touch): { x: number; y: number } => {
    return {
      x: (touch1.clientX + touch2.clientX) / 2,
      y: (touch1.clientY + touch2.clientY) / 2,
    };
  };

  // Angle in radians between the line connecting two fingers and the x-axis.
  const getAngle = (touch1: React.Touch, touch2: React.Touch): number => {
    return Math.atan2(touch2.clientY - touch1.clientY, touch2.clientX - touch1.clientX);
  };

  // Smallest signed angle delta in [-PI, PI].
  const angleDelta = (a: number, b: number): number => {
    let d = a - b;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  };

  // Rotation past this threshold (~12°) suppresses center-tracking pan during
  // the pinch so the image doesn't drift while the user re-grips the screen.
  const ROTATION_LOCK_THRESHOLD = (12 * Math.PI) / 180;

  const onTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) {
      isPinching.current = true;
      // A second finger landed: cancel any single-finger pan immediately so a
      // pinch (especially one with rotation) is never treated as a pan.
      isPanning.current = false;
      panStart.current = null;
      initialDistance.current = getDistance(e.touches[0], e.touches[1]);
      initialScale.current = stateRef.current.scale;
      initialCenter.current = getCenter(e.touches[0], e.touches[1]);
      initialAngle.current = getAngle(e.touches[0], e.touches[1]);
      rotationLocked.current = false;
      lastTranslate.current = { x: stateRef.current.translateX, y: stateRef.current.translateY };
      // Always preventDefault — iOS would otherwise start its own page-zoom
      // / rotation gesture and steal the touch sequence.
      e.preventDefault();
    } else if (e.touches.length === 1 && stateRef.current.scale > 1 && !isPinching.current) {
      // Start single-finger pan when zoomed (and only if not mid-pinch)
      panStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      lastTranslate.current = { x: stateRef.current.translateX, y: stateRef.current.translateY };
      isPanning.current = true;
    }
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2 && initialDistance.current && isPinching.current) {
      // Always suppress the system gesture during a 2-finger interaction,
      // including when the user is mostly rotating rather than pinching.
      e.preventDefault();

      const currentDistance = getDistance(e.touches[0], e.touches[1]);
      const currentCenter = getCenter(e.touches[0], e.touches[1]);
      const currentAngle = getAngle(e.touches[0], e.touches[1]);

      // Detect rotation: once the rotation crosses the threshold we lock out
      // center-tracking pan for the rest of this gesture. This prevents the
      // image from sliding sideways as the user rotates their grip — a
      // common cause of "stuck pinch" complaints on iOS.
      if (initialAngle.current !== null && !rotationLocked.current) {
        const rot = Math.abs(angleDelta(currentAngle, initialAngle.current));
        if (rot > ROTATION_LOCK_THRESHOLD) {
          rotationLocked.current = true;
        }
      }

      const scaleRatio = currentDistance / initialDistance.current;
      let newScale = initialScale.current * scaleRatio;
      newScale = Math.min(Math.max(newScale, minScale), maxScale);

      let newTranslateX = lastTranslate.current.x;
      let newTranslateY = lastTranslate.current.y;

      if (initialCenter.current && !rotationLocked.current) {
        const centerDeltaX = currentCenter.x - initialCenter.current.x;
        const centerDeltaY = currentCenter.y - initialCenter.current.y;
        newTranslateX = lastTranslate.current.x + centerDeltaX;
        newTranslateY = lastTranslate.current.y + centerDeltaY;
      }

      if (newScale <= 1) {
        newTranslateX = 0;
        newTranslateY = 0;
      }

      setState({
        scale: newScale,
        translateX: newTranslateX,
        translateY: newTranslateY,
      });
    } else if (
      e.touches.length === 1 &&
      isPanning.current &&
      panStart.current &&
      !isPinching.current
    ) {
      e.preventDefault();
      const dx = e.touches[0].clientX - panStart.current.x;
      const dy = e.touches[0].clientY - panStart.current.y;
      setState({
        scale: stateRef.current.scale,
        translateX: lastTranslate.current.x + dx,
        translateY: lastTranslate.current.y + dy,
      });
    }
  }, [minScale, maxScale]);

  const onTouchEnd = useCallback((e?: TouchEvent | globalThis.TouchEvent) => {
    // Only finalize the gesture once ALL fingers have lifted. On iOS users
    // frequently lift one finger slightly before the other; resetting pinch
    // state on the first lift would discard a valid pinch and snap the
    // image back to 1× before the gesture truly ends.
    const remainingTouches = e && "touches" in e ? e.touches.length : 0;
    if (remainingTouches > 0) {
      // Pan state always clears (pan needs a fresh deliberate finger), but
      // we keep pinch refs alive so the staggered second-finger lift still
      // commits the in-progress pinch.
      panStart.current = null;
      isPanning.current = false;
      return;
    }

    initialDistance.current = null;
    initialCenter.current = null;
    initialAngle.current = null;
    rotationLocked.current = false;
    isPinching.current = false;
    panStart.current = null;
    isPanning.current = false;

    // Lower threshold (was 1.15) — gentle iOS pinches commonly land in the
    // 1.05–1.12 range and were being silently discarded, making zoom feel
    // unresponsive. Anything above ~5% scale change counts as intentional.
    if (stateRef.current.scale < 1.05) {
      setState({ scale: 1, translateX: 0, translateY: 0 });
    }
  }, []);

  // Mouse wheel zoom (desktop). Hold no modifier — wheel = zoom in/out.
  const onWheel = useCallback((e: WheelEvent) => {
    // Only intercept zoom-style wheel events (ctrl/cmd held = pinch trackpad).
    // For coaches on desktop, plain wheel = zoom feels natural inside the court.
    e.preventDefault();
    const delta = -e.deltaY * 0.002;
    const current = stateRef.current.scale;
    let next = current * (1 + delta);
    next = Math.min(Math.max(next, minScale), maxScale);
    if (next === current) return;
    if (next <= 1.001) {
      setState({ scale: 1, translateX: 0, translateY: 0 });
    } else {
      setState({
        scale: next,
        translateX: stateRef.current.translateX,
        translateY: stateRef.current.translateY,
      });
    }
  }, [minScale, maxScale]);

  // Mouse drag to pan when zoomed (desktop).
  const onMouseDown = useCallback((e: MouseEvent) => {
    if (stateRef.current.scale <= 1) return;
    if (e.button !== 0) return;
    mousePanStart.current = { x: e.clientX, y: e.clientY };
    lastTranslate.current = { x: stateRef.current.translateX, y: stateRef.current.translateY };
    isMousePanning.current = true;
  }, []);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!isMousePanning.current || !mousePanStart.current) return;
    const dx = e.clientX - mousePanStart.current.x;
    const dy = e.clientY - mousePanStart.current.y;
    setState({
      scale: stateRef.current.scale,
      translateX: lastTranslate.current.x + dx,
      translateY: lastTranslate.current.y + dy,
    });
  }, []);

  const onMouseUp = useCallback(() => {
    mousePanStart.current = null;
    isMousePanning.current = false;
  }, []);

  // Double-click toggles between 1× and 2.2× — fast desktop "zoom in here".
  const onDoubleClick = useCallback((_e: MouseEvent) => {
    if (stateRef.current.scale > 1) {
      setState({ scale: 1, translateX: 0, translateY: 0 });
    } else {
      setState({ scale: 2.2, translateX: 0, translateY: 0 });
    }
  }, []);

  const resetZoom = useCallback(() => {
    setState({ scale: 1, translateX: 0, translateY: 0 });
  }, []);

  const isPanningOrPinching = useCallback(() => {
    return (
      isPinching.current ||
      isPanning.current ||
      isMousePanning.current ||
      stateRef.current.scale > 1
    );
  }, []);

  return {
    scale: state.scale,
    translateX: state.translateX,
    translateY: state.translateY,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onWheel,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onDoubleClick,
    resetZoom,
    isPanningOrPinching,
  };
}
