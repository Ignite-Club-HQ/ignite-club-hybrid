import { CheckCircle2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";

interface TeamAdminInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamName: string;
  inviteName: string;
  inviteEmail: string;
  onDone: () => void;
}

export function TeamAdminInviteDialog({
  open,
  onOpenChange,
  teamName,
  inviteName,
  inviteEmail,
  onDone,
}: TeamAdminInviteDialogProps) {
  const handleDone = () => {
    onOpenChange(false);
    onDone();
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <ResponsiveDialogTitle>Team Created!</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                Invite sent to the new Team Admin
              </ResponsiveDialogDescription>
            </div>
          </div>
        </ResponsiveDialogHeader>

        <div className="space-y-4 py-4">
          {/* Invite confirmation */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20">
            <p className="font-medium mb-1">{inviteName}</p>
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              Invite sent to {inviteEmail}
            </p>
          </div>

          <p className="text-sm text-muted-foreground text-center">
            When they accept the invite, they'll be added as Team Admin for <strong>{teamName}</strong>.
          </p>
        </div>

        <ResponsiveDialogFooter>
          <Button 
            onClick={handleDone}
            className="w-full"
          >
            Done
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
