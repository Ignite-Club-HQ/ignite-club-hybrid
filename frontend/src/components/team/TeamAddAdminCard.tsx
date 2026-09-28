import type { ComponentProps } from "react";
import { Crown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import PromoteToTeamAdminDialog from "@/components/PromoteToTeamAdminDialog";

interface TeamAddAdminCardProps {
  teamId: string;
  teamName: string;
  clubId: string;
  members: ComponentProps<typeof PromoteToTeamAdminDialog>["members"];
}

export function TeamAddAdminCard({ teamId, teamName, clubId, members }: TeamAddAdminCardProps) {
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/20">
            <Crown className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">Team Admin Management</p>
            <p className="text-xs text-muted-foreground">Add another admin to help manage the team</p>
          </div>
          <PromoteToTeamAdminDialog
            teamId={teamId}
            teamName={teamName}
            clubId={clubId}
            members={members}
          />
        </div>
      </CardContent>
    </Card>
  );
}
