import { useState, useEffect, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, ArrowRightLeft, Trash2, X, MessageCircle, Loader2, ShieldCheck, Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
const ManageRolesDialog = lazyWithRetry(() => import("@/components/ManageRolesDialog"));

const ROLE_LABELS: Record<string, string> = {
  app_admin: "App Admin",
  club_admin: "Club Admin",
  team_admin: "Team Admin",
  coach: "Coach",
  player: "Player",
  parent: "Parent",
  basic_user: "Member",
};

const ROLE_COLORS: Record<string, string> = {
  app_admin: "bg-red-500/20 text-red-400 border-red-500/30",
  club_admin: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  team_admin: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  coach: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  player: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  parent: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  basic_user: "bg-muted text-muted-foreground border-border",
};

interface MemberRole {
  id: string;
  role: string;
}

interface MemberDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  roles: MemberRole[];
  canManage: boolean;
  canMove: boolean;
  isSelf: boolean;
  showMoveAction?: boolean;
  showRemoveAction?: boolean;
  onAddRole: () => void;
  onMove: () => void;
  onRemove: () => void;
  onRemoveRole: (roleItem: MemberRole) => void;
  /**
   * When provided alongside `canManage`, the sheet renders a single
   * "Manage roles" entry (opens the unified ManageRolesDialog) instead of
   * the legacy inline X chip removals + "Add Role" button. Falls back to
   * the legacy UX when these props are not supplied (e.g. chat surfaces).
   */
  teamId?: string;
  teamName?: string;
  clubId?: string;
  /** Called after a successful save in the unified dialog. */
  onRolesUpdated?: () => void;
}

