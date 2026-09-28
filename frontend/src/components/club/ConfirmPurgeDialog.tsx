import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

interface Props {
  target: { id: string; name: string } | null;
  confirmText: string;
  onConfirmTextChange: (v: string) => void;
  purging: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmPurgeDialog({ target, confirmText, onConfirmTextChange, purging, onCancel, onConfirm }: Props) {
  const matches = target ? confirmText.trim() === target.name : false;
  return (
    <AlertDialog open={!!target} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Permanently delete "{target?.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            The club will be removed from your Recently removed list and can no longer be restored by you. Underlying data is retained in an archive so an app admin can recover it if needed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Type the club name <strong>{target?.name}</strong> below to confirm.
          </AlertDescription>
        </Alert>
        <Input
          value={confirmText}
          onChange={(e) => onConfirmTextChange(e.target.value)}
          placeholder={target?.name ?? ""}
          autoFocus
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={purging}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!matches || purging}
            onClick={(e) => { e.preventDefault(); onConfirm(); }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {purging ? "Deleting…" : "Delete permanently"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
