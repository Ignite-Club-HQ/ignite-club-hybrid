import { Fragment, type ReactNode } from "react";
import { Virtuoso } from "react-virtuoso";
import { Building2, Check, MessageCircle, Search, WifiOff } from "lucide-react";
import { ContactClubButton } from "@/components/ContactClubButton";
import DiscoverGroupsList from "@/components/chat/DiscoverGroupsList";
import { SponsorOrAdCarousel } from "@/components/SponsorOrAdCarousel";
import {
  conversationTypeActiveStyle,
} from "@/features/messaging/inbox/inboxPresentation";
import {
  type InboxConversation,
  type InboxTypeFilter,
} from "@/features/messaging/inbox/inboxReadModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

export interface MessagesInboxClubOption {
  id: string;
  name: string;
}

export interface MessagesInboxSectionsModel {
  searchQuery: string;
  typeFilter: InboxTypeFilter;
  isOnline: boolean;
  showSkeletonLoading: boolean;
  hasLocalFilter: boolean;
  localClubFilter: string;
  showClubFilterDrawer: boolean;
  activeClubFilter: string | null | undefined;
  effectiveClubFilter: string | null;
  memberClubs: readonly MessagesInboxClubOption[];
  unreadItems: readonly InboxConversation[];
  recentItems: readonly InboxConversation[];
  visibleRecent: readonly InboxConversation[];
  hiddenOps: readonly InboxConversation[];
  hasNoResults: boolean;
  hasNoMessages: boolean;
}

export interface MessagesInboxSectionsActions {
  setSearchQuery: (value: string) => void;
  setTypeFilter: (value: InboxTypeFilter) => void;
  setLocalClubFilter: (value: string) => void;
  setShowClubFilterDrawer: (open: boolean) => void;
  setShowAllOps: (showAll: boolean) => void;
}

export interface MessagesInboxSectionsProps {
  model: MessagesInboxSectionsModel;
  actions: MessagesInboxSectionsActions;
  renderConversationCard: (item: InboxConversation) => ReactNode;
}

function MessageSkeleton() {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full shrink-0" />
        <div className="flex-1 min-w-0 space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
        <Skeleton className="h-3 w-8 shrink-0" />
      </CardContent>
    </Card>
  );
}

