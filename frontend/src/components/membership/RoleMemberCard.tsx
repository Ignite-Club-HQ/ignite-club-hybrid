import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface RoleBadgeModel {
  id: string;
  label: string;
  className: string;
  variant: "outline" | "secondary";
  scopeName?: string;
  removal?: {
    description: string;
    onConfirm: () => void;
  };
}

export interface RoleMemberCardProps {
  userId: string;
  displayName: string | null | undefined;
  avatarUrl: string | null | undefined;
  isCurrentUser: boolean;
  roles: RoleBadgeModel[];
  headerAction?: ReactNode;
  footerAction?: ReactNode;
}

export function RoleBadge({ role }: { role: RoleBadgeModel }) {
  return (
    <div className="flex items-center gap-1">
      <Badge className={role.className} variant={role.variant}>
        {role.label}
        {role.scopeName && ` • ${role.scopeName}`}
      </Badge>
      {role.removal && <RemoveRoleConfirmation {...role.removal} />}
    </div>
  );
}

export function RemoveRoleConfirmation({
  description,
  onConfirm,
}: {
  description: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6">
          <Trash2 className="h-3 w-3 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove Role?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground"
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function RoleMemberCard({
  displayName,
  avatarUrl,
  isCurrentUser,
  roles,
  headerAction,
  footerAction,
}: RoleMemberCardProps) {
  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <Avatar className="h-10 w-10">
            <AvatarImage src={avatarUrl || undefined} />
            <AvatarFallback>{displayName?.charAt(0) || "?"}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <p className="font-medium">{displayName}</p>
            {isCurrentUser && (
              <p className="text-xs text-muted-foreground">You</p>
            )}
          </div>
          {headerAction}
        </div>
        <div className="flex flex-wrap gap-2">
          {roles.map((role) => (
            <RoleBadge key={role.id} role={role} />
          ))}
          {footerAction}
        </div>
      </div>
    </div>
  );
}
