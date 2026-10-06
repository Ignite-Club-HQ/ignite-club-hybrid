/**
 * Plain-language help for Internet Identity sign-in failures.
 *
 * The sign-in flow opens id.ai in a second window and talks to it with
 * postMessage. When that conversation breaks, the @icp-sdk signer surfaces
 * terse technical errors ("Channel was closed before a response was
 * received") that mean nothing to a member holding a phone. This module maps
 * those errors to what actually happened and what to do next. It is a pure
 * module with no imports so it is safe on the boot path.
 */

const OPEN_IN_BROWSER_TIP =
  "If you opened this page from another app (like email or a chat), open it in your device's browser instead and try again.";

/** The one-line explainer shown under the sign-in button before anything goes wrong. */
export const II_SIGN_IN_HINT =
  "Sign-in opens a separate Internet Identity window — leave it open until it closes by itself.";

/**
 * True when the page is running inside another app's embedded browser
 * (Facebook, Instagram, WhatsApp, TikTok, Android WebView, ...). Embedded
 * browsers break the window-to-window conversation Internet Identity relies
 * on, so these users should be told to open the page in a real browser.
 * Chrome Custom Tabs are not detectable and are covered by the error copy.
 */
export function isLikelyInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // "; wv)" is the standard Android WebView marker.
  if (/; wv\)/.test(ua)) return true;
   return /FBAN|FBAV|FB_IAB|Messenger|Instagram|Line\/|MicroMessenger|Twitter for|TikTok|musical_ly|Snapchat|Pinterest|LinkedInApp/i.test(
    ua,
  );
}

/**
 * Translates a raw sign-in error into a member-readable, actionable message.
 * Unrecognized errors pass through unchanged.
 */
export function describeIcpSignInError(rawMessage: string): string {
  const message = rawMessage.toLowerCase();

  // "Channel was closed before a response was received" and "The signer
  // window was closed before it could be established": the id.ai window went
  // away mid-ceremony — closed by the user, killed by the OS, or its replies
  // never made it back (common inside in-app browsers).
  if (message.includes("closed before")) {
    return (
      "The sign-in window was closed before sign-in finished. Tap “Continue with Internet Identity” " +
      "again and leave the Internet Identity window open until it closes by itself. " +
      OPEN_IN_BROWSER_TIP
    );
  }

  // "Signer window could not be opened": the browser blocked the window.
  if (message.includes("could not be opened")) {
    return (
      "Your browser blocked the sign-in window. Allow pop-ups for this site and try again — " +
      "or open this page directly in your device's browser."
    );
  }

  // "Signer window should not be opened outside of click handler": the tap's
  // permission to open a window expired before the window opened (usually a
  // slow connection still loading the sign-in code).
  if (message.includes("outside of click")) {
    return "The sign-in window couldn't open in time. Please tap the button again.";
  }

  // Heartbeat timeouts and anything else signer-shaped.
  if (message.includes("did not respond") || message.includes("timed out") || message.includes("timeout")) {
    return "The sign-in window didn't respond. Check your connection and try again. " + OPEN_IN_BROWSER_TIP;
  }

  return rawMessage;
}
