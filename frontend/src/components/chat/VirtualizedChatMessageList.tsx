import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  debugAttachScrollerWatcher,
  debugLogAnchor,
  debugLogBottomPin,
  debugLogDuplicate,
  debugLogEvent,
  debugLogFirstItemIndex,
  isChatVirtDebugEnabled,
} from "./chatVirtDebug";
import { prefetchChatImageAspectRatio } from "@/lib/chatImageAspectCache";
import {
  installChatScrollIntentTracking,
  isViewportUserActive,
} from "@/lib/chatScrollIntent";
import { BasicChatMessageList } from "./BasicChatMessageList";
import { useChatVirtualizationEnabled } from "@/hooks/useChatVirtualizationEnabled";
import { isChatJumpActive, setChatJumpActive, subscribeChatJumpActive } from "@/lib/chatJumpActive";
import { isRecentChatScrollWrite, markChatScrollWrite } from "@/lib/chatScrollWriteLock";
import { waitForChatVisualContentSettle } from "@/lib/chatInitialVisualSettle";
import { waitForChatJumpTargetReveal } from "@/lib/chatJumpReveal";
import { chatJumpLifecycleRemaining, getChatJumpLifecycle } from "@/lib/chatJumpLifecycle";

import { getChatBottomPaddingOffset } from "@/lib/chatBottomPadding";
import { createChatRowSignature } from "./chatRowSignature";
import {
  useDeferPrependsWhileScrolling,
  setPrependScrollerElementGetter,
} from "./useDeferChatPrepends";
import {
  ChatRowAdapter,
  ChatVirtuosoFooter,
  ChatVirtuosoHeader,
  ChatVirtuosoItem,
  ChatVirtuosoScroller,
  JumpHydrationSkeleton,
  type ChatVirtuosoContext,
} from "./chatVirtuosoRows";
import { useChatScrollActions } from "./useChatScrollActions";
import { useChatPrependPagination } from "./useChatPrependPagination";
import { useChatBottomFollow } from "./useChatBottomFollow";
import { useChatJumpAnchor } from "./useChatJumpAnchor";

/**
 * Virtualised chat message list.
 *
 * Drop-in replacement for the legacy mapped list used by chat pages, gated
 * behind the `ff:chat-virtualization` feature flag. Designed so the parent's
 * pagination, message data, and per-row JSX stay unchanged.
 *
 * Behaviour parity:
 *  - Mounts pinned to latest message (no upward jolt on cold open).
 *  - Upward infinite pagination via `startReached` (replaces the
 *    IntersectionObserver in `useChatOlderMessagesAnchor`).
 *  - Exact scroll anchor on prepend via virtuoso's `firstItemIndex` shift.
 *  - Auto-scroll to bottom only when the user is already at bottom; while
 *    reading history the parent shows its existing "new message" indicator.
 *  - Stable keys (`computeItemKey`) so reaction/edit updates don't churn
 *    neighbouring rows.
 *  - 1200px upward overscan matches existing prefetch margin.
 *
 * The component intentionally takes a `renderItem(message, index, arr)`
 * function so each chat page can keep its bespoke per-row JSX (date
 * separators, highlight ring, ChatMessage props) without duplication.
 */

export interface VirtualizedChatMessageListHandle {
  scrollToBottom: (behavior?: "auto" | "smooth", options?: { force?: boolean }) => void;
  scrollToIndex: (index: number, align?: "start" | "center" | "end") => void;
  scrollToMessageId: (messageId: string, align?: "start" | "center" | "end") => boolean;
  isAtBottom: () => boolean;
  /**
   * True when the scroller is within `thresholdPx` of the bottom. Used by
   * chat pages to decide whether composer/keyboard reflow should re-pin to
   * the latest message. Returns true if the scroller has not mounted yet
   * (matches the "default to pinning" semantics of the legacy helper).
   */
  isNearBottom: (thresholdPx: number) => boolean;
}

interface Props<TMessage extends { id: string }> {
  messages: TMessage[];
  hasOlder: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
  renderItem: (message: TMessage, index: number, arr: TMessage[]) => React.ReactNode;
  /** Padding above the first message (e.g. for the "load older" spinner). */
  topPadding?: number;
  /** Padding below the last message (typically composer + safe-area). */
  bottomPadding?: number | string;
  className?: string;
  style?: React.CSSProperties;
  /** Notified on at-bottom transitions so the parent can drive its FAB. */
  onAtBottomChange?: (atBottom: boolean) => void;
  /** Exposes Virtuoso's real scroll element to legacy chat scroll hooks. */
  scrollerRef?: (element: HTMLElement | Window | null) => void;
  /** Parent's initial-pin state; prevents reveal before legacy pin completed. */
  initialBottomPinned?: boolean;
  /** Mount this message in view immediately for exact notification jumps. */
  initialTargetMessageId?: string | null;
  /** Current user id, used only for row-height estimates (own messages have no author label). */
  currentUserId?: string | null;
}


