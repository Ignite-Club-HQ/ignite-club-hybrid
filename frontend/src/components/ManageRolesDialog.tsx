import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { invalidateRolesCache } from "@/lib/rolesCache";
import { cn } from "@/lib/utils";
import { refreshTeamRoleChange } from "@/lab/teamMembershipCacheCompletion";

/**
 * Single dialog that unifies role assignment AND team-admin promotion for a
 * team member. Replaces the previous split UX (separate "Add Role" dialog +
 * inline X chip removals + standalone "Promote to Team Admin" flow when
 * surfaced from the member card).
 *
 * - Lists every assignable role with a checkbox-style toggle.
 * - Highlights `team_admin` as an elevated-access role.
 * - Confirms removal of any currently-assigned role to prevent accidental
 *   demotion (especially Team Admin).
 * - Emits a single notification + toast summarising adds/removes.
 */

type TeamRole = "player" | "parent" | "coach" | "team_admin";

interface RoleEntry {
  id: string;
  role: string;
}

const ROLE_OPTIONS: {
  value: TeamRole;
  label: string;
  description: string;
  color: string;
  elevated?: boolean;
}[] = [
  {
    value: "player",
    label: "Player",
    description: "Can participate in team events",
    color: "bg-emerald-500/10 text-emerald-600 border-emerald-200 dark:text-emerald-400",
  },
  {
    value: "parent",
    label: "Parent",
    description: "Can view team activities for their child",
    color: "bg-blue-500/10 text-blue-600 border-blue-200 dark:text-blue-400",
  },
  {
    value: "coach",
    label: "Coach",
    description: "Can manage events and rosters",
    color: "bg-amber-500/10 text-amber-600 border-amber-200 dark:text-amber-400",
  },
  {
    value: "team_admin",
    label: "Team Admin",
    description: "Full team management access",
    color: "bg-purple-500/10 text-purple-600 border-purple-200 dark:text-purple-400",
    elevated: true,
  },
];

const ROLE_LABEL: Record<string, string> = ROLE_OPTIONS.reduce(
  (acc, r) => ({ ...acc, [r.value]: r.label }),
  {} as Record<string, string>,
);

interface ManageRolesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
  avatarUrl?: string | null;
  teamId: string;
  teamName: string;
  clubId: string;
  /** Existing roles for this member on this team (full row + role string). */
  currentRoles: RoleEntry[];
  /** Disable changes when the viewer can't manage roles (defensive). */
  canManage: boolean;
  /** Called after a successful save so the parent can dismiss its own UI. */
  onSaved?: () => void;
}

