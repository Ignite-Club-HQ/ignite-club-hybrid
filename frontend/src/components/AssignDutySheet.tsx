import { useState, useEffect } from "react";
import { Check, Loader2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";

interface Member {
  id: string;
  display_name: string | null;
  avatar_url?: string | null;
}

interface AssignDutySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dutyName: string;
  currentAssignee: string | null;
  members: Member[];
  onAssign: (userId: string | null) => void;
  isPending: boolean;
}

export function AssignDutySheet({
  open,
  onOpenChange,
  dutyName,
  currentAssignee,
  members,
  onAssign,
  isPending,
}: AssignDutySheetProps) {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(currentAssignee);

  // Sync with prop when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedUserId(currentAssignee);
    }
  }, [open, currentAssignee]);

  const handleSubmit = () => {
    onAssign(selectedUserId);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setSelectedUserId(currentAssignee);
    }
    onOpenChange(isOpen);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Assign: {dutyName}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="px-1">
          <div className="space-y-3 py-4 px-3">
            {/* Unassigned option */}
            <button
              type="button"
              onClick={() => setSelectedUserId(null)}
              className={cn(
                "w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left",
                "touch-manipulation focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                "hover:bg-accent/50",
                selectedUserId === null
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:border-primary/50"
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  "h-12 w-12 rounded-full flex items-center justify-center transition-colors",
                  selectedUserId === null ? "bg-primary text-primary-foreground" : "bg-muted"
                )}>
                  <User className="h-5 w-5" />
                </div>
                <div className="text-left">
                  <p className={cn(
                    "font-medium",
                    selectedUserId === null ? "text-primary" : "text-muted-foreground"
                  )}>
                    Unassigned
                  </p>
                  <p className="text-xs text-muted-foreground">Leave duty open</p>
                </div>
              </div>
              {selectedUserId === null && (
                <Check className="h-5 w-5 text-primary shrink-0" />
              )}
            </button>

            {/* Member options */}
            {members.map((member) => {
              const isSelected = selectedUserId === member.id;
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setSelectedUserId(member.id)}
                  className={cn(
                    "w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left",
                    "touch-manipulation focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                    "hover:bg-accent/50",
                    isSelected
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:border-primary/50"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Avatar className={cn(
                      "h-12 w-12 border-2 transition-colors",
                      isSelected ? "border-primary" : "border-transparent"
                    )}>
                      <AvatarImage src={member.avatar_url || undefined} />
                      <AvatarFallback className="text-sm bg-muted">
                        {member.display_name?.charAt(0)?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <p className={cn(
                      "font-medium",
                      isSelected ? "text-primary" : "text-foreground"
                    )}>
                      {member.display_name || "Unknown"}
                    </p>
                  </div>
                  {isSelected && (
                    <Check className="h-5 w-5 text-primary shrink-0" />
                  )}
                </button>
              );
            })}

            {members.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <div className="h-16 w-16 mx-auto mb-3 rounded-full bg-muted flex items-center justify-center">
                  <User className="h-8 w-8 opacity-50" />
                </div>
                <p className="font-medium">No members available</p>
                <p className="text-sm">No members found for this team/club</p>
              </div>
            )}
          </div>
        </div>

        <ResponsiveDialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending}
            className="flex-1 sm:flex-none"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save Assignment
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
