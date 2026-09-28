import { useEffect, useState } from "react";

/**
 * useState backed by sessionStorage so simple filter values (e.g. selected
 * club id) persist across tab navigation within the same session.
 */
export function usePersistedFilter(key: string, initial: string): [string, (v: string) => void] {
  const [value, setValue] = useState<string>(() => {
    if (typeof window === "undefined") return initial;
    try {
      return window.sessionStorage.getItem(key) ?? initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      /* noop */
    }
  }, [key, value]);

  return [value, setValue];
}
