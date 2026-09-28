import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import {
  VirtualizedChatMessageList,
  type VirtualizedChatMessageListHandle,
} from "@/components/chat/VirtualizedChatMessageList";
import { useViewportHeightSettled } from "@/hooks/useViewportHeightSettled";
import { markChatScrollWrite } from "@/lib/chatScrollWriteLock";
import { isChatJumpActive, setChatJumpActive } from "@/lib/chatJumpActive";
import { resolveChatScrollViewport } from "@/lib/chatScroll";
import { isViewportUserActive } from "@/lib/chatScrollIntent";
import { debugLogEvent } from "@/components/chat/chatVirtDebug";


/**
 * Shared scroller used by Team / Group / Club / Broadcast / ClubAdmin / DM
 * chat pages.
 *
 * Virtualisation is unconditional and end-to-end: react-virtuoso owns the
 * scroll container in normal viewing AND while search is active. Search
 * jump-to-message goes through `virtualHandleRef.current?.scrollToIndex(...)`
 * via `jumpToMessageInVirtualizedChat` — there is NO legacy mapped DOM and
 * no `document.getElementById('message-${id}')` lookup left.
 */
interface ChatMessagesScrollerProps<TMessage extends { id: string }> {
  messages: TMessage[];
  hasOlderMessages: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
  renderRow: (msg: TMessage, index: number, arr: TMessage[]) => ReactNode;

  // Layout / behaviour
  isPinned: boolean;
  isKeyboardOpen: boolean;
  searchOpen: boolean;
  composerHeight: number;
  currentUserId?: string | null;
  /** Disable the mount-time bottom pin when a deep-link jump owns first paint. */
  initialBottomPinned?: boolean;
  /** Message that should be mounted on first paint for notification/search jumps. */
  initialTargetMessageId?: string | null;

  /** Forwarded for parity with existing call sites; not used in virtual mode. */
  loadTriggerStyle?: CSSProperties;

  /**
   * Imperative handle. The parent owns it and uses it to drive
   * `scrollToBottom`, `scrollToIndex`, `isAtBottom`, `isNearBottom`. Search
   * jump-to-message uses `scrollToIndex` via this handle.
   */
  virtualHandleRef?: RefObject<VirtualizedChatMessageListHandle>;
}

function useDebouncedNumber(value: number, delayMs: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value);
      return;
    }
    if (Math.abs(value - debounced) <= 1) return;

    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [debounced, delayMs, value]);

  // With no delay, derive directly: routing through state + a passive effect
  // lags the composer height by a render (and potentially a paint), which is
  // exactly the footer/composer disagreement that steps the thread on send.
  return delayMs <= 0 ? value : debounced;
}

function useSettledChatMountBox(quietMs: number = 240) {
  const ref = useRef<HTMLDivElement>(null);
  const [settled, setSettled] = useState(false);
  const lastSizeRef = useRef({ width: 0, height: 0 });
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const arm = () => {
      clearTimer();
      timerRef.current = window.setTimeout(() => setSettled(true), quietMs);
    };

    const measure = (force = false) => {
      rafRef.current = null;
      const rect = element.getBoundingClientRect();
      const next = {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };

      if (next.width <= 0 || next.height <= 0) {
        clearTimer();
        setSettled(false);
        return;
      }

      const prev = lastSizeRef.current;
      const changed = Math.abs(next.width - prev.width) > 1 || Math.abs(next.height - prev.height) > 1;
      if (force || changed) {
        lastSizeRef.current = next;
        setSettled(false);
        arm();
      }
    };

    const onResize = () => {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(() => measure(false));
    };

    measure(true);

    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    observer?.observe(element);
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);

    return () => {
      clearTimer();
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [quietMs]);

  return { ref, settled };
}

function getChatComposerScope(host: HTMLElement | null) {
  return host?.closest('[data-lock-keyboard-scroll="true"]') ?? document;
}

