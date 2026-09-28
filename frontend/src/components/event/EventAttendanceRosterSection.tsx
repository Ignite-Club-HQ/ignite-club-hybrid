import { Bell, Check, Loader2, Lock } from "lucide-react";
import { AdminRsvpChanger } from "@/components/event/AdminRsvpChanger";
import { AttendanceRow } from "@/components/event/AttendanceRow";
import { AttendanceSection } from "@/components/event/AttendanceSection";
import {
  EventAttendeeCard,
  resolveEventAttendeeRoleLabel,
} from "@/components/event/EventAttendeeCard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { formatRelativePast } from "@/lib/formatRelativeTime";

type RsvpStatus = "going" | "maybe" | "not_going";

type EventAttendanceRosterSectionProps = {
  event: any;
  eventId: string;
  model: any;
  groupMap: any;
  scopedRosterQuery: any;
  showAllRoles: boolean;
  setShowAllRoles: (show: boolean) => void;
  isSocialEvent: boolean;
  isMiniLeagueEvent: boolean;
  isGameEvent: boolean;
  canManageEvent: boolean;
  canSendReminders: boolean;
  gateReminders: () => boolean;
  eventGuests: any[] | undefined;
  paidUserIds: Set<unknown>;
  showPaymentStatus: boolean | null | undefined;
  membersWithRoles: any[] | undefined;
  captainUserId: string | null;
  captainChildId: string | null;
  potmUserId: string | null;
  potmChildId: string | null;
  gkUserIds: Set<unknown>;
  gkChildIds: Set<unknown>;
  recentlyReminded: Map<string, string>;
  recentReminderMap: Map<string, string> | undefined;
  miniLeagueAdults: any[] | undefined;
  allChildrenOnTeam: any[] | undefined;
  individualRemindMutation: any;
  adminRsvpMutation: any;
  rsvpForChildMutation: any;
  rsvpForMemberMutation: any;
  togglePaymentMutation: any;
  adminUpdateRsvpMutation: any;
  handleShareReminderLink: () => void;
};

