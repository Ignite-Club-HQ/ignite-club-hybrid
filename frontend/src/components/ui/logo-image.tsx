import { useEffect, useState } from "react";

interface LogoImageProps {
  src: string;
  alt?: string;
  className?: string;
  /**
   * Classes for the inner <img> (replaces the default object-cover fit).
   * Kept separate from `className` (the wrapper span) so callers can give the
   * wrapper a FIXED footprint (e.g. "h-8 w-8") — a w-auto wrapper collapses to
   * zero width while the bitmap is still loading, then shoves surrounding
   * header content sideways when the image paints.
   */
  imgClassName?: string;
  fallback?: React.ReactNode;
}

// Module-level cache of logo URLs that have already decoded successfully.
// Warmed by `preloadLogo()` so that when the AppHeader mounts after login,
// the club logo paints synchronously instead of flashing in after a
// network round-trip + decode. Survives unmounts within the same tab.
// Cap so long sessions (multi-club admins switching repeatedly) don't
// accumulate unbounded decoded HTMLImageElements. Map insertion order
// gives us LRU semantics — touching an entry re-inserts it at the tail.
const MAX_PRELOADED_LOGOS = 24;
const decodedLogoUrls = new Set<string>();
const preloadedImages = new Map<string, HTMLImageElement>();

function touchPreloadedLogo(src: string) {
  const existing = preloadedImages.get(src);
  if (!existing) return;
  preloadedImages.delete(src);
  preloadedImages.set(src, existing);
}

function evictPreloadedLogos() {
  while (preloadedImages.size > MAX_PRELOADED_LOGOS) {
    const oldest = preloadedImages.keys().next().value as string | undefined;
    if (!oldest) break;
    preloadedImages.delete(oldest);
    decodedLogoUrls.delete(oldest);
  }
}

// Inject a <link rel="preload" as="image"> into <head> so the browser fetches
// the logo at the highest priority (higher than scripted Image() loads). The
// visible <img> with the same src then paints from the warm response without
// issuing a second request — eliminating the cold-open "logo pops in" flash.
function injectPreloadLinkTag(src: string) {
  if (typeof document === "undefined") return;
  try {
    const existing = document.head.querySelector(
      `link[rel="preload"][as="image"][href="${CSS.escape(src)}"]`
    );
    if (existing) return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = src;
    link.setAttribute("fetchpriority", "high");
    document.head.appendChild(link);
  } catch {
    /* ignore — Image() warm-up below still kicks off the fetch */
  }
}

// Drop a cached warm-up entry so a later preload/render re-issues the fetch.
// Called when the visible <img> errors (usually an offline fetch) — otherwise
// `preloadedImages.has(src)` short-circuits every retry forever.
export function forgetLogo(src: string | null | undefined) {
  if (!src) return;
  preloadedImages.delete(src);
  decodedLogoUrls.delete(src);
}

export function preloadLogo(src: string | null | undefined) {
  if (!src) return;
  if (preloadedImages.has(src)) {
    touchPreloadedLogo(src);
    return;
  }
  // 1) High-priority browser-level preload (matches the visible <img> later).
  injectPreloadLinkTag(src);
  // 2) Scripted decode warm-up so the bitmap is ready in memory too.
  const img = new Image();
  img.decoding = "sync";
  img.fetchPriority = "high" as HTMLImageElement["fetchPriority"];
  img.src = src;
  preloadedImages.set(src, img);
  evictPreloadedLogos();
  img.decode?.().then(() => {
    if (preloadedImages.has(src)) decodedLogoUrls.add(src);
  }).catch(() => {
    /* ignore — onError on the visible <img> handles the fallback */
  });
}

// Synchronous module-init warm-up: as soon as this module is parsed (well before
// React mounts the AppHeader / ClubThemeProvider), scan localStorage for any
// cached club theme and start fetching+decoding its logo. This eliminates the
// "logo loads in after a beat" flash on cold home-page loads — by the time the
// header renders, the bytes are already in the HTTP cache (and usually decoded).
if (typeof window !== "undefined") {
  try {
    const PREFIX = "ignite-club-theme-data-";
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as { logoUrl?: string | null };
        if (parsed?.logoUrl) preloadLogo(parsed.logoUrl);
      } catch {
        /* ignore malformed entry */
      }
    }
  } catch {
    /* localStorage unavailable — ignore */
  }
}

/**
 * Image component with built-in error fallback. Eager-loaded so the club
 * logo never appears as a "loading later" element in the top nav after
 * login — the URL is also pushed into a module-level decode cache so a
 * second mount (e.g. route change) paints instantly.
 *
 * IMPORTANT: the error fallback must never be a permanent latch. A logo fetch
 * that fails because the device briefly lost coverage used to stick for the
 * whole session (and the module-level warm-up cache suppressed every retry),
 * so the club header silently degraded to the generic Ignite mark until a full
 * app restart. Failures are therefore transient: they clear on src change, on
 * `online`, and on tab/app resume, and each retry re-issues a real request via
 * a cache-busting attempt token.
 */
export function LogoImage({ src, alt = "", className, imgClassName, fallback }: LogoImageProps) {
  const [failed, setFailed] = useState(false);
  // Bumped on every retry so React remounts the <img> and the browser
  // re-requests the (previously failed) URL instead of reusing its error cache.
  const [attempt, setAttempt] = useState(0);
  // Already-decoded URLs paint synchronously; otherwise show a soft
  // skeleton in the same footprint until the bitmap is ready.
  const [loaded, setLoaded] = useState(() => decodedLogoUrls.has(src));

  // Warm cache on every render so navigation between routes keeps the
  // decoded entry hot. A new src always clears a prior failure.
  useEffect(() => {
    setFailed(false);
    preloadLogo(src);
    if (decodedLogoUrls.has(src)) {
      setLoaded(true);
    } else {
      setLoaded(false);
    }
  }, [src]);

  // Retry the moment connectivity or foreground state comes back. Without this
  // the offline failure survives the reconnect and the club logo never returns.
  useEffect(() => {
    if (!failed) return;
    if (typeof window === "undefined") return;

    const retry = () => {
      if (navigator.onLine === false) return;
      forgetLogo(src);
      setFailed(false);
      setLoaded(false);
      setAttempt((n) => n + 1);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") retry();
    };

    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    document.addEventListener("visibilitychange", onVisible);
    // Also self-heal while the app stays open on a flaky connection.
    const timer = window.setTimeout(retry, 5000);

    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearTimeout(timer);
    };
  }, [failed, src]);

  if (failed) {
    return <>{fallback}</> || null;
  }

  const requestSrc = attempt === 0
    ? src
    : `${src}${src.includes("?") ? "&" : "?"}_logoRetry=${attempt}`;

  return (
    <span className={`relative inline-block overflow-hidden ${className ?? ""}`}>
      {!loaded && (
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-muted animate-pulse"
        />
      )}
      <img
        key={requestSrc}
        src={requestSrc}
        alt={alt}
        className={`block h-full w-full ${imgClassName ?? "object-cover"} transition-opacity duration-150 ${loaded ? "opacity-100" : "opacity-0"}`}
        loading="eager"
        decoding="sync"
        fetchPriority="high"
        onLoad={() => {
          decodedLogoUrls.add(src);
          setLoaded(true);
        }}
        onError={() => {
          forgetLogo(src);
          setFailed(true);
        }}
      />
    </span>
  );
}
