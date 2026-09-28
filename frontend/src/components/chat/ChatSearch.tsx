import { useState, useEffect, useCallback, useRef } from "react";
import { Search, ArrowLeft, X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useDebounce } from "@/hooks/useDebounce";

interface ChatSearchProps {
  onSearch: (query: string) => void;
  debounceMs?: number;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isSearching?: boolean;
}

export function ChatSearchTrigger({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" onClick={onClick} className="h-8 w-8">
      <Search className="h-4 w-4" />
    </Button>
  );
}

export function ChatSearchBar({ onSearch, debounceMs = 300, isOpen, onOpenChange, isSearching = false }: ChatSearchProps) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, debounceMs);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onSearch(debouncedQuery);
  }, [debouncedQuery, onSearch]);

  useEffect(() => {
    if (isOpen) {
      // Small delay to allow animation
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
    }
  }, [isOpen]);

  const handleClose = useCallback(() => {
    setQuery("");
    onOpenChange(false);
  }, [onOpenChange]);

  const handleClear = useCallback(() => {
    setQuery("");
    inputRef.current?.focus();
  }, []);

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 flex items-center gap-2 px-2 bg-background z-50 animate-in fade-in slide-in-from-right-4 duration-200">
      <Button variant="ghost" size="icon" onClick={handleClose} className="shrink-0 h-9 w-9">
        <ArrowLeft className="h-5 w-5" />
      </Button>
      <div className="relative flex-1 min-w-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder="Search messages..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 bg-muted/50 border-0 pl-9 pr-20 focus-visible:ring-1 text-ellipsis"
        />
        {/* Trailing controls: fixed-width slots aligned to the input so the
            spinner never shifts when text truncates or width changes. */}
        <div className="absolute right-1 top-0 h-9 flex items-center gap-0.5">
          <span
            className="flex h-7 w-7 items-center justify-center pointer-events-none"
            aria-hidden={!isSearching}
          >
            {isSearching && (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            )}
          </span>
          <span className="flex h-7 w-7 items-center justify-center">
            {query && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClear}
                className="h-7 w-7"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </span>
        </div>
        <span className="sr-only" aria-live="polite">
          {isSearching ? "Searching messages" : ""}
        </span>
      </div>
    </div>
  );
}

export function ChatSearchLoadingState() {
  // Skeleton list mimicking message rows so the user always sees results
  // loading instead of any "no messages" empty state during fetch.
  const rows = [
    { side: "left", w: "70%" },
    { side: "right", w: "55%" },
    { side: "left", w: "85%" },
    { side: "left", w: "45%" },
    { side: "right", w: "65%" },
    { side: "left", w: "75%" },
  ] as const;

  return (
    <div
      className="flex flex-col gap-3 px-3 py-4"
      role="status"
      aria-live="polite"
      aria-label="Searching messages"
    >
      <span className="sr-only">Searching messages…</span>
      {rows.map((row, i) => (
        <div
          key={i}
          className={`flex ${row.side === "right" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`flex max-w-[80%] items-end gap-2 ${
              row.side === "right" ? "flex-row-reverse" : ""
            }`}
          >
            {row.side === "left" && (
              <div className="h-8 w-8 shrink-0 rounded-full bg-muted animate-pulse" />
            )}
            <div className="flex flex-col gap-1.5">
              {row.side === "left" && i % 2 === 0 && (
                <div className="h-2.5 w-20 rounded bg-muted/70 animate-pulse" />
              )}
              <div
                className="h-10 rounded-2xl bg-muted animate-pulse"
                style={{ width: row.w, minWidth: "4rem" }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}


// Keep legacy component for backward compat if needed
export function ChatSearch({ onSearch, debounceMs = 300 }: { onSearch: (query: string) => void; debounceMs?: number }) {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <>
      {!isOpen && <ChatSearchTrigger onClick={() => setIsOpen(true)} />}
      <ChatSearchBar onSearch={onSearch} debounceMs={debounceMs} isOpen={isOpen} onOpenChange={setIsOpen} />
    </>
  );
}

export function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim() || !text) return text;

  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();
  const lowerText = text.toLowerCase();

  // Fast path: exact substring (whole query or any whitespace-separated token)
  const tokens = Array.from(new Set([lower, ...lower.split(/\s+/).filter(Boolean)]));
  const hasSubstring = tokens.some((tok) => tok && lowerText.includes(tok));

  if (hasSubstring) {
    const escaped = tokens
      .filter((tok) => tok && lowerText.includes(tok))
      .map((tok) => tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    const splitter = new RegExp(`(${escaped})`, "gi");
    const parts = text.split(splitter);
    return parts.map((part, i) =>
      part && tokens.includes(part.toLowerCase()) ? (
        <span
          key={i}
          data-search-highlight=""
          className="search-highlight rounded px-0.5 font-semibold"
        >
          {part}
        </span>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  }

  // Fuzzy fallback: highlight only whole words that are within 1 typo of a
  // query token (length ≥ 4). Avoids scattering highlights across unrelated
  // letters like marking 'a','n','d' inside "thanks already".
  const queryTokens = lower.split(/\s+/).filter((t) => t.length >= 4);
  if (queryTokens.length === 0) return text;

  const wordRegex = /[\p{L}\p{N}]+/gu;
  const ranges: Array<{ start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = wordRegex.exec(text)) !== null) {
    const w = m[0].toLowerCase();
    const matched = queryTokens.some((tok) => {
      if (Math.abs(w.length - tok.length) > 1) return false;
      return levenshteinLE1Local(w, tok);
    });
    if (matched) ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  if (ranges.length === 0) return text;

  const out: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((r, idx) => {
    if (cursor < r.start) out.push(<span key={`p${idx}`}>{text.slice(cursor, r.start)}</span>);
    out.push(
      <span
        key={`h${idx}`}
        data-search-highlight=""
        className="search-highlight rounded px-0.5 font-semibold"
      >
        {text.slice(r.start, r.end)}
      </span>,
    );
    cursor = r.end;
  });
  if (cursor < text.length) out.push(<span key="tail">{text.slice(cursor)}</span>);
  return out;
}

function levenshteinLE1Local(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la > lb) return levenshteinLE1Local(b, a);
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else {
      if (++edits > 1) return false;
      if (la === lb) {
        i++;
        j++;
      } else {
        j++;
      }
    }
  }
  if (j < lb) edits += lb - j;
  return edits <= 1;
}
