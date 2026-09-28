import { AlertTriangle, Info, Loader2, UserCheck, Users } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function JoinTeamInviteCard({
  inviteEntityName,
  inviteEntityLabel,
  inviteClubName,
  entityLogoUrl,
  entityInitial,
  isPendingInvite,
  invitedLabel,
  invitedEmail,
  isSignedIn,
  invitedEmailHasAccount,
  nameValidationError,
  nameMismatchDescription,
  otherMembershipClubName,
  addedClubName,
  roleLabel,
  joinButtonDisabled,
  joinButtonLoading,
  joinButtonLabel,
  onCreateAccountClick,
  onSignInClick,
  onJoinClick,
  onCancel,
}: {
  inviteEntityName: string;
  inviteEntityLabel: string;
  inviteClubName?: string | null;
  entityLogoUrl?: string | null;
  entityInitial: string;
  isPendingInvite: boolean;
  invitedLabel?: string | null;
  invitedEmail?: string | null;
  isSignedIn: boolean;
  invitedEmailHasAccount: boolean;
  nameValidationError?: string | null;
  nameMismatchDescription?: string | null;
  otherMembershipClubName?: string | null;
  addedClubName?: string | null;
  roleLabel: string;
  joinButtonDisabled: boolean;
  joinButtonLoading: boolean;
  joinButtonLabel: string;
  onCreateAccountClick: () => void;
  onSignInClick: () => void;
  onJoinClick: () => void;
  onCancel: () => void;
}) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          <Avatar className="h-20 w-20 border-2 border-primary/20">
            <AvatarImage src={entityLogoUrl || undefined} />
            <AvatarFallback className="bg-primary/20 text-primary text-2xl">
              {entityInitial}
            </AvatarFallback>
          </Avatar>
        </div>
        <CardTitle>Join {inviteEntityName}</CardTitle>
        {inviteClubName && inviteEntityName !== inviteClubName && (
          <p className="text-muted-foreground text-sm">{inviteClubName}</p>
        )}
        {isPendingInvite && invitedLabel && (
          <div className="mt-2 space-y-1">
            <p className="text-sm text-muted-foreground">
              Invite for: <span className="font-medium text-foreground">{invitedLabel}</span>
            </p>
            {!isSignedIn && (
              <p className="text-xs text-muted-foreground">
                {invitedEmailHasAccount
                  ? `Sign in to join as ${invitedLabel}`
                  : `Create an account to join as ${invitedLabel}`}
              </p>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {nameValidationError && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-destructive">Link Not Valid For Existing Users</p>
              <p className="text-muted-foreground mt-1">{nameValidationError}</p>
              <p className="text-muted-foreground mt-2">
                Contact your {inviteEntityLabel === "Team" ? "team admin" : "club admin"} to be added directly or to receive a general invite link.
              </p>
            </div>
          </div>
        )}

        {nameMismatchDescription && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/10 border border-primary/20">
            <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">{nameMismatchDescription}</p>
          </div>
        )}

        {isSignedIn && otherMembershipClubName && addedClubName && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border border-border">
            <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              You're already in <span className="font-medium text-foreground">{otherMembershipClubName}</span>. Joining adds <span className="font-medium text-foreground">{addedClubName}</span> to your account — you can switch clubs anytime from the header.
            </p>
          </div>
        )}

        <div className="flex items-center justify-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">You'll join as:</span>
          <Badge variant="secondary">{roleLabel}</Badge>
        </div>

        {!isSignedIn ? (
          <div className="space-y-3">
            {invitedEmailHasAccount && invitedEmail && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/10 border border-primary/20">
                <UserCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <p className="text-sm text-muted-foreground">
                  We found an existing Ignite account for{" "}
                  <span className="font-medium text-foreground break-all">{invitedEmail}</span>
                  . Sign in to accept this invite.
                </p>
              </div>
            )}
            {invitedEmailHasAccount ? (
              <>
                <Button onClick={onSignInClick} className="w-full" size="lg">
                  Sign in to join
                </Button>
                <Button
                  variant="outline"
                  onClick={onCreateAccountClick}
                  className="w-full"
                  size="lg"
                >
                  Create a new account instead
                </Button>
              </>
            ) : (
              <>
                <Button onClick={onCreateAccountClick} className="w-full" size="lg">
                  Create account to join
                </Button>
                <Button
                  variant="outline"
                  onClick={onSignInClick}
                  className="w-full"
                  size="lg"
                >
                  Already have an account? Sign in
                </Button>
              </>
            )}
          </div>
        ) : (
          <Button
            onClick={onJoinClick}
            disabled={joinButtonDisabled}
            className="w-full"
            size="lg"
          >
            {joinButtonLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {!joinButtonLoading ? joinButtonLabel : null}
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={onCancel}
          className="w-full"
        >
          Cancel
        </Button>
      </CardContent>
    </Card>
  );
}