function getActiveFixedChatComposers(scope: ParentNode = document) {
  if (typeof window === "undefined" || typeof document === "undefined") return [];

  return Array.from(scope.querySelectorAll<HTMLElement>('[data-chat-composer="true"]'))
    .filter((element) => {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (style.position !== "fixed") return false;

      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;

      // ChatHeaderShell also uses data-chat-chrome for overscroll locking, but
      // it is top chrome. Only bottom fixed chrome can cover the last message.
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || rect.bottom;
      return rect.top >= viewportHeight * 0.35;
    })
    // If a stale/outgoing chat page briefly co-exists during route transitions,
    // use the bottom-most composer inside this chat root rather than DOM order.
    .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
}

export function ChatMessagesScroller<TMessage extends { id: string }>(
  props: ChatMessagesScrollerProps<TMessage>,
) {
  const {
    messages,
    hasOlderMessages,
    isLoadingOlder,
    onLoadOlder,
    renderRow,
    isPinned,
    isKeyboardOpen,
    searchOpen,
    composerHeight,
    currentUserId,
    initialBottomPinned = true,
    initialTargetMessageId = null,
    virtualHandleRef: externalVirtualHandleRef,
  } = props;

  // Root cause: the composer is `position: fixed`, so it is not a flex sibling
  // and the message viewport can extend underneath it. The correct clearance is
  // NOT a guessed keyboard value: Android may resize the WebView, overlay the
  // keyboard, or do a partial hybrid depending on OEM/WebView. The only stable
  // source of truth is the rendered geometry: the distance from the message
  // area's bottom edge to the actual fixed composer's top edge.
  const LAST_MESSAGE_GAP = 32;
  const mountedAtRef = useRef<number>(performance.now());
  const INITIAL_MOUNT_QUIET_MS = 600;
  const [initialLayoutSettled, setInitialLayoutSettled] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => setInitialLayoutSettled(true), INITIAL_MOUNT_QUIET_MS);
    return () => window.clearTimeout(timeout);
  }, []);

  const layoutComposerHeight = useDebouncedNumber(
    composerHeight,
    !initialLayoutSettled && !isKeyboardOpen ? 180 : 0,
  );
  const safeComposer = Math.max(layoutComposerHeight, 56); // floor for first paint before measure
  const { ref: mountBoxRef, settled: mountBoxSettled } = useSettledChatMountBox(260);
  const [measuredBottomClearance, setMeasuredBottomClearance] = useState<number | null>(null);

  const syncBottomClearance = useCallback(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    if (searchOpen) {
      setMeasuredBottomClearance((current) => (current === 0 ? current : 0));
      return;
    }

    const host = mountBoxRef.current;
    const parent = host?.parentElement ?? host;
    if (!parent) {
      setMeasuredBottomClearance((current) => (current === safeComposer ? current : safeComposer));
      return;
    }

    const parentRect = parent.getBoundingClientRect();
    let composerRect: DOMRect | null = null;
    const composers = getActiveFixedChatComposers(getChatComposerScope(host));
    for (const composer of composers) {
      const rect = composer.getBoundingClientRect();
      composerRect = rect;
      break;
    }

    const measured = composerRect
      ? parentRect.bottom - composerRect.top
      : safeComposer;
    const maxUsefulClearance = Math.max(safeComposer, parentRect.height - 72);
    const next = Math.round(
      Math.min(
        Math.max(safeComposer, measured),
        maxUsefulClearance,
      ),
    );
    setMeasuredBottomClearance((current) => (current === next ? current : next));
  }, [mountBoxRef, safeComposer, searchOpen]);

  useLayoutEffect(() => {
    syncBottomClearance();

    const host = mountBoxRef.current;
    const parent = host?.parentElement ?? host;
    const composers = getActiveFixedChatComposers(getChatComposerScope(host));
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncBottomClearance) : null;
    if (parent) observer?.observe(parent);
    composers.forEach((composer) => observer?.observe(composer));

    window.addEventListener("resize", syncBottomClearance);
    window.visualViewport?.addEventListener("resize", syncBottomClearance);
    window.visualViewport?.addEventListener("scroll", syncBottomClearance);

    // Android keyboard + reply-preview transitions can update fixed-position
    // geometry after plugin events and ResizeObserver callbacks. Short trailing
    // reads keep the clearance tied to the actual composer top, not stale state.
    const timers = [80, 180, 360, 700].map((delay) => window.setTimeout(syncBottomClearance, delay));

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", syncBottomClearance);
      window.visualViewport?.removeEventListener("resize", syncBottomClearance);
      window.visualViewport?.removeEventListener("scroll", syncBottomClearance);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [composerHeight, isKeyboardOpen, mountBoxRef, syncBottomClearance]);

  const scrollerBottomClearance = searchOpen ? 0 : (measuredBottomClearance ?? safeComposer);
  const bottomPad = useMemo(
    () =>
      searchOpen
        ? 16
        : LAST_MESSAGE_GAP,
    [searchOpen],
  );

  const internalVirtualHandleRef = useRef<VirtualizedChatMessageListHandle>(null);
  const virtualHandleRef = externalVirtualHandleRef ?? internalVirtualHandleRef;
  const virtualScrollerElRef = useRef<HTMLElement | null>(null);

  // Virtuoso owns its own scroller; no external ref handover (legacy chat
  // hooks that mutated `scrollTop` directly are gone).
  const setVirtualScrollerRef = useCallback((element: HTMLElement | Window | null) => {
    virtualScrollerElRef.current = element instanceof HTMLElement ? element : null;
  }, []);

  // Wait for real data, visual viewport height, wrapper size, and composer
  // height to stop changing before mounting Virtuoso. If it mounts against an
  // interim height, its initial bottom-pin can visibly correct down/up/down.
  const viewportSettled = useViewportHeightSettled(180);
  const [initialViewportReleased, setInitialViewportReleased] = useState(false);
  // Hold the reveal until the composer has reported a real measured height.
  // Previously `initialLayoutSettled` (a fixed 600ms) short-circuited this to
  // true even when `composerHeight` was still 0, so Virtuoso mounted with an
  // under-sized `bottomPadding` (the 56px floor in `safeComposer`) and the
  // initial bottom pin landed the latest bubble behind the composer. Once the
  // composer subsequently measured (~80–100px), the late `bottomPadding`
  // growth was past the reveal point and the post-pin guard's >24px no-snap
  // rule left the last message clipped — exactly the push-landing report.
  //
  // New rule: composer is "settled" only when its reported height matches the
  // debounced value AND is > 0. Fall back to the legacy timeout-based settle
  // only when the composer has been absent for the entire `initialLayoutSettled`
  // window (chat surfaces without a composer, e.g. read-only previews).
  const composerHasMeasured = composerHeight > 0 && Math.abs(layoutComposerHeight - composerHeight) <= 1;
  const initialComposerSettled = isKeyboardOpen
    || composerHasMeasured
    || (initialLayoutSettled && composerHeight === 0);
  const initialMountReady = viewportSettled && mountBoxSettled && initialComposerSettled;
  const virtualReady = messages.length > 0 && (initialMountReady || initialViewportReleased);

  useEffect(() => {
    if (messages.length === 0) {
      // Do NOT reset `initialViewportReleased` here — once the list has been
      // mounted, transient messages.length===0 frames (cache reseed, refetch
      // window collapse) would otherwise flip the inner-render gate to false,
      // unmount VirtualizedChatMessageList, and visibly jolt the chat back to
      // bottom a few seconds after the user finishes scrolling.
      return;
    }
    if (messages.length > 0 && initialMountReady) {
      setInitialViewportReleased(true);
    }
  }, [initialMountReady, messages.length]);

  // Latch the inner gate: once the list has been mounted for real, we must
  // never unmount it for transient ready-state changes (ResizeObserver-driven
  // mountBoxSettled flips, viewportSettled debounces after scroll, briefly
  // empty `messages` during cache reseed). Unmounting drops Virtuoso's scroll
  // position and forces a re-pin to bottom — the visible "jolt after stop"
  // bug. Once true, it stays true for the lifetime of this scroller instance.
  const hasMountedListRef = useRef(false);
  if (!hasMountedListRef.current && (messages.length === 0 || virtualReady)) {
    hasMountedListRef.current = true;
  }

  // Diagnostics: scroller component lifecycle
  useEffect(() => {
    debugLogEvent("scroller-mount", { messagesLen: messages.length });
    return () => debugLogEvent("scroller-unmount", { messagesLen: messages.length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Diagnostics: track when the inner gate (messages.length===0 || virtualReady) flips
  const prevGateRef = useRef<boolean | null>(null);
  const innerGate = messages.length === 0 || virtualReady;
  useEffect(() => {
    if (prevGateRef.current !== null && prevGateRef.current !== innerGate) {
      debugLogEvent("inner-gate-flip", {
        from: prevGateRef.current,
        to: innerGate,
        messagesLen: messages.length,
        virtualReady,
        initialMountReady,
        initialViewportReleased,
        viewportSettled,
        mountBoxSettled,
        initialComposerSettled,
      });
    }
    prevGateRef.current = innerGate;
  }, [innerGate, messages.length, virtualReady, initialMountReady, initialViewportReleased, viewportSettled, mountBoxSettled, initialComposerSettled]);

  // Diagnostics: track significant messages.length drops at the scroller level
  const prevMessagesLenRef = useRef(messages.length);
  useEffect(() => {
    const prev = prevMessagesLenRef.current;
    if (messages.length < prev - 5) {
      debugLogEvent("scroller-messages-shrink", { prev, next: messages.length });
    }
    prevMessagesLenRef.current = messages.length;
  }, [messages.length]);

  // Open-time auto-adjustment is intentionally OFF. Virtuoso's own
  // `initialTopMostItemIndex={LAST}` + initialBottomPinned already lands the
  // chat at the bottom on first paint, and `ChatMessagesScroller` holds the
  // wrapper at opacity:0 until the visual viewport + composer height have
  // settled. Any parent-driven `scrollToBottom` after that just re-pins
  // against an already-pinned list and reads as content bouncing.
  //
  // We still react to POST-MOUNT transitions of `isKeyboardOpen` and to a
  // reply/edit composer growth, because in those cases the viewport shrinks
  // out from under the latest message and the user expects it to stay
  // visible. Mount-time changes to these values are ignored via the quiet
  // window. We do NOT re-pin on `lastMessageId` / `virtualReady` / `bottomPad`
  // changes — Virtuoso's `followOutput` covers new appends when at-bottom.
  const prevKeyboardOpenRef = useRef(isKeyboardOpen);
  const prevComposerHeightRef = useRef(composerHeight);
  const prevBottomClearanceRef = useRef(scrollerBottomClearance);
  const wasNearBottomBeforeLayoutRef = useRef(initialBottomPinned);
  useEffect(() => {
    // NOTE: do NOT early-return on `!virtualReady` here. On Android the
    // keyboard can open (focus the composer / tap Reply) while Virtuoso is
    // still in its initial settle window. Silently updating the prev refs
    // and bailing would swallow the false→true keyboard transition and the
    // composer-grew transition, so no re-pin ever fires and the latest
    // message stays clipped behind the composer. We rely on the
    // `virtualHandleRef.current` null check below to skip work safely until
    // the list has mounted.
    
    const handle = virtualHandleRef.current;
    if (!handle) return;
    // Initial-mount quiet window: let Virtuoso's own bottom pin own first
    // paint without ANY parent-driven re-snaps — UNLESS the user has already
    // activated the composer (focus → soft keyboard, or reply/edit pill
    // grew the composer). On Android the keyboard can open within the same
    // 600ms window (e.g. composer auto-focus on entry), and silently
    // updating the prev refs here would swallow the false→true transition,
    // so the latest message would stay clipped behind the composer with no
    // re-pin ever firing.
    const withinMountQuiet = performance.now() - mountedAtRef.current < INITIAL_MOUNT_QUIET_MS;
    const keyboardJustOpened = !prevKeyboardOpenRef.current && isKeyboardOpen;
    const composerJustGrew = composerHeight - prevComposerHeightRef.current > 4;
    if (withinMountQuiet && !keyboardJustOpened && !composerJustGrew) {
      prevKeyboardOpenRef.current = isKeyboardOpen;
      prevComposerHeightRef.current = composerHeight;
      return;
    }

    const keyboardChanged = prevKeyboardOpenRef.current !== isKeyboardOpen;
    const previousComposerHeight = prevComposerHeightRef.current;
    const previousBottomClearance = prevBottomClearanceRef.current;
    const composerGrew = composerHeight - previousComposerHeight > 4;
    const bottomClearanceChanged = Math.abs(scrollerBottomClearance - previousBottomClearance) > 4;
    const bottomClearanceGrew = scrollerBottomClearance - previousBottomClearance > 4;
    prevKeyboardOpenRef.current = isKeyboardOpen;
    prevComposerHeightRef.current = composerHeight;
    prevBottomClearanceRef.current = scrollerBottomClearance;

    if (!keyboardChanged && !composerGrew && !bottomClearanceChanged) return;

    // When the user activates the composer (keyboard opens) or the composer
    // grows (reply pill, multi-line input), they have signalled intent to
    // reply — release any in-flight notification/search jump so the keyboard
    // compensator can pin the latest message above the input area. The jump
    // landing has already served its purpose by this point.
    if ((keyboardChanged && isKeyboardOpen) || composerGrew) {
      if (isChatJumpActive()) setChatJumpActive(false);
    }

    // A notification/search deep-link owns the viewport until the user
    // explicitly activates the composer/reply UI. Before that, never issue a
    // generic `scrollToBottom()` because it races the target-message
    // `scrollToIndex`; after activation, the user's intent has changed to
    // replying, so the latest message should be pinned above the keyboard.
    const composerActivated = (keyboardChanged && isKeyboardOpen) || composerGrew;

    // When the user is scrolled UP reading history and the composer grows
    // (multi-line typing, reply pill), the fixed composer covers more of the
    // visible content. The scroll viewport itself doesn't resize (composer is
    // position: fixed and overlays the scroller), so the bottommost visible
    // message slides UNDER the composer. Compensate by shifting scrollTop
    // down by the same delta — the content the user was reading stays put
    // above the composer's new top edge. Don't do this when at/near bottom:
    // the pin-to-bottom branch below already handles that case.
    if ((composerGrew || bottomClearanceGrew) && previousComposerHeight > 0) {
      const delta = Math.max(
        composerHeight - previousComposerHeight,
        scrollerBottomClearance - previousBottomClearance,
      );
      const handleNearBottom = handle.isNearBottom(180);
      if (!handleNearBottom) {
        const viewport = virtualScrollerElRef.current ?? resolveChatScrollViewport(mountBoxRef.current);
        if (viewport) {
          viewport.scrollTop = viewport.scrollTop + delta;
          markChatScrollWrite();
        }
      }
    }




    if (!initialBottomPinned && !composerActivated) return;

    const wasNearBottom = handle.isNearBottom(180);
    const shouldPreserveBottom =
      wasNearBottom ||
      wasNearBottomBeforeLayoutRef.current ||
      (keyboardChanged && handle.isNearBottom(720)) ||
      (bottomClearanceChanged && handle.isNearBottom(720)) ||
      composerActivated;
    if (!composerGrew && !shouldPreserveBottom) return;
    // The scroll compensation above already keeps the visible content stable
    // for users scrolled up reading history; skip the pin-to-bottom branch in
    // that case so we don't yank them to the latest message.
    if ((composerGrew || bottomClearanceGrew) && !wasNearBottom && !wasNearBottomBeforeLayoutRef.current && !keyboardChanged) return;

    const pin = () => {
      if (isChatJumpActive()) return;
      handle.scrollToBottom("auto", { force: composerActivated });
      markChatScrollWrite();
    };
    pin();
    // Reply banners and mobile keyboards both resize the fixed composer in
    // stages; keep re-pinning while that animation settles so the latest
    // bubble remains above the input instead of underneath it.
    const timers = [120, 280, 520].map((delay) =>
      window.setTimeout(() => {
        if (handle.isNearBottom(240) || composerGrew) pin();
      }, delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));

  }, [virtualReady, isKeyboardOpen, composerHeight, scrollerBottomClearance, virtualHandleRef, initialBottomPinned]);

  // Belt-and-braces: re-pin to bottom on ANY composer height change (even
  // sub-4px growths) while the user is near the bottom. The main effect above
  // only fires on >4px growths and can miss the case where the composer grows
  // in small steps during typing (mid-line wrap reflows, predictive-text bar
  // toggles), letting the latest message drift behind the input.
  const lastPinComposerHeightRef = useRef(composerHeight);
  useEffect(() => {
    if (!virtualReady) return;
    const handle = virtualHandleRef.current;
    if (!handle) return;
    const prev = lastPinComposerHeightRef.current;
    lastPinComposerHeightRef.current = composerHeight;
    if (composerHeight <= prev) return; // only react to growth
    if (!handle.isNearBottom(240)) return;
    // Two rAFs: let Virtuoso apply the new bottomPadding (Footer height) before
    // we ask it to re-align LAST to "end", otherwise we scroll against stale
    // layout and the last bubble still lands under the composer.
    const r1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (isChatJumpActive()) return;
        handle.scrollToBottom("auto", { force: true });
        markChatScrollWrite();
      });
    });
    return () => cancelAnimationFrame(r1);
  }, [composerHeight, virtualReady, virtualHandleRef]);

  // Belt-and-braces #2: when the keyboard opens OR a new last message arrives
  // while near the bottom, force a re-pin using the CURRENT bottomPadding.
  // Virtuoso's `followOutput` can miss the append if the atBottom check reads
  // stale scrollTop the moment the visual viewport shrinks (keyboard opening
  // and message arrival in the same frame on Android). This effect covers
  // the case where the main pin effect updated its prev-refs during the
  // mount-quiet window and no re-pin ever fires — the report symptom being
  // the newest incoming bubble body sitting behind the composer after tap.
  // Seed with the current tail. The first populated render establishes the
  // baseline; it is not a newly-arrived message and must not schedule the
  // 120/280/520/900ms post-reveal pin sequence.
  const lastKnownLastIdRef = useRef<string | null>(
    messages.length > 0 ? messages[messages.length - 1]?.id ?? null : null,
  );
  const lastKnownKbRef = useRef(isKeyboardOpen);
  useEffect(() => {
    if (!virtualReady) return;
    const handle = virtualHandleRef.current;
    if (!handle) return;
    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
    const lastId = lastMessage?.id ?? null;
    const lastChanged = lastId !== lastKnownLastIdRef.current;
    const kbChanged = lastKnownKbRef.current !== isKeyboardOpen;
    lastKnownLastIdRef.current = lastId;
    lastKnownKbRef.current = isKeyboardOpen;
    if (!lastChanged && !kbChanged) return;
    // Distinguish the user's OWN optimistic append (an explicit intent change —
    // they just hit send) from an INCOMING message written by someone else.
    // Only the own-send case may use the generous tolerance + `force`. On a
    // cold open with an unread message arriving, the incoming path used to run
    // with tolerance 800 + force, which routes the guard through the
    // touch-only `isViewportTouching` check — so a scroll-up whose finger had
    // already lifted (or a wheel gesture) was invisible and the user got
    // yanked straight back to the newest message for ~1s after open.
    const ownAppend =
      !!currentUserId &&
      (lastMessage as { author_id?: string | null } | null)?.author_id === currentUserId;
    // When a new last message arrives from the current user, use a generous
    // tolerance: the row grows AFTER the initial pin as the read-frontier +
    // timestamp hydrate, which can push `isNearBottom` past the tight 360px
    // threshold for a frame. Missing the pin in that window leaves the sent
    // bubble behind the composer (user report 2026-07-10).
    const tolerance = lastChanged ? (ownAppend ? 800 : 240) : 360;
    if (!handle.isNearBottom(tolerance)) return;
    // Incoming messages and mere keyboard toggles must never override a live
    // user scroll: drop `force` so the handle uses the wheel-aware,
    // 600ms-cooldown `isViewportUserActive` guard.
    const force = ownAppend || kbChanged;
    const userIsScrolling = () => {
      if (force) return false;
      const viewport = virtualScrollerElRef.current ?? resolveChatScrollViewport(mountBoxRef.current);
      return !!viewport && isViewportUserActive(viewport as HTMLElement);
    };
    const pin = () => {
      if (isChatJumpActive()) return;
      if (userIsScrolling()) return;
      handle.scrollToBottom("auto", { force });
      markChatScrollWrite();
    };
    // Two rAFs first so bottomPadding (Footer) has flushed, then belt-and-
    // braces at 120/280/520/900ms to cover reply-pill / typing-indicator
    // growth AND the read-frontier hydration that can trail 500–800ms behind
    // the optimistic message append on slower Android devices.
    const r1 = requestAnimationFrame(() => {
      requestAnimationFrame(pin);
    });
    const timers = [120, 280, 520, 900].map((delay) =>
      window.setTimeout(() => {
        if (handle.isNearBottom(tolerance)) pin();
      }, delay),
    );
    return () => {
      cancelAnimationFrame(r1);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [messages, isKeyboardOpen, virtualReady, virtualHandleRef, currentUserId]);



  // Stable renderer identity — recreating it on every parent re-render
  // invalidates Virtuoso's `itemContent` and forces every visible row tree to
  // re-evaluate (defeats `memo` on ChatMessage). `renderRow` is captured by
  // ref so the parent's per-render closure changes don't churn this.
  const renderRowRef = useRef(renderRow);
  renderRowRef.current = renderRow;
  const renderVirtualRow = useCallback(
    (msg: TMessage, index: number, arr: TMessage[]) => (
      // `contain: layout` isolates each row's layout from siblings (so an
      // image decode or reaction update can't reflow the whole list and force
      // Virtuoso to chase with a paddingTop adjustment mid-scroll). We
      // intentionally do NOT add `paint` / `strict` / `content` here — those
      // would establish a containing block for `position: fixed` descendants,
      // which clips the FullscreenImageViewer to a single row instead of the
      // viewport when a chat image is tapped.
      // `data-message-id` is consumed by the e2e regression spec to assert
      // row order and per-row avatar containment under fast upward scroll.
      <div
        className="px-4 pt-4"
        data-message-id={msg.id}
        data-chat-row="true"
        style={{ contain: "layout" }}
      >
        {renderRowRef.current(msg, index, arr)}
      </div>
    ),
    [],
  );

  return (
    <div
      ref={mountBoxRef}
      className="flex-1 min-h-0 overflow-hidden"
      data-chat-virtualized="true"
      style={{ marginBottom: scrollerBottomClearance }}
    >
      {messages.length === 0 || virtualReady || hasMountedListRef.current ? (
        <VirtualizedChatMessageList
          ref={virtualHandleRef}
          messages={messages}
          hasOlder={hasOlderMessages}
          isLoadingOlder={isLoadingOlder}
          onLoadOlder={onLoadOlder}
          renderItem={renderVirtualRow}
          topPadding={0}
          bottomPadding={bottomPad}
          onAtBottomChange={(atBottom) => {
            wasNearBottomBeforeLayoutRef.current = atBottom;
          }}
          scrollerRef={setVirtualScrollerRef}
          initialBottomPinned={initialBottomPinned && (virtualReady || isPinned)}
          initialTargetMessageId={initialTargetMessageId}
          currentUserId={currentUserId}
        />
      ) : null}
    </div>
  );
}
