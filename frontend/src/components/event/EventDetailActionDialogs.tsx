import { Loader2, Share2 } from "lucide-react";
import { CancelEventConfirmDialog } from "@/components/CancelEventConfirmDialog";
import { RecurringCancelEventDialog } from "@/components/RecurringCancelEventDialog";
import { RecurringEventActionDialog } from "@/components/RecurringEventActionDialog";
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
import { Button } from "@/components/ui/button";

type MutationHandle<T> = {
  mutate: (variables: T) => void;
  isPending: boolean;
};

type CancelEventInput = {
  cancelType: "single" | "series";
  customMessage?: string;
  sendPushNotification?: boolean;
};

type EventDetailActionDialogsProps = {
  event: any;
  eventTypeLabel: string;
  attendanceActionsDisabled: boolean;
  reminderDialogOpen: boolean;
  setReminderDialogOpen: (open: boolean) => void;
  resendDialogOpen: boolean;
  setResendDialogOpen: (open: boolean) => void;
  cancelDialogOpen: boolean;
  setCancelDialogOpen: (open: boolean) => void;
  deleteDialogOpen: boolean;
  setDeleteDialogOpen: (open: boolean) => void;
  handleShareReminderLink: () => void;
  remindMutation: MutationHandle<void>;
  resendInvitesMutation: MutationHandle<void>;
  cancelEventMutation: MutationHandle<CancelEventInput>;
  handleConfirmDelete: (deleteType: "single" | "series") => void;
  deletePending: boolean;
};

export function EventDetailActionDialogs({
  event,
  eventTypeLabel,
  attendanceActionsDisabled,
  reminderDialogOpen,
  setReminderDialogOpen,
  resendDialogOpen,
  setResendDialogOpen,
  cancelDialogOpen,
  setCancelDialogOpen,
  deleteDialogOpen,
  setDeleteDialogOpen,
  handleShareReminderLink,
  remindMutation,
  resendInvitesMutation,
  cancelEventMutation,
  handleConfirmDelete,
  deletePending,
}: EventDetailActionDialogsProps) {
  const recurring = event.is_recurring || event.parent_event_id;

  return (
    <>
      <AlertDialog open={reminderDialogOpen} onOpenChange={setReminderDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send RSVP Reminders?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send a notification to all team members who haven't responded to this event yet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              className="w-full sm:w-auto gap-1.5"
              onClick={() => {
                setReminderDialogOpen(false);
                handleShareReminderLink();
              }}
            >
              <Share2 className="h-4 w-4" />
              Share via...
            </Button>
            <AlertDialogCancel className="w-full sm:w-auto">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => remindMutation.mutate()}
              disabled={remindMutation.isPending || attendanceActionsDisabled}
              className="w-full sm:w-auto"
            >
              {remindMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                "Send In-App"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={resendDialogOpen} onOpenChange={setResendDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resend Event Invites?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send notifications to any new members who haven't been notified about this event yet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => resendInvitesMutation.mutate()}
              disabled={resendInvitesMutation.isPending || attendanceActionsDisabled}
            >
              {resendInvitesMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                "Send Invites"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {recurring ? (
        <RecurringCancelEventDialog
          open={cancelDialogOpen}
          onOpenChange={setCancelDialogOpen}
          eventTitle={event.title}
          teamId={event.team_id}
          clubId={event.club_id}
          miniLeagueId={event.mini_league_id}
          eventType={event.type}
          onSingleAction={(customMessage, sendPushNotification) =>
            cancelEventMutation.mutate({ cancelType: "single", customMessage, sendPushNotification })
          }
          onSeriesAction={(customMessage, sendPushNotification) =>
            cancelEventMutation.mutate({ cancelType: "series", customMessage, sendPushNotification })
          }
          isPending={cancelEventMutation.isPending}
        />
      ) : (
        <CancelEventConfirmDialog
          open={cancelDialogOpen}
          onOpenChange={setCancelDialogOpen}
          eventId={event.id}
          eventTitle={event.title}
          teamId={event.team_id}
          clubId={event.club_id}
          miniLeagueId={event.mini_league_id}
          eventType={event.type}
          onConfirm={(customMessage, sendPushNotification) =>
            cancelEventMutation.mutate({ cancelType: "single", customMessage, sendPushNotification })
          }
          isPending={cancelEventMutation.isPending}
        />
      )}

      {recurring ? (
        <RecurringEventActionDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          title={`Delete ${eventTypeLabel}?`}
          description={`This will permanently delete the ${eventTypeLabel.toLowerCase()}(s) and all RSVPs. This action cannot be undone.`}
          actionLabel="Delete"
          actionVariant="destructive"
          onSingleAction={() => handleConfirmDelete("single")}
          onSeriesAction={() => handleConfirmDelete("series")}
          isPending={deletePending}
          keepOpenOnAction
        />
      ) : (
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {eventTypeLabel}?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this {eventTypeLabel.toLowerCase()} and all RSVPs. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  handleConfirmDelete("single");
                }}
                disabled={deletePending}
                className="bg-destructive text-destructive-foreground"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