function VirtualizedChatMessageListInner<TMessage extends { id: string }>(
  {
    messages: messagesProp,
    hasOlder,
    isLoadingOlder,
    onLoadOlder,
    renderItem,
    topPadding = 16,
    bottomPadding = 16,
    className,
    style,
    onAtBottomChange,
    scrollerRef,
    initialBottomPinned = true,
    initialTargetMessageId = null,
    currentUserId,
  }: Props<TMessage>,
  ref: React.Ref<VirtualizedChatMessageListHandle>,
) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  // Expose this scroller to the module-level prepend gate so it can check
  // whether a finger is currently on the glass before committing a held page.
  useEffect(() => {
    setPrependScrollerElementGetter(() => scrollerElRef.current);
    return () => {
      setPrependScrollerElementGetter(null);
    };
  }, []);
  // Prepended history pages are held until the scroll gesture goes idle so
  // Virtuoso's paddingTop correction never fires mid-flick. `messages` below
  // is the committed array — the rest of the body operates on it unchanged.
  const messages = useDeferPrependsWhileScrolling(messagesProp);
  const atBottomRef = useRef(true);
  const bottomPinReadyRef = useRef(false);
  const pinnedRevisionRef = useRef<number | null>(null);
  // Tracks which revision currently has an in-flight pin sequence
  // (immediate → raf1 → raf2 → stabilisation). Without this, the
  // depless useLayoutEffect below re-fires `jump("immediate")` on
  // every parent re-render that occurs during the 320ms stabilisation
  // window (Virtuoso paddingTop measurements cause many such renders),
  // flooding telemetry and re-yanking scrollTop.
  const pinAttemptRevisionRef = useRef<number | null>(null);
  const [initialRevealReady, setInitialRevealReady] = useState(false);
  // Timestamp of when the initial bottom-pin completed. Used to enforce a
  // "trust window" before any upward pagination fires, so the very first
  // upward gesture never triggers a prepend that visually teleports the
  // viewport to messages the user hasn't scrolled through yet (the
  // "scroll up, stop, then jump higher" symptom on cold open).
  const bottomPinReadyAtRef = useRef(0);
  const userHasScrolledAfterPinRef = useRef(false);
  // Fresh-login / cold-open safety net: cached messages can mount first, then
  // the fresh query appends the real latest row a moment later. Track the
  // opening window so those first data swaps keep landing on the latest row,
  // unless the user has deliberately started reading history.
  const openPinStartedAtRef = useRef<number | null>(null);
  const openPinLastMessageIdRef = useRef<string | null>(null);
  // Tracks the messages.length seen by the cold-open re-pin guard so it can
  // detect cached→fresh page swaps where lastMessageId is unchanged but
  // older rows get extended/replaced (which still shifts the bottom row).
  const openPinMessagesLengthRef = useRef<number>(-1);
  // Trust window in ms: until this elapses past the bottom-pin completion,
  // `startReached` is suppressed. After expiry, normal upward prefetch
  // resumes.
  const PREPEND_TRUST_WINDOW_MS = 800;
  const messagesLengthRef = useRef(messages.length);
  const {
    handleStartReached,
    handleAtTopStateChange,
    handleScroll,
    handleIsScrollingChange,
  } = useChatPrependPagination({
    messagesLength: messages.length,
    messagesLengthRef,
    hasOlder,
    isLoadingOlder,
    onLoadOlder,
    scrollerElRef,
    bottomPinReadyRef,
    bottomPinReadyAtRef,
    userHasScrolledAfterPinRef,
  });


  // Virtuoso's anchored-prepend trick: keep `firstItemIndex` tied to the
  // message that was first visible when this data set was established. This
  // is deterministic for a given `messages` array: prepends move the base
  // message to a larger data index, so we subtract that offset; appends do not
  // move it, so the first item index stays unchanged. The previous incremental
  // ref-diff approach could still double-shift under aborted/concurrent renders
  // and produced duplicate rows / shake after fast scrolls.
  const START_INDEX = 1_000_000;
  const newFirstId = messages[0]?.id ?? null;
  const wasEmptyRef = useRef(messages.length === 0);
  const [bottomPinRevision, setBottomPinRevision] = useState(0);
  const lastMessageId = messages[messages.length - 1]?.id ?? null;
  const anchorRef = useRef<{ baseFirstId: string | null; baseFirstIndex: number }>({
    baseFirstId: newFirstId,
    baseFirstIndex: START_INDEX - messages.length,
  });

  // Pure derivation — no ref mutations during render. Anchor reset (when the
  // baseFirstId is no longer in the data) is moved into a layout effect below
  // so StrictMode / concurrent re-renders cannot double-fire it mid-scroll
  // and snap the viewport while the user is reading history.
  // NOTE: anchor math is computed against the raw `messages` array (not the
  // de-duped one) because the parent's pagination merges land here first; if
  // a duplicate ever slips in we still want the FIRST occurrence (index 0)
  // to be the anchor, which matches `uniqueMessages[0]`.
  const baseFirstId = anchorRef.current.baseFirstId;
  // Memoise the O(n) anchor lookup. Without this it runs on every parent
  // render (200+ comparisons on a typical chat) and during a prepend +
  // Virtuoso measurement burst it can fire 20-40×/s, adding pure main-thread
  // jank to the fast-scroll budget.
  const baseOffset = useMemo(() => {
    if (messages.length === 0) return 0;
    if (!baseFirstId) return -1;
    return messages.findIndex((message) => message.id === baseFirstId);
  }, [messages, baseFirstId]);
  const needsAnchorReset = messages.length > 0 && (!baseFirstId || baseOffset === -1);
  const effectiveBaseIndex = needsAnchorReset
    ? START_INDEX - messages.length
    : anchorRef.current.baseFirstIndex;
  const effectiveBaseOffset = needsAnchorReset ? 0 : Math.max(0, baseOffset);
  const firstItemIndex = effectiveBaseIndex - effectiveBaseOffset;
  const firstItemIndexRef = useRef(firstItemIndex);
  firstItemIndexRef.current = firstItemIndex;
  wasEmptyRef.current = messages.length === 0;
  const latestInitialSettleSignatureRef = useRef("");
  latestInitialSettleSignatureRef.current = `${messages.length}:${lastMessageId ?? ""}:${firstItemIndex}:${String(bottomPadding)}`;
  // Tail id of the list at the moment it was last revealed. Used to tell a
  // "cached/placeholder → authoritative response corrected the head" swap
  // (same tail, already visible: must NOT re-hide) apart from a genuine
  // thread/anchor change.
  const revealedTailIdRef = useRef<string | null>(null);
  const initialRevealReadyRef = useRef(false);
  initialRevealReadyRef.current = initialRevealReady;
  if (initialRevealReady && lastMessageId) revealedTailIdRef.current = lastMessageId;
  // ONE-WAY REVEAL LATCH. Once this mount has painted its messages, nothing may
  // put the mask/skeleton back over them. The bottom-pin effect below re-runs on
  // every `bottomPinRevision` bump, and a bump is unavoidable when an anchor
  // reset coincides with a NEW message arriving (the `alreadyRevealedAndStable`
  // guard only covers an unchanged tail). Re-arming `initialRevealReady=false`
  // there is exactly the reported "messages → blank → skeleton → messages"
  // flash. Re-pinning/aligning is still allowed — only the masking is not.
  // Thread changes remount this component (scrollerKey / RemountOnParamChange),
  // so the latch can never leak across threads.
  const hasRevealedOnceRef = useRef(false);
  // Only latch once CONTENT has actually painted — and only from a PASSIVE
  // (post-paint) effect, never during render. Two cold-open races depend on
  // this:
  //   1. Empty-cache open (committee/group chats after launch or a club
  //      switch): the empty branch's 700ms grace reveals an EMPTY list while
  //      the page-level skeleton still covers the thread. That reveal has
  //      nothing on screen to protect, so it must not disarm re-masking —
  //      otherwise when the real messages land (>700ms fetch) the whole
  //      bottom-pin stabilisation sequence (immediate/raf pins, stability
  //      checks, settle pins, Virtuoso's end-align park → true-maxTop
  //      correction) plays out VISIBLY for seconds: the "thread moves up and
  //      down after skeleton reveal" report.
  //   2. The messages-arrive commit itself: a render-phase latch would arm
  //      the moment `initialRevealReady && messages.length > 0` is true —
  //      BEFORE the pin layout effect below gets to call armRevealMask().
  //      A passive effect runs after all layout effects of that commit, so
  //      the pin effect always wins the race and the mask re-arms.
  // The latch still arms after the first painted content reveal, which is
  // what blocks re-masking over already-visible messages (the original
  // flash regression this ref was added for).
  useEffect(() => {
    if (initialRevealReady && messages.length > 0) hasRevealedOnceRef.current = true;
  }, [initialRevealReady, messages.length]);
  const armRevealMask = useCallback(() => {
    if (hasRevealedOnceRef.current) return;
    setInitialRevealReady(false);
  }, []);


  const {
    safeScrollToIndex,
    pinToTrueBottom,
    alignMessageIdInView,
    bottomPaddingRef,
    bottomPaddingQuiet,
    jumpAlignOwnedByContentGateRef,
    postJumpAnchorRef,
    jumpAnchorNonce,
    setJumpAnchorNonce,
  } = useChatScrollActions({
    ref,
    virtuosoRef,
    scrollerElRef,
    messagesLengthRef,
    atBottomRef,
    bottomPadding,
  });
  // Latest-render mirrors for the mount-once jump overlay effect (deps: []).
  const alignMessageIdInViewRef = useRef(alignMessageIdInView);
  alignMessageIdInViewRef.current = alignMessageIdInView;
  const jumpOverlayTargetRef = useRef<string | null>(initialTargetMessageId ?? null);
  jumpOverlayTargetRef.current = initialTargetMessageId ?? null;


  useEffect(() => {
    if (messages.length === 0) {
      anchorRef.current = { baseFirstId: null, baseFirstIndex: START_INDEX };
      return;
    }
    if (needsAnchorReset) {
      const prev = anchorRef.current;
      anchorRef.current = {
        baseFirstId: newFirstId,
        baseFirstIndex: START_INDEX - messages.length,
      };
      // CRITICAL: only re-arm the bottom-pin revision when the user is at /
      // near the bottom (or hasn't pinned yet). Otherwise an in-flight
      // refetch / cache replacement that drops the previous baseline id
      // would teleport a user who is reading history straight back to LAST.
      // We still update the anchor itself so subsequent prepends shift
      // `firstItemIndex` correctly from the new baseline.
      const userIsReadingHistory = bottomPinReadyRef.current && !atBottomRef.current;
      // Already-revealed content whose tail is unchanged means this reset is
      // only anchor bookkeeping (a cached/placeholder head being corrected by
      // the authoritative response). Re-arming the pin here would clear the
      // reveal latch and flash an already-populated thread back to a skeleton.
      const alreadyRevealedAndStable =
        initialRevealReadyRef.current &&
        !!lastMessageId &&
        revealedTailIdRef.current === lastMessageId;
      if (!userIsReadingHistory && !alreadyRevealedAndStable) {
        bottomPinReadyRef.current = false;
        bottomPinReadyAtRef.current = 0;
        userHasScrolledAfterPinRef.current = false;
        openPinStartedAtRef.current = null;
        openPinLastMessageIdRef.current = null;
        openPinMessagesLengthRef.current = -1;
        setBottomPinRevision((revision) => revision + 1);
      }
      debugLogAnchor("reset", {
        previousBaseFirstId: prev.baseFirstId,
        newBaseFirstId: newFirstId,
        messagesLen: messages.length,
        newBaseFirstIndex: START_INDEX - messages.length,
        suppressedRePin: userIsReadingHistory || alreadyRevealedAndStable,
      } as Record<string, unknown>);
    }
  }, [needsAnchorReset, newFirstId, messages.length, lastMessageId]);


  // Trace firstItemIndex movement (the dominant signal for "the viewport
  // jumped under me"). Cheap when debug is off.
  useEffect(() => {
    debugLogFirstItemIndex(firstItemIndex, messages.length);
  }, [firstItemIndex, messages.length]);

  // Tracks whether this mount has ever observed a non-empty messages array.
  // Used to distinguish "empty thread (genuinely no messages)" from "first
  // open after fresh login where the cache is cold and messages haven't
  // streamed in yet". In the latter case, revealing the empty viewport at
  // opacity 1 lets the user see the chat surface unpinned; when messages
  // then arrive, the snap-to-LAST is visible as a downward jolt.
  const hasEverHadMessagesRef = useRef(false);
  if (messages.length > 0) hasEverHadMessagesRef.current = true;

  // Initial bottom pin happens while the wrapper is invisible. Reveal is held
  // until the actual scroll metrics are quiet, not just until a fixed timeout,
  // so first paint cannot show Virtuoso correcting an interim bottom anchor.
  useLayoutEffect(() => {
    const last = messages.length - 1;
    if (last < 0) {
      bottomPinReadyRef.current = false;
      pinnedRevisionRef.current = null;
      pinAttemptRevisionRef.current = null;
      // Empty thread on first-ever mount (cold cache after fresh login):
      // hold the reveal back briefly so that if messages stream in within
      // the grace window we go straight into the pin sequence without
      // ever painting an unpinned empty viewport. If the grace expires
      // with still no messages, reveal so the empty-state is visible.
      // Deep-link jump-to-message is unaffected: that path runs through
      // the non-empty branch (messages exist by the time the jump fires)
      // and is gated on `isChatJumpActive()` below.
      if (!initialBottomPinned || hasEverHadMessagesRef.current) {
        setInitialRevealReady(true);
        return;
      }
      const graceTimer = window.setTimeout(() => setInitialRevealReady(true), 700);
      return () => window.clearTimeout(graceTimer);
    }
    // Deep-link jump path (push notification / search / reply / pin tap):
    // when an `initialTargetMessageId` was supplied and its row is already
    // in the loaded set, Virtuoso mounted with
    // `initialTopMostItemIndex={index:target, align:"end"}` — the viewport
    // is ALREADY on the correct row. Running the bottom-pin sequence here
    // would immediately snap to LAST/end (the parent's jump effect that
    // sets `isChatJumpActive` runs AFTER this useLayoutEffect in commit
    // ordering, so the guard above misses on the tap that opens/refocuses
    // the chat), producing the visible "message moves around before
    // settling" jitter reported when tapping a notification for a
    // different message in a chat that's already open at another
    // position. Treat as already-pinned, but do NOT reveal immediately: wait
    // until Virtuoso's row measurement, exact-DOM correction, and any visible
    // row hydration have produced a quiet scroller. This branch must run
    // BEFORE the `!initialBottomPinned` shortcut below because every deep-link
    // page passes `initialBottomPinned={false}`.
    if (initialTargetMessageId && initialTargetIndex >= 0) {
      bottomPinReadyRef.current = true;
      pinnedRevisionRef.current = bottomPinRevision;
      pinAttemptRevisionRef.current = null;
      armRevealMask();
      let cancelled = false;
      let cleanup: (() => void) | null = null;
      let revealFrame: number | null = null;
      // ONE lifecycle budget, measured from the ORIGINAL jump start (not from
      // this effect run, which can re-fire on message-window growth). The
      // reveal itself is gated on the exact target being mounted, aligned,
      // unclipped and stationary — see `waitForChatJumpTargetReveal`. This is
      // deliberately the shortest defensible fail-safe: previously we chained a
      // 2.2 s jump tail onto a fresh 6.5 s settle wait (re-armed every 80 ms),
      // which left a correctly aligned thread masked for many seconds.
      const JUMP_REVEAL_FAILSAFE_MS = 4000;
      // This gate owns the exact-DOM correction for this target; the overlay
      // gate defers to it so only ONE alignment authority writes scrollTop.
      jumpAlignOwnedByContentGateRef.current = initialTargetMessageId;
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      const reveal = () => {
        cleanup?.();
        revealFrame = requestAnimationFrame(() => setInitialRevealReady(true));
      };
      const finish = () => {
        if (cancelled) return;
        // Do not unmask while the composer inset is still settling — the
        // in-flow Virtuoso footer height changes with it and would move the
        // just-revealed target row. Bounded by the same lifecycle budget.
        const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;
        if (!bottomPaddingQuiet(180) && elapsed < JUMP_REVEAL_FAILSAFE_MS) {
          revealFrame = requestAnimationFrame(() => {
            if (cancelled) return;
            alignMessageIdInView(initialTargetMessageId, "end");
            finish();
          });
          return;
        }
        cancelled = true;
        jumpAlignOwnedByContentGateRef.current = null;
        // Arm the post-reveal anchor BEFORE unmasking so late-hydrating rows
        // re-align to the target instead of shifting the revealed thread.
        // Reset the sticky user-scroll flag so a repeat jump in an already-open
        // chat still gets its full anchor window.
        userHasScrolledAfterPinRef.current = false;
        postJumpAnchorRef.current = {
          id: initialTargetMessageId,
          at: typeof performance !== "undefined" ? performance.now() : Date.now(),
        };
        setJumpAnchorNonce((n) => n + 1);
        reveal();
      };
      const wait = () => {
        if (cancelled) return;
        const scroller = scrollerElRef.current;
        if (!scroller) {
          revealFrame = requestAnimationFrame(wait);
          return;
        }
        cleanup = waitForChatJumpTargetReveal(
          scroller,
          {
            targetMessageId: initialTargetMessageId,
            usableBottomInsetPx: getChatBottomPaddingOffset(bottomPaddingRef.current),
            quietMs: 240,
            budgetMs: Math.max(
              600,
              chatJumpLifecycleRemaining(JUMP_REVEAL_FAILSAFE_MS),
            ),
            finalAlign: () => { alignMessageIdInView(initialTargetMessageId, "end"); },
          },
          finish,
        );
      };
      wait();
      return () => {
        cancelled = true;
        if (jumpAlignOwnedByContentGateRef.current === initialTargetMessageId) {
          jumpAlignOwnedByContentGateRef.current = null;
        }
        cleanup?.();
        if (revealFrame !== null) cancelAnimationFrame(revealFrame);
      };

    }


    // Deep-link target requested but its row is NOT in the loaded window yet.
    // Revealing here paints the fallback (bottom/LAST) anchor, and moments
    // later the parent's target-window hydration bumps the scroller key and
    // remounts this list — the user sees content, then a skeleton, then the
    // real target. Stay masked while the target fetch is in flight, bounded by
    // the jump lifecycle budget so a target that never arrives still reveals.
    if (initialTargetMessageId && initialTargetIndex < 0) {
      bottomPinReadyRef.current = true;
      pinnedRevisionRef.current = bottomPinRevision;
      pinAttemptRevisionRef.current = null;
      const TARGET_PENDING_HOLD_MS = 2500;
      const holdMs = Math.max(
        400,
        Math.min(3000, chatJumpLifecycleRemaining(TARGET_PENDING_HOLD_MS)),
      );
      const holdTimer = window.setTimeout(() => setInitialRevealReady(true), holdMs);
      return () => window.clearTimeout(holdTimer);
    }

    if (!initialBottomPinned) {
      bottomPinReadyRef.current = true;
      // Do NOT stamp `pinnedRevisionRef` here. The parent computes
      // `initialBottomPinned={initialBottomPinned && (virtualReady || isPinned)}`,
      // which is frequently `false` on the FIRST render of a mount and flips
      // `true` a frame later. Stamping the revision on that transient false
      // pass made the guard below short-circuit the real pin sequence when the
      // prop flipped, so a plain reopen (e.g. straight after posting a
      // message) revealed wherever Virtuoso happened to mount instead of the
      // bottom — and nothing corrected it afterwards.
      pinnedRevisionRef.current = null;
      pinAttemptRevisionRef.current = null;
      setInitialRevealReady(true);
      return;
    }

    if (bottomPinReadyRef.current && pinnedRevisionRef.current === bottomPinRevision) return;
    if (isChatJumpActive()) {
      bottomPinReadyRef.current = true;
      pinnedRevisionRef.current = bottomPinRevision;
      setInitialRevealReady(true);
      return;
    }
    // Skip if a pin sequence for this revision is already in flight — a
    // re-render mid-stabilisation must not retrigger the synchronous
    // `jump("immediate")` below.
    if (pinAttemptRevisionRef.current === bottomPinRevision) return;
    pinAttemptRevisionRef.current = bottomPinRevision;
    // Re-mask only when a pin can actually MOVE content. If every row fits
    // inside the viewport (e.g. the first messages landing in a previously
    // empty open thread) maxTop is 0 and every pin below is a no-op — masking
    // would just flash a skeleton over the empty state for no benefit. When
    // the scroller is not measurable yet (missing or zero-sized), default to
    // masking: an unmeasurable layout cannot prove the pins will be no-ops.
    const pinViewportEl = scrollerElRef.current;
    const pinCanMoveContent =
      !pinViewportEl ||
      (pinViewportEl.clientHeight === 0 && pinViewportEl.scrollHeight === 0) ||
      pinViewportEl.scrollHeight > pinViewportEl.clientHeight + 1;
    if (pinCanMoveContent) armRevealMask();
    const jump = (phase: string) => {
      // Defensive guard: if the user has already scrolled away from the
      // bottom by the time a deferred jump fires (e.g. a refetch landed and
      // bumped the revision, then the user flicked up before raf2/200ms
      // expired), abort the jump rather than yanking them back.
      if (bottomPinReadyRef.current && !atBottomRef.current && phase !== "immediate") {
        debugLogBottomPin(bottomPinRevision, `${phase}-skipped-not-at-bottom`);
        return;
      }
      if (isChatJumpActive()) {
        debugLogBottomPin(bottomPinRevision, `${phase}-skipped-jump-active`);
        return;
      }
      debugLogBottomPin(bottomPinRevision, phase);
      pinToTrueBottom(`bottom-pin-${phase}`);
    };
    jump("immediate");
    let revealTimer: ReturnType<typeof setTimeout> | null = null;
    let deadlineTimer: number | null = null;
    let frame: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    let cancelled = false;
    let disposedAfterReveal = false;
    let lastMetrics = "";
    // Hard deadline for the reveal. On Android, late-hydrating images / link
    // previews / reactions can keep `scrollHeight` ticking for far longer
    // than the 320 ms idle window, which previously left the wrapper at
    // opacity 0 indefinitely AND ran a per-frame rAF the entire time —
    // visible to the user as a frozen, blank chat. After this deadline we
    // reveal regardless and let any remaining reflows happen in plain sight.
    const REVEAL_DEADLINE_MS = 3000;
    const REVEAL_IDLE_MS = 520;
    let visualSettleCleanup: (() => void) | null = null;
    const doReveal = (reason: string) => {
      if (cancelled) return;
      const el = scrollerElRef.current;
      cancelled = true;
      if (revealTimer !== null) {
        clearTimeout(revealTimer);
        revealTimer = null;
      }
      if (deadlineTimer !== null) {
        clearTimeout(deadlineTimer);
        deadlineTimer = null;
      }
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      // Final belt-and-braces re-anchor the frame before we reveal, so any
      // last paddingTop adjustment from overscan-row measurement doesn't
      // visually shift the bottom row at the moment opacity flips to 1.
      if (!isChatJumpActive()) {
        pinToTrueBottom("bottom-pin-reveal-final");
      }
      if (!bottomPinReadyRef.current) bottomPinReadyAtRef.current = performance.now();
      bottomPinReadyRef.current = true;
      pinnedRevisionRef.current = bottomPinRevision;
      userHasScrolledAfterPinRef.current = false;
      debugLogBottomPin(bottomPinRevision, `reveal-${reason}`);
      visualSettleCleanup?.();
      visualSettleCleanup = waitForChatVisualContentSettle(el, { quietMs: 520, maxMs: 2400 }, () => {
        if (disposedAfterReveal) return;
        if (isChatJumpActive()) {
          requestAnimationFrame(() => setInitialRevealReady(true));
          return;
        }
        if (userHasScrolledAfterPinRef.current && !atBottomRef.current) {
          requestAnimationFrame(() => setInitialRevealReady(true));
          return;
        }
        pinToTrueBottom("bottom-pin-settle");
        requestAnimationFrame(() => {
          pinToTrueBottom("bottom-pin-settle-raf");
          setInitialRevealReady(true);
        });
      });
    };
    const armRevealWhenStable = () => {
      const el = scrollerElRef.current;
      if (!el || cancelled) return;
      if (!isChatJumpActive()) {
        pinToTrueBottom("bottom-pin-stability-check");
      }
      const metrics = `${latestInitialSettleSignatureRef.current}:${Math.round(el.scrollTop)}:${Math.round(el.scrollHeight)}:${Math.round(el.clientHeight)}`;
      if (metrics !== lastMetrics) {
        lastMetrics = metrics;
        if (revealTimer !== null) clearTimeout(revealTimer);
        revealTimer = setTimeout(() => doReveal("idle"), REVEAL_IDLE_MS);
      }
      frame = null;
    };
    const scheduleStableCheck = () => {
      if (cancelled || frame !== null) return;
      frame = requestAnimationFrame(armRevealWhenStable);
    };
    const attachStabilityWatchers = () => {
      const el = scrollerElRef.current;
      if (!el) return;
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(scheduleStableCheck);
        resizeObserver.observe(el);
        const inner = el.firstElementChild;
        if (inner instanceof HTMLElement) resizeObserver.observe(inner);
      }
      mutationObserver = new MutationObserver(scheduleStableCheck);
      mutationObserver.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
      deadlineTimer = window.setTimeout(() => doReveal("deadline"), REVEAL_DEADLINE_MS);
      scheduleStableCheck();
    };
    let r2: number | null = null;
    const r1 = requestAnimationFrame(() => {
      if (cancelled) return;
      jump("raf1");
      r2 = requestAnimationFrame(() => {
        if (cancelled) return;
        jump("raf2");
        attachStabilityWatchers();
      });
    });
    return () => {
      disposedAfterReveal = true;
      cancelled = true;
      cancelAnimationFrame(r1);
      if (r2 !== null) cancelAnimationFrame(r2);
      if (revealTimer !== null) clearTimeout(revealTimer);
      if (deadlineTimer !== null) clearTimeout(deadlineTimer);
      if (frame !== null) cancelAnimationFrame(frame);
      visualSettleCleanup?.();
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
    // Intentionally narrow deps: this effect must NOT re-run on every
    // parent render (Virtuoso paddingTop measurements cause many during
    // the stabilisation window — re-running cancels in-flight rAFs and
    // floods telemetry with redundant `jump("immediate")` calls). It only
    // needs to fire when a new pin revision is requested or when the list
    // transitions between empty / non-empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `initialTargetMessageId` is included so a NEW deep-link target starts a
    // fresh hydration lifecycle (and cancels the previous one) rather than
    // inheriting an already-expired deadline from another notification.
  }, [bottomPinRevision, messages.length === 0, initialBottomPinned, initialTargetMessageId]);

  const handleAtBottomChange = useCallback(
    (atBottom: boolean) => {
      atBottomRef.current = atBottom;
      onAtBottomChange?.(atBottom);
    },
    [onAtBottomChange],
  );


  // Prepend anchoring is handled entirely by Virtuoso's `firstItemIndex`
  // shift (see anchorRef math above). We deliberately do NOT run a manual
  // scrollTop-restore loop here: writing scrollTop frame-after-frame while
  // Virtuoso is settling its own row-height estimates produces a visible
  // up/down wobble after an upward fling stops ("jitters then lands").

    // Post-reveal "stay pinned" guard. After the initial bottom pin reveals,
  // late-hydrating content (images decoding, link previews mounting, reply
  // quotes inflating, reactions arriving) grows the heights of rows already
  // on screen. Virtuoso's `followOutput` only re-pins when NEW items are
  // appended, not when existing rows resize, so without this the last
  // message visibly drifts downward (or the viewport scrolls up away from
  // it) over the first ~1.2s after open. We watch scrollHeight via a
  // ResizeObserver on the inner content and forcibly re-pin to LAST as long
  // as the user is still at the bottom and hasn't scrolled away.
  useEffect(() => {
    if (!initialRevealReady) return;
    if (!initialBottomPinned) return;
    // Match the sibling watchers' guard — jsdom (and very old WebViews) have
    // no ResizeObserver; without this the effect throws on reveal.
    if (typeof ResizeObserver === "undefined") return;
    const viewport = scrollerElRef.current;
    if (!viewport) return;
    const inner = viewport.firstElementChild as HTMLElement | null;
    if (!inner) return;

    let cancelled = false;
    const startedAt = performance.now();
    // Cold post-login opens hydrate more slowly than normal re-opens (auth,
    // profiles, avatars, link previews, READ RECEIPTS / read frontier). Keep
    // the first-open bottom guard alive long enough to absorb that settling
    // without affecting a user who has intentionally scrolled away. Matches
    // the open-pin window (6s) so late-hydrating "Seen by" rows on own
    // messages — which can land 2-4s after reveal on a cold start — are
    // compensated before this observer retires.
    const STAY_PINNED_MS = 6000;
    let lastScrollHeight = viewport.scrollHeight;
    let lastClientHeight = viewport.clientHeight;

    // SYNCHRONOUS delta compensation. The flicker comes from the gap
    // between a layout-changing paint (image decode / link preview /
    // reaction landing → scrollHeight grows) and the next animation frame
    // where we'd write scrollTop. In that gap the browser paints one frame
    // with content shifted down, then snaps back — visible as a jolt. By
    // adjusting scrollTop synchronously inside the ResizeObserver callback
    // (which fires before the layout-change paint commits) we move the
    // viewport by the exact same delta the inner content grew, so the
    // bottom row stays optically nailed in place.
    const ro = new ResizeObserver(() => {
      if (cancelled) return;
      if (isChatJumpActive()) return;
      if (isViewportUserActive(viewport)) return;

      // Parked-at-bottom must be judged against the PRE-RESIZE geometry.
      // By the time this callback runs, the growth has already landed:
      // measuring `scrollHeight - clientHeight - scrollTop` NOW turns a
      // parked 0 into the grown delta (e.g. +24px), so the old
      // `distanceFromBottom > 4 → bail` check defeated the guard's own
      // purpose — every real row growth while pinned at bottom was ignored
      // and the tail drifted until an unrelated pin yanked it back (the
      // visible "moves up and down" after reveal).
      const prevDistanceFromBottom =
        lastScrollHeight - lastClientHeight - viewport.scrollTop;

      const sh = viewport.scrollHeight;
      const ch = viewport.clientHeight;
      const delta = sh - lastScrollHeight;
      const viewportDelta = ch - lastClientHeight;
      lastScrollHeight = sh;
      lastClientHeight = ch;
      // Bail on sub-pixel / tiny noise so the RO→scroll→RO feedback loop
      // dies quickly. On Android WebView this is the difference between a
      // ~1.5 s main-thread freeze on first open and a clean reveal.
      if (Math.abs(delta) < 2 && Math.abs(viewportDelta) < 2) return;

      // Hard guards: never re-pin from a ResizeObserver callback when the
      // user has scrolled away from the pin or was NOT parked at the bottom
      // before this resize (reading history / mid-fling). Pure pixel-distance
      // check — atBottomRef is unreliable here because Virtuoso's 120px
      // atBottomThreshold keeps it `true` for the first ~120px of an upward
      // fling.
      if (userHasScrolledAfterPinRef.current) return;
      if (prevDistanceFromBottom > 4) return;

      // Coordinate with sibling writers (openPinWindow timers, parent
      // keyboard-pin). If one of them just wrote scrollTop, skip this pass
      // so we don't apply an opposing micro-correction in the same frame.
      if (isRecentChatScrollWrite(200)) return;

      // Re-pin to the true max scroll position for BOTH growth and shrink.
      // Cold-login row estimates can correct in either direction; only
      // handling positive deltas leaves the browser to clamp negative deltas
      // on the next paint, which reads as the down/up jolt the user reported.
      const maxTop = sh - ch;
      const target = Math.max(0, maxTop);
      if (Math.abs(viewport.scrollTop - target) > 0.5) {
        viewport.scrollTop = target;
        markChatScrollWrite();
      }

      if (performance.now() - startedAt > STAY_PINNED_MS) {
        cancelled = true;
        ro.disconnect();
      }
    });
    ro.observe(viewport);
    ro.observe(inner);

    const stopTimer = window.setTimeout(() => {
      cancelled = true;
      ro.disconnect();
    }, STAY_PINNED_MS + 50);

    return () => {
      cancelled = true;
      ro.disconnect();
      window.clearTimeout(stopTimer);
    };
  }, [initialRevealReady, bottomPinRevision, initialBottomPinned]);

  useChatJumpAnchor({
    initialRevealReady,
    jumpAnchorNonce,
    postJumpAnchorRef,
    scrollerElRef,
    userHasScrolledAfterPinRef,
    alignMessageIdInViewRef,
  });

  const { followOutput } = useChatBottomFollow({
    initialRevealReady,
    initialBottomPinned,
    lastMessageId,
    messages,
    bottomPinRevision,
    currentUserId,
    scrollerElRef,
    bottomPinReadyRef,
    userHasScrolledAfterPinRef,
    openPinStartedAtRef,
    openPinLastMessageIdRef,
    openPinMessagesLengthRef,
  });

  // O(1) id → index map AND defensive de-duplication. Pagination races (two
  // `startReached` events firing before React flushes `isLoadingOlder=true`)
  // can land the same older page twice, producing duplicate IDs in the array.
  // Virtuoso would then render a "ghost" duplicate row whose key collides
  // with a sibling. Filter out any second occurrence here so the list the
  // virtualiser sees is always strictly unique.
  const { uniqueMessages, indexById } = useMemo(() => {
    const map = new Map<string, number>();
    const unique: TMessage[] = [];
    const dupCounts = new Map<string, number>();
    for (let i = 0; i < messages.length; i++) {
      const id = messages[i].id;
      if (map.has(id)) {
        dupCounts.set(id, (dupCounts.get(id) ?? 1) + 1);
        continue;
      }
      map.set(id, unique.length);
      unique.push(messages[i]);
    }
    if (dupCounts.size > 0 && isChatVirtDebugEnabled()) {
      for (const [id, count] of dupCounts) debugLogDuplicate(id, count);
    }
    return { uniqueMessages: unique, indexById: map };
  }, [messages]);

  // CRITICAL flicker fix: keep `itemContent` identity stable across messages
  // mutations. If this callback's identity changes when an older page lands,
  // Virtuoso re-invokes it for every visible row, defeating React.memo on
  // ChatMessage and producing a full-row repaint flash mid-scroll. We capture
  // the per-render data into refs and reference them inside a callback that
  // is created ONCE per component instance.
  const renderItemRef = useRef(renderItem);
  const uniqueMessagesRef = useRef(uniqueMessages);
  const indexByIdRef = useRef(indexById);
  const currentUserIdRef = useRef(currentUserId);
  useLayoutEffect(() => {
    renderItemRef.current = renderItem;
    uniqueMessagesRef.current = uniqueMessages;
    indexByIdRef.current = indexById;
    currentUserIdRef.current = currentUserId;
  }, [renderItem, uniqueMessages, indexById, currentUserId]);

  // Pre-decode aspect ratios for any image messages in the current window
  // BEFORE Virtuoso mounts those rows. Populates chatImageAspectCache so
  // estimateChatRowHeight reserves the correct box on first paint instead
  // of the 4:3 fallback — eliminates the post-decode row-grow/shrink jolt
  // that telemetry shows as ±50-200px image-row deltas after scroll-up.
  useEffect(() => {
    for (const m of uniqueMessages) {
      const url = (m as any).image_url ?? (m as any).imageUrl ?? null;
      if (url) prefetchChatImageAspectRatio(url);
    }
  }, [uniqueMessages]);


  const itemContent = useCallback(
    (_absoluteIndex: number, message: TMessage) => {
      const idx = indexByIdRef.current.get(message.id) ?? -1;
      const rows = uniqueMessagesRef.current;
      const signature = createChatRowSignature(message, idx, rows, currentUserIdRef.current);
      return (
        <ChatRowAdapter
          message={message}
          signature={signature}
          renderItemRef={renderItemRef as React.MutableRefObject<
            (m: any, i: number, a: any[]) => React.ReactNode
          >}
          uniqueMessagesRef={uniqueMessagesRef as React.MutableRefObject<any[]>}
          indexByIdRef={indexByIdRef}
          currentUserIdRef={currentUserIdRef}
        />
      );
    },
    [],
  );

  const computeItemKey = useCallback((_index: number, message: TMessage) => message.id, []);

  const initialTargetIndex = initialTargetMessageId
    ? uniqueMessages.findIndex((message) => message.id === initialTargetMessageId)
    : -1;


  // Force integer measurements. React-Virtuoso's default itemSize uses
  // getBoundingClientRect(), which can oscillate by sub-pixels on fractional
  // DPR phones during momentum scrolling. Each tiny measurement delta causes
  // Virtuoso to mutate paddingTop, which reads as the remaining upward jitter.
  const itemSize = useCallback((el: HTMLElement, field: "offsetHeight" | "offsetWidth") => {
    return field === "offsetHeight" ? el.offsetHeight : el.offsetWidth;
  }, []);

  const components = useMemo(
    () => ({
      Scroller: ChatVirtuosoScroller,
      Item: ChatVirtuosoItem,
      Header: ChatVirtuosoHeader,
      Footer: ChatVirtuosoFooter,
    }),
    [],
  );
  const virtuosoContext = useMemo<ChatVirtuosoContext>(
    () => ({ topPadding: topPadding ?? 0, bottomPadding: bottomPadding ?? 0 }),
    [topPadding, bottomPadding],
  );

  // Attach a debug watcher to Virtuoso's real scroll element so we can flag
  // foreign `scrollTop` writes (legacy chat hooks fighting Virtuoso for
  // ownership of the same scroller — the canonical cause of "rows stacking
  // on top of each other" on fast scroll).
  const wrappedScrollerRef = useCallback(
    (element: HTMLElement | Window | null) => {
      // Track the scroll element for the imperative `isNearBottom` API.
      // Window targets don't apply for the inline Virtuoso scroller, so we
      // only retain HTMLElement instances.
      scrollerElRef.current = element instanceof HTMLElement ? element : null;
      // Track real user gestures (touch / wheel) on the viewport so the
      // post-pin stay-pinned guard can distinguish a user-driven scroll
      // away from programmatic snaps + content-growth driven `atBottom`
      // flips. Without this, the very first programmatic `scrollToIndex`
      // after reveal fires a `scroll` event that we'd mistakenly count as
      // "user scrolled away".
      installChatScrollIntentTracking(scrollerElRef.current);
      debugAttachScrollerWatcher(element);
      scrollerRef?.(element);
    },
    [scrollerRef],
  );

  // Brief skeleton overlay while a deep-link/jump-to-message is hydrating.
  // Driven by window CustomEvents from `jumpToMessageInVirtualizedChat` so
  // every chat surface (Team/Group/Club/Broadcast/ClubAdmin/DM) gets the
  // mask without prop-drilling. Masks the visible re-anchor as deferred row
  // sub-content (link previews, replies, reactions) hydrates after scroll.
  // Seed from the module-level flag so push-notification jumps that fire
  // `setChatJumpActive(true)` BEFORE this list mounts still show the
  // overlay (the CustomEvent itself would have been dispatched before our
  // listener was attached and silently lost).
  const [isJumpHydrating, setIsJumpHydrating] = useState(() => isChatJumpActive());
  // Keep the skeleton mounted (with opacity 0) for the duration of its
  // CSS fade-out transition, so a deep-link landing reads as "load → settled"
  // instead of "load → bobble → snap" when the overlay disappears.
  const [renderJumpOverlay, setRenderJumpOverlay] = useState(() => isChatJumpActive());
  useEffect(() => {
    let fadeTimer: ReturnType<typeof setTimeout> | null = null;
    let unmountTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelSettleWait: (() => void) | null = null;
    let hardTimer: number | null = null;
    // Overlay lifecycle budget, anchored at the START of each jump (i.e. each
    // notification/deep-link), never extended by rerenders or by repeated
    // settle passes. SAFETY backstop only — the overlay's normal exit is the
    // settle-driven `onEnd` path, so the reveal always shows a settled thread.
    // Longer than the jump poller's own lifetime (~30s) on purpose.
    const OVERLAY_HARD_DEADLINE_MS = 32000;
    // Shortest defensible fail-safe for the reveal itself. The 32 s value above
    // stays as the absolute never-blank-forever backstop.
    const OVERLAY_REVEAL_FAILSAFE_MS = 4000;
    let hydrating = false;
    const remainingBudget = () =>
      Math.max(0, chatJumpLifecycleRemaining(OVERLAY_HARD_DEADLINE_MS));

    const onStart = () => {
      // Idempotent: duplicate start signals (the CustomEvent AND the
      // `setChatJumpActive(true)` subscription both fire for one jump, plus the
      // seeded mount call) must not re-arm the budget or restart the wait.
      if (hydrating) return;
      hydrating = true;
      if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
      if (unmountTimer) { clearTimeout(unmountTimer); unmountTimer = null; }
      if (cancelSettleWait) { cancelSettleWait(); cancelSettleWait = null; }
      if (hardTimer !== null) { window.clearTimeout(hardTimer); hardTimer = null; }
      hardTimer = window.setTimeout(() => {
        hardTimer = null;
        if (cancelSettleWait) { cancelSettleWait(); cancelSettleWait = null; }
        fadeOut();
      }, OVERLAY_HARD_DEADLINE_MS);
      setRenderJumpOverlay(true);
      setIsJumpHydrating(true);
      // Start observing alignment progress DURING the jump instead of waiting
      // for the tail release and then starting a second, independent settle
      // wait. As soon as the exact target is mounted, aligned above the
      // composer and stationary for a short quiet window we fade out — which is
      // what removed the multi-second blank chat after a notification tap.
      armRevealWait();
    };
    const fadeOut = () => {
      if (hardTimer !== null) { window.clearTimeout(hardTimer); hardTimer = null; }
      hydrating = false;
      setIsJumpHydrating(false);
      if (unmountTimer) clearTimeout(unmountTimer);
      unmountTimer = setTimeout(() => setRenderJumpOverlay(false), 300);
    };
    function armRevealWait() {
      const scroller = scrollerElRef.current;
      const budget = remainingBudget();
      if (!scroller || budget <= 200) {
        if (fadeTimer) clearTimeout(fadeTimer);
        fadeTimer = setTimeout(fadeOut, 120);
        return;
      }
      const targetId =
        getChatJumpLifecycle().targetMessageId ?? jumpOverlayTargetRef.current;
      cancelSettleWait = waitForChatJumpTargetReveal(
        scroller,
        {
          targetMessageId: targetId,
          usableBottomInsetPx: getChatBottomPaddingOffset(bottomPaddingRef.current),
          quietMs: 240,
          budgetMs: Math.max(
            600,
            Math.min(OVERLAY_REVEAL_FAILSAFE_MS, budget),
          ),
          finalAlign: () => {
            // Single alignment authority: while the content-reveal gate owns
            // this target, its own `finalAlign` is the only one allowed to
            // write scrollTop. Two gates correcting the same row on different
            // frames is what produced the down-then-up settle.
            if (!targetId) return;
            if (jumpAlignOwnedByContentGateRef.current === targetId) return;
            alignMessageIdInViewRef.current?.(targetId, "end");
          },
        },
        () => {
          cancelSettleWait = null;
          // Tiny intentional cross-fade so the reveal reads as "settled".
          if (fadeTimer) clearTimeout(fadeTimer);
          // Hold the overlay a little longer while the composer inset (and thus
          // the in-flow Virtuoso footer height) is still changing.
          const delay = bottomPaddingQuiet(180) ? 80 : 220;
          fadeTimer = setTimeout(fadeOut, delay);
        },

      );
    }
    const onEnd = () => {
      // Idempotent by construction: the reveal wait is already running from
      // `onStart`, so duplicate `chat:jump-hydration-end` /
      // `setChatJumpActive(false)` notifications must NOT cancel or restart it.
      if (!hydrating) return;
      if (cancelSettleWait) return;
      armRevealWait();
    };

    window.addEventListener("chat:jump-hydration-start", onStart);
    window.addEventListener("chat:jump-hydration-end", onEnd);
    const unsubscribe = subscribeChatJumpActive((value) => {
      if (value) onStart();
      else onEnd();
    });
    // Jump was already active before this list mounted (cold push tap): the
    // start event was dispatched before our listener existed, so arm the
    // lifecycle budget now — otherwise the seeded overlay would have no
    // deadline at all.
    if (isChatJumpActive()) onStart();
    return () => {
      window.removeEventListener("chat:jump-hydration-start", onStart);
      window.removeEventListener("chat:jump-hydration-end", onEnd);
      unsubscribe();
      if (fadeTimer) clearTimeout(fadeTimer);
      if (unmountTimer) clearTimeout(unmountTimer);
      if (hardTimer !== null) window.clearTimeout(hardTimer);
      if (cancelSettleWait) cancelSettleWait();
    };
  }, []);



  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        width: "100%",
      }}
    >
    {!initialRevealReady ? <JumpHydrationSkeleton /> : null}
    <div
      style={{
        position: "relative",
        height: "100%",
        width: "100%",
        opacity: initialRevealReady ? 1 : 0,
        transition: initialRevealReady ? "opacity 80ms ease-out" : "none",
      }}
    >
    {uniqueMessages.length > 0 ? (
      <Virtuoso
      ref={virtuosoRef}
      className={className}
      style={{ height: "100%", ...style, overflowAnchor: "none" }}
      data={uniqueMessages}
      firstItemIndex={firstItemIndex}
      // When a deep-link target message id is supplied but isn't in the current
      // message window yet (typical first paint from a push notification — the
      // parent's jump-window hydration query runs async, or silently fails on
      // RLS/network), fall back to anchoring at the latest message instead of
      // leaving Virtuoso unanchored (which can present as a completely blank
      // viewport on Android WebView). Once the hydration completes, the parent
      // bumps its scrollerKey and we remount with a valid `initialTargetIndex`.
      initialTopMostItemIndex={
        // Guard: Virtuoso crashes with "Cannot read properties of undefined
        // (reading 'index')" if we hand it an initial anchor while `data` is
        // still empty — its internal sizer tries to read items[-1].index.
        // This is exactly the cold-start path for a notification tap on
        // team/club chats, where uniqueMessages is briefly [] before the
        // first query resolves. Skip the prop until we actually have rows.
        uniqueMessages.length === 0
          ? undefined
          : initialTargetIndex >= 0
            ? { index: initialTargetIndex, align: "end", behavior: "auto" }
            : (initialBottomPinned || !!initialTargetMessageId)
              ? { index: "LAST", align: "end", behavior: "auto" }
              : undefined
      }
      // NOTE: `alignToBottom` was removed. With anchored prepends
      // (`firstItemIndex` shifting backwards by the page size), `alignToBottom`
      // pins the BOTTOM of the viewport when content grows above the current
      // scroll position. The visible result is exactly the reported symptom:
      // user scrolls up, hits the top of the loaded set, the older page lands
      // ~1–2s later, and the viewport "jumps higher" to messages they never
      // scrolled through — because the bottom-anchor lets the topmost visible
      // row swap to a much older one. The initial-mount bottom pin is already
      // handled by `initialTopMostItemIndex={LAST, end}` and the belt-and-
      // braces `scrollToIndex` effect, so `alignToBottom` is not needed for
      // first-paint and actively breaks anchored pagination.
      startReached={handleStartReached}
      atTopStateChange={handleAtTopStateChange}
      atTopThreshold={400}
      atBottomStateChange={handleAtBottomChange}
      onScroll={handleScroll}
      isScrolling={handleIsScrollingChange}
      followOutput={initialBottomPinned ? followOutput : false}
      computeItemKey={computeItemKey}
      itemContent={itemContent}
      itemSize={itemSize}
      // ROOT-CAUSE FIX for scroll-up flicker/movement: by default Virtuoso
      // wraps its item ResizeObserver callback in requestAnimationFrame, so a
      // row mounted during upward scroll reports its real height ONE FRAME
      // LATE. For that frame the list is positioned with the wrong (default
      // 160px) height, then snaps — visible as per-row flicker on slow scroll
      // and compounding viewport movement on fast flings (react-virtuoso
      // issue #1049). Skipping the rAF makes measurement synchronous within
      // the same layout pass, eliminating the one-frame misposition window.
      // Note: estimator tuning could never fix this — estimateChatRowHeight
      // only feeds debug telemetry; Virtuoso itself only knows
      // defaultItemHeight until the RO reports.
      skipAnimationFrameInResizeObserver
      // Tuned to the real median chat row height: most rows fall in the
      // 90–180px band (text bubble + author + timestamp ≈ 90, image rows
      // with the reserved 4/3 frame ≈ 300). 160 is the population median
      // and minimises the magnitude of the post-measure correction Virtuoso
      // applies to unmeasured rows during a fast upward fling.
      defaultItemHeight={160}
      scrollSeekConfiguration={false}
      // ROOT-CAUSE FIX (round 13): estimateChatRowHeight / chatRowHeightCache
      // never feed Virtuoso — the library only knows defaultItemHeight (160)
      // for unmounted rows and corrects on first mount. On Android touch
      // scrolling that correction is a scrollTop write mid-fling = the
      // visible flicker (slow scroll) and post-stop jolt (fast fling). No
      // estimator tuning can remove it. The only way to eliminate it is to
      // guarantee rows are mounted + measured BEFORE they can reach the
      // viewport: keep the top overscan larger than one full message page
      // (30 rows ≈ 4800px at the 160px default), so the entire loaded window
      // mounts at reveal and each prepended page mounts in ONE batch at the
      // scroll-idle commit. After that batch, scrolling through those rows
      // performs zero corrections. Hydration no longer trickles in mid-fling
      // because nothing mounts mid-fling.
      increaseViewportBy={{ top: 6000, bottom: 600 }}
      minOverscanItemCount={{ top: 8, bottom: 2 }}
      atBottomThreshold={120}
      scrollerRef={wrappedScrollerRef}
      context={virtuosoContext}
      components={components as any}
      />
    ) : null}
    {renderJumpOverlay ? <JumpHydrationSkeleton visible={isJumpHydrating} /> : null}
    </div>
    </div>
  );
}

