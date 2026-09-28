import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface RecurringEventActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  actionLabel: string;
  actionVariant?: "default" | "destructive" | "warning";
  onSingleAction: () => void;
  onSeriesAction: () => void;
  isPending?: boolean;
  /**
   * Keep the dialog mounted while the action runs (destructive awaited
   * operations): the caller closes it only after the database confirms.
   */
  keepOpenOnAction?: boolean;
}

export function RecurringEventActionDialog({
  open,
  onOpenChange,
  title,
  description,
  actionLabel,
  actionVariant = "default",
  onSingleAction,
  onSeriesAction,
  isPending,
  keepOpenOnAction,
}: RecurringEventActionDialogProps) {
  const actionClasses = {
    default: "",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    warning: "bg-warning text-warning-foreground hover:bg-warning/90",
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (isPending) return; onOpenChange(next); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <Button
            variant="outline"
            onClick={() => {
              if (isPending) return;
              if (!keepOpenOnAction) onOpenChange(false);
              onSingleAction();
            }}
            disabled={isPending}
          >
            {isPending && keepOpenOnAction ? "Working…" : `${actionLabel} This Event Only`}
          </Button>
          <Button
            onClick={() => {
              if (isPending) return;
              if (!keepOpenOnAction) onOpenChange(false);
              onSeriesAction();
            }}
            className={actionClasses[actionVariant]}
            disabled={isPending}
          >
            {actionLabel} Entire Series
          </Button>

        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