export function MessagesInboxSections({
  model,
  actions,
  renderConversationCard,
}: MessagesInboxSectionsProps) {
  const {
    searchQuery,
    typeFilter,
    isOnline,
    showSkeletonLoading,
    hasLocalFilter,
    localClubFilter,
    showClubFilterDrawer,
    activeClubFilter,
    effectiveClubFilter,
    memberClubs,
    unreadItems,
    recentItems,
    visibleRecent,
    hiddenOps,
    hasNoResults,
    hasNoMessages,
  } = model;
  const {
    setSearchQuery,
    setTypeFilter,
    setLocalClubFilter,
    setShowClubFilterDrawer,
    setShowAllOps,
  } = actions;

  return (
    <>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search messages..."
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="pl-9"
        />
      </div>

      {!showSkeletonLoading && (() => {
        const counts = { teams: 0, groupish: 0, dms: 0 };
        const unread = { teams: 0, groupish: 0, dms: 0 };
        const allItems = [...unreadItems, ...recentItems];
        allItems.forEach((conversation) => {
          const unreadCount = conversation.unreadCount || 0;
          if (conversation.type === "team" || conversation.type === "league") {
            counts.teams++;
            unread.teams += unreadCount;
          } else if (
            conversation.type === "group"
            || conversation.type === "club"
            || conversation.type === "admin_group"
          ) {
            counts.groupish++;
            unread.groupish += unreadCount;
          } else if (conversation.type === "dm") {
            counts.dms++;
            unread.dms += unreadCount;
          }
        });
        const totalUnread = unread.teams + unread.groupish + unread.dms;
        const chips: {
          id: InboxTypeFilter;
          label: string;
          visible: boolean;
          type?: string;
          unread: number;
        }[] = [
          { id: "all", label: "All", visible: true, unread: totalUnread },
          { id: "teams", label: "Teams", visible: counts.teams > 0, type: "team", unread: unread.teams },
          { id: "groups", label: "Groups", visible: counts.groupish > 0, type: "group", unread: unread.groupish },
          { id: "dms", label: "DMs", visible: counts.dms > 0, type: "dm", unread: unread.dms },
        ];
        const shown = chips.filter((chip) => chip.visible);
        if (totalUnread === 0 && allItems.length <= 6) return null;
        if (shown.length <= 2) return null;

        const currentUnread = chips.find((chip) => chip.id === typeFilter)?.unread ?? 0;
        const elsewhere = chips
          .filter((chip) => chip.id !== "all" && chip.id !== typeFilter && chip.unread > 0)
          .sort((a, b) => b.unread - a.unread);
        const banner = typeFilter !== "all" && currentUnread === 0 ? elsewhere[0] : null;

        return (
          <>
            <div className="-mx-4 px-4 mt-1 mb-1 overflow-x-auto scrollbar-none">
              <div className="flex items-center gap-2 py-1">
                {shown.map((chip) => {
                  const active = typeFilter === chip.id;
                  const activeStyle = active && chip.type
                    ? conversationTypeActiveStyle(chip.type)
                    : undefined;
                  const hasActiveAccent = activeStyle !== undefined;
                  const showCount = chip.unread > 0;
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => setTypeFilter(chip.id)}
                      style={activeStyle}
                      aria-pressed={active}
                      aria-label={showCount ? `${chip.label}, ${chip.unread} unread` : chip.label}
                      className={`shrink-0 inline-flex items-center gap-2 px-4 h-10 min-h-[40px] rounded-full text-sm border transition-colors touch-manipulation ${
                        active
                          ? `font-semibold ${hasActiveAccent ? "" : "bg-primary text-primary-foreground border-primary"}`
                          : `${showCount ? "font-semibold text-foreground" : "font-medium text-muted-foreground"} bg-background border-border hover:text-foreground`
                      }`}
                    >
                      <span>{chip.label}</span>
                      {showCount && (
                        chip.unread === 1 ? (
                          <span className="h-2 w-2 rounded-full bg-destructive" />
                        ) : (
                          <span className="h-[18px] min-w-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center leading-none">
                            {chip.unread > 99 ? "99+" : chip.unread}
                          </span>
                        )
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            {banner && (
              <button
                type="button"
                onClick={() => setTypeFilter(banner.id)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-destructive/30 bg-destructive/5 text-left touch-manipulation"
              >
                <span className="text-[13px] text-foreground">
                  You have <span className="font-semibold">{banner.unread}</span> unread message{banner.unread === 1 ? "" : "s"} in <span className="font-semibold">{banner.label}</span>
                </span>
                <span className="shrink-0 text-[12px] font-semibold text-destructive">
                  View {banner.label} →
                </span>
              </button>
            )}
          </>
        );
      })()}

      {hasLocalFilter && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1.5 px-3 py-1">
            <Building2 className="h-3 w-3" />
            {memberClubs.find((club) => club.id === localClubFilter)?.name || "Club"}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocalClubFilter("all")}
            className="h-7 px-2 text-xs text-muted-foreground"
          >
            Clear
          </Button>
        </div>
      )}

      <Drawer open={showClubFilterDrawer} onOpenChange={setShowClubFilterDrawer}>
        <DrawerContent>
          <DrawerHeader className="text-left border-b">
            <DrawerTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Filter by Club
            </DrawerTitle>
          </DrawerHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="p-4 space-y-2">
              <button
                type="button"
                onClick={() => {
                  setLocalClubFilter("all");
                  setShowClubFilterDrawer(false);
                }}
                className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left hover:bg-accent/50 ${
                  localClubFilter === "all" ? "border-primary bg-primary/5" : "border-border bg-card"
                }`}
              >
                <span className="text-base font-medium">All Clubs</span>
                {localClubFilter === "all" && <Check className="h-5 w-5 text-primary" />}
              </button>
              {memberClubs.map((club) => (
                <button
                  key={club.id}
                  type="button"
                  onClick={() => {
                    setLocalClubFilter(club.id);
                    setShowClubFilterDrawer(false);
                  }}
                  className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left hover:bg-accent/50 ${
                    localClubFilter === club.id ? "border-primary bg-primary/5" : "border-border bg-card"
                  }`}
                >
                  <span className="text-base font-medium">{club.name}</span>
                  {localClubFilter === club.id && <Check className="h-5 w-5 text-primary" />}
                </button>
              ))}
            </div>
          </ScrollArea>
        </DrawerContent>
      </Drawer>

      <div className="space-y-2">
        {showSkeletonLoading && (
          <>
            <MessageSkeleton />
            <MessageSkeleton />
            <MessageSkeleton />
            <MessageSkeleton />
          </>
        )}

        {(() => {
          if (showSkeletonLoading) return null;

          const useGroupSections = typeFilter === "groups" && visibleRecent.length >= 5;
          const totalRows = unreadItems.length + visibleRecent.length;
          const shouldVirtualize = !useGroupSections && totalRows > Number.POSITIVE_INFINITY;

          type FlatRow =
            | { kind: "unread-header"; key: string; count: number }
            | { kind: "recent-header"; key: string; withDivider: boolean }
            | { kind: "card"; key: string; item: InboxConversation }
            | { kind: "show-more-ops"; key: string; count: number };

          if (shouldVirtualize) {
            const rows: FlatRow[] = [];
            if (unreadItems.length > 0) {
              rows.push({ kind: "unread-header", key: "__unread_header", count: unreadItems.length });
              unreadItems.forEach((item) => rows.push({ kind: "card", key: `u:${item.key}`, item }));
            }
            if (visibleRecent.length > 0) {
              rows.push({
                kind: "recent-header",
                key: "__recent_header",
                withDivider: unreadItems.length > 0,
              });
              visibleRecent.forEach((item) => rows.push({ kind: "card", key: `r:${item.key}`, item }));
            }
            if (hiddenOps.length > 0) {
              rows.push({ kind: "show-more-ops", key: "__more_ops", count: hiddenOps.length });
            }

            return (
              <Virtuoso
                useWindowScroll
                data={rows}
                computeItemKey={(_index, row) => row.key}
                increaseViewportBy={{ top: 600, bottom: 800 }}
                itemContent={(_index, row) => {
                  if (row.kind === "unread-header") {
                    return (
                      <div className="flex items-center gap-2 pb-1.5 mb-2">
                        <span className="text-[13px] font-bold uppercase tracking-wide text-foreground">Unread</span>
                      </div>
                    );
                  }
                  if (row.kind === "recent-header") {
                    return (
                      <div className={`flex items-center gap-2 pb-1.5 mb-2 ${row.withDivider ? "pt-5 border-t border-border/50 mt-3" : ""}`}>
                        <span className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Recent</span>
                      </div>
                    );
                  }
                  if (row.kind === "show-more-ops") {
                    return (
                      <button
                        type="button"
                        onClick={() => setShowAllOps(true)}
                        className="w-full mt-1 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md border border-dashed border-border hover:border-foreground/40"
                      >
                        Show {row.count} more inactive group{row.count === 1 ? "" : "s"}
                      </button>
                    );
                  }
                  return <div className="mb-2">{renderConversationCard(row.item)}</div>;
                }}
              />
            );
          }

          return (
            <>
              {unreadItems.length > 0 && (
                <>
                  <div className="flex items-center gap-2 pb-1.5">
                    <span className="text-[13px] font-bold uppercase tracking-wide text-foreground">Unread</span>
                  </div>
                  {unreadItems.map(renderConversationCard)}
                </>
              )}

              {recentItems.length > 0 && (
                <>
                  <div className={`flex items-center gap-2 pb-1.5 ${unreadItems.length > 0 ? "pt-5 border-t border-border/50 mt-3" : ""}`}>
                    <span className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Recent</span>
                  </div>
                  {(() => {
                    const builtinOrder = ["Announcements", "Club Management", "Operations", "Volunteers", "Admin Groups", "Custom Groups"] as const;
                    const classifyGroup = (conversation: InboxConversation): string => {
                      if (conversation.type === "admin_group") return "Admin Groups";
                      if (conversation.type === "club" || conversation.type === "broadcast") return "Announcements";
                      const explicit = (conversation.category || "").trim();
                      if (explicit) return explicit;
                      const name = (conversation.name || "").toLowerCase();
                      if (/committee|admin|coach|leadership|staff|board|manager|coordinator/.test(name)) return "Club Management";
                      if (/finance|treasur|ground|fixture|operation|registr|equipment|kit|event|schedul/.test(name)) return "Operations";
                      if (/volunteer|bbq|canteen|fundrais|helper|roster/.test(name)) return "Volunteers";
                      return "Custom Groups";
                    };

                    if (!useGroupSections) return <>{visibleRecent.map(renderConversationCard)}</>;

                    const buckets: Record<string, InboxConversation[]> = {};
                    visibleRecent.forEach((conversation) => {
                      const section = (
                        conversation.type === "group"
                        || conversation.type === "club"
                        || conversation.type === "broadcast"
                        || conversation.type === "admin_group"
                      )
                        ? classifyGroup(conversation)
                        : "Custom Groups";
                      (buckets[section] ||= []).push(conversation);
                    });
                    const customSections = Object.keys(buckets)
                      .filter((section) => !builtinOrder.includes(section as (typeof builtinOrder)[number]))
                      .sort((a, b) => a.localeCompare(b));
                    const orderedSections = [
                      ...builtinOrder.filter((section) => buckets[section]?.length),
                      ...customSections,
                    ];

                    return (
                      <>
                        {orderedSections.map((section, index) => (
                          <Fragment key={section}>
                            <div className={index === 0 ? "" : "pt-3"}>
                              <div className="flex items-center gap-2 pb-1.5">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                                  {section}
                                </span>
                              </div>
                              {buckets[section].map(renderConversationCard)}
                            </div>
                          </Fragment>
                        ))}
                      </>
                    );
                  })()}

                  {hiddenOps.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAllOps(true)}
                      className="w-full mt-1 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md border border-dashed border-border hover:border-foreground/40"
                    >
                      Show {hiddenOps.length} more inactive group{hiddenOps.length === 1 ? "" : "s"}
                    </button>
                  )}
                </>
              )}
            </>
          );
        })()}

        {!showSkeletonLoading && hasNoResults && (
          <Card className="border-dashed">
            <CardContent className="p-6 text-center">
              <Search className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No messages match "{searchQuery}"</p>
            </CardContent>
          </Card>
        )}

        {!showSkeletonLoading && !searchQuery && hasNoMessages && (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center">
              {isOnline ? (
                <>
                  <MessageCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No messages available</p>
                  <p className="text-sm text-muted-foreground mt-1">Join a team or club to access chats</p>
                </>
              ) : (
                <>
                  <WifiOff className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">
                    You're offline and no saved conversations are available yet
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">Reconnect to load your messages</p>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {!showSkeletonLoading && <ContactClubButton clubFilter={activeClubFilter} />}
        {!showSkeletonLoading && (typeFilter === "all" || typeFilter === "groups") && (
          <DiscoverGroupsList activeClubFilter={effectiveClubFilter} />
        )}
        <SponsorOrAdCarousel location="messages" activeClubFilter={activeClubFilter} />
      </div>
    </>
  );
}
