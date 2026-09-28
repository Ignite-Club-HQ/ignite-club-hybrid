import { Clock, Filter, RefreshCw, Sparkles } from "lucide-react";
import { CreateActionButton } from "@/components/CreateActionButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface MessagesPageHeaderProps {
  isLoadingFreshData: boolean;
  hasCachedData: boolean;
  activeClubFilter: string | null | undefined;
  displayMemberClubCount: number;
  hasLocalFilter: boolean;
  canShowRecap: boolean;
  hasAdminRoleButNoPro: boolean;
  upgradeClubId: string | null;
  adminTeamIds: readonly string[] | undefined;
  onClearClubFilter: () => void;
  onOpenClubFilter: () => void;
  onOpenRecap: () => void;
  onNavigateToScheduledMessages: () => void;
  onOpenNewMessage: () => void;
  onNavigateToUpgrade: (path: string) => void;
}

export function MessagesPageHeader({
  isLoadingFreshData,
  hasCachedData,
  activeClubFilter,
  displayMemberClubCount,
  hasLocalFilter,
  canShowRecap,
  hasAdminRoleButNoPro,
  upgradeClubId,
  adminTeamIds,
  onClearClubFilter,
  onOpenClubFilter,
  onOpenRecap,
  onNavigateToScheduledMessages,
  onOpenNewMessage,
  onNavigateToUpgrade,
}: MessagesPageHeaderProps) {
  const navigateToUpgrade = () => {
    if (upgradeClubId) {
      onNavigateToUpgrade(`/clubs/${upgradeClubId}/upgrade`);
    } else if (adminTeamIds?.[0]) {
      onNavigateToUpgrade(`/teams/${adminTeamIds[0]}/upgrade`);
    } else {
      onNavigateToUpgrade("/clubs");
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Messages</h1>
          {isLoadingFreshData && hasCachedData && (
            <RefreshCw className="h-4 w-4 text-muted-foreground animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {!activeClubFilter && displayMemberClubCount > 1 && (
            <Button
              variant={hasLocalFilter ? "default" : "outline"}
              size="icon"
              onClick={hasLocalFilter ? onClearClubFilter : onOpenClubFilter}
              className="relative"
              aria-label="Filter"
            >
              <Filter className="h-4 w-4" />
              {hasLocalFilter && (
                <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary" />
              )}
            </Button>
          )}

          {canShowRecap && (
            <Button
              variant="outline"
              size="icon"
              onClick={onOpenRecap}
              className="h-10 w-10 relative"
              aria-label="Recap all chats"
              title="Recap all unread chats"
            >
              <Sparkles className="h-5 w-5" />
            </Button>
          )}

          <Button
            variant="outline"
            size="icon"
            onClick={onNavigateToScheduledMessages}
            className="h-10 w-10"
            aria-label="Scheduled messages"
            title="Scheduled messages"
          >
            <Clock className="h-5 w-5" />
          </Button>
          <CreateActionButton ariaLabel="New message" onClick={onOpenNewMessage} />
        </div>
      </div>

      {hasAdminRoleButNoPro && (
        <Card className="border-primary/10 bg-primary/[0.03] overflow-hidden">
          <CardContent className="py-1.5 px-3">
            <div className="flex items-center gap-2">
              <Badge
                variant="secondary"
                className="text-[9px] px-1.5 py-0 h-4 font-bold uppercase tracking-wider bg-primary/10 text-primary border-0 leading-none shrink-0"
              >
                PRO
              </Badge>
              <p className="font-bold text-sm leading-tight whitespace-nowrap">
                Unlock Unlimited Club Messaging
              </p>
              <button
                type="button"
                onClick={navigateToUpgrade}
                className="ml-auto shrink-0 text-xs font-semibold text-primary hover:underline"
              >
                Upgrade →
              </button>
            </div>
            <p className="mt-1 text-[11px] text-foreground/60 leading-snug">
              📢 Club Chats · 📷 Photos · 📁 Files · 📊 Polls
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
