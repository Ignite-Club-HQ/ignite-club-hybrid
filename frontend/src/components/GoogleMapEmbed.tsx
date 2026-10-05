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
    /(^|\.)lovable(app|project)\.com$/.test(window.location.hostname);
  if (!place) {
    return null;
  }

  // A missing key must never leave a broken iframe in the event form.
  if (!browserKey || !isAuthorizedHost) {
    return (
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-48 w-full items-center justify-center gap-2 rounded-lg border bg-muted text-primary"
      >
        <MapPin className="h-5 w-5" />
        View location on Google Maps
        <ExternalLink className="h-4 w-4" />
      </a>
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
