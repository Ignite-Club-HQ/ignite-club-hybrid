import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle, Loader2, MessageSquare } from "lucide-react";
import { getEventTypeLabel } from "@/lib/eventTypeLabel";
import { useNativeKeyboardBottomInset } from "@/hooks/useNativeKeyboardBottomInset";
import { useEventCancellationRecipients } from "@/hooks/useEventCancellationRecipients";


interface RecurringCancelEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventTitle: string;
  teamId: string | null;
  clubId: string;
  miniLeagueId?: string | null;
  eventType?: string | null;
  onSingleAction: (customMessage?: string, sendPushNotification?: boolean) => void;
  onSeriesAction: (customMessage?: string, sendPushNotification?: boolean) => void;
  isPending?: boolean;
}

export function RecurringCancelEventDialog({
  open,
  onOpenChange,
  eventTitle,
  teamId,
  clubId,
  miniLeagueId,
  eventType,
  onSingleAction,
  onSeriesAction,
  isPending,
}: RecurringCancelEventDialogProps) {
  const [customMessage, setCustomMessage] = useState("");
  const [sendPushNotification, setSendPushNotification] = useState(true);
  const keyboardBottomInset = useNativeKeyboardBottomInset();
  const { memberCount, isLoading, recipientLookupFailed } = useEventCancellationRecipients({
    open,
    teamId,
    clubId,
    miniLeagueId,
  });

  useEffect(() => {
    if (open) {
      setCustomMessage("");
      setSendPushNotification(true);
    }
  }, [open, teamId, clubId, miniLeagueId]);

  useEffect(() => {
    if (recipientLookupFailed) {
      setSendPushNotification(false);
    }
  }, [recipientLookupFailed]);

  const handleSingleAction = () => {
    const push = recipientLookupFailed ? false : sendPushNotification;
    onSingleAction(customMessage.trim() || undefined, push);
    onOpenChange(false);
  };

  const handleSeriesAction = () => {
    const push = recipientLookupFailed ? false : sendPushNotification;
    onSeriesAction(customMessage.trim() || undefined, push);
    onOpenChange(false);
  };

  const getChatMessagePreview = () => {
    const baseMessage = `📢 Event Cancelled: "${eventTitle}"`;
    if (customMessage.trim()) {
      return `${baseMessage}\n\n${customMessage.trim()}\n\nView event: [link]`;
    }
    return `${baseMessage}\n\nView event: [link]`;
  };

  const chatType = miniLeagueId ? "league" : (teamId ? "team" : "club");

  const typeLabel = getEventTypeLabel(eventType, { miniLeagueId });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[425px] top-[max(0.75rem,env(safe-area-inset-top))] translate-y-0 sm:top-[50%] sm:translate-y-[-50%] p-0 gap-0 flex flex-col overflow-hidden w-[calc(100vw-1rem)]"
        style={{ maxHeight: `calc(100dvh - ${keyboardBottomInset + 24}px)` }}
      >

        <DialogHeader className="p-4 sm:p-6 pb-2 shrink-0">
          <DialogTitle className="text-left">Cancel {typeLabel}?</DialogTitle>
          <DialogDescription className="space-y-2 text-left">
            <span className="block">
              You are about to cancel "{eventTitle}".
            </span>
            {isLoading ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Counting members...
              </span>
            ) : recipientLookupFailed ? null : memberCount !== null ? (
              <span className="block font-medium text-foreground">
                {memberCount} member{memberCount === 1 ? "" : "s"} will be notified.
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-2 space-y-4 min-h-0">
          <div className="space-y-2">
            <Label htmlFor="custom-message-recurring">
              Custom message (optional)
            </Label>
            <Textarea
              id="custom-message-recurring"
              placeholder="Add a reason or message for members..."
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              className="min-h-[72px]"
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">
              {customMessage.length}/500 characters
            </p>
          </div>

          {/* Push notification option */}
          <div className="flex items-start space-x-2">
            <Checkbox
              id="send-push-recurring"
              checked={sendPushNotification}
              disabled={isLoading || recipientLookupFailed || isPending}
              onCheckedChange={(checked) => setSendPushNotification(checked === true)}
              className="mt-0.5"
            />
            <Label htmlFor="send-push-recurring" className="text-sm font-normal cursor-pointer leading-tight">
              Also send push notification to members
            </Label>
          </div>

          {recipientLookupFailed && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
              <span>
                Recipients could not be verified. You can still cancel this event,
                but push notifications will not be sent.
              </span>
            </div>
          )}

          {/* Chat Message Preview - always shown */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Message will be posted to {chatType} chat</span>
            </Label>
            <div className="rounded-md border bg-muted/50 p-3">
              <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                {getChatMessagePreview()}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 p-4 sm:p-6 pt-3 border-t bg-background shrink-0">
          <Button
            variant="default"
            className="w-full bg-warning text-warning-foreground hover:bg-warning/90 min-h-[44px]"
            onClick={handleSingleAction}
            disabled={isPending || isLoading}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Cancelling...
              </>
            ) : (
              `Cancel This ${typeLabel} Only`
            )}
          </Button>
          <Button
            variant="outline"
            className="w-full min-h-[44px]"
            onClick={handleSeriesAction}
            disabled={isPending || isLoading}
          >
            Cancel Entire Series
          </Button>
          <Button
            variant="ghost"
            className="w-full min-h-[44px]"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Keep {typeLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
