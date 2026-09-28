import { History, UserMinus, UserPlus, UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface AuditLogActivityCardProps {
  actionType: string;
  createdAtLabel: string;
  targetUserName: string;
  ignitePoints: number;
  role?: string;
  clubName?: string;
  teamName?: string;
}

function getActionIcon(actionType: string) {
  switch (actionType) {
    case "user_deleted":
      return <UserX className="h-4 w-4 text-destructive" />;
    case "role_assigned":
      return <UserPlus className="h-4 w-4 text-emerald-500" />;
    case "role_removed":
      return <UserMinus className="h-4 w-4 text-amber-500" />;
    default:
      return <History className="h-4 w-4" />;
  }
}

function getActionLabel(actionType: string) {
  switch (actionType) {
    case "user_deleted":
      return "User Deleted";
    case "role_assigned":
      return "Role Assigned";
    case "role_removed":
      return "Role Removed";
    default:
      return actionType;
  }
}

export function AuditLogActivityCard({
  actionType,
  createdAtLabel,
  targetUserName,
  ignitePoints,
  role,
  clubName,
  teamName,
}: AuditLogActivityCardProps) {
  const isRoleChange = actionType === "role_assigned" || actionType === "role_removed";

  return (
    <Card className="hover:bg-muted/30 transition-colors">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 p-2 rounded-full bg-muted">
            {getActionIcon(actionType)}
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs">
                {getActionLabel(actionType)}
              </Badge>
              <span className="text-xs text-muted-foreground">{createdAtLabel}</span>
            </div>
            <p className="font-medium truncate">{targetUserName}</p>
            {actionType === "user_deleted" ? (
              <span className="text-muted-foreground">Points: {ignitePoints}</span>
            ) : isRoleChange ? (
              <div className="flex items-center gap-1 flex-wrap">
                {role && (
                  <Badge variant="secondary" className="capitalize">
                    {role.replace("_", " ")}
                  </Badge>
                )}
                {clubName && <span className="text-muted-foreground">@ {clubName}</span>}
                {teamName && <span className="text-muted-foreground">/ {teamName}</span>}
              </div>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
