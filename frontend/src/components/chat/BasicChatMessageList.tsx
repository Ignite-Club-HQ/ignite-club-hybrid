import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Loader2 } from "lucide-react";
import { useChatBasicChunkSize } from "@/hooks/useChatBasicChunkSize";
import { waitForChatVisualContentSettle } from "@/lib/chatInitialVisualSettle";
import { getChatBottomPaddingOffset } from "@/lib/chatBottomPadding";

function escapeCssAttributeValue(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Basic non-virtualised chat message list — emergency fallback used when an
 * app admin disables chat virtualisation via /admin/settings.
 *
 * Renders only the most recent 100 messages from the cached set as a plain
 * mapped list inside a single scroll container. Trades full-history scroll-up
 * and infinite pagination for predictable DOM and zero virtualiser cost,
 * which is useful as a kill-switch when a Virtuoso/Android freeze recurs.
 *
 * Implements the same `VirtualizedChatMessageListHandle` so chat pages can
 * use the two interchangeably without conditional ref logic.
 */

const DEFAULT_CHUNK = 100;

function BasicChatLoadingSkeleton() {
  const rows = [82, 64, 96, 72, 88, 60, 78];
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end gap-3 px-4 pb-6 animate-in fade-in duration-150"
      style={{
        background:
          "linear-gradient(to bottom, hsl(var(--background) / 0.96), hsl(var(--background)))",
      }}
    >
      {rows.map((width, i) => (
        <div
          key={i}
          className="flex"
          style={{ justifyContent: i % 2 === 0 ? "flex-start" : "flex-end" }}
        >
          <div
            className="h-10 rounded-2xl bg-muted animate-pulse"
            style={{ width: `${width}%`, maxWidth: "75%" }}
          />
        </div>
      ))}
    </div>
  );
}

export interface BasicChatMessageListHandle {
  scrollToBottom: (behavior?: "auto" | "smooth", options?: { force?: boolean }) => void;
  scrollToIndex: (index: number, align?: "start" | "center" | "end") => void;
  scrollToMessageId: (messageId: string, align?: "start" | "center" | "end") => boolean;
  isAtBottom: () => boolean;
  isNearBottom: (thresholdPx: number) => boolean;
}

interface Props<TMessage extends { id: string }> {
  messages: TMessage[];
  hasOlder: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
  renderItem: (message: TMessage, index: number, arr: TMessage[]) => React.ReactNode;
  topPadding?: number;
  bottomPadding?: number | string;
  className?: string;
  style?: React.CSSProperties;
  onAtBottomChange?: (atBottom: boolean) => void;
  scrollerRef?: (element: HTMLElement | Window | null) => void;
  initialBottomPinned?: boolean;
  currentUserId?: string | null;
}

