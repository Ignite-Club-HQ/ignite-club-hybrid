import { Check, UserPlus, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { roleLabels, type AppRole } from "@/features/membership/rolePresentation";

export interface RoleRequestRow {
  id: string;
  role: string;
  created_at?: string;
  requester: { avatar_url: string | null; display_name: string | null } | null;
}

interface RoleRequestsListProps<TRequest extends RoleRequestRow> {
  requests: TRequest[] | undefined;
  isProcessing: boolean;
  isLoading?: boolean;
  error?: Error | null;
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
  isLoading,
  error,
  onApprove,
  onDeny,
}: RoleRequestsListProps<TRequest>) {
  if (error) return <p role="alert" className="text-destructive">Unable to load requests. Please try again.</p>;
  if (isLoading) return <p role="status" className="text-muted-foreground">Loading requests…</p>;
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
              <div className="flex-1 min-w-0">
                <p className="font-medium break-words">{request.requester?.display_name?.trim() || "Name unavailable"}</p>
                <p className="text-sm text-muted-foreground">
                  Wants to be: {roleLabels[request.role as AppRole]}
                </p>
                {request.created_at && Number.isFinite(Date.parse(request.created_at)) && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Requested {new Date(request.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                )}
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
