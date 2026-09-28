import { Check, CheckCircle, XCircle } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { SwipeableNotificationCard } from "@/components/SwipeableNotificationCard";
import { useNotificationIcon } from "@/components/NotificationIcon";

export interface NotificationListItem {
  id: string;
  type: string;
  message: string;
  read: boolean;
  created_at: string;
  related_id: string | null;
}

const EVENT_LINK_NOTIFICATION_TYPES = [
  "event_invite",
  "event_cancelled",
  "event_updated",
  "event_reminder",
  "event_view_reminder",
  "duty_assigned",
  "duty_completed",
];

export function NotificationIconWrapper({ type, isRead, message }: { type: string; isRead: boolean; message?: string | null }) {
  const { Icon, reactionEmoji, colorClass } = useNotificationIcon(type, message);
  return (
    <div className={`p-2 rounded-lg ${isRead ? "bg-muted" : "bg-primary/10"}`}>
      {reactionEmoji ? (
        <span
          className="inline-flex items-center justify-center h-4 w-4 text-base leading-none"
          role="img"
          aria-label={type.replace(/_/g, " ")}
        >
          {reactionEmoji}
        </span>
      ) : (
        <Icon className={`h-4 w-4 ${isRead ? "text-muted-foreground" : colorClass}`} />
      )}
    </div>
  );
}

export interface NotificationListCardProps {
  notification: NotificationListItem;
  /** "unread" adds the primary border and the mark-as-read action; "earlier" is a dimmed read-only row. */
  variant: "unread" | "earlier";
  onClick: () => void;
  onDelete: () => void;
  onViewEvent: () => void;
  onMarkAsRead: () => void;
  onApproveJoinRequest: () => void;
  onDenyJoinRequest: () => void;
  joinRequestActionsDisabled: boolean;
}

/**
 * Shared notification row for both the "Unread" and "Earlier" sections of
 * NotificationsPage. The only real differences between the two sections are
 * the dimmed styling/message color and whether a mark-as-read action is
 * shown; every other interaction (event link, join-request approve/deny,
 * delete) behaves identically.
 */
export function NotificationListCard({
  notification,
  variant,
  onClick,
  onDelete,
  onViewEvent,
  onMarkAsRead,
  onApproveJoinRequest,
  onDenyJoinRequest,
  joinRequestActionsDisabled,
}: NotificationListCardProps) {
  const isEarlier = variant === "earlier";

  return (
    <SwipeableNotificationCard
      className={isEarlier ? "opacity-60" : "border-primary/30"}
      onClick={onClick}
      onDelete={onDelete}
    >
      <div className="flex items-start gap-3">
        <NotificationIconWrapper type={notification.type} isRead={notification.read} message={notification.message} />
        <div className="flex-1 min-w-0">
          <p className={isEarlier ? "text-sm text-muted-foreground" : "text-sm"}>
            {notification.message}
            {EVENT_LINK_NOTIFICATION_TYPES.includes(notification.type) && notification.related_id && (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 ml-1 text-primary font-medium"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewEvent();
                }}
              >
                View event →
              </Button>
            )}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {formatDistanceToNow(parseISO(notification.created_at), { addSuffix: true })}
          </p>
          {notification.type === "join_request" && notification.related_id && (
            <div className="flex gap-2 mt-2">
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onApproveJoinRequest();
                }}
                disabled={joinRequestActionsDisabled}
              >
                <CheckCircle className="h-3 w-3 mr-1" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs text-destructive hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDenyJoinRequest();
                }}
                disabled={joinRequestActionsDisabled}
              >
                <XCircle className="h-3 w-3 mr-1" />
                Deny
              </Button>
            </div>
          )}
        </div>
        {!isEarlier && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            onTouchEnd={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onMarkAsRead();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onMarkAsRead();
            }}
          >
            <Check className="h-4 w-4" />
          </Button>
        )}
      </div>
    </SwipeableNotificationCard>
  );
}
