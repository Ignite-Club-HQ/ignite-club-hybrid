import { forwardRef, memo, useLayoutEffect, useRef, type ComponentProps } from "react";
import { debugLogMeasure, debugTrackRender, isChatVirtDebugEnabled, classifyChatRow, type ChatRowType } from "./chatVirtDebug";
import { setCachedRowHeight } from "./chatRowHeightCache";
import { getLastChatScrollAt, runWhenChatScrollIdle } from "@/lib/chatScrollActivity";
import { estimateChatRowHeight } from "./chatRowHeightEstimator";
import { isAndroidNativeWebView, installVirtuosoResizeObserverErrorGuard } from "./chatVirtuosoEnvironment";

/**
 * Hoisted Header/Footer components. Inline declarations inside `useMemo`
 * (with topPadding/bottomPadding deps) generated a new component identity
 * every time padding changed, forcing Virtuoso to remount the footer and
 * apply a paddingTop correction — visible as an upward jolt. Reading the
 * padding values from Virtuoso's `context` keeps the function identity
 * stable across renders.
 */
export type ChatVirtuosoContext = { topPadding: number; bottomPadding: number | string };
export const ChatVirtuosoHeader = ({ context }: { context?: ChatVirtuosoContext }) => (
  <div style={{ height: context?.topPadding ?? 0, overflowAnchor: "none" }} />
);
export const ChatVirtuosoFooter = ({ context }: { context?: ChatVirtuosoContext }) => (
  <div style={{ height: context?.bottomPadding ?? 0 }} />
);


export const ChatVirtuosoScroller = forwardRef<HTMLDivElement, ComponentProps<"div"> & { context?: unknown }>(
  ({ context: _context, style, ...props }, scrollerRef) => (
    <div
      {...props}
      ref={scrollerRef}
      data-chat-scroll-lock="true"
      data-chat-virtualized="true"
      className={`${(props as any).className ?? ""} scrollbar-hide`}
      style={{
        ...style,
        overscrollBehaviorY: "contain",
        // iOS WebKit momentum scrolling. Harmless on Android/Chromium.
        // Do not add transform/will-change here: promoted overflow scrollers
        // with virtualized children flicker in Android WebView during upward
        // momentum when rows mount and Virtuoso updates paddingTop.
        WebkitOverflowScrolling: "touch",
      } as React.CSSProperties}
    />
  ),
);
ChatVirtuosoScroller.displayName = "ChatVirtuosoScroller";

// `skipAnimationFrameInResizeObserver` (set on <Virtuoso/> below) makes item
// measurement synchronous inside the ResizeObserver callback. The browser
// then legitimately reports the benign "ResizeObserver loop completed with
// undelivered notifications" error (per react-virtuoso docs / issue #1049).
// Swallow ONLY that specific message so it doesn't pollute error overlays
// or monitoring. Installed once at module load.
installVirtuosoResizeObserverErrorGuard();



// Custom Item wrapper that applies CSS containment to each virtualised row.
// This is the single biggest win for fast upward scrolls on native: when a
// row mounts it can no longer invalidate ancestor layout/paint, so the
// 1400px upward overscan (which mounts many rows during a fast flick) stops
// causing main-thread layout thrash.
//
// IMPORTANT: We use `contain: layout style` (NOT `content`) because `content`
// implies `paint`, which promotes every row to its own rasterisation layer.
// On Android WebView, mounting a paint-contained element during a prepend
// causes a one-frame white flash before the layer's contents are rasterised
// — this is the "flash when older messages load" the user reports. Layout
// containment alone gives us the layout-isolation win without the per-row
// rasterisation cost.
export const ChatVirtuosoItem = forwardRef<HTMLDivElement, ComponentProps<"div"> & { context?: unknown }>(
  ({ context: _context, style, ...props }, itemRef) => (
    <div
      {...props}
      ref={itemRef}
      data-chat-virtuoso-item="true"
      style={{
        ...style,
        contain: "layout style",
      }}
    />
  ),
);
ChatVirtuosoItem.displayName = "ChatVirtuosoItem";

/**
 * Wraps a virtualised row to record render churn (key stability signal) and
 * the first-paint measured height vs the static estimate. Only mounted when
 * `isChatVirtDebugEnabled()` is true, so it has zero cost in production.
 */
function DebugRowProbe({
  messageId,
  estimated,
  rowType,
  children,
}: {
  messageId: string;
  estimated: number | undefined;
  rowType: ChatRowType;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  debugTrackRender(messageId);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    debugLogMeasure(messageId, estimated, el.offsetHeight, rowType);
  }, [messageId, estimated, rowType]);
  return (
    <div ref={ref} data-debug-probe={messageId} data-row-type={rowType}>
      {children}
    </div>
  );
}

