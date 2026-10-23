import { ExternalLink, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

interface GoogleMapEmbedProps {
  address: string;
  className?: string;
  loading?: "eager" | "lazy";
}

export function GoogleMapEmbed({
  address,
  className = "w-full h-48 rounded-lg",
  loading = "lazy",
}: GoogleMapEmbedProps) {
  const [frameGeneration, setFrameGeneration] = useState(0);
  useEffect(() => {
    // Cross-origin iframe errors cannot be inspected. A suspended Android
    // WebView can retain ERR_CONNECTION_CLOSED, so recreate it on recovery.
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let backgrounded = document.visibilityState === "hidden";
    const removers: Array<() => void> = [];
    const reload = () => {
      if (disposed || document.visibilityState === "hidden" || navigator.onLine === false) return;
      if (timer !== undefined) clearTimeout(timer);
      // One return can emit native resume, appStateChange and visibility.
      timer = setTimeout(() => {
        timer = undefined;
        if (!disposed && document.visibilityState !== "hidden" && navigator.onLine !== false) {
          setFrameGeneration((generation) => generation + 1);
        }
      }, 250);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        backgrounded = true;
      } else if (backgrounded) {
        backgrounded = false;
        reload();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", reload);
    if (Capacitor.isNativePlatform()) {
      void import("@capacitor/app").then(async ({ App }) => {
        const registrations = [
          App.addListener("resume", reload),
          App.addListener("appStateChange", ({ isActive }) => {
            if (isActive) reload();
          }),
        ];
        await Promise.all(registrations.map(async (registration) => {
          const handle = await registration;
          if (disposed) void handle.remove();
          else removers.push(() => { void handle.remove(); });
        }));
      }).catch(() => { /* Web lifecycle events remain available. */ });
    }
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", reload);
      removers.forEach((remove) => remove());
    };
  }, []);
  const browserKey = import.meta.env.IGNITE_LIVE_GOOGLE_MAPS_BROWSER_KEY;
  const place = address.trim();
  // The managed browser key accepts Lovable-hosted sites, not localhost or
  // unrelated custom domains. Keep the location usable there without showing
  // Google's "not authorized" error inside the iframe.
  const isAuthorizedHost = typeof window !== "undefined" &&
    /(^|\.)lovable(?:\.app|project\.com)$/.test(window.location.hostname);
  if (!place) {
    return null;
  }

  // Without an authorized key (e.g. the ICP-hosted copy), use Google's keyless
  // embed so the map still shows, plus a link to open it in Maps.
  if (!browserKey || !isAuthorizedHost) {
    return (
      <div className="space-y-1">
        <iframe
          key={frameGeneration}
          className={className}
          src={`https://www.google.com/maps?q=${encodeURIComponent(place)}&output=embed`}
          allowFullScreen
          loading={loading}
          referrerPolicy="strict-origin-when-cross-origin"
          title="Event location map"
        />
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-sm text-primary"
        >
          <MapPin className="h-4 w-4" />
          View location on Google Maps
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    );
  }

  return (
    <iframe
      key={frameGeneration}
      className={className}
      src={`https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(browserKey)}&q=${encodeURIComponent(place)}`}
      allowFullScreen
      loading={loading}
      referrerPolicy="strict-origin-when-cross-origin"
      title="Event location map"
    />
  );
}
