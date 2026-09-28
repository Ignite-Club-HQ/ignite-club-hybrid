import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserPlus, Pencil, ArrowRightLeft, Link2, UserMinus } from "lucide-react";

interface ChildDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  childName: string;
  parentDisplay?: string | null;
  isPending: boolean;
  canManage: boolean;
  showPosition: boolean;
  canMove: boolean;
  onInviteParent: () => void;
  onEditPosition: () => void;
  onSwapTeam: () => void;
  onLink?: () => void;
  onRemove?: () => void;
}

export default function ChildDetailSheet({
  open,
  onOpenChange,
  childName,
  parentDisplay,
  isPending,
  canManage,
  showPosition,
  canMove,
  onInviteParent,
  onEditPosition,
  onSwapTeam,
  onLink,
  onRemove,
}: ChildDetailSheetProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle className="sr-only">Player Details</DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-6 space-y-5">
          {/* Profile header */}
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12">
              <AvatarFallback className={isPending ? "bg-orange-500/20 text-orange-500 text-lg font-semibold" : "bg-pink-500/20 text-pink-500 text-lg font-semibold"}>
                {childName?.charAt(0)?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-base truncate">{childName}</p>
              {parentDisplay && (
                <p className="text-xs text-muted-foreground truncate">{parentDisplay}</p>
              )}
            </div>
            <Badge variant="outline" className={isPending
              ? "bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs"
              : "bg-pink-500/20 text-pink-400 border-pink-500/30 text-xs"
            }>
              {isPending ? "Pending" : "Child"}
            </Badge>
          </div>

          {/* Actions */}
          {canManage && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Actions</p>
              <div className="grid gap-2">
                {isPending && onLink ? (
                  <Button
                    variant="outline"
                    className="justify-start gap-2 h-11"
                    onClick={() => { onOpenChange(false); onLink(); }}
                  >
                    <Link2 className="h-4 w-4 text-orange-500" />
                    Link to Existing Parent
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      className="justify-start gap-2 h-11"
                      onClick={() => { onOpenChange(false); onInviteParent(); }}
                    >
                      <UserPlus className="h-4 w-4 text-emerald-500" />
                      Invite Parent
                    </Button>
                    {showPosition && (
                      <Button
                        variant="outline"
                        className="justify-start gap-2 h-11"
                        onClick={() => { onOpenChange(false); onEditPosition(); }}
                      >
                        <Pencil className="h-4 w-4 text-blue-500" />
                        Edit Position
                      </Button>
                    )}
                    {canMove && (
                      <Button
                        variant="outline"
                        className="justify-start gap-2 h-11"
                        onClick={() => { onOpenChange(false); onSwapTeam(); }}
                      >
                        <ArrowRightLeft className="h-4 w-4 text-amber-500" />
                        Move to Another Team
                      </Button>
                    )}
                    {onRemove && (
                      <Button
                        variant="outline"
                        className="justify-start gap-2 h-11 text-destructive hover:text-destructive"
                        onClick={() => { onOpenChange(false); onRemove(); }}
                      >
                        <UserMinus className="h-4 w-4" />
                        Remove from Team
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