export default function MemberDetailSheet({
  open,
  onOpenChange,
  userId,
  displayName,
  avatarUrl,
  roles,
  canManage,
  canMove,
  isSelf,
  showMoveAction = true,
  showRemoveAction = true,
  onAddRole,
  onMove,
  onRemove,
  onRemoveRole,
  teamId,
  teamName,
  clubId,
  onRolesUpdated,
}: MemberDetailSheetProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [startingDM, setStartingDM] = useState(false);
  const [canDM, setCanDM] = useState<boolean | null>(null);
  const [manageRolesOpen, setManageRolesOpen] = useState(false);
  // When the parent provides full team context, the new unified dialog handles
  // both adding and removing roles (with confirmations). Otherwise we fall
  // back to the legacy inline-X chip removals + "Add Role" callback.
  const useUnifiedDialog =
    canManage && !isSelf && !!teamId && !!teamName && !!clubId;
  const canRemoveRoles =
    canManage && !isSelf && roles.length > 1 && !useUnifiedDialog;

  // Check DM permission whenever the sheet opens for a non-self member
  useEffect(() => {
    if (!open || isSelf || !userId) {
      setCanDM(null);
      return;
    }
    let cancelled = false;
    setCanDM(null);
    supabase
      .rpc("can_dm_user", { other_user_id: userId })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          // Fail open — let the RPC enforce on send
          setCanDM(true);
        } else {
          setCanDM(data === true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, isSelf, userId]);

  const handleSendMessage = async () => {
    if (startingDM || canDM === false) return;
    setStartingDM(true);
    try {
      // 1. Quick check for an existing conversation so we can confirm + skip creation
      let existingConvId: string | null = null;
      if (user?.id) {
        const [p1, p2] = user.id < userId ? [user.id, userId] : [userId, user.id];
        const { data: existing } = await supabase
          .from("direct_conversations")
          .select("id")
          .eq("participant_1", p1)
          .eq("participant_2", p2)
          .maybeSingle();
        existingConvId = existing?.id ?? null;
      }

      if (existingConvId) {
        toast.success(`Opening existing conversation with ${displayName}`);
        onOpenChange(false);
        navigate(`/messages/dm/${existingConvId}`);
        return;
      }

      // 2. No existing convo — create one
      const { data, error } = await supabase.rpc("get_or_create_dm_conversation", {
        other_user_id: userId,
      });
      if (error) throw error;
      onOpenChange(false);
      navigate(`/messages/dm/${data as string}`);
    } catch (err: any) {
      const message = err?.message || "Could not start conversation";
      toast.error(message.includes("not allowed") || message.includes("permission")
        ? "You can't message this member"
        : `Failed to start conversation: ${message}`);
    } finally {
      setStartingDM(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle className="sr-only">Member Details</DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-6 space-y-5">
          {/* Profile header */}
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12">
              <AvatarImage src={avatarUrl || undefined} />
              <AvatarFallback className="bg-primary/20 text-primary text-lg">
                {displayName?.charAt(0)?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-base truncate">{displayName}</p>
              <p className="text-xs text-muted-foreground">
                {roles.map(r => ROLE_LABELS[r.role] || r.role).join(", ")}
              </p>
            </div>
          </div>

          {/* Current roles */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Roles</p>
            <div className="flex flex-wrap gap-2">
              {roles.map((roleItem) => {
                const colorClass = ROLE_COLORS[roleItem.role] || ROLE_COLORS.basic_user;
                const label = ROLE_LABELS[roleItem.role] || "Member";
                return (
                  <Badge
                    key={roleItem.id}
                    variant="outline"
                    className={`text-xs border px-2 py-0.5 ${colorClass} flex items-center gap-1`}
                  >
                    {label}
                    {canRemoveRoles && (
                      <button
                        onClick={() => onRemoveRole(roleItem)}
                        className="ml-0.5 hover:bg-destructive/20 rounded-full p-0.5"
                        aria-label={`Remove ${label} role`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </Badge>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          {(!isSelf || canManage) && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Actions</p>
              <div className="grid gap-2">
                {!isSelf && canDM !== false && (
                  <Button
                    variant="outline"
                    className="justify-start gap-2 h-11"
                    onClick={handleSendMessage}
                    disabled={startingDM || canDM === null}
                  >
                    {startingDM ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : (
                      <MessageCircle className="h-4 w-4 text-primary" />
                    )}
                    Send Message
                  </Button>
                )}
                {!isSelf && canDM === false && (
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div tabIndex={0}>
                          <Button
                            variant="outline"
                            className="w-full justify-start gap-2 h-11 opacity-60 cursor-not-allowed"
                            disabled
                          >
                            <MessageCircle className="h-4 w-4 text-muted-foreground" />
                            Send Message
                          </Button>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[260px] text-xs">
                        You can only message members who share a team, club, or group chat with you.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {useUnifiedDialog ? (
                  <Button
                    variant="outline"
                    className="justify-start gap-2 h-11"
                    onClick={() => setManageRolesOpen(true)}
                  >
                    <Settings2 className="h-4 w-4 text-primary" />
                    Manage roles
                    <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
                  </Button>
                ) : (
                  canManage && (
                    <Button
                      variant="outline"
                      className="justify-start gap-2 h-11"
                      onClick={() => {
                        onOpenChange(false);
                        onAddRole();
                      }}
                    >
                      <Plus className="h-4 w-4 text-blue-500" />
                      Add Role
                    </Button>
                  )
                )}
                {canManage && showMoveAction && canMove && (
                  <Button
                    variant="outline"
                    className="justify-start gap-2 h-11"
                    onClick={() => {
                      onOpenChange(false);
                      onMove();
                    }}
                  >
                    <ArrowRightLeft className="h-4 w-4 text-amber-500" />
                    Move to Another Team
                  </Button>
                )}
                {canManage && showRemoveAction && !isSelf && (
                  <Button
                    variant="outline"
                    className="justify-start gap-2 h-11 text-destructive hover:text-destructive"
                    onClick={() => {
                      onOpenChange(false);
                      onRemove();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove from Team
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </DrawerContent>
      {useUnifiedDialog && teamId && teamName && clubId && (
        <Suspense fallback={null}>
        <ManageRolesDialog
          open={manageRolesOpen}
          onOpenChange={setManageRolesOpen}
          userId={userId}
          userName={displayName}
          avatarUrl={avatarUrl}
          teamId={teamId}
          teamName={teamName}
          clubId={clubId}
          currentRoles={roles}
          canManage={canManage}
          onSaved={() => {
            onOpenChange(false);
            onRolesUpdated?.();
          }}
        />
        </Suspense>
      )}
    </Drawer>
  );
}
