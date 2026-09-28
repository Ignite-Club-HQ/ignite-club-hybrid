import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Pencil } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

type RsvpStatus = "going" | "maybe" | "not_going";

const statusConfig: Record<RsvpStatus, { label: string; icon: string; badgeClass: string }> = {
  going: {
    label: "Going",
    icon: "✅",
    badgeClass: "border-primary/40 bg-primary/10 text-primary",
  },
  maybe: {
    label: "Maybe",
    icon: "🤔",
    badgeClass: "border-warning/40 bg-warning/10 text-warning",
  },
  not_going: {
    label: "Not Going",
    icon: "❌",
    badgeClass: "border-destructive/40 bg-destructive/10 text-destructive",
  },
};

const allStatuses: RsvpStatus[] = ["going", "maybe", "not_going"];

interface AdminRsvpChangerProps {
  currentStatus: RsvpStatus | null;
  playerName: string;
  onChangeStatus: (status: RsvpStatus) => void;
  isPending?: boolean;
}

/**
 * Icon-only edit action that opens a bottom sheet with RSVP status options.
 * Used by admins to set or change another person's RSVP response.
 */
export function AdminRsvpChanger({
  currentStatus,
  playerName,
  onChangeStatus,
  isPending,
}: AdminRsvpChangerProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = (status: RsvpStatus) => {
    onChangeStatus(status);
    setOpen(false);
  };

  const titlePrefix = currentStatus ? "Change RSVP for" : "Set RSVP for";
  const subtitle = currentStatus
    ? "You are editing this response as an admin"
    : "You are setting this response as an admin";

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
          disabled={isPending}
          aria-label={`${titlePrefix} ${playerName}`}
          title={`${titlePrefix} ${playerName}`}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Pencil className="h-4 w-4" />
          )}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="pb-2">
          <DrawerTitle className="text-base">
            {titlePrefix} {playerName}
          </DrawerTitle>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </DrawerHeader>
        <div className="px-4 pb-6 space-y-2">
          {allStatuses.map((status) => {
            const opt = statusConfig[status];
            const isActive = status === currentStatus;
            return (
              <Button
                key={status}
                variant={isActive ? "secondary" : "outline"}
                className={`w-full justify-start gap-3 h-12 text-base ${isActive ? "ring-2 ring-primary/30" : ""}`}
                onClick={() => !isActive && handleSelect(status)}
                disabled={isPending || isActive}
              >
                <span className="text-lg">{opt.icon}</span>
                {opt.label}
                {isActive && (
                  <span className="ml-auto text-xs text-muted-foreground">Current</span>
                )}
              </Button>
            );
          })}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