export default function ManageRolesDialog({
  open,
  onOpenChange,
  userId,
  userName,
  avatarUrl,
  teamId,
  teamName,
  clubId,
  currentRoles,
  canManage,
  onSaved,
}: ManageRolesDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const initialRoles = useMemo(
    () => new Set(currentRoles.map((r) => r.role as TeamRole)),
    [currentRoles],
  );
  const [selected, setSelected] = useState<Set<TeamRole>>(initialRoles);
  const [pendingConfirm, setPendingConfirm] = useState<TeamRole | null>(null);

  // Reset selection whenever the dialog opens or the member changes.
  useEffect(() => {
    if (open) setSelected(new Set(currentRoles.map((r) => r.role as TeamRole)));
  }, [open, currentRoles]);

  const additions = useMemo(
    () => ROLE_OPTIONS.filter((r) => selected.has(r.value) && !initialRoles.has(r.value)),
    [selected, initialRoles],
  );
  const removals = useMemo(
    () => currentRoles.filter((r) => !selected.has(r.role as TeamRole)),
    [currentRoles, selected],
  );
  const hasChanges = additions.length > 0 || removals.length > 0;

  const requestToggle = (role: TeamRole) => {
    if (!canManage) return;
    if (selected.has(role) && initialRoles.has(role)) {
      // Removing an already-saved role → confirm first
      setPendingConfirm(role);
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  };

  const confirmRemove = () => {
    if (!pendingConfirm) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(pendingConfirm);
      return next;
    });
    setPendingConfirm(null);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Inserts first so we never leave a member role-less mid-flight.
      if (additions.length > 0) {
        const rows = additions.map((r) => ({
          user_id: userId,
          team_id: teamId,
          club_id: clubId,
          role: r.value,
        }));
        const { error } = await supabase.from("user_roles").insert(rows);
        if (error) throw error;
      }
      if (removals.length > 0) {
        const ids = removals.map((r) => r.id);
        const { error } = await supabase.from("user_roles").delete().in("id", ids);
        if (error) throw error;
      }

      // Single consolidated notification summarising the change.
      const parts: string[] = [];
      if (additions.length > 0) {
        parts.push(`added: ${additions.map((r) => r.label).join(", ")}`);
      }
      if (removals.length > 0) {
        parts.push(
          `removed: ${removals.map((r) => ROLE_LABEL[r.role] ?? r.role).join(", ")}`,
        );
      }
      if (parts.length > 0) {
        await supabase.from("notifications").insert({
          user_id: userId,
          type: "membership",
          message: `Your roles in ${teamName} were updated — ${parts.join("; ")}`,
          related_id: teamId,
        });
      }

      // Invalidate the affected user's role cache (e.g. team_admin gained/lost).
      invalidateRolesCache();
    },
    onSuccess: () => {
      refreshTeamRoleChange(queryClient, teamId);

      const summary: string[] = [];
      if (additions.length > 0) {
        summary.push(
          `Added ${additions.length} role${additions.length === 1 ? "" : "s"}`,
        );
      }
      if (removals.length > 0) {
        summary.push(
          `Removed ${removals.length} role${removals.length === 1 ? "" : "s"}`,
        );
      }
      toast({
        title: "Roles updated",
        description: summary.join(" · ") || "No changes",
      });
      onOpenChange(false);
      onSaved?.();
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't update roles",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const willLoseAllRoles = selected.size === 0;

  return (
    <>
      <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <Avatar className="h-10 w-10">
                <AvatarImage src={avatarUrl || undefined} />
                <AvatarFallback className="bg-primary/20 text-primary">
                  {userName?.charAt(0)?.toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <ResponsiveDialogTitle className="truncate">
                  Manage roles
                </ResponsiveDialogTitle>
                <ResponsiveDialogDescription className="truncate">
                  {userName} · {teamName}
                </ResponsiveDialogDescription>
              </div>
            </div>
          </ResponsiveDialogHeader>

          <div className="space-y-2 py-2">
            {ROLE_OPTIONS.map((role) => {
              const isSelected = selected.has(role.value);
              const wasInitial = initialRoles.has(role.value);
              return (
                <button
                  key={role.value}
                  type="button"
                  onClick={() => requestToggle(role.value)}
                  disabled={!canManage}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50 hover:bg-muted/50",
                    !canManage && "opacity-60 cursor-not-allowed",
                  )}
                >
                  <div
                    className={cn(
                      "h-5 w-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors",
                      isSelected
                        ? "border-primary bg-primary"
                        : "border-muted-foreground/30",
                    )}
                  >
                    {isSelected && (
                      <Check className="h-3 w-3 text-primary-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={cn(
                          "text-xs font-medium px-2 py-0.5 rounded-full border inline-flex items-center gap-1",
                          role.color,
                        )}
                      >
                        {role.elevated && <ShieldCheck className="h-3 w-3" />}
                        {role.label}
                      </span>
                      {wasInitial && !isSelected && (
                        <span className="text-[10px] uppercase tracking-wide text-destructive font-semibold">
                          Will be removed
                        </span>
                      )}
                      {!wasInitial && isSelected && (
                        <span className="text-[10px] uppercase tracking-wide text-primary font-semibold">
                          New
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {role.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {willLoseAllRoles && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                {userName} will have no roles on this team and will lose access.
                Consider removing them from the team instead.
              </span>
            </div>
          )}

          <ResponsiveDialogFooter>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1 sm:flex-none"
            >
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={
                !canManage ||
                !hasChanges ||
                willLoseAllRoles ||
                saveMutation.isPending
              }
              className="flex-1 sm:flex-none"
            >
              {saveMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <AlertDialog
        open={!!pendingConfirm}
        onOpenChange={(o) => {
          if (!o) setPendingConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {pendingConfirm ? ROLE_LABEL[pendingConfirm] : "role"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingConfirm === "team_admin"
                ? `${userName} will lose Team Admin access for ${teamName}, including the ability to manage members and events.`
                : `${userName} will no longer have the ${
                    pendingConfirm ? ROLE_LABEL[pendingConfirm] : ""
                  } role on ${teamName}. This change is saved when you tap Save changes.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep role</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
