import { useEffect, useState } from "react";

function getIsVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible";
}

/**
 * Tracks `document.visibilityState`, re-rendering whenever the tab is
 * hidden/shown. Used to make chat polling (ICP/free-tier) slow down while
 * the tab is hidden and immediately catch up when it regains focus.
 */
export function useIsDocumentVisible(): boolean {
  const [isVisible, setIsVisible] = useState(getIsVisible);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibilityChange = () => setIsVisible(getIsVisible());
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  return isVisible;
}
