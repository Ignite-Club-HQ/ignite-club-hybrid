import { useState } from "react";
import { ShieldAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useBlockedUsers } from "@/hooks/useBlockedUsers";
import { toast } from "sonner";

interface BlockUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
}

export function BlockUserDialog({ open, onOpenChange, userId, userName }: BlockUserDialogProps) {
  const [reason, setReason] = useState("");
  const { blockUser } = useBlockedUsers();

  const handleBlock = async () => {
    try {
      await blockUser.mutateAsync({ blockedId: userId, reason: reason.trim() || undefined });
      toast.success(`${userName} has been blocked`);
      onOpenChange(false);
      setReason("");
    } catch {
      toast.error("Failed to block user");
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            Block {userName}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            You will no longer see messages, photos, or comments from this user. They won't be notified that you blocked them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="resize-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          rows={2}
        />
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleBlock}
            disabled={blockUser.isPending}
          >
            {blockUser.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Block User"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
