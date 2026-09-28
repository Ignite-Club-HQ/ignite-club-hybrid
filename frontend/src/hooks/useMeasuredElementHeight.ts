import { DependencyList, useLayoutEffect, useRef, useState } from "react";

/**
 * Measures a chat composer's rendered height.
 *
 * The height feeds the message list's in-flow Virtuoso footer (bottomPadding),
 * so every frame in which the composer DOM and the reported height disagree
 * paints the thread either with a gap above the composer or clipped behind
 * it. To keep them in lock-step:
 *
 * 1. Measure synchronously in a layout effect on EVERY commit. A React-driven
 *    composer change (textarea clears on send, reply pill unmounts, edit mode
 *    exits) is then reported in the same commit — the setState inside a
 *    layout effect is flushed before paint, so the footer shrinks/grows in the
 *    very frame the composer does.
 * 2. Keep a ResizeObserver only for non-React resizes (font load, orientation,
 *    keyboard-driven viewport changes) and measure inside its callback
 *    directly — never behind a requestAnimationFrame, which adds a full frame
 *    of disagreement.
 */
export function useMeasuredElementHeight<T extends HTMLElement>(deps: DependencyList = [], minHeight = 56) {
  const elementRef = useRef<T>(null);
  const [height, setHeight] = useState(minHeight);
  const lastHeightRef = useRef(minHeight);

  const measure = () => {
    const element = elementRef.current;
    if (!element) return;
    const nextHeight = Math.max(minHeight, Math.ceil(element.getBoundingClientRect().height));
    if (nextHeight === lastHeightRef.current) return;
    lastHeightRef.current = nextHeight;
    setHeight(nextHeight);
  };

  // Every commit: cheap (one layout read, which the browser needs before
  // paint anyway) and guarantees same-frame agreement for React-driven
  // composer changes.
  useLayoutEffect(() => {
    measure();
  });

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(() => {
      measure();
    });

    observer.observe(element);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minHeight, ...deps]);

  return { elementRef, height };
}
