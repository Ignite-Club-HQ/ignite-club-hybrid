import { useEffect, type MutableRefObject } from "react";
import { isViewportUserActive } from "@/lib/chatScrollIntent";

type JumpAnchorDeps = {
  initialRevealReady: boolean;
  jumpAnchorNonce: number;
  postJumpAnchorRef: MutableRefObject<{ id: string; at: number } | null>;
  scrollerElRef: MutableRefObject<HTMLElement | null>;
  userHasScrolledAfterPinRef: MutableRefObject<boolean>;
  alignMessageIdInViewRef: MutableRefObject<((messageId: string, align?: "start" | "center" | "end") => boolean) | undefined>;
};

export function useChatJumpAnchor({
  initialRevealReady,
  jumpAnchorNonce,
  postJumpAnchorRef,
  scrollerElRef,
  userHasScrolledAfterPinRef,
  alignMessageIdInViewRef,
}: JumpAnchorDeps) {
  // POST-REVEAL JUMP ANCHOR (deep-link / notification path). The stay-pinned
  // RO guard and the open-pin window above both early-return when
  // `initialBottomPinned` is false — which it always is on deep-link pages —
  // so after a jump reveal there was NO writer compensating the late
  // hydration that cold starts deliver over the next several seconds (read
  // receipts at 2-4s, reactions, link previews, image decode). Those resizes
  // played out in plain sight as the "messages keep moving after the skeleton
  // reveal" jolt. For the same 6s settle window, keep the jump target glued
  // to its revealed position using the SAME exact-DOM alignment the reveal
  // gate used (live composer inset, 2px epsilon no-op), so any late reflow is
  // absorbed invisibly instead of extending the skeleton (which historically
  // caused multi-second blank chats). Retires on the first real user scroll
  // gesture — it must never fight someone scrolling away from the target.
  useEffect(() => {
    if (!initialRevealReady) return;
    const anchor = postJumpAnchorRef.current;
    if (!anchor) return;
    if (typeof ResizeObserver === "undefined") return;
    const viewport = scrollerElRef.current;
    if (!viewport) return;
    const inner = viewport.firstElementChild as HTMLElement | null;
    if (!inner) return;

    // Same window as STAY_PINNED_MS so late-hydrating read receipts are
    // compensated before the guard retires.
    const ANCHOR_WINDOW_MS = 6000;
    const retireAt = anchor.at + ANCHOR_WINDOW_MS;
    const remaining = retireAt - performance.now();
    if (remaining <= 0) return;

    let cancelled = false;
    let lastSignature = "";
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;

    const retire = () => {
      if (cancelled) return;
      cancelled = true;
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.clearTimeout(stopTimer);
    };

    const reanchor = () => {
      if (cancelled) return;
      if (performance.now() > retireAt) {
        retire();
        return;
      }
      // Hard guards: never re-align from an observer callback while the user
      // is actively scrolling or has scrolled away from the revealed target.
      if (isViewportUserActive(viewport)) {
        retire();
        return;
      }
      if (userHasScrolledAfterPinRef.current) {
        retire();
        return;
      }
      // Geometry-signature gate: mutation noise that doesn't move anything
      // (class flips, text ticks) must not even run the DOM measurement.
      const signature = `${Math.round(viewport.scrollTop)}:${Math.round(viewport.scrollHeight)}:${Math.round(viewport.clientHeight)}`;
      if (signature === lastSignature) return;
      lastSignature = signature;
      // alignMessageIdInView is idempotent here: live composer inset, 2px
      // epsilon no-op, and a single synchronous write — no intermediate paint.
      alignMessageIdInViewRef.current?.(anchor.id, "end");
    };

    resizeObserver = new ResizeObserver(reanchor);
    resizeObserver.observe(viewport);
    resizeObserver.observe(inner);
    mutationObserver = new MutationObserver(reanchor);
    mutationObserver.observe(viewport, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const stopTimer = window.setTimeout(retire, remaining + 50);

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.clearTimeout(stopTimer);
    };
  }, [initialRevealReady, jumpAnchorNonce]);



}
