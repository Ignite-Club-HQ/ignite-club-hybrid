import { useLayoutEffect, useRef } from "react";
import { useKeptPageActive } from "@/components/layout/KeptPageActivity";

/** Preserve the visible card's offset, not an absolute scrollTop. No smooth
 * scrolling or page-return restoration; ordinary navigation owns those. */
export function useReadingPosition(enabled: boolean, scope: string) {
  const container = useRef<HTMLDivElement>(null);
  const active = useKeptPageActive();
  const anchor = useRef<{ key: string; top: number; scope: string } | null>(null);
  const controller = useRef<{ capture: () => void; restore: () => void } | null>(null);
  useLayoutEffect(() => {
    const element = container.current;
    const root = document.getElementById("root");
    if (!enabled || active === false || !element || !root) { anchor.current = null; return; }
    anchor.current = null;
    const cards = () => [...element.querySelectorAll<HTMLElement>("[data-reading-row]")];
    const capture = () => {
      if (root.scrollTop < 8) { anchor.current = null; return; }
      const top = root.getBoundingClientRect().top;
      const row = cards().find(row => row.getBoundingClientRect().bottom > top + 64);
      anchor.current = row ? { key: row.dataset.readingRow ?? "", top: row.getBoundingClientRect().top, scope } : null;
    };
    const restore = () => {
      const saved = anchor.current;
      if (saved?.scope === scope) {
        const row = cards().find(row => row.dataset.readingRow === saved.key);
        if (row) {
          const delta = row.getBoundingClientRect().top - saved.top;
          if (Math.abs(delta) > 1) root.scrollTop += delta;
        }
      }
      capture();
    };
    controller.current = { capture, restore };
    root.addEventListener("scroll", capture, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(restore);
    observer?.observe(element);
    capture();
    return () => { root.removeEventListener("scroll", capture); observer?.disconnect(); controller.current = null; };
  }, [enabled, scope, active]);
  useLayoutEffect(() => { controller.current?.restore(); });
  return container;
}