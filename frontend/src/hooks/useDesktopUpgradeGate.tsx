import { useState } from "react";
import { isNativePlatform } from "@/lib/nativePush";
import { DesktopUpgradeDialog } from "@/components/subscription/DesktopUpgradeDialog";

/**
 * Gatekeeper for upgrade/subscribe actions. On desktop web it shows a friendly
 * dialog explaining that subscriptions must be purchased in the mobile app.
 * Returns true when the dialog is shown so callers can early-return.
 */
export function useDesktopUpgradeGate() {
  const [open, setOpen] = useState(false);

  const showIfDesktop = () => {
    if (isNativePlatform()) return false;
    setOpen(true);
    return true;
  };

  return {
    showIfDesktop,
    open,
    setOpen,
    dialog: <DesktopUpgradeDialog open={open} onOpenChange={setOpen} />,
  };
}
