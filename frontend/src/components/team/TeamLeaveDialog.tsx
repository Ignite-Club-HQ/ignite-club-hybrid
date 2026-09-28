import { LogOut } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

interface TeamLeaveDialogProps {
  teamName: string;
  onConfirmLeave: () => void | Promise<void>;
}

/** "Leave Team" dropdown item + confirmation dialog for team members. */
export function TeamLeaveDialog({ teamName, onConfirmLeave }: TeamLeaveDialogProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-warning">
          <LogOut className="h-4 w-4 mr-2" />
          Leave Team
        </DropdownMenuItem>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave Team?</AlertDialogTitle>
          <AlertDialogDescription>
            You will be removed from {teamName || "this team"}. You'll need a new invite to rejoin.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirmLeave} className="bg-destructive text-destructive-foreground">
            Leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