export function EventAttendanceRosterSection({
  event,
  eventId,
  model,
  groupMap,
  scopedRosterQuery,
  showAllRoles,
  setShowAllRoles,
  isSocialEvent,
  isMiniLeagueEvent,
  isGameEvent,
  canManageEvent,
  canSendReminders,
  gateReminders,
  eventGuests,
  paidUserIds,
  showPaymentStatus,
  membersWithRoles,
  captainUserId,
  captainChildId,
  potmUserId,
  potmChildId,
  gkUserIds,
  gkChildIds,
  recentlyReminded,
  recentReminderMap,
  miniLeagueAdults,
  allChildrenOnTeam,
  individualRemindMutation,
  adminRsvpMutation,
  rsvpForChildMutation,
  rsvpForMemberMutation,
  togglePaymentMutation,
  adminUpdateRsvpMutation,
  handleShareReminderLink,
}: EventAttendanceRosterSectionProps) {
  const {
    goingRsvps,
    maybeRsvps,
    notGoingRsvps,
    notResponded,
    notRespondedChildren,
    totalNotResponded,
    allNotRespondedForReminders,
    isTargetedScope,
    goingTotal,
    trackableMembers,
    addressableMembers,
  } = model;

  const renderAttendee = (rsvp: any, status: RsvpStatus) => (
    <EventAttendeeCard
      key={rsvp.id}
      rsvp={rsvp}
      hasPaid={status !== "not_going" ? paidUserIds.has(rsvp.user_id) : undefined}
      isAdmin={canManageEvent}
      showPrice={status !== "not_going" && !!showPaymentStatus}
      onTogglePayment={status !== "not_going" ? () => togglePaymentMutation.mutate({
        userId: rsvp.user_id,
        isPaid: paidUserIds.has(rsvp.user_id),
      }) : undefined}
      isPending={togglePaymentMutation.isPending || adminUpdateRsvpMutation.isPending}
      isMiniLeague={isMiniLeagueEvent}
      currentStatus={status}
      onChangeStatus={(newStatus) => adminUpdateRsvpMutation.mutate({
        rsvpId: rsvp.id,
        status: newStatus,
        playerName: rsvp.mini_league_player_id
          ? rsvp.mini_league_players?.name
          : (rsvp.child_id ? rsvp.children?.name : rsvp.profiles?.display_name),
      })}
      memberRole={!rsvp.child_id && !rsvp.mini_league_player_id
        ? resolveEventAttendeeRoleLabel(
            membersWithRoles?.find((member) => member.id === rsvp.user_id),
            event,
          )
        : undefined}
      isCaptain={
        isGameEvent && (
          (!!rsvp.user_id && rsvp.user_id === captainUserId) ||
          (!!rsvp.child_id && rsvp.child_id === captainChildId)
        )
      }
      isPotm={
        isGameEvent && (
          (!!rsvp.user_id && rsvp.user_id === potmUserId) ||
          (!!rsvp.child_id && rsvp.child_id === potmChildId)
        )
      }
      isGoalkeeper={
        isGameEvent && (
          (!!rsvp.user_id && gkUserIds.has(rsvp.user_id)) ||
          (!!rsvp.child_id && gkChildIds.has(rsvp.child_id))
        )
      }
    />
  );

  const guestNodes = eventGuests?.map((guest) => (
    <AttendanceRow
      key={guest.id}
      name={guest.guest_name}
      roleLabel="Guest"
      roleTone="guest"
      secondaryLine={`Guest of ${guest.added_by_name}`}
    />
  ));

  const rsvpGroupKey = (rsvp: any) => {
    const childId = rsvp.child_id || rsvp.mini_league_players?.child_id || null;
    return groupMap.groupOf({
      userId: childId ? null : rsvp.user_id,
      childId,
    });
  };

  const renderBucket = (rsvpList: any[], status: RsvpStatus, includeGuests = false) => {
    if (!groupMap.isActive) {
      return (
        <div className="divide-y divide-border/50">
          {rsvpList.map((rsvp) => renderAttendee(rsvp, status))}
          {includeGuests && guestNodes}
        </div>
      );
    }

    const buckets = new Map<string, any[]>();
    for (const rsvp of rsvpList) {
      const group = rsvpGroupKey(rsvp);
      if (!group) continue;
      const items = buckets.get(group.key) ?? [];
      items.push(rsvp);
      buckets.set(group.key, items);
    }

    return (
      <div className="space-y-3">
        {groupMap.orderedGroups.map((group: any) => {
          const items = buckets.get(group.key) ?? [];
          if (items.length === 0) return null;
          return (
            <div key={group.key}>
              <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label} <span className="text-muted-foreground/70">({items.length})</span>
              </div>
              <div className="divide-y divide-border/50">
                {items.map((rsvp) => renderAttendee(rsvp, status))}
              </div>
            </div>
          );
        })}
        {includeGuests && (guestNodes?.length ?? 0) > 0 && (
          <div>
            <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Guests
            </div>
            <div className="divide-y divide-border/50">{guestNodes}</div>
          </div>
        )}
      </div>
    );
  };

  const reminderButton = ({
    userId,
    childId,
    recipientKey,
    displayName,
    title,
  }: {
    userId?: string;
    childId?: string;
    recipientKey: string;
    displayName: string;
    title: string;
  }) => {
    const isLoading = individualRemindMutation.isPending &&
      individualRemindMutation.variables?.userId === userId &&
      individualRemindMutation.variables?.childId === childId;
    const lastRemindedAt =
      recentlyReminded.get(recipientKey) ||
      (userId ? recentReminderMap?.get(userId) : null) ||
      null;
    const wasReminded = !!lastRemindedAt;
    const remindedLabel = lastRemindedAt
      ? `Reminded ${formatRelativePast(lastRemindedAt)}`
      : "Reminded";
    const isProBlocked = !canSendReminders && !wasReminded;

    return (
      <Button
        variant={wasReminded ? "secondary" : isProBlocked ? "outline" : "default"}
        size="sm"
        className={`h-8 px-2.5 shrink-0 gap-1 ${isProBlocked ? "opacity-60 cursor-not-allowed" : ""}`}
        onClick={() => {
          if (!gateReminders()) return;
          individualRemindMutation.mutate({ userId, displayName, childId });
        }}
        disabled={isLoading || wasReminded}
        title={wasReminded ? remindedLabel : isProBlocked ? "Pro required — upgrade to send reminders" : title}
      >
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : wasReminded ? (
          <Check className="h-3.5 w-3.5" />
        ) : isProBlocked ? (
          <Lock className="h-3.5 w-3.5" />
        ) : (
          <Bell className="h-3.5 w-3.5" />
        )}
        <span className="text-xs">{wasReminded ? remindedLabel : isProBlocked ? "Pro" : "Remind"}</span>
      </Button>
    );
  };

  const renderNotRespondedChild = (child: any) => {
    const isPendingChild = isMiniLeagueEvent ? !!child.is_pending : false;
    const remindParentId = isMiniLeagueEvent ? child.parent_user_id : child.parent_id;
    const remindChildId = isMiniLeagueEvent ? child.child_id : (child.child_id || child.id);
    const recipientKey = remindParentId || remindChildId || child.id;
    const canRemind = !isPendingChild && !!(remindParentId || remindChildId);
    const remind = canManageEvent && canRemind
      ? reminderButton({
          userId: remindParentId,
          childId: remindChildId,
          recipientKey,
          displayName: child.name || "Unknown",
          title: "Remind all parents",
        })
      : null;
    const edit = canManageEvent ? (
      <AdminRsvpChanger
        currentStatus={null}
        playerName={child.name || "Unknown"}
        onChangeStatus={(status) => {
          if (isMiniLeagueEvent) {
            adminRsvpMutation.mutate({
              playerId: child.id,
              playerName: child.name,
              childId: child.child_id,
              parentUserId: child.parent_user_id,
              status,
            });
          } else {
            rsvpForChildMutation.mutate({
              childId: child.id,
              childName: child.name,
              parentUserId: child.parent_id,
              status,
            });
          }
        }}
        isPending={adminRsvpMutation.isPending || rsvpForChildMutation.isPending}
      />
    ) : null;

    return (
      <AttendanceRow
        key={`child-${child.id}`}
        name={child.name || "Unknown"}
        roleLabel={!isMiniLeagueEvent ? "Child" : null}
        roleTone="child"
        isPending={isPendingChild}
        rightSlot={<>{remind}{edit}</>}
      />
    );
  };

  const renderNotRespondedAdult = (member: any) => {
    const remind = canManageEvent
      ? reminderButton({
          userId: member.id,
          recipientKey: member.id,
          displayName: member.display_name || "Unknown",
          title: "Send reminder",
        })
      : null;
    const edit = canManageEvent ? (
      <AdminRsvpChanger
        currentStatus={null}
        playerName={member.display_name || "Unknown"}
        onChangeStatus={(status) => rsvpForMemberMutation.mutate({
          memberId: member.id,
          memberName: member.display_name,
          status,
        })}
        isPending={rsvpForMemberMutation.isPending}
      />
    ) : null;

    const roleLabel = resolveEventAttendeeRoleLabel(member, event);
    return (
      <AttendanceRow
        key={member.id}
        name={member.display_name || "Unknown"}
        avatarUrl={member.avatar_url}
        roleLabel={roleLabel ? String(roleLabel).replace(/_/g, " ") : null}
        roleTone="neutral"
        rightSlot={<>{remind}{edit}</>}
      />
    );
  };

  const notRespondedNode = groupMap.isActive ? (() => {
    const childBuckets = new Map<string, any[]>();
    for (const child of notRespondedChildren) {
      const childId = isMiniLeagueEvent ? (child.child_id || child.id) : child.id;
      const group = groupMap.groupOf({ childId, userId: null });
      if (!group) continue;
      const items = childBuckets.get(group.key) ?? [];
      items.push(child);
      childBuckets.set(group.key, items);
    }
    const adultBuckets = new Map<string, any[]>();
    for (const member of notResponded) {
      const group = groupMap.groupOf({ userId: member.id, childId: null });
      if (!group) continue;
      const items = adultBuckets.get(group.key) ?? [];
      items.push(member);
      adultBuckets.set(group.key, items);
    }
    return (
      <div className="space-y-3">
        {groupMap.orderedGroups.map((group: any) => {
          const children = childBuckets.get(group.key) ?? [];
          const adults = adultBuckets.get(group.key) ?? [];
          const total = children.length + adults.length;
          if (total === 0) return null;
          return (
            <div key={group.key}>
              <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label} <span className="text-muted-foreground/70">({total})</span>
              </div>
              <div className="divide-y divide-border/50">
                {children.map(renderNotRespondedChild)}
                {adults.map(renderNotRespondedAdult)}
              </div>
            </div>
          );
        })}
      </div>
    );
  })() : (
    <div className="divide-y divide-border/50">
      {notRespondedChildren.map(renderNotRespondedChild)}
      {notResponded.map(renderNotRespondedAdult)}
    </div>
  );

  return (
    <div className="space-y-3">
      {!isSocialEvent && (
        <div className="flex items-center justify-end gap-2">
          <Checkbox
            id="showAllRoles"
            checked={showAllRoles}
            onCheckedChange={(checked) => setShowAllRoles(checked === true)}
          />
          <Label htmlFor="showAllRoles" className="text-xs cursor-pointer text-muted-foreground">
            Show all roles
          </Label>
        </div>
      )}
      {canManageEvent && event.type === "training" && goingRsvps.length > 0 && (() => {
        const auto = goingRsvps.filter((rsvp: any) => rsvp.source === "default").length;
        const confirmed = goingRsvps.length - auto;
        return (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {confirmed} confirmed
            </span>
            {auto > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-2 py-1">
                <span className="h-2 w-2 rounded-full border border-primary" />
                {auto} on default
              </span>
            )}
          </div>
        );
      })()}
      {(groupMap.isActive && groupMap.isError) || (isTargetedScope && scopedRosterQuery.isError) ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          <span>Grouped attendance couldn’t be loaded. The list below may be incomplete.</span>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => {
              if (groupMap.isError) groupMap.refetch();
              if (scopedRosterQuery.isError) scopedRosterQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      ) : null}
      <AttendanceSection
        eventId={eventId}
        isAdmin={canManageEvent}
        hasMembers={trackableMembers > 0 || (allChildrenOnTeam?.length || 0) > 0}
        counts={{
          going: goingTotal,
          maybe: maybeRsvps.length,
          notGoing: notGoingRsvps.length,
          notResponded: totalNotResponded,
        }}
        goingContent={renderBucket(goingRsvps, "going", true)}
        maybeContent={renderBucket(maybeRsvps, "maybe")}
        notGoingContent={renderBucket(notGoingRsvps, "not_going")}
        notRespondedContent={notRespondedNode}
        notRespondedUserIds={allNotRespondedForReminders.map((member: any) => member.id)}
        canSendReminders={canSendReminders}
        trackableMembersCount={isMiniLeagueEvent ? (miniLeagueAdults?.length ?? 0) : trackableMembers}
        addressableMembers={addressableMembers}
        onShareLink={handleShareReminderLink}
        onProRequired={gateReminders}
        eventType={event.type}
      />
    </div>
  );
}
