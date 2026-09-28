import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Bell, CheckCircle } from "lucide-react";

const NATIVE_NOTIFICATION_PROMPTED_KEY_PREFIX = "native-notification-prompted-";

// Check if native at module load - wrapped in try/catch
let isNative = false;
let platform = 'web';
try {
  const { Capacitor } = require('@capacitor/core');
  isNative = Capacitor.isNativePlatform();
  platform = Capacitor.getPlatform();
} catch (e) {
  console.log("[NativeNotificationPrompt] Capacitor not available at module load");
}

console.log("[NativeNotificationPrompt] Module loaded, isNative:", isNative, "platform:", platform);

interface NativeNotificationPromptProps {
  userId?: string;
}

export function NativeNotificationPrompt({ userId }: NativeNotificationPromptProps) {
  const [showResult, setShowResult] = useState<'success' | 'denied' | null>(null);

  useEffect(() => {
    console.log("[NativeNotificationPrompt] useEffect triggered", {
      isNative,
      platform,
      userId,
    });
    
    // Only run on native platforms
    if (!isNative) {
      console.log("[NativeNotificationPrompt] Not native platform, skipping");
      return;
    }
    
    // Only proceed if user is logged in
    if (!userId) {
      console.log("[NativeNotificationPrompt] No userId, skipping");
      return;
    }
    
    // Check if we've already prompted for THIS user
    const promptKey = `${NATIVE_NOTIFICATION_PROMPTED_KEY_PREFIX}${userId}`;
    const hasPrompted = localStorage.getItem(promptKey);
    console.log("[NativeNotificationPrompt] hasPrompted:", hasPrompted, "key:", promptKey);
    if (hasPrompted) {
      console.log("[NativeNotificationPrompt] Already prompted for this user, skipping");
      return;
    }
    
    console.log("[NativeNotificationPrompt] Will trigger permission prompt in 1.5s");
    
    // Small delay to let the app settle, then directly request system permission
    const timer = setTimeout(async () => {
      console.log("[NativeNotificationPrompt] Timer fired, requesting permission");
      
      // Mark as prompted immediately to prevent re-triggering
      localStorage.setItem(promptKey, "true");
      
      try {
        // Dynamically import to avoid issues on web
        const { initializeNativePush } = await import("@/lib/nativePush");
        console.log("[NativeNotificationPrompt] Calling initializeNativePush with userId:", userId);
        
        const result = await initializeNativePush(userId);
        console.log("[NativeNotificationPrompt] initializeNativePush result:", JSON.stringify(result));
        
        if (result.success) {
          console.log("[NativeNotificationPrompt] Push notifications enabled successfully");
          setShowResult('success');
        } else {
          console.warn("[NativeNotificationPrompt] Failed to enable push:", result.error);
          // Only show denied message if user explicitly denied (not for technical errors)
          if (result.error?.includes('denied')) {
            setShowResult('denied');
          }
        }
      } catch (err) {
        console.error("[NativeNotificationPrompt] Error enabling notifications:", err);
      }
    }, 1500);
    
    return () => clearTimeout(timer);
  }, [userId]);

  const handleDismiss = () => {
    setShowResult(null);
  };

  // Show a brief confirmation dialog after permission result
  if (showResult === 'success') {
    return (
      <AlertDialog open={true} onOpenChange={handleDismiss}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <div className="flex justify-center mb-4">
              <div className="p-4 rounded-full bg-green-500/10">
                <CheckCircle className="h-8 w-8 text-green-500" />
              </div>
            </div>
            <AlertDialogTitle className="text-center">
              Notifications Enabled
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              You'll receive updates about match times, team messages, and important announcements.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleDismiss} className="w-full">
              Got it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (showResult === 'denied') {
    return (
      <AlertDialog open={true} onOpenChange={handleDismiss}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <div className="flex justify-center mb-4">
              <div className="p-4 rounded-full bg-muted">
                <Bell className="h-8 w-8 text-muted-foreground" />
              </div>
            </div>
            <AlertDialogTitle className="text-center">
              Notifications Disabled
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              You can enable notifications later in your device settings or in your profile.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleDismiss} className="w-full">
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return null;
}
