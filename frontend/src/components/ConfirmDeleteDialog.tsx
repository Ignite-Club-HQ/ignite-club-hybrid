import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface ConfirmDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityName: string;
  entityType: "club" | "team" | "organisation" | "class";
  onConfirm: () => void;
  isLoading?: boolean;
  permanent?: boolean;
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  entityName,
  entityType,
  onConfirm,
  isLoading,
  permanent,
}: ConfirmDeleteDialogProps) {
  const [confirmText, setConfirmText] = useState("");

  const isMatch = confirmText.trim().toLowerCase() === entityName.trim().toLowerCase();

  const handleConfirm = () => {
    if (isMatch) {
      onConfirm();
      setConfirmText("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setConfirmText(""); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-destructive/10 p-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <DialogTitle>{permanent ? "Permanently delete" : "Delete"} {entityType}?</DialogTitle>
          </div>
          <DialogDescription className="pt-2 space-y-3">
            {permanent ? (
              <>
                <p className="text-destructive font-medium">
                  ⚠️ This action is irreversible. All data associated with <strong>{entityName}</strong> will be permanently deleted and cannot be recovered.
                </p>
                <p>
                  This includes all{" "}
                  {entityType === "club" || entityType === "organisation" ? "teams, " : ""}
                  events, messages, photos, files, and member data.
                </p>
              </>
            ) : (
              <>
                <p>
                  This will remove <strong>{entityName}</strong> and all its{" "}
                  {entityType === "club" || entityType === "organisation" ? "teams, " : ""}
                  events, and data. Members will be notified.
                </p>
                <p className="text-xs text-muted-foreground">
                  Changed your mind? You can restore this {entityType} within 30 days from the settings menu.
                </p>
              </>
            )}
            <p className="font-medium text-foreground">
              Type <span className="font-bold text-destructive">"{entityName}"</span> to confirm:
            </p>
          </DialogDescription>
        </DialogHeader>
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={`Type ${entityName} to confirm`}
          autoFocus
        />
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => { setConfirmText(""); onOpenChange(false); }}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!isMatch || isLoading}
            onClick={handleConfirm}
          >
            {isLoading ? "Deleting…" : permanent ? `Permanently delete ${entityType}` : `Delete ${entityType}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
