import { useCallback, useLayoutEffect, useRef, type MutableRefObject } from "react";
import { isChatJumpActive, setChatJumpActive } from "@/lib/chatJumpActive";
import { isViewportUserActive } from "@/lib/chatScrollIntent";
import { isRecentChatScrollWrite, markChatScrollWrite } from "@/lib/chatScrollWriteLock";

type BottomFollowDeps<TMessage extends { id: string }> = {
  initialRevealReady: boolean;
  initialBottomPinned: boolean;
  lastMessageId: string | null;
  messages: TMessage[];
  bottomPinRevision: number;
  currentUserId?: string | null;
  scrollerElRef: MutableRefObject<HTMLElement | null>;
  bottomPinReadyRef: MutableRefObject<boolean>;
  userHasScrolledAfterPinRef: MutableRefObject<boolean>;
  openPinStartedAtRef: MutableRefObject<number | null>;
  openPinLastMessageIdRef: MutableRefObject<string | null>;
  openPinMessagesLengthRef: MutableRefObject<number>;
};

export function useChatBottomFollow<TMessage extends { id: string }>({
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
}: BottomFollowDeps<TMessage>) {
  // Cold-open data refresh guard. On a fresh login we often render cached
  // messages first, then replace/extend them with the network-fresh latest
  // page. `followOutput` only follows when Virtuoso still reports bottom;
  // first-open measurement drift can make that false, leaving the real latest
  // message below the viewport. During the first few seconds only, keep
  // pinning to LAST while there has been no user scroll gesture.
  useLayoutEffect(() => {
    if (!initialRevealReady || !lastMessageId) return;
    if (!initialBottomPinned) return;
    if (openPinStartedAtRef.current === null) openPinStartedAtRef.current = performance.now();

    const previousLastMessageId = openPinLastMessageIdRef.current;
    openPinLastMessageIdRef.current = lastMessageId;

    const OPEN_PIN_WINDOW_MS = 6000;
    const withinOpenWindow = performance.now() - openPinStartedAtRef.current <= OPEN_PIN_WINDOW_MS;
    if (!withinOpenWindow) return;
    // NOTE: do NOT early-return when lastMessageId is unchanged. On first
    // login the cached page often shares its last message id with the
    // network-fresh page, but the fresh page extends/replaces older rows,
    // which shifts the bottom row's pixel position. We still need to
    // re-pin to LAST in that case — relying on lastMessageId alone misses
    // the jolt entirely. Suppress only when the bottom is already nailed
    // AND messages haven't grown since the last pass.
    const messagesLengthChanged = openPinMessagesLengthRef.current !== messages.length;
    openPinMessagesLengthRef.current = messages.length;
    if (
      previousLastMessageId === lastMessageId &&
      !messagesLengthChanged &&
      bottomPinReadyRef.current
    ) return;
    // PREPEND GUARD: when lastMessageId is unchanged but length grew, an
    // older page just landed (Load More / startReached). This is ALWAYS a
    // prepend — never re-pin to LAST regardless of atBottomRef, because the
    // 120px atBottomThreshold keeps atBottomRef=true for the first ~120px
    // of an upward fling. Without this, a fast scroll-up from the bottom
    // that triggers startReached snaps the viewport back to LAST mid-fling
    // (the reported "I scroll up fast and it pins me back to bottom" bug,
    // especially visible in DMs where new realtime messages keep the
    // OPEN_PIN_WINDOW alive).
    if (
      messagesLengthChanged &&
      previousLastMessageId === lastMessageId
    ) return;

    const run = () => {
      const viewport = scrollerElRef.current;
      if (!viewport) return;
      if (isChatJumpActive()) return;
      if (isViewportUserActive(viewport)) return;
      // Pure pixel-distance gate (atBottomRef has a 120px threshold and is
      // unreliable mid-fling — see RO guard above).
      const distanceFromBottom =
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
      if (distanceFromBottom > 4) return;
      if (userHasScrolledAfterPinRef.current && distanceFromBottom > 4) return;
      if (isRecentChatScrollWrite(80)) return;
      // Silent scrollTop write rather than `scrollToIndex` — the latter
      // triggers a visible Virtuoso recompute/jump every time it fires,
      // which on first-open stacks into a multi-step flicker as cached
      // messages get replaced/extended by the network refresh.
      const maxTop = viewport.scrollHeight - viewport.clientHeight;
      if (Math.abs(viewport.scrollTop - maxTop) > 1) {
        viewport.scrollTop = maxTop;
        markChatScrollWrite();
      }
    };


    // SYNCHRONOUS first pass — commits in the same paint frame as the
    // cached→fresh message swap, so the browser never paints a frame where
    // the bottom row is partially scrolled off. Without this, Android WebView
    // shows a single-frame "jolt" right after first login as the fresh page
    // replaces the cached one. The rAF + delayed passes below remain as a
    // safety net for late-hydrating row heights (avatars, link previews).
    if (!isChatJumpActive()) run();
    const r = requestAnimationFrame(() => requestAnimationFrame(run));
    // Two follow-up passes are enough to absorb the network-fresh page
    // landing on top of cached messages. The previous 5-timer barrage
    // (160/420/900/1600/2600 ms) caused a visible series of jolts on
    // cold opens.
    const timers = [200, 600].map((delay) => window.setTimeout(run, delay));
    return () => {
      cancelAnimationFrame(r);
      timers.forEach((timer) => window.clearTimeout(timer));
    };

  }, [initialRevealReady, lastMessageId, messages.length, bottomPinRevision, initialBottomPinned]);

  // OWN-MESSAGE SEND PIN. When the newest appended message belongs to the
  // current user, they just hit Send — the freshly sent bubble MUST be
  // visible regardless of `followOutput`'s atBottom state, the open-pin
  // window, or a stale jump flag. With the keyboard open Virtuoso often
  // reports atBottom=false (the visual viewport shrank under it), so
  // `followOutput` silently skips the append and the sent bubble lands
  // clipped behind the composer. The page-level `onMutate` scrollToBottom
  // can also be swallowed when `isChatJumpActive()` was left set — sending
  // a message is an explicit intent change, so release the jump and pin.
  const prevOwnPinLastIdRef = useRef<string | null>(lastMessageId);
  useLayoutEffect(() => {
    const prevId = prevOwnPinLastIdRef.current;
    prevOwnPinLastIdRef.current = lastMessageId;
    if (!lastMessageId || lastMessageId === prevId) return;
    const last = messages[messages.length - 1] as { author_id?: string | null } | undefined;
    if (!currentUserId || !last || last.author_id !== currentUserId) return;
    if (isChatJumpActive()) setChatJumpActive(false);

    const pin = () => {
      const el = scrollerElRef.current;
      if (!el) return;
      // NOTE: do NOT bail on `isViewportTouching` here. On Android, sending a
      // message keeps the soft keyboard open and the composer/viewport keeps
      // resizing for several hundred ms after send; any of those resize
      // gestures can leave the touch-tracker hot and silently swallow the
      // pin, leaving the freshly-sent bubble clipped behind the composer.
      // Send is an explicit intent change, so always honour it.
      const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
      if (Math.abs(el.scrollTop - maxTop) > 1) {
        el.scrollTop = maxTop;
        markChatScrollWrite();
      }
    };
    pin();
    const r = requestAnimationFrame(() => requestAnimationFrame(pin));
    // Trailing passes absorb composer collapse (reply pill clears, textarea
    // shrinks back to one line), optimistic bubble height settling, and on
    // Android the soft-keyboard / visualViewport reflow that can land 600ms+
    // after send commits.
    const timers = [80, 200, 360, 560, 820, 1200].map((delay) => window.setTimeout(pin, delay));
    return () => {
      cancelAnimationFrame(r);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [lastMessageId, messages, currentUserId]);


  // Only auto-follow new outgoing messages when the user is already at the
  // bottom — never yank a finger reading history.
  const followOutput = useCallback((isAtBottom: boolean) => {
    return isAtBottom ? ("auto" as const) : false;
  }, []);


  return { followOutput };
}
