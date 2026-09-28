import { Check, UserPlus, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { roleLabels, type AppRole } from "@/features/membership/rolePresentation";

export interface RoleRequestRow {
  id: string;
  role: string;
  requester: { avatar_url: string | null; display_name: string | null } | null;
}

interface RoleRequestsListProps<TRequest extends RoleRequestRow> {
  requests: TRequest[] | undefined;
  isProcessing: boolean;
  onApprove: (request: TRequest) => void;
  onDeny: (request: TRequest) => void;
}

/**
 * Shared pending-role-request list, extracted from the identical "requests"
 * tab content rendered by both `ManageRolesPage` (club scope) and
 * `ManageTeamRolesPage` (team scope). Approval/denial mutation wiring
 * (RPC, invalidated query keys, toast copy) stays page-local and is passed
 * in via `onApprove`/`onDeny`.
 */
export function RoleRequestsList<TRequest extends RoleRequestRow>({
  requests,
  isProcessing,
  onApprove,
  onDeny,
}: RoleRequestsListProps<TRequest>) {
  if (requests?.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center">
          <UserPlus className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No pending requests</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {requests?.map((request) => (
        <Card key={request.id}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <Avatar className="h-10 w-10">
                <AvatarImage src={request.requester?.avatar_url || undefined} />
                <AvatarFallback>
                  {request.requester?.display_name?.charAt(0) || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="font-medium">{request.requester?.display_name}</p>
                <p className="text-sm text-muted-foreground">
                  Wants to be: {roleLabels[request.role as AppRole]}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                onClick={() => onApprove(request)}
                disabled={isProcessing}
              >
                <Check className="h-4 w-4 mr-1" /> Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => onDeny(request)}
                disabled={isProcessing}
              >
                <X className="h-4 w-4 mr-1" /> Deny
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </>
  );
}
