import { Capacitor } from '@capacitor/core';

/**
 * Safely open a URL on both web and native platforms.
 *
 * On web: uses window.open (standard behaviour).
 * On native (Capacitor): uses the Capacitor Browser plugin which opens an
 * in-app SFSafariViewController / Chrome Custom Tab — keeping the user inside
 * the app and avoiding App Store rejections for "leaving the app unexpectedly".
 *
 * Falls back to window.open if the Browser plugin isn't available.
 *
 * For Supabase private-bucket URLs (e.g. vault files stored in the `photos`
 * bucket), this function transparently exchanges the public URL for a
 * short-lived signed URL so the browser can fetch the object — otherwise
 * the request fails with "Bucket not found" (404).
 */
// URLs that should open in their native app rather than an in-app browser
const NATIVE_APP_DOMAINS = ['facebook.com', 'fb.com', 'fb.me', 'instagram.com', 'twitter.com', 'x.com', 'docs.google.com', 'sheets.google.com', 'drive.google.com'];

function shouldOpenInNativeApp(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return NATIVE_APP_DOMAINS.some(d => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export async function safeOpenUrl(url: string): Promise<void> {
  // Resolve Supabase private-bucket URLs to signed URLs before opening.
  let resolvedUrl = url;
  try {
    if (url.includes("/storage/v1/object/")) {
      const { resolveSignedUrl } = await import("@/hooks/useSignedPhotoUrl");
      resolvedUrl = await resolveSignedUrl(url);
    }
  } catch (err) {
    console.warn('[safeOpenUrl] Failed to resolve signed URL, opening original:', err);
  }

  if (!Capacitor.isNativePlatform()) {
    window.open(resolvedUrl, '_blank');
    return;
  }

  // For social-media URLs, let the OS handle them so the native app opens
  if (shouldOpenInNativeApp(resolvedUrl)) {
    window.open(resolvedUrl, '_blank');
    return;
  }

  try {
    const { Browser } = await import('@capacitor/browser');
    console.log('[safeOpenUrl] Opening in-app browser:', resolvedUrl);
    await Browser.open({ url: resolvedUrl, windowName: '_blank' });
    console.log('[safeOpenUrl] Browser.open resolved successfully');
  } catch (err) {
    console.warn('[safeOpenUrl] Browser plugin failed, falling back:', err);
    window.open(resolvedUrl, '_blank');
  }
}
