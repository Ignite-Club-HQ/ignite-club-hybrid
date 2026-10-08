import { ExternalLink, MapPin } from "lucide-react";

interface GoogleMapEmbedProps {
  address: string;
  className?: string;
}

export function GoogleMapEmbed({
  address,
  className = "w-full h-48 rounded-lg",
}: GoogleMapEmbedProps) {
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
          className={className}
          src={`https://www.google.com/maps?q=${encodeURIComponent(place)}&output=embed`}
          allowFullScreen
          loading="lazy"
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
      className={className}
      src={`https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(browserKey)}&q=${encodeURIComponent(place)}`}
      allowFullScreen
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
      title="Event location map"
    />
  );
}
