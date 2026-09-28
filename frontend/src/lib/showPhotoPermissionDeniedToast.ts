import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";

/**
 * Shows a toast informing the user that the app needs full photo-library
 * access. On native platforms we offer a CTA to jump into Settings.
 */
export function showPhotoPermissionDeniedToast() {
  const isNative = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();

  const message = "Photo access is required";
  const description = isNative
    ? platform === "ios"
      ? "Please open Settings → Ignite → Photos and choose 'All Photos' so you can upload media."
      : "Please open Settings → Apps → Ignite → Permissions and allow access to Photos & Media."
    : "Please allow this site to access your photos in your browser settings, then try again.";

  toast.error(message, {
    description,
    duration: 8000,
    action: isNative
      ? {
          label: "Open Settings",
          onClick: () => {
            void openAppSettings();
          },
        }
      : undefined,
  });
}

async function openAppSettings() {
  try {
    // Use the App plugin if available (Capacitor v5+)
    const { App } = await import("@capacitor/app");
    // @ts-expect-error - exitApp exists, but openSettings is platform-specific
    if (typeof App.openSettings === "function") {
      // @ts-expect-error
      await App.openSettings();
      return;
    }
  } catch {
    // ignore
  }

  // Fallback if App.openSettings is not available on this platform/version


  // Last resort
  toast.message("Open your device Settings → Ignite to enable photo access.");
}
