import { Capacitor } from "@capacitor/core";

/**
 * URL the Supabase recovery email link should redirect back to after the
 * user clicks "Reset password" in their inbox. We send users to the
 * standalone /verify-reset-code page (with their email pre-filled) so they
 * can paste the 6-digit code from the same email — works whether they
 * opened the email on the same device or a different one.
 *
 * On native (Capacitor) we use the universal-link domain so the OS opens
 * the installed app instead of the web build. On web we use the current
 * origin.
 */
export function getPasswordResetRedirectUrl(email: string): string {
  const params = new URLSearchParams({ email });

  // Universal link domain for native apps (matches apple-app-site-association
  // and assetlinks.json). The deep link handler routes /verify-reset-code
  // into the app via SPA routing.
  const NATIVE_HOST = "https://reference.invalid";

  const base = Capacitor.isNativePlatform()
    ? NATIVE_HOST
    : window.location.origin;

  return `${base}/verify-reset-code?${params.toString()}`;
}
