import {
  MoreVertical,
  RefreshCw,
  Pencil,
  Trash2,
  Pin,
  Crown,
  CalendarClock,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface ChatHeaderMenuProps {
  onRefresh?: () => Promise<void>;
  isRefreshing?: boolean;
  onEditGroup?: () => void;
  onDeleteGroup?: () => void;
  onSearch?: () => void;
  /** Open the schedule-message dialog for the current conversation. */
  onScheduleMessage?: () => void;
  /** When true, show Schedule message as a Pro-locked entry (Crown + Pro badge). */
  scheduleMessageLocked?: boolean;
  /** Open the pinned-vault management sheet (admins only). */
  onManagePinnedVault?: () => void;
  /** Remove the pinned vault entirely (admins only, when one exists). */
  onUnpinVault?: () => void;
  /** When true, show Pinned vault as a Pro-locked entry (Crown + Pro badge). Toggle is hidden. */
  pinnedVaultLocked?: boolean;
  /**
   * Trigger an AI "Chat Recap" summary of recent messages.
   * Renders inside the overflow dropdown menu.
   * Pass even for free-tier users together with `summarizeLocked` so the entry
   * point is visible and clicking can route to the upgrade flow.
   */
  onSummarizeMessages?: () => void;
  /** When true, decorate the Sparkles button with a PRO badge (free tier). */
  summarizeLocked?: boolean;
}

export function ChatHeaderMenu({
  onRefresh,
  isRefreshing = false,
  onEditGroup,
  onDeleteGroup,
  onSearch,
  onScheduleMessage,
  scheduleMessageLocked = false,
  onManagePinnedVault,
  pinnedVaultLocked = false,
  onUnpinVault,
  onSummarizeMessages,
  summarizeLocked = false,
}: ChatHeaderMenuProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const hasMoreActions = !!onManagePinnedVault || !!onEditGroup || !!onDeleteGroup;
  const hasDropdownAction =
    !!onRefresh || !!onScheduleMessage || hasMoreActions;
  const hasAnyAction = hasDropdownAction || !!onSearch;
  if (!hasAnyAction) return null;

  // If refresh is the only action (no search, no others), render directly.
  const isRefreshOnly =
    !!onRefresh
    && !onEditGroup
    && !onDeleteGroup
    && !onSearch
    && !onScheduleMessage
    && !onManagePinnedVault
    && !onSummarizeMessages;
  if (isRefreshOnly) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0 transition-transform active:scale-95"
        onClick={() => void onRefresh!()}
        disabled={isRefreshing}
        aria-label="Refresh messages"
      >
        <RefreshCw className={cn("h-[18px] w-[18px]", isRefreshing && "animate-spin")} />
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      {hasDropdownAction && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label="More options"
            >
              <MoreVertical className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-popover min-w-[200px]">
            {onRefresh && (
              <DropdownMenuItem
                onClick={() => void onRefresh()}
                disabled={isRefreshing}
              >
                <RefreshCw className={cn("h-4 w-4 mr-2", isRefreshing && "animate-spin")} />
                Refresh messages
              </DropdownMenuItem>
            )}

            {onSummarizeMessages && (
              <DropdownMenuItem onClick={onSummarizeMessages}>
                <Sparkles className="h-4 w-4 mr-2 text-primary" />
                <span className="flex-1">AI Chat Recap</span>
                {summarizeLocked && (
                  <span className="ml-2 inline-flex items-center gap-1 bg-primary/10 text-primary px-1.5 py-0.5 rounded-full text-[10px] font-medium">
                    <Crown className="h-3 w-3" />
                    Pro
                  </span>
                )}
              </DropdownMenuItem>
            )}

            {onScheduleMessage && (
              <DropdownMenuItem onClick={onScheduleMessage}>
                <CalendarClock className="h-4 w-4 mr-2" />
                <span className="flex-1">Schedule message</span>
                {scheduleMessageLocked && (
                  <span className="ml-2 inline-flex items-center gap-1 bg-primary/10 text-primary px-1.5 py-0.5 rounded-full text-[10px] font-medium">
                    <Crown className="h-3 w-3" />
                    Pro
                  </span>
                )}
              </DropdownMenuItem>
            )}

            {hasMoreActions && (
              <>
                {(onRefresh || onScheduleMessage) && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  onClick={(e) => {
                    e.preventDefault();
                    setMoreOpen((v) => !v);
                    (e.currentTarget as HTMLElement).blur();
                  }}
                >
                  <span className="flex-1">More</span>
                  {moreOpen ? (
                    <ChevronUp className="h-4 w-4 ml-2" />
                  ) : (
                    <ChevronDown className="h-4 w-4 ml-2" />
                  )}
                </DropdownMenuItem>
                {moreOpen && (
                  <div className="pl-2">
                    {onManagePinnedVault && (
                      <>
                        <DropdownMenuItem onClick={onManagePinnedVault}>
                          <Pin className="h-4 w-4 mr-2" />
                          <span className="flex-1">Pinned vault…</span>
                          {pinnedVaultLocked && (
                            <span className="ml-2 inline-flex items-center gap-1 bg-primary/10 text-primary px-1.5 py-0.5 rounded-full text-[10px] font-medium">
                              <Crown className="h-3 w-3" />
                              Pro
                            </span>
                          )}
                        </DropdownMenuItem>
                        {!pinnedVaultLocked && onUnpinVault && (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={onUnpinVault}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Unpin vault
                          </DropdownMenuItem>
                        )}
                      </>
                    )}
                    {onEditGroup && (
                      <>
                        {onManagePinnedVault && <DropdownMenuSeparator />}
                        <DropdownMenuItem onClick={onEditGroup}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit group
                        </DropdownMenuItem>
                      </>
                    )}
                    {onDeleteGroup && (
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={onDeleteGroup}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete group
                      </DropdownMenuItem>
                    )}
                  </div>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