/**
 * Always-mounted measurement wrapper. Writes the row's real `offsetHeight`
 * into the module-level cache (`chatRowHeightCache`) so `estimateChatRowHeight`
 * can return the exact previous value the next time this row mounts. Uses a
 * ResizeObserver so reactions / edits / late-loading link previews update the
 * cached value as the row's true height changes.
 *
 * Identity-stable component (declared at module scope) — safe to use inside a
 * stable `itemContent` callback.
 */
function CachedMeasureRow({
  messageId,
  signature,
  children,
}: {
  messageId: string;
  signature: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest signature in a ref so the ResizeObserver callback always
  // writes the freshest version alongside the measured height (without
  // re-subscribing the observer on every signature change).
  const sigRef = useRef(signature);
  sigRef.current = signature;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const write = () => {
      const h = el.offsetHeight;
      if (h > 0) setCachedRowHeight(messageId, h, sigRef.current);
    };
    write();
    // Android WebView crash fix: a fast fling through chat history was creating
    // hundreds of per-row ResizeObservers in seconds (546 total in the field
    // snapshot), which correlated with 14–18s compositor stalls / app kills.
    // Virtuoso already observes row size; on Android we only capture the mount
    // height and skip our extra live observer. Edits/reactions still recapture
    // through the signature layout effect below.
    if (isAndroidNativeWebView()) return;
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => ro.disconnect();
  }, [messageId]);
  // Re-write the cached height whenever the signature changes (edit, reaction,
  // preview hydrate) — content height may shift before the ResizeObserver
  // fires, so capture it eagerly. Also fires a short-lived ResizeObserver to
  // catch animated/late layout changes (Android WebView skips the live
  // observer above, and Virtuoso's own observer can miss a reaction chip
  // landing inside a `contain: layout` wrapper — visible as overlapping rows
  // immediately after reacting).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const write = () => {
      const el2 = ref.current;
      if (!el2) return;
      const h = el2.offsetHeight;
      if (h > 0) setCachedRowHeight(messageId, h, signature);
    };
    // Late writes (rAF, 120ms, 360ms, short-RO) update measured heights
    // *after* the row has already mounted. If the user is actively scrolling
    // (or just stopped), pushing those updates into Virtuoso's itemSize cache
    // mid-fling causes visible row shifts: the message the user is reading
    // jolts down/up as a row above re-measures. Defer all late writes until
    // the chat scroller has been idle for ~600ms (bumped from 400ms — the
    // post-fling compositor settle on Android WebView regularly takes
    // 450–550ms before paddingTop corrections stop landing, and writes
    // inside that window were the residual cause of "messages drift down
    // after I stop scrolling").
    const IDLE_MS = 600;
    let cancelIdle: (() => void) | null = null;
    let raf: number | null = null;
    let t1: ReturnType<typeof setTimeout> | null = null;
    let t2: ReturnType<typeof setTimeout> | null = null;
    let ro: ResizeObserver | null = null;
    let roTimer: ReturnType<typeof setTimeout> | null = null;

    // Immediate write is safe on web — it lands in the same layout pass.
    // Android WebView: if the user is actively scrolling, even a same-pass
    // setCachedRowHeight feeds Virtuoso's itemSize cache mid-touch and the
    // compositor re-rasterises the visible band for one frame = the slow
    // scroll-up flicker. Defer to scroll-idle on Android only; web keeps
    // the synchronous write so reactions/edits commit without delay.
    if (isAndroidNativeWebView()) {
      const sinceScrollEager = performance.now() - getLastChatScrollAt();
      if (sinceScrollEager >= IDLE_MS) {
        write();
      } else {
        cancelIdle = runWhenChatScrollIdle(write, IDLE_MS);
      }
    } else {
      write();
    }

    const writeWhenIdle = () => {
      const since = performance.now() - getLastChatScrollAt();
      if (since >= IDLE_MS) {
        write();
        return;
      }
      cancelIdle?.();
      cancelIdle = runWhenChatScrollIdle(write, IDLE_MS);
    };

    const scheduleLateWrites = () => {
      raf = requestAnimationFrame(writeWhenIdle);
      t1 = setTimeout(writeWhenIdle, 120);
      t2 = setTimeout(writeWhenIdle, 360);
      // Android WebView: skip the short-lived ResizeObserver. On slow upward
      // scroll with realtime read receipts firing, dozens of 600ms ROs stack
      // up and land deferred itemSize writes the moment the user pauses,
      // producing visible paddingTop jolts that read as flicker. The rAF +
      // 120ms + 360ms timeouts above (all scroll-idle gated) are sufficient
      // to capture late content like link previews / reaction chips.
      if (isAndroidNativeWebView()) return;
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => {
          // RO can fire during a scroll-driven re-layout. Gate again.
          writeWhenIdle();
        });
        ro.observe(el);
        roTimer = setTimeout(() => {
          ro?.disconnect();
          ro = null;
        }, 600);
      }
    };

    const since = performance.now() - getLastChatScrollAt();
    if (since >= IDLE_MS) {
      scheduleLateWrites();
    } else {
      cancelIdle = runWhenChatScrollIdle(scheduleLateWrites, IDLE_MS);
    }

    return () => {
      cancelIdle?.();
      if (raf !== null) cancelAnimationFrame(raf);
      if (t1) clearTimeout(t1);
      if (t2) clearTimeout(t2);
      if (roTimer) clearTimeout(roTimer);
      ro?.disconnect();
    };
  }, [messageId, signature]);
  return (
    <div ref={ref} data-row-id={messageId}>
      {children}
    </div>
  );
}

