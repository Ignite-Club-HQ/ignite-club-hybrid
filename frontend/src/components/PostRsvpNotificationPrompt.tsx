import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Bell } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { useNavigate } from "react-router-dom";

const APP_STORE_URL = "https://reference.invalid";
const POST_RSVP_NUDGE_KEY_PREFIX = "post-rsvp-nudge-shown-";

interface PostRsvpNotificationPromptProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  eventTitle: string;
}

export function PostRsvpNotificationPrompt({
  open,
  onClose,
  userId,
  eventTitle,
}: PostRsvpNotificationPromptProps) {
  const navigate = useNavigate();
  const [hasShownBefore, setHasShownBefore] = useState(true);

  useEffect(() => {
    if (!userId) return;
    const key = `${POST_RSVP_NUDGE_KEY_PREFIX}${userId}`;
    const shown = localStorage.getItem(key);
    setHasShownBefore(!!shown);
  }, [userId]);

  const handleEnable = async () => {
    const key = `${POST_RSVP_NUDGE_KEY_PREFIX}${userId}`;
    localStorage.setItem(key, "true");

    const isNative = Capacitor.isNativePlatform();
    if (isNative) {
      // Use initializeNativePush for the full flow:
      // permission request → register → get FCM token → save to database
      try {
        const { initializeNativePush } = await import("@/lib/nativePush");
        const result = await initializeNativePush(userId);
        console.log("[PostRsvpNudge] initializeNativePush result:", result);
      } catch (err) {
        console.error("[PostRsvpNudge] Error:", err);
      }
    } else {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (isIOS) {
        window.open(APP_STORE_URL, "_blank");
      } else if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      } else {
        navigate("/settings");
      }
    }
    onClose();
  };

  const handleDismiss = () => {
    const key = `${POST_RSVP_NUDGE_KEY_PREFIX}${userId}`;
    localStorage.setItem(key, "true");
    onClose();
  };

  // Don't show if already shown before (one-time prompt)
  if (hasShownBefore || !open) return null;

  return (
    <AlertDialog open={true} onOpenChange={handleDismiss}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <div className="flex justify-center mb-4">
            <div className="p-4 rounded-full bg-primary/10">
              <Bell className="h-8 w-8 text-primary" />
            </div>
          </div>
          <AlertDialogTitle className="text-center">
            Get Reminders for This Event?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            Enable notifications to get reminders about "{eventTitle}" and never miss match updates, team messages, or schedule changes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <AlertDialogAction onClick={handleEnable} className="w-full">
            Enable Notifications
          </AlertDialogAction>
          <AlertDialogCancel onClick={handleDismiss} className="w-full">
            Not Now
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
