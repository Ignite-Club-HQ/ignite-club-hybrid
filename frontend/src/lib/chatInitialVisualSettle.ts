type Timer = number;

interface ChatVisualSettleOptions {
  quietMs?: number;
  maxMs?: number;
}

const LOADING_SELECTOR = [
  ".animate-pulse",
  "[data-skeleton]",
  "[data-state='loading']",
  "[aria-busy='true']",
  "[data-media-pending='true']",
].join(",");

function isImageLoaded(img: HTMLImageElement) {
  return img.complete && img.naturalHeight > 0;
}

function getVisibleRowGeometrySignature(root: HTMLElement) {
  const rootRect = root.getBoundingClientRect();
  const visibleRows = Array.from(root.querySelectorAll<HTMLElement>("[data-row-id]")).filter((row) => {
    const rect = row.getBoundingClientRect();
    return rect.bottom >= rootRect.top && rect.top <= rootRect.bottom;
  });

  if (visibleRows.length === 0) return "no-visible-rows";

  const sample = visibleRows.length <= 8
    ? visibleRows
    : [...visibleRows.slice(0, 4), ...visibleRows.slice(-4)];

  return sample
    .map((row) => {
      const rect = row.getBoundingClientRect();
      return [
        row.dataset.rowId ?? "",
        Math.round(rect.top - rootRect.top),
        Math.round(rect.bottom - rootRect.top),
        Math.round(rect.height),
      ].join("/");
    })
    .join("|");
}

/**
 * Holds chat reveal until visible row assets/placeholders stop changing.
 *
 * Chat rows hydrate in stages on a cold login: cached text first, then
 * avatars/signed images/link-card skeletons/read state. Revealing between
 * those stages lets the user see Virtuoso/basic scrollers correct the bottom
 * anchor. This helper waits for pending images and loading placeholders to
 * clear, then requires a short quiet window of unchanged scroll metrics.
 */
export function waitForChatVisualContentSettle(
  root: HTMLElement | null,
  options: ChatVisualSettleOptions,
  done: () => void,
) {
  if (!root || typeof window === "undefined") {
    done();
    return () => {};
  }

  const quietMs = options.quietMs ?? 520;
  const maxMs = options.maxMs ?? 2400;
  let finished = false;
  let maxTimer: Timer | null = null;
  let rafId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let lastSignature = "";
  let stableSince = 0;
  let stableFrames = 0;
  const imageListeners = new Map<HTMLImageElement, () => void>();

  const cleanup = () => {
    if (maxTimer !== null) window.clearTimeout(maxTimer);
    if (rafId !== null) window.cancelAnimationFrame(rafId);
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    root.removeEventListener("scroll", scheduleCheck);
    imageListeners.forEach((handler, img) => {
      img.removeEventListener("load", handler);
      img.removeEventListener("error", handler);
    });
    imageListeners.clear();
    maxTimer = null;
    rafId = null;
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    cleanup();
    done();
  };

  const scheduleCheck = () => {
    if (finished || rafId !== null) return;
    rafId = window.requestAnimationFrame(check);
  };

  const attachPendingImageListeners = (pendingImages: HTMLImageElement[]) => {
    pendingImages.forEach((img) => {
      if (imageListeners.has(img)) return;
      const handler = () => scheduleCheck();
      imageListeners.set(img, handler);
      img.addEventListener("load", handler, { once: true });
      img.addEventListener("error", handler, { once: true });
    });
  };

  function check() {
    rafId = null;
    if (finished || !root.isConnected) {
      finish();
      return;
    }

    const pendingImages = Array.from(root.querySelectorAll<HTMLImageElement>("img")).filter(
      (img) => !isImageLoaded(img),
    );
    attachPendingImageListeners(pendingImages);

    const loadingCount = root.querySelectorAll(LOADING_SELECTOR).length;
    const signature = [
      pendingImages.length,
      loadingCount,
      Math.round(root.scrollTop),
      Math.round(root.scrollHeight),
      Math.round(root.clientHeight),
      root.firstElementChild?.childElementCount ?? root.childElementCount,
      getVisibleRowGeometrySignature(root),
    ].join(":");

    const ready = pendingImages.length === 0 && loadingCount === 0;
    if (!ready) {
      lastSignature = signature;
      stableSince = 0;
      stableFrames = 0;
      return;
    }

    const now = performance.now();
    if (signature !== lastSignature) {
      lastSignature = signature;
      stableSince = now;
      stableFrames = 0;
      scheduleCheck();
      return;
    }

    stableFrames += 1;
    if (stableSince === 0) stableSince = now;
    if (now - stableSince >= quietMs && stableFrames >= 2) {
      finish();
      return;
    }

    // Keep sampling through the quiet window. ResizeObserver / MutationObserver
    // do not fire for every programmatic scrollTop correction, and those pure
    // scroll movements are exactly what must stay hidden behind the skeleton.
    scheduleCheck();
  }

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(scheduleCheck);
    resizeObserver.observe(root);
    if (root.firstElementChild instanceof HTMLElement) {
      resizeObserver.observe(root.firstElementChild);
    }
  }

  mutationObserver = new MutationObserver(scheduleCheck);
  mutationObserver.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });

  root.addEventListener("scroll", scheduleCheck, { passive: true });

  maxTimer = window.setTimeout(finish, maxMs);
  scheduleCheck();

  return () => {
    finished = true;
    cleanup();
  };
}