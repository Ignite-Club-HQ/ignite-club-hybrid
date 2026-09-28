import { Smartphone, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const APP_STORE_URL = "https://reference.invalid";
const PLAY_STORE_URL = "https://reference.invalid";

interface DesktopUpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DesktopUpgradeDialog({ open, onOpenChange }: DesktopUpgradeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="items-center text-center">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <Smartphone className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle>Upgrade on the Ignite app</DialogTitle>
          <DialogDescription>
            Subscriptions are purchased through the App Store or Google Play. Please open Ignite Club HQ on your phone or tablet to subscribe.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => window.open(APP_STORE_URL, "_blank")}
          >
            <Download className="mr-2 h-4 w-4" />
            Download for iPhone
          </Button>
          <Button
            variant="outline"
            onClick={() => window.open(PLAY_STORE_URL, "_blank")}
          >
            <Download className="mr-2 h-4 w-4" />
            Download for Android
          </Button>
          <Button onClick={() => onOpenChange(false)}>Got it</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
