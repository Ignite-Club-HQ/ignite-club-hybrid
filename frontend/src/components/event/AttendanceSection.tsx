import { useState, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, Loader2, Eye, Smartphone, Mail, ChevronDown, Share2, EyeOff, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { EventViewMemberRow } from "@/components/EventViewMemberRow";

interface AttendanceCounts {
  going: number;
  maybe: number;
  notGoing: number;
  notResponded: number;
}

interface AddressableMember {
  id: string;
  display_name?: string | null;
  avatar_url?: string | null;
  roles?: string[] | null;
}

interface AttendanceSectionProps {
  eventId: string;
  isAdmin: boolean;
  /** Whether the event has any addressable members at all (drives empty state copy) */
  hasMembers: boolean;
  counts: AttendanceCounts;
  /** Pre-rendered attendee rows for each bucket, supplied by the parent so we
   *  reuse all of its existing AttendeeCard / admin-action wiring. */
  goingContent: ReactNode;
  maybeContent: ReactNode;
  notGoingContent: ReactNode;
  notRespondedContent: ReactNode;
  /** IDs of members who have NOT responded — used to send batched reminders */
  notRespondedUserIds: string[];
  canSendReminders: boolean;
  /** Total members who could view this event (used to compute "X viewed") */
  trackableMembersCount?: number;
  /** Full addressable member list — enables "viewed/not viewed" breakdown dialog */
  addressableMembers?: AddressableMember[];
  /** Optional: open the native/web share sheet with a copyable RSVP link */
  onShareLink?: () => void;
  /** Called when a non-Pro admin tries to trigger a reminder */
  onProRequired?: () => void;
  /** Event type — controls noun used in copy ("player" vs "member") */
  eventType?: string;
}

export function AttendanceSection({
  eventId,
  isAdmin,
  hasMembers,
  counts,
  goingContent,
  maybeContent,
  notGoingContent,
  notRespondedContent,
  notRespondedUserIds,
  canSendReminders,
  trackableMembersCount,
  addressableMembers,
  onShareLink,
  onProRequired,
  eventType,
}: AttendanceSectionProps) {
  const personNoun = eventType === "social" ? "member" : "player";
  const personNounPlural = eventType === "social" ? "members" : "players";
  const { toast } = useToast();
  const [isSending, setIsSending] = useState(false);
  const [sendingForUser, setSendingForUser] = useState<string | null>(null);
  const [viewsDialogOpen, setViewsDialogOpen] = useState(false);

  // Lightweight view-count fetch; only when admin (others don't need it)
  const { data: eventViews } = useQuery({
    queryKey: ["event-views-summary", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_views")
        .select("user_id, viewed_at")
        .eq("event_id", eventId);
      if (error) throw error;
      return data || [];
    },
    enabled: isAdmin,
    staleTime: 30_000,
  });

  const addressableMemberIds = useMemo(
    () => addressableMembers ? new Set(addressableMembers.map((m) => m.id)) : null,
    [addressableMembers],
  );
  const scopedEventViews = useMemo(
    () => addressableMemberIds
      ? (eventViews || []).filter((v: any) => addressableMemberIds.has(v.user_id))
      : (eventViews || []),
    [addressableMemberIds, eventViews],
  );
  const viewedCount = scopedEventViews.length;
  const viewedUserIds = useMemo(
    () => new Set(scopedEventViews.map((v: any) => v.user_id)),
    [scopedEventViews],
  );
  const viewedAtMap = useMemo(() => {
    const map = new Map<string, string>();
    scopedEventViews.forEach((v: any) => {
      if (v.viewed_at) map.set(v.user_id, v.viewed_at);
    });
    return map;
  }, [scopedEventViews]);

  // Fetch the most recent bulk reminder for this event (24h cooldown window).
  // Only admins query — non-admins never see the bulk reminder button anyway.
  const cooldownWindowMs = 24 * 60 * 60 * 1000;
  const { data: lastReminder, refetch: refetchLastReminder } = useQuery({
    queryKey: ["event-reminder-log-latest", eventId],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - cooldownWindowMs).toISOString();
      const { data, error } = await supabase
        .from("event_reminder_log")
        .select("sent_at, recipients_count")
        .eq("event_id", eventId)
        .gte("sent_at", cutoff)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: isAdmin,
    staleTime: 60_000,
  });

  const cooldownActive = !!lastReminder?.sent_at &&
    Date.now() - new Date(lastReminder.sent_at).getTime() < cooldownWindowMs;
  const cooldownNextAvailableAt = lastReminder?.sent_at
    ? new Date(new Date(lastReminder.sent_at).getTime() + cooldownWindowMs)
    : null;

  // notRespondedUserIds excludes second parents whose child responded — use as source of truth
  const notRespondedSet = useMemo(() => new Set(notRespondedUserIds), [notRespondedUserIds]);

  const { viewedMembers, notViewedMembers } = useMemo(() => {
    const list = addressableMembers || [];
    const viewed = list.filter((m) => viewedUserIds.has(m.id));
    const notViewed = list.filter((m) => !viewedUserIds.has(m.id));
    return { viewedMembers: viewed, notViewedMembers: notViewed };
  }, [addressableMembers, viewedUserIds]);

  // Reachability lookup for the "Not opened" dialog. We must know per-member
  // whether push is even possible (any subscription/token) AND whether the
  // member has opted out of event pushes — otherwise per-user "Send push"
  // will silently fail on the backend and mislead the admin.
  //
  // Fail-closed: if either query errors, we mark every member as unreachable
  // so the UI degrades to email-only rather than showing an enabled push
  // button that will drop the notification server-side.
  const notViewedIds = useMemo(
    () => notViewedMembers.map((m) => m.id),
    [notViewedMembers],
  );
  const notViewedIdsKey = useMemo(() => [...notViewedIds].sort().join(","), [notViewedIds]);

  const { data: pushReachable, isError: pushReachableError } = useQuery({
    queryKey: ["event-attendance-push-reachable", eventId, notViewedIdsKey],
    queryFn: async () => {
      if (notViewedIds.length === 0) return {} as Record<string, boolean>;
      const { data, error } = await supabase.rpc("get_members_push_reachable", {
        member_ids: notViewedIds,
      });
      if (error) throw error;
      const map: Record<string, boolean> = {};
      for (const row of data || []) map[row.user_id] = !!row.has_push;
      return map;
    },
    enabled: isAdmin && viewsDialogOpen && notViewedIds.length > 0,
    staleTime: 60_000,
  });

  const { data: eventsEnabled, isError: eventsEnabledError } = useQuery({
    queryKey: ["event-attendance-events-enabled", eventId, notViewedIdsKey],
    queryFn: async () => {
      if (notViewedIds.length === 0) return {} as Record<string, boolean>;
      const { data, error } = await supabase.rpc("get_members_events_enabled", {
        member_ids: notViewedIds,
      });
      if (error) throw error;
      // Missing row → default enabled (matches backend default_true policy).
      const map: Record<string, boolean> = {};
      for (const row of data || []) map[row.user_id] = row.events_enabled !== false;
      return map;
    },
    enabled: isAdmin && viewsDialogOpen && notViewedIds.length > 0,
    staleTime: 60_000,
  });

  const reachabilityUnknown = pushReachableError || eventsEnabledError;

  const totalResponses = counts.going + counts.maybe + counts.notGoing;
  const noOneInvited = !hasMembers && totalResponses === 0;

  const handleSendReminders = async (
    channels: "push" | "email" | "both",
    userIds?: string[],
  ) => {
    if (!canSendReminders) {
      onProRequired?.();
      return;
    }
    const targets = userIds && userIds.length > 0 ? userIds : notRespondedUserIds;
    if (targets.length === 0) return;
    const isPerUser = !!(userIds && userIds.length === 1);
    if (isPerUser) setSendingForUser(targets[0]);
    else setIsSending(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "send-event-view-reminder",
        {
          body: {
            eventId,
            userIds: targets,
            channels,
          },
        },
      );
      if (error) {
        // 429 from edge function comes through as a non-2xx; the body is in `error.context`
        // for some SDK versions, otherwise message is the only signal. Surface the friendly copy.
        const ctxBody = (error as any)?.context?.body
          || (typeof (error as any)?.message === "string" ? (error as any).message : "");
        const isCooldown = typeof ctxBody === "string" && ctxBody.includes("cooldown");
        if (isCooldown && cooldownNextAvailableAt) {
          toast({
            title: "Reminder already sent",
            description: `Another reminder can be sent ${formatRelativeFuture(cooldownNextAvailableAt)}.`,
          });
        } else {
          throw error;
        }
        return;
      }
      const parts: string[] = [];
      if (data?.emailsSent > 0) parts.push(`${data.emailsSent} email${data.emailsSent === 1 ? "" : "s"}`);
      if (data?.pushSent > 0) parts.push(`${data.pushSent} push notification${data.pushSent === 1 ? "" : "s"}`);
      toast({
        title: "Reminder sent",
        description: parts.length ? `Sent ${parts.join(" and ")}.` : "No reminder could be delivered.",
      });
      if (!isPerUser) refetchLastReminder();
    } catch (err: any) {
      toast({
        title: "Failed to send reminder",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      if (isPerUser) setSendingForUser(null);
      else setIsSending(false);
    }
  };

  const handleNudgeUser = (_userId: string, displayName: string) => {
    toast({
      title: "Nudge sent",
      description: `${displayName} will be prompted to enable push notifications.`,
    });
  };

  // Sharing a reminder link is always available to admins (no Pro required).
  // Push/email reminders require Pro (canSendReminders).
  const hasNonResponders = counts.notResponded > 0 && notRespondedUserIds.length > 0;
  const showReminderAction = isAdmin && hasNonResponders;

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Team Attendance</h2>
        {isAdmin && (viewedCount > 0 || (addressableMembers?.length ?? 0) > 0) && (
          <button
            type="button"
            onClick={() => setViewsDialogOpen(true)}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground rounded-md px-1.5 py-1 -mx-1.5 -my-1 hover:bg-muted/60 active:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`See who viewed this event: ${viewedCount} viewed`}
          >
            <Eye className="h-3 w-3" />
            <span>{viewedCount} viewed</span>
            <ChevronDown className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Viewed / Not viewed breakdown */}
      <Dialog open={viewsDialogOpen} onOpenChange={setViewsDialogOpen}>
        <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader className="text-left">
            <DialogTitle>Event views</DialogTitle>
            <DialogDescription>
              Who has opened this event in the app.
            </DialogDescription>
          </DialogHeader>
          {(addressableMembers?.length ?? 0) === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              {viewedCount > 0
                ? `${viewedCount} member${viewedCount === 1 ? "" : "s"} viewed this event.`
                : "No views yet."}
            </div>
          ) : (
            <Tabs defaultValue={notViewedMembers.length > 0 ? "not-viewed" : "viewed"} className="flex-1 min-h-0 flex flex-col">
              <TabsList className="grid grid-cols-2">
                <TabsTrigger value="viewed" className="gap-1.5">
                  <Eye className="h-3.5 w-3.5" />
                  Viewed ({viewedMembers.length})
                </TabsTrigger>
                <TabsTrigger value="not-viewed" className="gap-1.5">
                  <EyeOff className="h-3.5 w-3.5" />
                  Not opened ({notViewedMembers.length})
                </TabsTrigger>
              </TabsList>
              <TabsContent value="viewed" className="flex-1 overflow-y-auto mt-3">
                <ViewerList members={viewedMembers} emptyText="No one has viewed yet." />
              </TabsContent>
              <TabsContent value="not-viewed" className="flex-1 overflow-y-auto mt-3">
                {notViewedMembers.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Everyone has opened this event.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {notViewedMembers.map((m) => {
                      const hasResponded = !notRespondedSet.has(m.id);
                      // Fail-closed: unknown reachability => treat as no push
                      // setup so buttons never advertise a channel we can't
                      // deliver on. When reachable data is loaded, honour it.
                      const hasPush = reachabilityUnknown
                        ? false
                        : pushReachable?.[m.id] ?? false;
                      const eventsPushOn = reachabilityUnknown
                        ? false
                        : eventsEnabled?.[m.id] ?? true;
                      const noPushSetup = !hasPush;
                      const pushDisabled = hasPush && !eventsPushOn;
                      return (
                        <EventViewMemberRow
                          key={m.id}
                          member={{
                            id: m.id,
                            display_name: m.display_name ?? null,
                            avatar_url: m.avatar_url ?? null,
                            hasViewed: false,
                            hasResponded,
                          }}
                          variant="not-viewed"
                          pushDisabled={pushDisabled}
                          noPushSetup={noPushSetup}
                          isBusy={sendingForUser === m.id}
                          onSendReminder={(channels, userIds) =>
                            handleSendReminders(channels, userIds)
                          }
                          onNudge={handleNudgeUser}
                          onShareLink={onShareLink}
                          hasResponded={hasResponded}
                        />
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      {noOneInvited ? (
        <div className="rounded-md border border-dashed p-4 text-center">
          <p className="text-sm font-medium">No responses yet</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Invite members or send a reminder
          </p>
        </div>
      ) : (
        <>
          {/* Status summary chips — No Response prioritised first */}
          <div className="flex flex-wrap gap-1.5">
            <AttendanceChip
              tone="noResponse"
              label="No Response"
              count={counts.notResponded}
              emphasised
              targetId={`attendance-group-noResponse-${eventId}`}
            />
            <AttendanceChip
              tone="going"
              label="Going"
              count={counts.going}
              targetId={`attendance-group-going-${eventId}`}
            />
            {counts.maybe > 0 && (
              <AttendanceChip
                tone="maybe"
                label="Maybe"
                count={counts.maybe}
                targetId={`attendance-group-maybe-${eventId}`}
              />
            )}
            {counts.notGoing > 0 && (
              <AttendanceChip
                tone="notGoing"
                label="Not Going"
                count={counts.notGoing}
                targetId={`attendance-group-notGoing-${eventId}`}
              />
            )}
          </div>

          {/* Top-level reminder action */}
          {showReminderAction && (
            canSendReminders ? (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  {counts.notResponded} {counts.notResponded === 1 ? `${personNoun} hasn't` : `${personNounPlural} haven't`} responded yet
                </p>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="default"
                      disabled={isSending || cooldownActive}
                      className="gap-1.5 w-full sm:w-auto"
                    >
                      {isSending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Bell className="h-4 w-4" />
                      )}
                      {cooldownActive && lastReminder?.sent_at
                        ? `Reminded ${formatRelativePast(new Date(lastReminder.sent_at))}`
                        : "Remind all non-responders"}
                      <ChevronDown className="h-3 w-3 ml-0.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {!cooldownActive && (
                      <>
                        <DropdownMenuItem onClick={() => handleSendReminders("push")}>
                          <Smartphone className="h-4 w-4 mr-2" />
                          Push Notification
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleSendReminders("email")}>
                          <Mail className="h-4 w-4 mr-2" />
                          Email
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleSendReminders("both")}>
                          <Bell className="h-4 w-4 mr-2" />
                          Both (Push + Email)
                        </DropdownMenuItem>
                      </>
                    )}
                    {cooldownActive && cooldownNextAvailableAt && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        Available again {formatRelativeFuture(cooldownNextAvailableAt)}
                      </div>
                    )}
                    {onShareLink && <DropdownMenuSeparator />}
                    {onShareLink && (
                      <DropdownMenuItem onClick={() => onShareLink()}>
                        <Share2 className="h-4 w-4 mr-2" />
                        Share link…
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Lock className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">
                      On-demand reminders are a Pro feature
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {counts.notResponded} {counts.notResponded === 1 ? `${personNoun} hasn't` : `${personNounPlural} haven't`} responded yet. Upgrade to Pro to send push & email reminders to non-responders in one tap.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => onProRequired?.()}
                    className="gap-1.5"
                  >
                    <Lock className="h-3.5 w-3.5" />
                    Upgrade to Pro
                  </Button>
                </div>
              </div>
            )
          )}


          {/* Full member list — No Response prioritised first */}
          <div className="space-y-5">
            {counts.notResponded > 0 && (
              <AttendanceGroup
                id={`attendance-group-noResponse-${eventId}`}
                label="No Response"
                count={counts.notResponded}
                tone="noResponse"
              >
                {notRespondedContent}
              </AttendanceGroup>
            )}

            {counts.going > 0 && (
              <AttendanceGroup
                id={`attendance-group-going-${eventId}`}
                label="Going"
                count={counts.going}
                tone="going"
              >
                {goingContent}
              </AttendanceGroup>
            )}

            {counts.maybe > 0 && (
              <AttendanceGroup
                id={`attendance-group-maybe-${eventId}`}
                label="Maybe"
                count={counts.maybe}
                tone="maybe"
              >
                {maybeContent}
              </AttendanceGroup>
            )}

            {counts.notGoing > 0 && (
              <AttendanceGroup
                id={`attendance-group-notGoing-${eventId}`}
                label="Not Going"
                count={counts.notGoing}
                tone="notGoing"
              >
                {notGoingContent}
              </AttendanceGroup>
            )}
          </div>
        </>
      )}
    </section>
  );
}

type Tone = "going" | "maybe" | "notGoing" | "noResponse";

const toneStyles: Record<Tone, { chip: string; chipEmphasised: string; header: string; icon: string }> = {
  going: {
    chip: "bg-primary/5 text-primary border-primary/15",
    chipEmphasised: "bg-primary/15 text-primary border-primary/30",
    header: "text-primary",
    icon: "✅",
  },
  maybe: {
    chip: "bg-warning/5 text-warning border-warning/15",
    chipEmphasised: "bg-warning/15 text-warning border-warning/30",
    header: "text-warning",
    icon: "🤔",
  },
  notGoing: {
    chip: "bg-destructive/5 text-destructive border-destructive/15",
    chipEmphasised: "bg-destructive/15 text-destructive border-destructive/30",
    header: "text-destructive",
    icon: "❌",
  },
  noResponse: {
    chip: "bg-muted/60 text-muted-foreground border-border/60",
    chipEmphasised: "bg-foreground/10 text-foreground border-foreground/20 font-semibold",
    header: "text-foreground",
    icon: "⏳",
  },
};

function AttendanceChip({
  tone,
  label,
  count,
  emphasised,
  targetId,
}: {
  tone: Tone;
  label: string;
  count: number;
  emphasised?: boolean;
  targetId?: string;
}) {
  const handleClick = () => {
    if (!targetId) return;
    const el = document.getElementById(targetId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const badge = (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium gap-1 transition-colors",
        emphasised ? toneStyles[tone].chipEmphasised : toneStyles[tone].chip,
        targetId && "cursor-pointer hover:opacity-80 active:opacity-70",
      )}
    >
      <span aria-hidden>{toneStyles[tone].icon}</span>
      <span>{label}</span>
      <span className="font-semibold">{count}</span>
    </Badge>
  );

  if (!targetId) return badge;

  return (
    <button
      type="button"
      onClick={handleClick}
      className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      aria-label={`Jump to ${label} (${count})`}
    >
      {badge}
    </button>
  );
}

function AttendanceGroup({
  id,
  label,
  count,
  tone,
  children,
}: {
  id?: string;
  label: string;
  count: number;
  tone: Tone;
  children: ReactNode;
}) {
  return (
    <div id={id} className="space-y-2 scroll-mt-20">
      <div
        className={cn(
          "flex items-center gap-2 text-sm font-semibold",
          toneStyles[tone].header,
        )}
      >
        <span aria-hidden>{toneStyles[tone].icon}</span>
        <span>
          {label} ({count})
        </span>
      </div>
      <div>{children}</div>
    </div>
  );
}

function ViewerList({
  members,
  emptyText,
}: {
  members: AddressableMember[];
  emptyText: string;
}) {
  if (members.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">{emptyText}</p>;
  }
  return (
    <ul className="divide-y divide-border/50">
      {members.map((m) => {
        const initial = m.display_name?.charAt(0)?.toUpperCase() || "?";
        const role = m.roles?.[0];
        return (
          <li key={m.id} className="flex items-center gap-3 py-2.5">
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarImage src={m.avatar_url || undefined} />
              <AvatarFallback className="text-xs bg-muted">{initial}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <span className="text-sm font-medium truncate">
                {m.display_name || "Unknown"}
              </span>
              {role && (
                <Badge variant="outline" className="capitalize text-[10px] h-5 px-1.5">
                  {role}
                </Badge>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---- Relative time helpers --------------------------------------------------
// Lightweight, dependency-free strings suitable for short admin UI labels.
function formatRelativePast(when: Date): string {
  const diffMs = Date.now() - when.getTime();
  const mins = Math.max(1, Math.round(diffMs / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatRelativeFuture(when: Date): string {
  const diffMs = when.getTime() - Date.now();
  if (diffMs <= 0) return "now";
  const mins = Math.max(1, Math.round(diffMs / 60000));
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}
