import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface GiphyResult {
  id: string;
  title: string;
  preview: string;
  previewWidth: number;
  previewHeight: number;
  url: string;
  width: number;
  height: number;
}

interface GifGridProps {
  active: boolean;
  onSelect: (gifUrl: string) => void;
  onQueryChange?: (query: string) => void;
  onFocusChange?: (focused: boolean) => void;
  className?: string;
  /** Tailwind classes for the scrollable area max-height (e.g. "max-h-52"). */
  scrollClassName?: string;
  /** Grid column classes — defaults to 2 cols. */
  gridClassName?: string;
  showAttribution?: boolean;
}

export function GifGrid({
  active,
  onSelect,
  onQueryChange,
  onFocusChange,
  className,
  scrollClassName,
  gridClassName = "grid-cols-2",
  showAttribution = true,
}: GifGridProps) {
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<GiphyResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const loadedOnceRef = useRef(false);

  const fetchGifs = async (q: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("giphy-search", {
        body: { query: q, limit: 24 },
      });
      if (error) throw error;
      setGifs((data?.gifs as GiphyResult[]) || []);
    } catch (err) {
      console.error("[GifGrid] fetch failed:", err);
      toast.error("Couldn't load GIFs. Please try again.");
      setGifs([]);
    } finally {
      setLoading(false);
    }
  };

  // Load trending the first time the grid becomes active
  useEffect(() => {
    if (active && !loadedOnceRef.current) {
      loadedOnceRef.current = true;
      fetchGifs("");
    }
  }, [active]);

  // Debounced search while active
  useEffect(() => {
    onQueryChange?.(query);
  }, [query, onQueryChange]);

  useEffect(() => {
    if (!active) return;
    if (!loadedOnceRef.current) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      fetchGifs(query);
    }, 350);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, active]);

  return (
    <div data-gif-picker className={cn("flex flex-col min-h-0 overflow-hidden", className)}>
      <div className="sticky top-0 z-10 shrink-0 bg-popover pb-1.5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => onFocusChange?.(true)}
            onBlur={() => onFocusChange?.(false)}
            placeholder="Search GIPHY"
            className="pl-9 pr-9 h-8"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {showAttribution && (
          <p className="mt-1 text-[9px] leading-none text-muted-foreground">Powered by GIPHY</p>
        )}
      </div>

      <div
        className={cn(
          "mt-1.5 flex-1 min-h-[132px] overflow-y-auto overscroll-contain pb-2",
          scrollClassName ?? "max-h-72",
        )}
        // touch-action: pan-y guarantees the scroll container always claims
        // vertical pan gestures on Android, so swiping up at the bottom doesn't
        // bubble out to a parent scroller (which was preventing scroll-back-up
        // after reaching the end of the GIF list).
        style={{ touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}
      >
        {loading && gifs.length === 0 ? (
          <div className="flex min-h-[132px] items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : gifs.length === 0 ? (
          <div className="flex min-h-[132px] items-center justify-center text-center text-xs text-muted-foreground">
            No GIFs found.
          </div>
        ) : (
          <div className={cn("grid gap-1.5", gridClassName)}>
            {gifs.map((gif) => {
              const aspect = gif.previewHeight / Math.max(gif.previewWidth, 1);
              return (
                <button
                  key={gif.id}
                  type="button"
                  onClick={() => onSelect(gif.url)}
                  className={cn(
                    "relative w-full overflow-hidden rounded-md bg-muted",
                    "active:opacity-80 transition-opacity",
                  )}
                  style={{ paddingBottom: `${aspect * 100}%` }}
                  aria-label={gif.title || "Select GIF"}
                >
                  <img
                    src={gif.preview}
                    alt={gif.title}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
