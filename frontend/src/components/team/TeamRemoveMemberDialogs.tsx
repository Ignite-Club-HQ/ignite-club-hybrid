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
import { Input } from "@/components/ui/input";

interface RemoveTeamMemberDialogProps {
  memberName: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function RemoveTeamMemberDialog({
  memberName,
  open,
  onOpenChange,
  onConfirm,
}: RemoveTeamMemberDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove Member?</AlertDialogTitle>
          <AlertDialogDescription>
            This will remove {memberName} from the team. They can request to join again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive text-destructive-foreground">
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface RemoveTeamChildDialogProps {
  childName: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  confirmText: string;
  onConfirmTextChange: (value: string) => void;
  onConfirm: () => void;
}

export function RemoveTeamChildDialog({
  childName,
  open,
  onOpenChange,
  confirmText,
  onConfirmTextChange,
  onConfirm,
}: RemoveTeamChildDialogProps) {
  const isConfirmed =
    confirmText.trim().toLowerCase() === (childName || "").trim().toLowerCase();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove Player?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                This will remove <strong>{childName}</strong> from the team. Their RSVPs,
                attendance and stats history for this team will no longer be linked. Their
                parent can request to rejoin.
              </p>
              <p className="text-foreground font-medium">
                Type <span className="font-bold text-destructive">"{childName}"</span> to
                confirm:
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          value={confirmText}
          onChange={(e) => onConfirmTextChange(e.target.value)}
          placeholder={childName || ""}
          autoFocus
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!isConfirmed}
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground"
          >
            Remove Player
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
