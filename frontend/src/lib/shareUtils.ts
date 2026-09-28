const APP_URL = "https://reference.invalid";

/**
 * Generates a share URL that serves OG meta tags for rich previews,
 * then redirects to the actual app page.
 */
export function getShareUrl(type: "photo" | "event" | "folder", id: string): string {
  const cacheBust = Date.now().toString(36);
  return `${APP_URL}/share?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}&cb=${cacheBust}`;
}

/**
 * The deep link URL that opens the content directly in the app.
 * Used for clipboard fallback where we want the direct link.
 */
export function getDeepLink(type: "photo" | "event" | "folder", id: string): string {
  switch (type) {
    case "photo": return `${APP_URL}/media/${id}`;
    case "event": return `${APP_URL}/events/${id}`;
    case "folder": return `${APP_URL}/vault/folder/${id}`;
  }
}

