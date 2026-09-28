import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { membershipKeys } from "@/lab/membershipQueryKeys";
import { refreshTeamRoleChange } from "@/lab/teamMembershipCacheCompletion";

interface Props {
  pendingCount: number;
  teamId?: string;
  clubId?: string;
}

/**
 * Admin tool to reconcile "ghost" pending invites — entries left in a pending state
 * because the user signed up with a different role than the invite was for, or because
 * their email was never auto-linked.
 *
 * Calls the `reconcile_pending_invites` RPC, which authorizes admins server-side and
 * matches pending invites to active members of the team/club by user_id or email.
 * Roles are not changed — only the pending invite status.
 */
export default function ReconcilePendingInvitesButton({ pendingCount, teamId, clubId }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  if (pendingCount === 0) return null;
  if (!teamId && !clubId) return null;

  const handleReconcile = async () => {
    setIsRunning(true);
    try {
      const { data, error } = await supabase.rpc("reconcile_pending_invites", {
        _team_id: teamId ?? null,
        _club_id: teamId ? null : (clubId ?? null),
      });

      if (error) {
        toast({
          title: "Reconcile failed",
          description: error.message,
          variant: "destructive",
        });
        return;
      }

      const row = Array.isArray(data) ? data[0] : data;
      const reconciled = (row as any)?.reconciled_count ?? 0;
      const skipped = (row as any)?.skipped_count ?? 0;

      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      queryClient.invalidateQueries({ queryKey: ["pending-invites", teamId, clubId] });
      if (teamId) {
        refreshTeamRoleChange(queryClient, teamId);
      } else {
        queryClient.invalidateQueries({ queryKey: membershipKeys.teamRoles() });
      }

      if (reconciled === 0) {
        toast({
          title: "Nothing to reconcile",
          description: `No pending invites matched an existing active member${skipped ? ` (${skipped} checked).` : "."}`,
        });
      } else {
        toast({
          title: `Reconciled ${reconciled} invite${reconciled !== 1 ? "s" : ""}`,
          description: skipped > 0 ? `${skipped} could not be matched and remain pending.` : undefined,
        });
      }
    } catch (err: any) {
      toast({
        title: "Reconcile failed",
        description: err?.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsRunning(false);
      setIsOpen(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        disabled={isRunning}
        className="h-7 text-xs gap-1.5"
        title="Match pending invites to active members and clear stale entries"
      >
        {isRunning ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Wand2 className="h-3 w-3" />
        )}
        Reconcile
      </Button>

      <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reconcile pending invites?</AlertDialogTitle>
            <AlertDialogDescription>
              This will scan {pendingCount} pending invite{pendingCount !== 1 ? "s" : ""} and
              mark any as accepted where the invited person is already an active member of this
              {teamId ? " team" : " club"} (matched by user or email). This is useful for clearing
              "ghost" pending invites left behind when someone joined with a different role than
              was originally invited.
              <br /><br />
              Roles are <strong>not</strong> changed — only the pending invite status.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRunning}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReconcile} disabled={isRunning}>
              {isRunning ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Reconciling...
                </>
              ) : (
                "Reconcile"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
