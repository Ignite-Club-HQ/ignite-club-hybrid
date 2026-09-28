/**
 * On long-press, reposition the selected message bubble so it sits in the
 * lower third of the viewport — closer to the bottom-anchored action sheet
 * and the floating reaction picker that appears just above it. Keeps the
 * selected message, reactions and action sheet visually grouped without large
 * empty gaps. Safe no-op when no scrollable ancestor exists.
 */
export function scrollMessageIntoLowerThird(el: HTMLElement | null) {
  if (!el || typeof window === "undefined") return;

  // Find nearest scrollable ancestor (covers Virtuoso + basic list scrollers).
  let parent: HTMLElement | null = el.parentElement;
  let scroller: HTMLElement | null = null;
  while (parent) {
    const style = window.getComputedStyle(parent);
    const overflowY = style.overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && parent.scrollHeight > parent.clientHeight) {
      scroller = parent;
      break;
    }
    parent = parent.parentElement;
  }

  const viewportH = window.innerHeight || document.documentElement.clientHeight;
  const bubbleRect = el.getBoundingClientRect();
  // Target: bubble bottom sits roughly at ~62% of viewport height — leaves
  // ~8–12px for the reaction pill, ~32px for the bubble itself, and the
  // remaining space for the action sheet without crowding the message.
  const targetBottom = viewportH * 0.62;
  const delta = bubbleRect.bottom - targetBottom;
  if (Math.abs(delta) < 8) return;

  if (scroller) {
    scroller.scrollBy({ top: delta, behavior: "smooth" });
  } else {
    window.scrollBy({ top: delta, behavior: "smooth" });
  }
}
