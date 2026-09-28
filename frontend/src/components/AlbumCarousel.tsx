import { useEffect, useRef, useState, useCallback } from "react";
import { Images } from "lucide-react";
import { LazyImage } from "@/components/LazyImage";
import { cn } from "@/lib/utils";

export interface AlbumCarouselPhoto {
  id: string;
  file_url?: string | null;
  image_url?: string | null;
  title?: string | null;
  caption?: string | null;
}

interface AlbumCarouselProps {
  photos: AlbumCarouselPhoto[];
  /** Called when the user taps a slide (not while swiping). Receives the slide index. */
  onTap?: (index: number) => void;
  /** Called as the visible index changes (after snap). */
  onIndexChange?: (index: number) => void;
  /** Touch handlers forwarded so the parent can still long-press for moderation. */
  onTouchStart?: (e: React.TouchEvent) => void;
  onTouchMove?: (e: React.TouchEvent) => void;
  onTouchEnd?: (e: React.TouchEvent) => void;
  onTouchCancel?: (e: React.TouchEvent) => void;
  priority?: boolean;
  /** Extra absolute-positioned overlays (e.g. deleting state). */
  overlay?: React.ReactNode;
  /** When true, animate a one-time swipe hint on mount. */
  showSwipeHintOnMount?: boolean;
}

/**
 * Inline horizontal carousel for album posts. Uses native CSS scroll-snap so:
 *  - vertical feed scroll is preserved (browser axis-locks gestures),
 *  - momentum and snap feel native,
 *  - no JS per-frame work during swipe (good for perf).
 */
export function AlbumCarousel({
  photos,
  onTap,
  onIndexChange,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  priority,
  overlay,
  showSwipeHintOnMount,
}: AlbumCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const totalCount = photos.length;
  const isAlbum = totalCount > 1;

  // Track touch movement to suppress tap if it was a swipe.
  const swipedRef = useRef(false);
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);

  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    if (!w) return;
    const next = Math.round(el.scrollLeft / w);
    if (next !== index && next >= 0 && next < totalCount) {
      setIndex(next);
      onIndexChange?.(next);
    }
  }, [index, totalCount, onIndexChange]);

  // One-time swipe hint: nudge the scroller a few px right then back.
  useEffect(() => {
    if (!showSwipeHintOnMount || !isAlbum) return;
    const el = scrollerRef.current;
    if (!el) return;
    const t1 = window.setTimeout(() => {
      el.scrollTo({ left: 32, behavior: "smooth" });
    }, 600);
    const t2 = window.setTimeout(() => {
      el.scrollTo({ left: 0, behavior: "smooth" });
    }, 1200);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [showSwipeHintOnMount, isAlbum]);

  return (
    <div className="relative w-full bg-muted select-none" style={{ WebkitTouchCallout: "none" }}>
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        onTouchStart={(e) => {
          swipedRef.current = false;
          const t = e.touches[0];
          if (t) {
            touchStartXRef.current = t.clientX;
            touchStartYRef.current = t.clientY;
          }
          onTouchStart?.(e);
        }}
        onTouchMove={(e) => {
          const t = e.touches[0];
          if (t) {
            const dx = Math.abs(t.clientX - touchStartXRef.current);
            const dy = Math.abs(t.clientY - touchStartYRef.current);
            if (dx > 8 || dy > 8) swipedRef.current = true;
          }
          onTouchMove?.(e);
        }}
        onTouchEnd={(e) => {
          onTouchEnd?.(e);
        }}
        onTouchCancel={(e) => {
          swipedRef.current = true;
          onTouchCancel?.(e);
        }}
        onClick={() => {
          if (swipedRef.current) {
            swipedRef.current = false;
            return;
          }
          onTap?.(index);
        }}
        onContextMenu={(e) => e.preventDefault()}
        className={cn(
          "flex w-full overflow-x-auto overflow-y-hidden",
          "snap-x snap-mandatory scroll-smooth",
          "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
        )}
        style={{
          scrollSnapType: "x mandatory",
          // Allow both axes — browser axis-locks the gesture so vertical feed
          // scroll still works when the touch starts on the image.
          touchAction: "pan-x pan-y",
          overscrollBehaviorX: "contain",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {photos.map((p, i) => (
          <div
            key={p.id}
            className="relative shrink-0 w-full snap-center aspect-square bg-muted cursor-pointer"
            style={{ scrollSnapAlign: "center", scrollSnapStop: "always", minWidth: "100%" }}
          >
            <LazyImage
              src={p.file_url || p.image_url}
              alt={p.title || p.caption || "Photo"}
              priority={priority && i === 0}
            />
          </div>
        ))}
      </div>

      {/* Album count / position pill */}
      {isAlbum && (
        <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white shadow-sm">
          <Images className="h-3 w-3" />
          <span className="tabular-nums">
            {index + 1}/{totalCount}
          </span>
        </div>
      )}

      {/* Dots */}
      {isAlbum && totalCount <= 8 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
          {photos.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all duration-200",
                i === index ? "w-4 bg-white" : "w-1.5 bg-white/60",
              )}
              style={{ boxShadow: "0 0 2px rgba(0,0,0,0.4)" }}
            />
          ))}
        </div>
      )}

      {overlay}
    </div>
  );
}