const VirtuosoChatMessageList = forwardRef(VirtualizedChatMessageListInner) as <
  TMessage extends { id: string },
>(
  props: Props<TMessage> & { ref?: React.Ref<VirtualizedChatMessageListHandle> },
) => React.ReactElement;

/**
 * Public wrapper that picks between the real Virtuoso-backed list and the
 * basic mapped fallback based on the app-admin kill-switch flag. Splitting
 * the choice at the component boundary (rather than via an early return
 * inside the inner component) keeps the Rules of Hooks intact when the flag
 * flips at runtime via cache invalidation.
 */
function VirtualizedChatMessageListSwitcher<TMessage extends { id: string }>(
  props: Props<TMessage>,
  ref: React.Ref<VirtualizedChatMessageListHandle>,
) {
  const enabled = useChatVirtualizationEnabled();
  if (!enabled) {
    return <BasicChatMessageList ref={ref as React.Ref<any>} {...props} />;
  }
  return <VirtuosoChatMessageList ref={ref} {...props} />;
}

export const VirtualizedChatMessageList = forwardRef(VirtualizedChatMessageListSwitcher) as <
  TMessage extends { id: string },
>(
  props: Props<TMessage> & { ref?: React.Ref<VirtualizedChatMessageListHandle> },
) => React.ReactElement;
