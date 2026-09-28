import { ArrowLeft, Bell, MoreVertical, Pencil, Share2, Trash2, UserPlus, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type EventType = "game" | "training" | "social";

const eventTypeColors: Record<EventType, string> = {
  game: "bg-destructive/20 text-destructive",
  training: "bg-primary/20 text-primary",
  social: "bg-warning/20 text-warning",
};

interface EventDetailHeaderProps {
  event: { type: EventType; is_cancelled: boolean; event_date: string; end_time?: string | null; start_time?: string | null };
  eventTypeLabel: string;
  canManageEvent: boolean;
  canSendReminders: boolean;
  isLoadingHasTeamPro: boolean;
  onBack: () => void;
  onShare: () => void;
  onEdit: () => void;
  onSendReminders: () => void;
  onResendInvites: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

export function EventDetailHeader({
  event,
  eventTypeLabel,
  canManageEvent,
  canSendReminders,
  isLoadingHasTeamPro,
  onBack,
  onShare,
  onEdit,
  onSendReminders,
  onResendInvites,
  onCancel,
  onDelete,
}: EventDetailHeaderProps) {
  const eventDateStr = event.event_date?.split("T")[0] || event.event_date;
  const isUpcoming =
    new Date(eventDateStr + "T" + (event.end_time || event.start_time || "23:59")) >= new Date();

  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="icon" className="shrink-0" onClick={onBack}>
        <ArrowLeft className="h-5 w-5" />
      </Button>
      <Badge className={eventTypeColors[event.type]} variant="secondary">
        {eventTypeLabel}
      </Badge>
      <div className="flex-1" />
      <Button variant="ghost" size="icon" className="shrink-0" onClick={onShare}>
        <Share2 className="h-5 w-5" />
      </Button>
      {canManageEvent && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0">
              <MoreVertical className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-popover">
            {!event.is_cancelled && (
              <>
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit {eventTypeLabel}
                </DropdownMenuItem>
                {isUpcoming && (canSendReminders ? (
                  <DropdownMenuItem onClick={onSendReminders}>
                    <Bell className="h-4 w-4 mr-2 text-primary" />
                    Send Reminders
                  </DropdownMenuItem>
                ) : !isLoadingHasTeamPro && (
                  <DropdownMenuItem disabled>
                    <Bell className="h-4 w-4 mr-2" />
                    Send Reminders
                    <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1">Pro</Badge>
                  </DropdownMenuItem>
                ))}
                {isUpcoming && (
                  <DropdownMenuItem onClick={onResendInvites}>
                    <UserPlus className="h-4 w-4 mr-2 text-primary" />
                    Resend Invites
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onCancel} className="text-warning focus:text-warning">
                  <XCircle className="h-4 w-4 mr-2" />
                  Cancel {eventTypeLabel}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="h-4 w-4 mr-2" />
              Delete {eventTypeLabel}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
