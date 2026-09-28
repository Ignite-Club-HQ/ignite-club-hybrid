import { useRef, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  Clock,
  ChevronDown,
  ChevronUp,
  Pencil,
  X,
  Image as ImageIcon,
  Repeat,
  AlertTriangle,
  WifiOff,
} from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  classifyScheduledBanner,
  shouldShowInlineRefreshWarning,
} from "@/lib/scheduledMessagesBannerState";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  ScheduleTarget,
  ScheduledMessageRow,
  useCancelScheduledMessage,
  useThreadScheduledMessages,
} from "@/hooks/useScheduledMessages";
import {
  ScheduleMessageDialog,
  localTimezoneLabel,
} from "./ScheduleMessageDialog";

const RECURRENCE_LABELS: Record<string, string> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
};

interface ScheduledMessagesBannerProps {
  target: ScheduleTarget;
}

export function ScheduledMessagesBanner({ target }: ScheduledMessagesBannerProps) {
  const {
    data: rows = [],
    isError,
    refetch,
    isFetching,
  } = useThreadScheduledMessages(target);
  const { isOnline } = useOnlineStatus();
  const [expanded, setExpanded] = useState(false);
  const [editingRow, setEditingRow] = useState<ScheduledMessageRow | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // Synchronous re-entry guard. React state updates are batched, so two
  // rapid clicks on the confirm button can both observe `cancelling=false`
  // before the first re-render lands. This ref is flipped inside the click
  // handler itself, so the second click sees `true` and bails immediately.
  const cancellingRef = useRef(false);
  // Track which row is being cancelled so we can lock its edit/delete
  // affordances (and the dialog) to that exact ID for the whole request.
  const cancellingIdRef = useRef<string | null>(null);
  const cancelMut = useCancelScheduledMessage();

  const bannerInput = {
    hasRows: rows.length > 0,
    isError,
    isFetching,
    isOnline,
  };
  const bannerState = classifyScheduledBanner(bannerInput);
  const showInlineRefreshWarning = shouldShowInlineRefreshWarning(bannerInput);

  // Nothing loaded yet. Only shout when the query genuinely failed while the
  // device was online and the built-in retries were exhausted — a transient
  // resume/offline blip must not imply the schedule is broken.
  if (bannerState === "hidden") return null;

  if (bannerState === "offline") {
    return (
      <div className="bg-muted/50 border-b border-border px-3 py-2 flex items-center gap-2">
        <WifiOff className="h-4 w-4 text-muted-foreground shrink-0" />
        <p className="text-xs text-muted-foreground flex-1 min-w-0">
          You're offline. Scheduled messages will refresh when you reconnect —
          nothing has been cancelled.
        </p>
      </div>
    );
  }

  if (bannerState === "error") {
    return (
      <div
        role="alert"
        className="bg-amber-500/10 border-b border-amber-500/40 px-3 py-2 flex items-start gap-2"
      >
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-foreground">
            Scheduled messages could not be loaded. Your existing messages have
            not been deleted and may still send.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-xs font-medium text-primary hover:underline disabled:opacity-60"
        >
          {isFetching ? "Retrying…" : "Retry"}
        </button>
      </div>
    );
  }


  const handleCancel = async () => {
    // Synchronous re-entry guard — must run before any await so a second
    // click within the same tick observes `true` and bails.
    if (cancellingRef.current) return;
    if (!confirmDeleteId) return;
    const targetId = confirmDeleteId;
    cancellingRef.current = true;
    cancellingIdRef.current = targetId;
    setCancelling(true);
    try {
      await cancelMut.mutateAsync(targetId);
      toast.success("Scheduled message cancelled");
      // Success: close the dialog and clear selection. Cache invalidation
      // happens inside the mutation's onSuccess so the banner refreshes.
      setConfirmDeleteId(null);
    } catch (e: any) {
      if (e?.code === "session_expired") {
        toast.error("Your session expired. Please sign in again.");
      } else {
        toast.error(e?.message || "Failed to cancel");
      }
      // Keep dialog open + confirmDeleteId set so the user can retry the
      // same message without reopening the confirmation.
    } finally {
      // Reset guards last so a stale click that fired mid-request cannot
      // accidentally start a second cancellation for the same or another row.
      cancellingRef.current = false;
      cancellingIdRef.current = null;
      setCancelling(false);
    }
  };

  return (
    <>
      <div className="bg-primary/5 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between gap-2 text-left"
          aria-expanded={expanded}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Clock className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-medium truncate">
              {rows.length} scheduled message{rows.length === 1 ? "" : "s"}
            </span>
            {!expanded && rows[0] && (
              <span className="text-xs text-muted-foreground truncate">
                · next in {formatDistanceToNow(new Date(rows[0].scheduled_for))}
              </span>
            )}
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
        </button>

        {showInlineRefreshWarning && (
          <div
            role="alert"
            className="mt-2 flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/40 px-2 py-1.5"
          >
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-foreground flex-1">
              Couldn't refresh scheduled messages. Existing messages may still send.
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="text-[11px] font-medium text-primary hover:underline disabled:opacity-60"
            >
              {isFetching ? "…" : "Retry"}
            </button>
          </div>
        )}

        {expanded && (
          <>
            <ul className="mt-2 space-y-1.5">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-start gap-2 rounded-md bg-background/60 border border-border p-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(row.scheduled_for), "EEE, MMM d 'at' h:mm a")}
                      </p>
                      {row.recurrence && row.recurrence !== "none" && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium uppercase tracking-wide text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                          <Repeat className="h-2.5 w-2.5" />
                          {RECURRENCE_LABELS[row.recurrence] || row.recurrence}
                        </span>
                      )}
                    </div>
                    <div className="flex items-start gap-1.5 mt-0.5">
                      {row.image_url && (
                        <ImageIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                      )}
                      <p className="text-sm break-words line-clamp-2">
                        {row.text || (row.image_url ? "(Image only)" : "")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => setEditingRow(row)}
                      disabled={cancelling && confirmDeleteId === row.id}
                      aria-label="Edit scheduled message"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => setConfirmDeleteId(row.id)}
                      disabled={cancelling && confirmDeleteId === row.id}
                      aria-label="Cancel scheduled message"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Times shown in {localTimezoneLabel()}
            </p>
          </>
        )}
      </div>

      <ScheduleMessageDialog
        open={!!editingRow}
        onOpenChange={(o) => !o && setEditingRow(null)}
        target={target}
        editingRow={editingRow}
      />

      <AlertDialog
        open={!!confirmDeleteId}
        onOpenChange={(o) => {
          // Don't allow the dialog to close (via Esc / outside click) while
          // the cancellation request is still in flight — the user must see
          // the outcome and the row must stay locked to this ID.
          if (!o && !cancelling) setConfirmDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel scheduled message?</AlertDialogTitle>
            <AlertDialogDescription>
              This message won't be sent. You can always schedule a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep it</AlertDialogCancel>
            {/*
              Deliberately NOT AlertDialogAction — that auto-closes the dialog
              on click, which would clear confirmDeleteId and let a stale
              click submit against a different row. A plain Button lets us
              control close/reset in `handleCancel` after the request
              resolves.
            */}
            <Button
              type="button"
              variant="destructive"
              onClick={handleCancel}
              disabled={cancelling}
              aria-busy={cancelling}
            >
              {cancelling ? "Cancelling…" : "Cancel message"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
