/**
 * Authoritative reveal gate for exact-message jumps (notification / search /
 * reply / pinned-message taps).
 *
 * The previous implementation reused `waitForChatVisualContentSettle`, which
 * gates on "NO `.animate-pulse` / pending `<img>` anywhere in the scroller".
 * On a real thread there is almost always an off-screen image or link-preview
 * skeleton somewhere in Virtuoso's (6000 px tall) overscan window, so the gate
 * never went green and the overlay was released only by its `maxMs` timer —
 * a multi-second blank chat even though the target row was mounted, aligned
 * and stationary.
 *
 * This gate is target-centric instead:
 *
 *   - the exact target row must be mounted;
 *   - it must be fully inside the USABLE viewport (above the fixed composer);
 *   - only VISIBLE row content must have finished hydrating;
 *   - visible row geometry must be unchanged for a short quiet window and for
 *     at least two consecutive animation frames.
 *
 * When all of that holds we reveal immediately — we do not wait for the jump's
 * remaining settle passes, because a stationary, correctly aligned target is
 * exactly the "visually stable" condition those passes exist to reach.
 */

const LOADING_SELECTOR = [
  ".animate-pulse",
  "[data-skeleton]",
  "[data-state='loading']",
  "[aria-busy='true']",
].join(",");

export interface ChatJumpRevealOptions {
  /** Exact target row id (`data-row-id`). */
  targetMessageId?: string | null;
  /** Bottom inset covered by the fixed composer / safe area, in px. */
  usableBottomInsetPx?: number;
  /** Continuous quiet window required before reveal. */
  quietMs?: number;
  /** Consecutive stable frames required before reveal. */
  stableFrames?: number;
  /**
   * Fail-safe: milliseconds still available for this lifecycle. When it
   * elapses we run `finalAlign()` once and reveal on the next stable frame —
   * never leaving the user on a blank thread.
   */
  budgetMs?: number;
  /** One final exact-DOM alignment, executed when the fail-safe fires. */
  finalAlign?: () => void;
  /** Diagnostics hook: receives the current blocking reason ("" when ready). */
  onGate?: (reason: string) => void;
}

function isImageLoaded(img: HTMLImageElement) {
  return img.complete && img.naturalHeight > 0;
}

