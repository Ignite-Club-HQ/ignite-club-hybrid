import { useState, useEffect } from "react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { requireAccessToken, SessionExpiredError, SESSION_EXPIRED_MESSAGE } from "@/lib/requireAccessToken";

interface AccountRecoveryBannerProps {
  userId: string;
  onRecovered: () => void;
}

export function AccountRecoveryBanner({ userId, onRecovered }: AccountRecoveryBannerProps) {
  const [scheduledDeletion, setScheduledDeletion] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const checkDeletionStatus = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('scheduled_deletion_at')
        .eq('id', userId)
        .single();
      
      if (!error && data?.scheduled_deletion_at) {
        setScheduledDeletion(new Date(data.scheduled_deletion_at));
      }
      setLoading(false);
    };

    checkDeletionStatus();
  }, [userId]);

  const handleRecover = async () => {
    if (recovering) return;
    setRecovering(true);
    let token: string;
    try {
      token = await requireAccessToken();
    } catch (err) {
      // Do NOT invoke the Edge Function, do NOT clear the warning, do NOT
      // call onRecovered. Keep the banner visible so the user still sees
      // that their account is scheduled for deletion.
      toast({
        title: "Session expired",
        description: err instanceof SessionExpiredError ? err.message : SESSION_EXPIRED_MESSAGE,
        variant: "destructive",
      });
      setRecovering(false);
      return;
    }

    try {
      const response = await supabase.functions.invoke('recover-account', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      toast({
        title: "Account recovered!",
        description: "Your account has been restored and is no longer scheduled for deletion.",
      });

      setScheduledDeletion(null);
      onRecovered();
    } catch (err) {
      toast({
        title: "Recovery failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRecovering(false);
    }
  };

  if (loading || !scheduledDeletion) {
    return null;
  }

  const daysRemaining = Math.ceil((scheduledDeletion.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  return (
    <Card className="border-amber-500/50 bg-amber-500/10">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-5 w-5" />
          Account Scheduled for Deletion
        </CardTitle>
        <CardDescription>
          Your account will be permanently deleted on {scheduledDeletion.toLocaleDateString()} ({daysRemaining} days remaining)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={handleRecover} disabled={recovering}>
          {recovering ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Recovering...
            </>
          ) : (
            <>
              <RotateCcw className="h-4 w-4 mr-2" />
              Recover My Account
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
