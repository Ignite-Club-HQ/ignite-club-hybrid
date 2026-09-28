import { useMemo } from "react";
import { fuzzyMatch } from "@/lib/fuzzySearch";

interface HighlightedTextProps {
  text: string;
  query?: string;
  className?: string;
}

/**
 * Renders text with fuzzy-matched characters highlighted. Falls back to
 * plain text when no query is supplied or no match is found.
 */
export function HighlightedText({ text, query, className }: HighlightedTextProps) {
  const indices = useMemo(() => {
    if (!query || !query.trim() || !text) return null;
    const m = fuzzyMatch(text, query);
    return m && m.indices.length > 0 ? new Set(m.indices) : null;
  }, [text, query]);

  if (!indices) return <span className={className}>{text}</span>;

  return (
    <span className={className}>
      {Array.from(text).map((ch, i) =>
        indices.has(i) ? (
          <mark
            key={i}
            className="bg-primary/20 text-foreground rounded-sm px-0 font-semibold"
          >
            {ch}
          </mark>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </span>
  );
}