function escapeRowId(id: string) {
  if (typeof CSS !== "undefined" && typeof (CSS as any).escape === "function") {
    return (CSS as any).escape(id);
  }
  return id.replace(/"/g, '\\"');
}

export function findChatRow(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-row-id="${escapeRowId(id)}"]`);
}

function visibleRows(root: HTMLElement, bottomInset: number) {
  const rootRect = root.getBoundingClientRect();
  const usableBottom = rootRect.bottom - bottomInset;
  return Array.from(root.querySelectorAll<HTMLElement>("[data-row-id]")).filter((row) => {
    const rect = row.getBoundingClientRect();
    return rect.bottom >= rootRect.top && rect.top <= usableBottom;
  });
}

/**
 * Returns "" when the thread may be revealed, otherwise a short reason code.
 * Pure + synchronous so it can be unit tested against a static DOM.
 */
export function evaluateChatJumpRevealGate(
  root: HTMLElement | null,
  options: ChatJumpRevealOptions = {},
): string {
  if (!root || !root.isConnected) return "no-root";

  const bottomInset = Math.max(0, options.usableBottomInsetPx ?? 0);
  const rootRect = root.getBoundingClientRect();
  const usableBottom = rootRect.bottom - bottomInset;
  const targetId = options.targetMessageId;

  if (targetId) {
    const row = findChatRow(root, targetId);
    if (!row) return "target-not-mounted";
    const rect = row.getBoundingClientRect();
    if (rect.height === 0) return "target-not-measured";
    // Fully visible above the composer. A row taller than the usable viewport
    // can never satisfy "fully visible", so for those we only require that its
    // bottom is above the composer (which is what `align:"end"` produces).
    const usableHeight = usableBottom - rootRect.top;
    if (rect.bottom > usableBottom + 1) return "target-clipped-by-composer";
    if (rect.height <= usableHeight && rect.top < rootRect.top - 1) return "target-above-viewport";
    if (rect.bottom < rootRect.top) return "target-outside-viewport";
  }

  const rows = visibleRows(root, bottomInset);
  if (rows.length === 0) return targetId ? "no-visible-rows" : "";

  for (const row of rows) {
    const pendingImage = Array.from(row.querySelectorAll<HTMLImageElement>("img")).some(
      (img) => !isImageLoaded(img),
    );
    if (pendingImage) return "visible-image-hydrating";
    if (row.querySelector(LOADING_SELECTOR)) return "visible-row-hydrating";
  }

  return "";
}

export function chatJumpRevealSignature(
  root: HTMLElement | null,
  options: ChatJumpRevealOptions = {},
): string {
  if (!root) return "no-root";
  const bottomInset = Math.max(0, options.usableBottomInsetPx ?? 0);
  const rootRect = root.getBoundingClientRect();
  const rows = visibleRows(root, bottomInset);
  const sample = rows.length <= 8 ? rows : [...rows.slice(0, 4), ...rows.slice(-4)];
  return [
    Math.round(root.scrollTop),
    Math.round(root.scrollHeight),
    Math.round(root.clientHeight),
    sample
      .map((row) => {
        const rect = row.getBoundingClientRect();
        return [
          row.dataset.rowId ?? "",
          Math.round(rect.top - rootRect.top),
          Math.round(rect.bottom - rootRect.top),
        ].join("/");
      })
      .join("|"),
  ].join(":");
}

/**
 * Waits until the exact jump target is mounted, aligned, unclipped and
 * visually stable, then calls `reveal()` exactly once. Returns a cancel
 * function; cancelling never calls `reveal()`.
 */
export function waitForChatJumpTargetReveal(
  root: HTMLElement | null,
  options: ChatJumpRevealOptions,
  reveal: () => void,
): () => void {
  if (typeof window === "undefined") {
    reveal();
    return () => {};
  }

  const quietMs = options.quietMs ?? 240;
  const requiredFrames = Math.max(1, options.stableFrames ?? 2);
  const budgetMs = Math.max(0, options.budgetMs ?? 3500);

  let finished = false;
  let rafId: number | null = null;
  let budgetTimer: number | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let lastSignature = "";
  let stableSince = 0;
  let stableFrames = 0;
  let failSafeArmed = false;
  const imageListeners = new Map<HTMLImageElement, () => void>();

  const cleanup = () => {
    if (rafId !== null) window.cancelAnimationFrame(rafId);
    if (budgetTimer !== null) window.clearTimeout(budgetTimer);
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    root?.removeEventListener("scroll", schedule);
    imageListeners.forEach((handler, img) => {
      img.removeEventListener("load", handler);
      img.removeEventListener("error", handler);
    });
    imageListeners.clear();
    rafId = null;
    budgetTimer = null;
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    cleanup();
    reveal();
  };

  function schedule() {
    if (finished || rafId !== null) return;
    rafId = window.requestAnimationFrame(check);
  }

  const trackPendingImages = () => {
    if (!root) return;
    Array.from(root.querySelectorAll<HTMLImageElement>("img"))
      .filter((img) => !isImageLoaded(img))
      .forEach((img) => {
        if (imageListeners.has(img)) return;
        const handler = () => schedule();
        imageListeners.set(img, handler);
        img.addEventListener("load", handler, { once: true });
        img.addEventListener("error", handler, { once: true });
      });
  };

  function check() {
    rafId = null;
    if (finished) return;
    if (!root || !root.isConnected) {
      finish();
      return;
    }

    trackPendingImages();
    const reason = evaluateChatJumpRevealGate(root, options);
    options.onGate?.(reason);
    const signature = chatJumpRevealSignature(root, options);
    const nowMs = performance.now();

    if (signature !== lastSignature) {
      lastSignature = signature;
      stableSince = nowMs;
      stableFrames = 0;
      schedule();
      return;
    }

    stableFrames += 1;
    if (stableSince === 0) stableSince = nowMs;
    const geometryStable = nowMs - stableSince >= quietMs && stableFrames >= requiredFrames;

    // Fail-safe path: one final alignment has already run, so reveal as soon
    // as two consecutive frames agree on the position — never merely because
    // a timer elapsed while the thread is still moving.
    if (failSafeArmed && stableFrames >= requiredFrames) {
      finish();
      return;
    }

    if (reason === "" && geometryStable) {
      finish();
      return;
    }

    schedule();
  }

  if (root) {
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(schedule);
      resizeObserver.observe(root);
      if (root.firstElementChild instanceof HTMLElement) {
        resizeObserver.observe(root.firstElementChild);
      }
    }
    if (typeof MutationObserver !== "undefined") {
      mutationObserver = new MutationObserver(schedule);
      mutationObserver.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    }
    root.addEventListener("scroll", schedule, { passive: true });
  }

  budgetTimer = window.setTimeout(() => {
    budgetTimer = null;
    if (finished) return;
    failSafeArmed = true;
    try { options.finalAlign?.(); } catch { /* noop */ }
    // Re-baseline so the next two frames must agree on the POST-alignment
    // position before we reveal.
    lastSignature = "";
    stableSince = 0;
    stableFrames = 0;
    schedule();
  }, budgetMs);

  schedule();

  return () => {
    if (finished) return;
    finished = true;
    cleanup();
  };
}
