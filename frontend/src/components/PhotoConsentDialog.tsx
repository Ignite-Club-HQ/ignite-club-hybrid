import { useState } from "react";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Camera } from "lucide-react";

interface PhotoConsentDialogProps {
  open: boolean;
  onConsentGiven: () => void;
  onDecline: () => void;
}

export function PhotoConsentDialog({
  open,
  onConsentGiven,
  onDecline,
}: PhotoConsentDialogProps) {
  const [consentChecked, setConsentChecked] = useState(false);

  return (
    <ResponsiveDialog open={open} onOpenChange={() => {}}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-primary" />
            <ResponsiveDialogTitle>Team Photo Consent</ResponsiveDialogTitle>
          </div>
          <ResponsiveDialogDescription className="text-left space-y-4 pt-2">
            <p>
              I understand the club/team may share photos of games and training
              inside the Ignite app to other verified team members.
            </p>
            <p>
              Photos are visible only to approved members of the team/club (not
              public).
            </p>
            <p>
              I can withdraw consent at any time and request deletion of photos
              where reasonably possible.
            </p>
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="flex items-start space-x-3 py-4">
          <Checkbox
            id="photo-consent"
            checked={consentChecked}
            onCheckedChange={(checked) => setConsentChecked(checked === true)}
          />
          <Label
            htmlFor="photo-consent"
            className="text-sm leading-relaxed cursor-pointer"
          >
            I give consent for photos of my child to be shared within the
            team/club in the app
          </Label>
        </div>

        <ResponsiveDialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onDecline} className="w-full sm:w-auto">
            Decline
          </Button>
          <Button
            onClick={onConsentGiven}
            disabled={!consentChecked}
            className="w-full sm:w-auto"
          >
            Continue
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