/**
 * Memoised wrapper for one virtualised row. Virtuoso re-invokes the parent's
 * `itemContent` for every visible row each time the `data` array reference
 * changes (e.g. on every prepend page). Without memoisation, that means the
 * parent's `renderItem` closure is invoked — and each `ChatMessage` rebuilt
 * — for every visible row on every prepend, producing the "21 renders / 1.5s"
 * key churn observed in production telemetry.
 *
 * This adapter takes ONLY the message reference as a memo key; the real
 * `renderItem`, the index map, and the messages array are read from refs so
 * an updated parent closure does not invalidate every row. The result: a row
 * only re-renders when its OWN message reference changes (edit, reaction,
 * read-receipt update — all already produce a fresh message object via the
 * upstream cache).
 */
type ChatRowAdapterProps = {
  message: { id: string };
  signature: string;
  renderItemRef: React.MutableRefObject<
    (message: any, index: number, arr: any[]) => React.ReactNode
  >;
  uniqueMessagesRef: React.MutableRefObject<any[]>;
  indexByIdRef: React.MutableRefObject<Map<string, number>>;
  currentUserIdRef: React.MutableRefObject<string | null | undefined>;
};

export const ChatRowAdapter = memo(
  function ChatRowAdapter({
    message,
    signature,
    renderItemRef,
    uniqueMessagesRef,
    indexByIdRef,
    currentUserIdRef,
  }: ChatRowAdapterProps) {
    const idx = indexByIdRef.current.get(message.id);
    if (idx === undefined) return null;
    const rows = uniqueMessagesRef.current;
    const currentUserId = currentUserIdRef.current;
    const child = renderItemRef.current(message, idx, rows);
    const debug = isChatVirtDebugEnabled();
    const estimated =
      debug && idx >= 0
        ? estimateChatRowHeight(message as any, idx, rows, currentUserId)
        : undefined;
    const measured = (
      <CachedMeasureRow messageId={message.id} signature={signature}>{child}</CachedMeasureRow>
    );
    if (estimated === undefined) return measured;
    const rowType = classifyChatRow(message as Parameters<typeof classifyChatRow>[0]);
    return (
      <DebugRowProbe messageId={message.id} estimated={estimated} rowType={rowType}>
        {measured}
      </DebugRowProbe>
    );
  },
  // Skip re-render unless THIS row's layout-affecting signature changed.
  // Using signature equality (not message reference) means upstream churn —
  // read-receipt merges, profile-cache refreshes, prepend-page object
  // re-spreading — no longer re-renders every visible row. Only edits,
  // reactions, link-preview hydration, neighbour-grouping changes etc.
  // (anything chatRowSignature captures) trigger a real re-render.
  // Ref props are stable for the lifetime of the parent component.
  (prev, next) => prev.signature === next.signature && prev.message.id === next.message.id,
);

/**
 * Lightweight skeleton overlay shown briefly while a deep-link / jump-to-
 * message is hydrating. Uses semantic tokens so it follows the active theme,
 * and `pointer-events-none` so the user can still scroll/tap underneath if
 * they want to abort.
 */
export function JumpHydrationSkeleton({ visible = true }: { visible?: boolean }) {
  const rows = [82, 64, 96, 72, 88, 60, 78];
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end gap-3 px-4 pb-6"
      style={{
        // Solid background — any translucency lets the underlying virtualised
        // list bleed through and the user sees the multi-pass settle "bobble"
        // as deferred row heights stabilise. Solid + fade-out transition
        // makes the chat appear fully settled when the overlay lifts.
        // NOTE: do NOT add backdrop-filter here. On Android WebView, a
        // backdrop blur layered over a virtualised scroller forces the
        // compositor to re-rasterise on every scroll frame and causes
        // multi-second freezes.
        background: "hsl(var(--background))",
        opacity: visible ? 1 : 0,
        // Slow fade-out so the underlying chat is already stationary by the
        // time it becomes visible — no perceptible bobble after a deep link.
        transition: "opacity 260ms ease-out",
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