function BasicChatMessageListInner<TMessage extends { id: string }>(
  {
    messages,
    hasOlder,
    isLoadingOlder: _isLoadingOlder,
    onLoadOlder: _onLoadOlder,
    renderItem,
    topPadding = 16,
    bottomPadding = 16,
    className,
    style,
    onAtBottomChange,
    scrollerRef,
    initialBottomPinned = true,
  }: Props<TMessage>,
  ref: React.Ref<BasicChatMessageListHandle>,
) {
  const chunkSize = useChatBasicChunkSize();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const lastLengthRef = useRef(0);
  const [revealed, setRevealed] = useState(false);
  // How many of the most-recent messages to render. Starts at the admin-tunable
  // chunk size and grows by `chunkSize` each time the user taps "Load earlier".
  const [revealCount, setRevealCount] = useState(() => chunkSize || DEFAULT_CHUNK);
  // Preserve scroll offset from bottom across reveals so the user's current
  // viewport doesn't jump when older rows are inserted above.
  const preserveBottomOffsetRef = useRef<number | null>(null);
  const settleCleanupRef = useRef<(() => void) | null>(null);

  // Cap to most recent revealCount messages to keep the DOM small.
  const visible = useMemo(() => {
    if (messages.length <= revealCount) return messages;
    return messages.slice(messages.length - revealCount);
  }, [messages, revealCount]);

  const truncatedCount = messages.length - visible.length;

  const canRevealMore = truncatedCount > 0 || hasOlder;

  const handleLoadEarlier = useCallback(() => {
    const el = containerRef.current;
    if (el) {
      preserveBottomOffsetRef.current = el.scrollHeight - el.scrollTop;
    }
    const step = chunkSize || DEFAULT_CHUNK;
    if (truncatedCount > 0) {
      // Reveal another page of already-cached messages first.
      setRevealCount((c) => c + step);
    } else if (hasOlder && !_isLoadingOlder) {
      // Cached set exhausted — fetch the next page from the server.
      _onLoadOlder();
      // Grow the cap proactively so the new page is visible once it lands.
      setRevealCount((c) => c + step);
    }
  }, [truncatedCount, hasOlder, _isLoadingOlder, _onLoadOlder, chunkSize]);

  // After visible grows, restore the user's scroll position relative to
  // the bottom of the content so the viewport stays put.
  useLayoutEffect(() => {
    const el = containerRef.current;
    const offset = preserveBottomOffsetRef.current;
    if (el && offset !== null) {
      el.scrollTop = el.scrollHeight - offset;
      preserveBottomOffsetRef.current = null;
    }
  }, [visible.length]);

  const isAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 4;
  }, []);

  const isNearBottom = useCallback((thresholdPx: number) => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx;
  }, []);

  const scrollToBottomImpl = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: (behavior) => {
        // Defer two paints so optimistic messages committed via React
        // Query inside `onMutate` are in the DOM and contribute to
        // scrollHeight before we pin to bottom. Otherwise the freshly
        // sent bubble lands below the viewport.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => scrollToBottomImpl(behavior)),
        );
      },

      scrollToIndex: (index, align = "center") => {
        const el = containerRef.current;
        if (!el) return;
        const child = el.querySelector<HTMLElement>(`[data-basic-row-index="${index}"]`);
        if (!child) return;
        const reservedBottom = getChatBottomPaddingOffset(bottomPadding);
        const targetTop =
          align === "end"
            ? child.offsetTop + child.offsetHeight - el.clientHeight + reservedBottom
            : align === "start"
            ? child.offsetTop
            : child.offsetTop - Math.max(0, (el.clientHeight - child.offsetHeight) / 2);
        el.scrollTo({ top: Math.max(0, targetTop), behavior: "auto" });
      },
      scrollToMessageId: (messageId, align = "center") => {
        const el = containerRef.current;
        if (!el) return false;
        const row = el.querySelector<HTMLElement>(`[data-row-id="${escapeCssAttributeValue(messageId)}"]`);
        if (!row) return false;
        const reservedBottom = getChatBottomPaddingOffset(bottomPadding);
        const targetTop =
          align === "end"
            ? row.offsetTop + row.offsetHeight - el.clientHeight + reservedBottom
            : align === "start"
            ? row.offsetTop
            : row.offsetTop - Math.max(0, (el.clientHeight - row.offsetHeight) / 2);
        el.scrollTo({ top: Math.max(0, targetTop), behavior: "auto" });
        return true;
      },
      isAtBottom,
      isNearBottom,
    }),
    [bottomPadding, isAtBottom, isNearBottom, scrollToBottomImpl],
  );

  // Initial pin to bottom on mount when requested. Keep the fallback hidden
  // until row assets/placeholders have settled, matching the virtualised path.
  useLayoutEffect(() => {
    if (revealed && visible.length > 0) return;
    settleCleanupRef.current?.();
    setRevealed(false);
    if (!initialBottomPinned) {
      setRevealed(true);
      return;
    }
    scrollToBottomImpl("auto");
    // Two-frame settle so any image with intrinsic dimensions has measured.
    requestAnimationFrame(() => {
      scrollToBottomImpl("auto");
      requestAnimationFrame(() => {
        scrollToBottomImpl("auto");
        settleCleanupRef.current = waitForChatVisualContentSettle(
          containerRef.current,
          { quietMs: 360, maxMs: 1800 },
          () => {
            scrollToBottomImpl("auto");
            requestAnimationFrame(() => {
              scrollToBottomImpl("auto");
              setRevealed(true);
            });
          },
        );
      });
    });
    return () => {
      settleCleanupRef.current?.();
      settleCleanupRef.current = null;
    };
  }, [initialBottomPinned, scrollToBottomImpl, visible.length, revealed]);

  // Auto-stick to bottom when new messages arrive and user is already there.
  useLayoutEffect(() => {
    const prev = lastLengthRef.current;
    lastLengthRef.current = visible.length;
    if (!initialBottomPinned) return;
    if (visible.length > prev && atBottomRef.current) {
      scrollToBottomImpl("auto");
    }
  }, [visible.length, initialBottomPinned, scrollToBottomImpl]);

  // Wire scrollerRef so chat pages' scroll hooks can observe the element.
  useEffect(() => {
    scrollerRef?.(containerRef.current);
    return () => scrollerRef?.(null);
  }, [scrollerRef]);

  const handleScroll = useCallback(() => {
    const next = isAtBottom();
    if (next !== atBottomRef.current) {
      atBottomRef.current = next;
      onAtBottomChange?.(next);
    }
  }, [isAtBottom, onAtBottomChange]);

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
    {!revealed ? <BasicChatLoadingSkeleton /> : null}
    <div
      ref={containerRef}
      data-chat-scroll-lock="true"
      className={className}
      onScroll={handleScroll}
      style={{
        height: "100%",
        width: "100%",
        overflowY: "auto",
        overflowX: "hidden",
        WebkitOverflowScrolling: "touch",
        opacity: revealed ? 1 : 0,
        transition: revealed ? "opacity 80ms ease-out" : "none",
        ...style,
      }}
    >
      <div style={{ height: topPadding }} />
      {canRevealMore && (
        <div className="flex justify-center px-4 py-3">
          <button
            type="button"
            onClick={handleLoadEarlier}
            disabled={_isLoadingOlder}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-4 py-2 text-xs font-medium text-secondary-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground active:bg-accent active:text-accent-foreground disabled:opacity-60"
          >
            {_isLoadingOlder ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading…
              </>
            ) : (
              <>Load earlier messages</>
            )}
          </button>
        </div>
      )}
      {visible.map((message, index) => (
        <div key={message.id} data-basic-row-index={index} data-row-id={message.id}>
          {renderItem(message, index, visible)}
        </div>
      ))}
      <div style={{ height: typeof bottomPadding === "number" ? bottomPadding : undefined }}>
        {typeof bottomPadding === "string" ? (
          <div style={{ paddingBottom: bottomPadding }} />
        ) : null}
      </div>
      {_isLoadingOlder ? (
        <div className="flex justify-center py-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : null}
    </div>
    </div>
  );
}

export const BasicChatMessageList = forwardRef(BasicChatMessageListInner) as <
  TMessage extends { id: string },
>(
  props: Props<TMessage> & { ref?: React.Ref<BasicChatMessageListHandle> },
) => React.ReactElement;
