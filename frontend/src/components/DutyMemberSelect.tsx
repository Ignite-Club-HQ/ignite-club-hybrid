import * as React from "react";
import { Check, ChevronDown, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";


interface Member {
  id: string;
  display_name: string;
  avatar_url?: string | null;
}

interface DutyMemberSelectProps {
  value: string | null;
  onValueChange: (value: string | null) => void;
  members: Member[];
  dutyName: string;
  disabled?: boolean;
}

export function DutyMemberSelect({
  value,
  onValueChange,
  members,
  dutyName,
  disabled = false,
}: DutyMemberSelectProps) {
  const [open, setOpen] = React.useState(false);

  const selectedMember = members.find((m) => m.id === value);

  const handleSelect = (memberId: string | null) => {
    onValueChange(memberId);
    setOpen(false);
  };

  // Scroll-vs-tap detection: if finger moves more than the threshold between
  // touchstart and touchend, treat as a scroll and suppress the click.
  const touchRef = React.useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const MOVE_THRESHOLD = 10;

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY, moved: false };
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    const start = touchRef.current;
    if (!start) return;
    const t = e.touches[0];
    if (
      Math.abs(t.clientX - start.x) > MOVE_THRESHOLD ||
      Math.abs(t.clientY - start.y) > MOVE_THRESHOLD
    ) {
      start.moved = true;
    }
  };
  const guardedSelect = (memberId: string | null) => (e: React.MouseEvent) => {
    if (touchRef.current?.moved) {
      e.preventDefault();
      e.stopPropagation();
      touchRef.current = null;
      return;
    }
    touchRef.current = null;
    handleSelect(memberId);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
        className={cn(
          "w-full justify-between h-12 px-3 font-normal",
          !selectedMember && "text-muted-foreground"
        )}
      >
        {selectedMember ? (
          <div className="flex items-center gap-2 min-w-0">
            <Avatar className="h-6 w-6 shrink-0">
              <AvatarImage src={selectedMember.avatar_url || undefined} />
              <AvatarFallback className="text-xs">
                {selectedMember.display_name?.charAt(0)?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{selectedMember.display_name}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <User className="h-4 w-4" />
            <span>Assign volunteer</span>
          </div>
        )}
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </Button>

      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent className="sm:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Assign: {dutyName}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>

          <div>
            <div className="space-y-3 py-4">
              {/* Unassigned option */}
              <button
                type="button"
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onClick={guardedSelect(null)}
                className={cn(
                  "w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left",
                  "touch-manipulation focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                  "hover:bg-accent/50",
                  value === null
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card hover:border-primary/50"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "h-12 w-12 rounded-full flex items-center justify-center transition-colors",
                    value === null ? "bg-primary text-primary-foreground" : "bg-muted"
                  )}>
                    <User className="h-5 w-5" />
                  </div>
                  <div className="text-left">
                    <p className={cn(
                      "font-medium",
                      value === null ? "text-primary" : "text-muted-foreground"
                    )}>
                      Unassigned
                    </p>
                    <p className="text-xs text-muted-foreground">Remove assignment</p>
                  </div>
                </div>
                {value === null && (
                  <Check className="h-5 w-5 text-primary shrink-0" />
                )}
              </button>

              {/* Member options */}
              {members.map((member) => {
                const isSelected = value === member.id;
                return (
                  <button
                    key={member.id}
                    type="button"
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onClick={guardedSelect(member.id)}
                    className={cn(
                      "w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left",
                      "touch-manipulation focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                      "hover:bg-accent/50",
                      isSelected
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:border-primary/50"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className={cn(
                        "h-12 w-12 border-2 transition-colors",
                        isSelected ? "border-primary" : "border-transparent"
                      )}>
                        <AvatarImage src={member.avatar_url || undefined} />
                        <AvatarFallback className="text-sm bg-muted">
                          {member.display_name?.charAt(0)?.toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <p className={cn(
                        "font-medium",
                        isSelected ? "text-primary" : "text-foreground"
                      )}>
                        {member.display_name}
                      </p>
                    </div>
                    {isSelected && (
                      <Check className="h-5 w-5 text-primary shrink-0" />
                    )}
                  </button>
                );
              })}

              {members.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <div className="h-16 w-16 mx-auto mb-3 rounded-full bg-muted flex items-center justify-center">
                    <User className="h-8 w-8 opacity-50" />
                  </div>
                  <p className="font-medium">No members available</p>
                  <p className="text-sm">Select a club or team first</p>
                </div>
              )}
            </div>
          </div>

          <ResponsiveDialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
