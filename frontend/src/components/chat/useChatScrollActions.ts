import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import { debugLogEvent } from "./chatVirtDebug";
import { getChatBottomPaddingOffset } from "@/lib/chatBottomPadding";
import { isChatJumpActive } from "@/lib/chatJumpActive";
import { isViewportTouching, isViewportUserActive } from "@/lib/chatScrollIntent";
import { isRecentChatScrollWrite, markChatScrollWrite } from "@/lib/chatScrollWriteLock";
import { escapeChatCssAttributeValue } from "./chatVirtuosoEnvironment";
import type { VirtualizedChatMessageListHandle } from "./VirtualizedChatMessageList";

type ScrollActionDeps = {
  ref: React.Ref<VirtualizedChatMessageListHandle>;
  virtuosoRef: MutableRefObject<VirtuosoHandle | null>;
  scrollerElRef: MutableRefObject<HTMLElement | null>;
  messagesLengthRef: MutableRefObject<number>;
  atBottomRef: MutableRefObject<boolean>;
  bottomPadding: number | string;
};

export function useChatScrollActions({
  ref,
  virtuosoRef,
  scrollerElRef,
  messagesLengthRef,
  atBottomRef,
  bottomPadding,
}: ScrollActionDeps) {
  const safeScrollToIndex = useCallback(
    (payload: any, reason: string) => {
      if (messagesLengthRef.current <= 0) {
        debugLogEvent("scroll-to-index-skipped-empty", { reason });
        return false;
      }
      try {
        virtuosoRef.current?.scrollToIndex(payload);
        return true;
      } catch (error) {
        console.warn("[VirtualizedChatMessageList] scrollToIndex skipped", { reason, error });
        return false;
      }
    },
    [messagesLengthRef, virtuosoRef],
  );

  const pinToTrueBottom = useCallback(
    (reason: string, _behavior: "auto" | "smooth" = "auto") => {
      if (messagesLengthRef.current <= 0) return false;
      if (isChatJumpActive()) return false;
      const el = scrollerElRef.current;
      if (!el) return false;
      const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
      const delta = Math.abs(el.scrollTop - maxTop);
      if (delta <= 1) return true;
      debugLogEvent("pin-to-true-bottom", { reason, from: Math.round(el.scrollTop), to: Math.round(maxTop) });
      el.scrollTop = maxTop;
      markChatScrollWrite();
      return true;
    },
    [messagesLengthRef, scrollerElRef],
  );

  const bottomPaddingRef = useRef(bottomPadding);
  const bottomPaddingChangedAtRef = useRef(0);
  const repinAfterPaddingRef = useRef(false);
  if (bottomPaddingRef.current !== bottomPadding) {
    bottomPaddingRef.current = bottomPadding;
    const el = scrollerElRef.current;
    if (el) {
      const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
      repinAfterPaddingRef.current = maxTop - el.scrollTop <= 24;
    }
    bottomPaddingChangedAtRef.current =
      typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  const bottomPaddingQuiet = useCallback((quietMs = 180) => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    return now - bottomPaddingChangedAtRef.current >= quietMs;
  }, []);

  useLayoutEffect(() => {
    if (!repinAfterPaddingRef.current) return;
    repinAfterPaddingRef.current = false;
    if (messagesLengthRef.current <= 0) return;
    if (isChatJumpActive()) return;
    const el = scrollerElRef.current;
    if (!el) return;
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    if (Math.abs(el.scrollTop - maxTop) <= 1) return;
    el.scrollTop = maxTop;
    markChatScrollWrite();
  }, [bottomPadding, messagesLengthRef, scrollerElRef]);

  const alignMessageIdInView = useCallback(
    (messageId: string, align: "start" | "center" | "end" = "center") => {
      const el = scrollerElRef.current;
      if (!el) return false;
      const escapedId = escapeChatCssAttributeValue(messageId);
      const row = el.querySelector<HTMLElement>(`[data-row-id="${escapedId}"]`);
      if (!row) return false;
      const rowRect = row.getBoundingClientRect();
      const scrollerRect = el.getBoundingClientRect();
      const reservedBottom =
        align === "end" ? getChatBottomPaddingOffset(bottomPaddingRef.current) : 0;
      const targetTop =
        align === "end"
          ? el.scrollTop + rowRect.bottom - scrollerRect.bottom + reservedBottom
          : align === "start"
          ? el.scrollTop + rowRect.top - scrollerRect.top
          : el.scrollTop + rowRect.top - scrollerRect.top - Math.max(0, (el.clientHeight - rowRect.height) / 2);
      const previousScrollTop = el.scrollTop;
      const nextScrollTop = Math.max(0, targetTop);
      if (Math.abs(nextScrollTop - previousScrollTop) < 2) return true;
      el.scrollTo({ top: nextScrollTop, behavior: "auto" });
      markChatScrollWrite();
      console.log("[jumpToMessage] exact DOM correction", {
        messageId,
        align,
        previousScrollTop,
        targetTop: nextScrollTop,
        rowTop: rowRect.top,
        rowBottom: rowRect.bottom,
        scrollerTop: scrollerRect.top,
        scrollerBottom: scrollerRect.bottom,
      });
      return true;
    },
    [scrollerElRef],
  );

  const jumpAlignOwnedByContentGateRef = useRef<string | null>(null);
  const postJumpAnchorRef = useRef<{ id: string; at: number } | null>(null);
  const [jumpAnchorNonce, setJumpAnchorNonce] = useState(0);

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: (behavior = "auto", options) => {
        const run = () => {
          if (messagesLengthRef.current <= 0) return;
          if (isChatJumpActive()) return;
          const viewport = scrollerElRef.current;
          if (options?.force ? isViewportTouching(viewport) : isViewportUserActive(viewport)) return;
          pinToTrueBottom("imperative-scroll-to-bottom", behavior);
        };
        run();
        requestAnimationFrame(() => requestAnimationFrame(run));
        window.setTimeout(run, 200);
        window.setTimeout(run, 400);
        window.setTimeout(run, 650);
      },

      scrollToIndex: (index, align = "center") => {
        if (messagesLengthRef.current <= 0) return;
        const last = Math.max(0, messagesLengthRef.current - 1);
        const dataIndex = Math.max(0, Math.min(index, last));
        const offset = align === "end" && dataIndex !== last ? getChatBottomPaddingOffset(bottomPadding) : 0;
        safeScrollToIndex({
          index: dataIndex,
          align,
          offset,
          behavior: "auto",
        }, "imperative-scroll-to-index");
      },
      scrollToMessageId: (messageId, align = "center") => alignMessageIdInView(messageId, align),

      isAtBottom: () => atBottomRef.current,
      isNearBottom: (thresholdPx: number) => {
        const el = scrollerElRef.current;
        if (!el) return true;
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        return distance <= Math.max(0, thresholdPx);
      },
    }),
    [ref, bottomPadding, safeScrollToIndex, alignMessageIdInView, messagesLengthRef, scrollerElRef, atBottomRef, pinToTrueBottom],
  );

  return {
    safeScrollToIndex,
    pinToTrueBottom,
    alignMessageIdInView,
    bottomPaddingRef,
    bottomPaddingQuiet,
    jumpAlignOwnedByContentGateRef,
    postJumpAnchorRef,
    jumpAnchorNonce,
    setJumpAnchorNonce,
  };
}
