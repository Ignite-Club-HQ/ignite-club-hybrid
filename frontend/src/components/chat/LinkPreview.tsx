import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { runWhenChatScrollIdle } from "@/lib/chatScrollActivity";
import { preventIfReactionInteractionGuarded } from "@/lib/reactionInteractionGuard";
import { deferIfJumpActive } from "@/lib/linkPreviewJumpDefer";

interface LinkPreviewData {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

interface LinkPreviewProps {
  url: string;
  onRemove?: () => void;
  compact?: boolean;
  reserveSpace?: boolean;
}

// Module-level cache so the same URL never refetches across remounts AND
// renders synchronously on every subsequent appearance. Keyed by raw URL.
type CacheEntry = LinkPreviewData | null; // null = no preview / errored
const previewCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();

// Skip link previews for app's own domains
const isAppDomain = (url: string): boolean => {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    const host = urlObj.hostname.toLowerCase();
    return (
      host.includes('lovable.app') ||
      host.includes('lovableproject.com') ||
      host.includes('ignite.invalid')
    );
  } catch {
    return false;
  }
};

async function fetchPreviewOnce(url: string): Promise<CacheEntry> {
  if (previewCache.has(url)) return previewCache.get(url)!;
  const existing = inflight.get(url);
  if (existing) return existing;

  const p = (async () => {
    try {
      let fetchUrl = url;
      if (!fetchUrl.startsWith('http://') && !fetchUrl.startsWith('https://')) {
        fetchUrl = `https://${fetchUrl}`;
      }
      const { data, error } = await supabase.functions.invoke("fetch-link-preview", {
        body: { url: fetchUrl },
      });
      if (error) throw error;
      const hasContent = data && (data.title || data.description || data.image);
      // In chat history we reserve a fixed h-20 slot for URL previews before
      // metadata returns. If the edge function succeeds but finds no title / image,
      // still render a simple host card instead of removing the reserved slot at
      // scroll-idle — that removal is perceived as a downward jolt when upward
      // momentum stops.
      const value = hasContent ? (data as LinkPreviewData) : ({ url: fetchUrl } as LinkPreviewData);
      previewCache.set(url, value);
      return value;
    } catch (err) {
      console.error("Failed to fetch link preview:", err);
      const fallbackUrl = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
      const fallback = { url: fallbackUrl } as LinkPreviewData;
      previewCache.set(url, fallback);
      return fallback;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p;
}

export function LinkPreview({ url, onRemove, compact = false, reserveSpace = false }: LinkPreviewProps) {
  const skipPreview = isAppDomain(url);
  // Synchronous cache hit → render the final card on the very first commit,
  // which is what makes repeat-mount (re-render during scroll) jolt-free.
  const cached = !skipPreview && previewCache.has(url) ? previewCache.get(url)! : undefined;
  const [preview, setPreview] = useState<CacheEntry | undefined>(cached);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (skipPreview) return;
    if (previewCache.has(url)) {
      // Already cached — make sure local state matches in case the URL
      // prop changed across renders.
      const v = previewCache.get(url)!;
      if (v !== preview) setPreview(v);
      return;
    }

    let cancelIdle: (() => void) | null = null;
    let cancelDefer: (() => void) | null = null;
    let cancelled = false;

    const startFetch = () => {
      if (cancelled || !mountedRef.current) return;
      fetchPreviewOnce(url).then((value) => {
        if (cancelled || !mountedRef.current) return;
        // CRITICAL: do NOT setState mid-flick. Inserting/removing a
        // ~80px-tall preview card while the user is fast-scrolling shifts
        // every row below by the card height — the user sees the message
        // they were reading "drop down" by 80px. Wait for scroll-idle.
        cancelIdle = runWhenChatScrollIdle(() => {
          if (cancelled || !mountedRef.current) return;
          setPreview(value);
        }, 250);
      });
    };

    // Batch 3C: while a jump-to-message is in flight, defer the fetch until
    // ~800ms after hydration-end so async row-height growth doesn't force
    // jumpToMessage's settle-pass to re-correct repeatedly.
    cancelDefer = deferIfJumpActive(startFetch);
    if (!cancelDefer) startFetch();

    return () => {
      cancelled = true;
      cancelIdle?.();
      cancelDefer?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, skipPreview]);

  // In chat history, reserve the final card height immediately so a fetched
  // preview does not insert ~80px above/inside the viewport during a fast
  // upward flick. Composer previews opt out, so typing a URL doesn't create
  // a blank card before the fetch returns.
  if (!skipPreview && reserveSpace && preview === undefined) {
    return <div className="h-20 w-full max-w-full min-w-0 invisible" aria-hidden="true" />;
  }

  if (skipPreview || preview === undefined) {
    return null;
  }

  const fullUrl = url.startsWith('http') ? url : `https://${url}`;
  const fallbackHost = (() => {
    try {
      return new URL(fullUrl).hostname.replace(/^www\./, "");
    } catch {
      return "Link";
    }
  })();

  const handleCardClick = (e: React.MouseEvent) => {
    if (preventIfReactionInteractionGuarded(e)) return;
    e.stopPropagation();
    safeOpenUrl(fullUrl);
  };

  return (
    <div
      className="flex h-20 w-full max-w-full min-w-0 box-border items-start gap-3 overflow-hidden rounded-lg border border-border/40 bg-muted/80 px-3 py-2 transition-opacity cursor-pointer active:opacity-80 dark:bg-muted/60"
      onClick={handleCardClick}
      onTouchEnd={(e) => e.stopPropagation()}
      role="link"
    >
      {preview?.image && (
        <div className="w-16 h-16 shrink-0 rounded overflow-hidden">
          <img
            src={preview.image}
            alt={preview?.title || "Link preview"}
            className="w-full h-full object-cover"
            decoding="async"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        </div>
      )}
      <div className="flex flex-1 min-w-0 flex-col justify-center overflow-hidden">
        {preview?.siteName && (
          <p className="text-xs text-muted-foreground truncate">{preview.siteName}</p>
        )}
        <p className="text-sm font-medium truncate">
          {preview?.title || fallbackHost}
        </p>
        {!compact && preview?.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{preview.description}</p>
        )}
        <p className="text-xs text-muted-foreground truncate mt-0.5 text-left max-w-full">
          {url.length > 50 ? url.slice(0, 47) + '…' : url}
        </p>
      </div>
      {onRemove && (
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
