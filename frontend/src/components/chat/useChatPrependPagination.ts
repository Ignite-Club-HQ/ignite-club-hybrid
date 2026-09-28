import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { debugLogEvent, debugLogStartReached } from "./chatVirtDebug";
import { isViewportTouching, isViewportUserActive } from "@/lib/chatScrollIntent";
import {
  markPrependUserInput,
  markPrependUpwardMotion,
  setPrependVirtuosoScrolling,
  isPrependUserDrivenScrollActive,
} from "./useDeferChatPrepends";

type PrependPaginationDeps = {
  messagesLength: number;
  messagesLengthRef: MutableRefObject<number>;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
  scrollerElRef: MutableRefObject<HTMLElement | null>;
  bottomPinReadyRef: MutableRefObject<boolean>;
  bottomPinReadyAtRef: MutableRefObject<number>;
  userHasScrolledAfterPinRef: MutableRefObject<boolean>;
};

export function useChatPrependPagination({
  messagesLength,
  messagesLengthRef,
  hasOlder,
  isLoadingOlder,
  onLoadOlder,
  scrollerElRef,
  bottomPinReadyRef,
  bottomPinReadyAtRef,
  userHasScrolledAfterPinRef,
}: PrependPaginationDeps) {
  const PREPEND_TRUST_WINDOW_MS = 800;
  const loadingOlderInFlightRef = useRef(false);
  const lastObservedScrollTopRef = useRef<number | null>(null);
  const lastUserUpwardScrollAtRef = useRef(0);
  const PREPEND_USER_SCROLL_ACTIVE_MS = 100;
  const PREPEND_COOLDOWN_MS = 600;
  const lastPrependLandedAtRef = useRef(0);

  const hasRecentUserUpwardScroll = useCallback(() => {
    if (performance.now() - lastUserUpwardScrollAtRef.current <= PREPEND_USER_SCROLL_ACTIVE_MS) {
      return true;
    }
    const el = scrollerElRef.current;
    if (el && el.scrollTop <= 4 && isViewportTouching(el)) return true;
    return false;
  }, [scrollerElRef]);

  useEffect(() => {
    if (messagesLength > messagesLengthRef.current) {
      loadingOlderInFlightRef.current = false;
      lastPrependLandedAtRef.current = performance.now();
    }
    if (messagesLength < messagesLengthRef.current - 5) {
      debugLogEvent("window-shrink", {
        prevLen: messagesLengthRef.current,
        nextLen: messagesLength,
      });
    }
    messagesLengthRef.current = messagesLength;
  }, [messagesLength, messagesLengthRef]);

  useEffect(() => {
    debugLogEvent("list-mount", { messagesLen: messagesLengthRef.current });
    return () => {
      debugLogEvent("list-unmount", { messagesLen: messagesLengthRef.current });
    };
  }, [messagesLengthRef]);

  const prevIsLoadingOlderRef = useRef(isLoadingOlder);
  useEffect(() => {
    if (prevIsLoadingOlderRef.current && !isLoadingOlder) {
      loadingOlderInFlightRef.current = false;
      lastPrependLandedAtRef.current = performance.now();
    }
    prevIsLoadingOlderRef.current = isLoadingOlder;
  }, [isLoadingOlder]);

  const handleStartReached = useCallback(() => {
    if (!bottomPinReadyRef.current) {
      debugLogStartReached(false, "bottom-pin-not-ready");
      return;
    }
    const sincePin = performance.now() - bottomPinReadyAtRef.current;
    const userInitiatedTopReach = hasRecentUserUpwardScroll();
    if (sincePin < PREPEND_TRUST_WINDOW_MS) {
      debugLogStartReached(false, "trust-window-suppressed");
      return;
    }
    if (!userInitiatedTopReach) {
      debugLogStartReached(false, "no-user-scroll");
      return;
    }
    if (!hasOlder) {
      debugLogStartReached(false, "no-older");
      return;
    }
    if (isLoadingOlder) {
      debugLogStartReached(false, "already-loading");
      return;
    }
    if (loadingOlderInFlightRef.current) {
      debugLogStartReached(false, "in-flight-guard");
      return;
    }
    const sinceLastPrepend = performance.now() - lastPrependLandedAtRef.current;
    if (
      lastPrependLandedAtRef.current > 0 &&
      sinceLastPrepend < PREPEND_COOLDOWN_MS
    ) {
      debugLogStartReached(false, "cooldown-suppressed");
      return;
    }
    loadingOlderInFlightRef.current = true;
    debugLogStartReached(true, "fetch");
    onLoadOlder();
  }, [bottomPinReadyRef, bottomPinReadyAtRef, hasRecentUserUpwardScroll, hasOlder, isLoadingOlder, onLoadOlder]);

  useEffect(() => {
    const el = scrollerElRef.current;
    if (!el) return;

    let lastTouchY: number | null = null;
    let frame: number | null = null;
    const requestEdgeLoad = () => {
      markPrependUpwardMotion({ explicitGesture: true });
      lastUserUpwardScrollAtRef.current = performance.now();
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (scrollerElRef.current && scrollerElRef.current.scrollTop <= 8) handleStartReached();
      });
    };
    const onTouchStart = (event: TouchEvent) => {
      markPrependUserInput();
      lastTouchY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      markPrependUserInput();
      const y = event.touches[0]?.clientY ?? null;
      if (y === null || lastTouchY === null) {
        lastTouchY = y;
        return;
      }
      const deltaY = y - lastTouchY;
      lastTouchY = y;
      if (deltaY > 3 && el.scrollTop <= 8) requestEdgeLoad();
    };
    const onWheel = (event: WheelEvent) => {
      markPrependUserInput();
      if (event.deltaY < -3 && el.scrollTop <= 8) requestEdgeLoad();
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("wheel", onWheel);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [handleStartReached, scrollerElRef]);

  const atTopRafRef = useRef<number | null>(null);
  const handleAtTopStateChange = useCallback(
    (atTop: boolean) => {
      if (!atTop) return;
      if (!hasRecentUserUpwardScroll()) return;
      if (atTopRafRef.current !== null) return;
      atTopRafRef.current = requestAnimationFrame(() => {
        atTopRafRef.current = null;
        handleStartReached();
      });
    },
    [handleStartReached, hasRecentUserUpwardScroll],
  );

  const handleScroll = useCallback(() => {
    if (!bottomPinReadyRef.current) return;
    const el = scrollerElRef.current;
    const currentTop = el?.scrollTop ?? 0;
    const previousTop = lastObservedScrollTopRef.current;
    lastObservedScrollTopRef.current = currentTop;
    const userDrivenScroll = isViewportUserActive(el) || isPrependUserDrivenScrollActive();
    if (!userDrivenScroll) return;
    if (previousTop !== null && currentTop < previousTop - 2) {
      markPrependUpwardMotion();
      lastUserUpwardScrollAtRef.current = performance.now();
    }
    userHasScrolledAfterPinRef.current = true;
  }, [bottomPinReadyRef, scrollerElRef, userHasScrolledAfterPinRef]);

  const handleIsScrollingChange = useCallback((scrolling: boolean) => {
    setPrependVirtuosoScrolling(scrolling);
  }, []);

  return {
    handleStartReached,
    handleAtTopStateChange,
    handleScroll,
    handleIsScrollingChange,
  };
}
