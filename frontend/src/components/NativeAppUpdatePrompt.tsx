import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { consumePendingForceUpdatePrompt } from '@/lib/notificationLaunchHandler';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

const APP_STORE_URL = 'https://reference.invalid';
const PLAY_STORE_URL = 'https://reference.invalid';

/**
 * Compare two semver strings. Returns:
 *  -1 if a < b, 0 if a == b, 1 if a > b
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

/**
 * Shows a non-dismissible update prompt on native apps when the installed
 * version is below the minimum required version stored in app_settings.
 *
 * This acts as a fallback for users who haven't updated — even if the
 * push notification tap couldn't open the store, this prompt will appear
 * every time they open the app.
 */
export function NativeAppUpdatePrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [storeUrl, setStoreUrl] = useState(PLAY_STORE_URL);

  useEffect(() => {
    // Helper: only show force-update if actually outdated
    async function handleForceUpdateIfOutdated(detail?: { storeUrl?: string }) {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        const platform = Capacitor.getPlatform();
        const { App } = await import('@capacitor/app');
        const info = await App.getInfo();
        const currentVersion = info.version;
        if (!currentVersion) return;

        const { data } = await supabase.functions.invoke('public-minimum-app-version', { method: 'GET' });
        const minVersions = data?.value as Record<string, string> | undefined;
        const requiredVersion = minVersions?.[platform];
        if (!requiredVersion) return;

        const isOutdated = platform === 'android'
          ? Number(info.build || '0') < Number(requiredVersion)
          : compareSemver(currentVersion, requiredVersion) < 0;

        console.log('[UpdatePrompt] Force-update version check:', { platform, currentVersion, build: info.build, requiredVersion, isOutdated });
        if (isOutdated) {
          if (detail?.storeUrl) setStoreUrl(detail.storeUrl);
          else setStoreUrl(platform === 'ios' ? APP_STORE_URL : PLAY_STORE_URL);
          setShowPrompt(true);
        }
      } catch (err) {
        console.warn('[UpdatePrompt] Force-update check failed:', err);
      }
    }

    // Check for any pending force-update prompt that fired before this component mounted
    const pending = consumePendingForceUpdatePrompt();
    if (pending) {
      console.log('[UpdatePrompt] Found pending force-update prompt from cold start:', pending);
      handleForceUpdateIfOutdated(pending);
    }

    // Listen for force-update-prompt event from push notifications
    const handleForcePrompt = (event: Event) => {
      const customEvent = event as CustomEvent<{ storeUrl?: string }>;
      console.log('[UpdatePrompt] Force update prompt triggered via event', customEvent.detail);
      handleForceUpdateIfOutdated(customEvent.detail);
    };
    window.addEventListener('force-update-prompt', handleForcePrompt);
    return () => window.removeEventListener('force-update-prompt', handleForcePrompt);
  }, []);

  // Automatic version check on login/focus/foreground removed —
  // the prompt now only appears when triggered by an admin-sent push notification
  // (handled by the 'force-update-prompt' event listener above).

  const handleUpdate = async () => {
    console.log('[UpdatePrompt] Update Now tapped, storeUrl:', storeUrl);
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url: storeUrl, windowName: '_system' });
      console.log('[UpdatePrompt] Browser.open succeeded');
    } catch (err) {
      console.warn('[UpdatePrompt] Browser.open failed, trying window.open:', err);
      try {
        window.open(storeUrl, '_blank');
      } catch {
        window.location.href = storeUrl;
      }
    }
  };

  if (!showPrompt) return null;

  return (
    <AlertDialog open>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            📲 Update Required
          </AlertDialogTitle>
          <AlertDialogDescription>
            A new version of Ignite Club HQ is available with important improvements. Please update to continue using the app.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button onClick={handleUpdate} className="w-full">
            Update Now
          </Button>
          <Button
            variant="ghost"
            className="w-full text-xs text-muted-foreground"
            onClick={() => setShowPrompt(false)}
          >
            Remind me later
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}