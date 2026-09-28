import { useState } from "react";
import { Loader2, CheckCircle, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
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
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

interface RewardClaimQRDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rewardName: string;
  clubName: string;
  redemptionId: string;
  qrCodeUrl: string | null;
  userName?: string;
  userId: string;
}

export function RewardClaimQRDialog({
  open,
  onOpenChange,
  rewardName,
  clubName,
  redemptionId,
  qrCodeUrl,
  userName,
  userId,
}: RewardClaimQRDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleMarkAsClaimed = async () => {
    setResetting(true);
    try {
      // Points were already deducted during redemption (in RewardRedemptionCard).
      // This handler only marks the redemption as fulfilled.

      // Mark redemption as fulfilled
      if (redemptionId) {
        const { error: redemptionError } = await supabase
          .from("reward_redemptions")
          .update({
            status: "fulfilled",
            verified_at: new Date().toISOString(),
          })
          .eq("id", redemptionId);

        if (redemptionError) throw redemptionError;
      }

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["user-redemptions"] });
      queryClient.invalidateQueries({ queryKey: ["latest-pending-redemption"] });

      toast({
        title: "Reward Claimed!",
        description: "Reward marked as claimed.",
      });

      setConfirming(false);
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error claiming reward:", error);
      toast({
        title: "Failed to claim reward",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
      <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
        <ResponsiveDialogContent className="sm:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-primary" />
              Partner QR Code
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Show this QR code to the partner to redeem your reward
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <div className="flex flex-col items-center gap-6 py-6">
            {/* QR Code Image */}
            {qrCodeUrl ? (
              <div className="bg-white p-4 rounded-xl shadow-lg">
                <img
                  src={qrCodeUrl}
                  alt="Reward QR Code"
                  className="w-64 h-64 object-contain"
                />
              </div>
            ) : (
              <div className="bg-muted/50 p-8 rounded-xl flex flex-col items-center gap-2">
                <QrCode className="h-16 w-16 text-muted-foreground" />
                <p className="text-muted-foreground text-sm">No QR code available</p>
              </div>
            )}

            {/* Reward Info */}
            <div className="text-center space-y-2">
              <div className="text-4xl">🎁</div>
              <h3 className="text-xl font-bold text-foreground">{rewardName}</h3>
              <p className="text-muted-foreground">{clubName}</p>
              {userName && (
                <p className="text-sm text-muted-foreground">For: {userName}</p>
              )}
            </div>

            {/* Instructions */}
            <div className="bg-muted/50 rounded-lg p-4 text-center text-sm text-muted-foreground">
              <p>Present this QR code to the partner store.</p>
              <p>They will scan it to validate and fulfill your reward.</p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Button
              className="w-full"
              onClick={() => setConfirming(true)}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Mark as Claimed
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Confirm Reset Dialog */}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Reward Claimed</AlertDialogTitle>
            <AlertDialogDescription>
              This will deduct the reward cost from your points and mark the reward as claimed.
              <br /><br />
              <strong>Only press this after receiving your reward!</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleMarkAsClaimed}
              disabled={resetting}
            >
              {resetting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Confirm & Claim Reward"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
