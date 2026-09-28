import { useEffect } from "react";

/**
 * Sets the document title for accessibility and SEO.
 * Appends " | Ignite" suffix automatically.
 */
export function usePageTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} | Ignite` : "Ignite";
    return () => {
      document.title = prev;
    };
  }, [title]);
}
