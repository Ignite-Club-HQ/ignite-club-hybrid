import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { eventKeys } from "@/lab/eventQueryKeys";
import { getMatchArrivalDate } from "@/lib/matchArrivalTime";
import { setLocalEventDuty } from "@/lab/localEventsService";

type DutyStatus = "open" | "completed";

// Thrown when the duty row committed as completed but the admin/coach
// notification insert failed. Records explicitly that the duty is committed.
class DutyNotificationPartialError extends Error {
  dutyCommitted = true as const;
  constructor(public underlying: string) {
    super(underlying);
    this.name = "DutyNotificationPartialError";
  }
}

export interface UseEventDutyMutationsArgs {
  supabase: any;
  useIcpLab: boolean;
  id: string | undefined;
  localIcpPersona: string;
  event: any;
  duties: any[] | undefined;
  user: { id?: string } | null | undefined;
  profile: { display_name?: string | null; avatar_url?: string | null } | null | undefined;
  selectedDutyId: string | null;
  setNewDutyName: (value: string) => void;
  setSelectedPresetDuty: (value: string) => void;
  setAddDutyOpen: (value: boolean) => void;
  setAssignDialogOpen: (value: boolean) => void;
  setSelectedDutyId: (value: string | null) => void;
  setSelectedUserId: (value: string) => void;
}

/**
 * Duty lifecycle mutations for the event detail page: add, claim, complete,
 * uncomplete, delete and assign. Extracted verbatim from `EventDetailPage.tsx`
 * — no control flow or decision logic changed, only file location.
 */
export function useEventDutyMutations(params: UseEventDutyMutationsArgs) {
  const {
    supabase, useIcpLab, id, localIcpPersona, event, duties, user, profile, selectedDutyId,
    setNewDutyName, setSelectedPresetDuty, setAddDutyOpen,
    setAssignDialogOpen, setSelectedDutyId, setSelectedUserId,
  } = params;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Add duty mutation
  const addDutyMutation = useMutation({
    mutationFn: async (args: { dutyName: string; startTime?: string; endTime?: string }) => {
      if (useIcpLab) {
        throw new Error("Open duty creation is not connected to the local events canister yet.");
      }

      // Combine event date with optional HH:MM times into ISO timestamps
      const buildTs = (hhmm?: string): string | null => {
        if (!hhmm || !event) return null;
        const base = new Date(event.start_time || event.event_date);
        if (Number.isNaN(base.getTime())) return null;
        const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
        if (Number.isNaN(h) || Number.isNaN(m)) return null;
        const d = new Date(base);
        d.setHours(h, m, 0, 0);
        return d.toISOString();
      };
      const start_time = buildTs(args.startTime);
      const end_time = buildTs(args.endTime);
      const { error } = await supabase
        .from("duties")
        .insert({ event_id: id!, name: args.dutyName, start_time, end_time } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      if (useIcpLab) {
        setNewDutyName("");
        setSelectedPresetDuty("");
        setAddDutyOpen(false);
        toast({ title: "Duty added locally" });
        return;
      }

      queryClient.invalidateQueries({ queryKey: eventKeys.duties(id) });
      setNewDutyName("");
      setSelectedPresetDuty("");
      setAddDutyOpen(false);
      toast({ title: "Duty added" });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to add duty", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Claim duty mutation
  const claimDutyMutation = useMutation({
    mutationFn: async (dutyId: string) => {
      if (useIcpLab) {
        if (!id) throw new Error("Missing event ID");
        const duty = duties?.find((candidate) => candidate.id === dutyId);
        if (!duty?.name) throw new Error("Duty not found");
        const localAccountId = user?.id ?? localIcpPersona;
        await setLocalEventDuty(localIcpPersona, id, localAccountId, duty.name);
        queryClient.setQueryData(eventKeys.duties(id), (current: unknown) =>
          (Array.isArray(current) ? current : []).map((duty: any) =>
            duty.id === dutyId
              ? { ...duty, assigned_to: localAccountId, profiles: { display_name: profile?.display_name || "Local ICP Member", avatar_url: profile?.avatar_url || null } }
              : duty,
          ),
        );
        return;
      }

      const { error } = await supabase
        .from("duties")
        .update({ assigned_to: user?.id })
        .eq("id", dutyId);
      if (error) throw error;
    },
    onSuccess: () => {
      if (useIcpLab) {
        toast({ title: "Duty claimed locally" });
        return;
      }

      queryClient.invalidateQueries({ queryKey: eventKeys.duties(id) });
      toast({ title: "Duty claimed!" });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to claim duty", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Complete duty mutation
  const completeDutyMutation = useMutation({
    mutationFn: async (dutyId: string) => {
      // Get duty details before updating
      const duty = duties?.find(d => d.id === dutyId);

      if (useIcpLab) {
        throw new Error("Duty completion is not connected to the local events canister yet.");
      }

      // Guard against premature completion — duties can only be marked complete
      // from match arrival time (for games) or event start time onwards.
      if (event) {
        const earliest = event.type === "game"
          ? (getMatchArrivalDate(event as any) ?? new Date(event.start_time || event.event_date))
          : new Date(event.start_time || event.event_date);
        if (!Number.isNaN(earliest.getTime()) && new Date() < earliest) {
          throw new Error(
            `This duty can't be completed yet — it's available from ${format(earliest, "EEE d MMM, h:mm a")}.`
          );
        }
      }

      const { data: updatedDuty, error } = await supabase
        .from("duties")
        .update({ status: "completed" as DutyStatus, completed_at: new Date().toISOString() })
        .eq("id", dutyId)
        .eq("status", "open")
        .select("id")
        .maybeSingle();
      // Duty update failed outright — no notifications, complete failure.
      if (error) throw error;
      // No row updated: the duty is no longer open (idempotent/concurrent
      // outcome). Do not notify; just refresh so current state is displayed.
      if (!updatedDuty) return { outcome: "noop" as const };

      // Notify team/club admins and coaches about duty completion
      if (event && duty) {
        const memberName = profile?.display_name || "A member";
        
        // Get admins/coaches for this team/event
        const roleQuery = event.team_id 
          ? supabase.from("user_roles").select("user_id").eq("team_id", event.team_id).in("role", ["team_admin", "coach", "club_admin", "committee_member"])
          : supabase.from("user_roles").select("user_id").eq("club_id", event.club_id).in("role", ["club_admin", "committee_member"]);
        
        const { data: admins, error: adminsError } = await roleQuery;

        if (adminsError) {
          throw new DutyNotificationPartialError(adminsError.message);
        }

        if (admins && admins.length > 0) {
          const recipientIds = Array.from(
            new Set(admins.map(a => a.user_id).filter((userId): userId is string => !!userId && userId !== user?.id))
          );
          const message = `${memberName} completed ${duty.name} for ${event.title}`;
          const notifications = recipientIds.map(userId => ({
              user_id: userId,
              type: "duty_completed",
              message,
              related_id: id,
            }));
          
          if (notifications.length > 0) {
            const { error: notificationError } = await supabase.from("notifications").insert(notifications);
            // 23505 = duplicate/idempotency conflict, intentionally tolerated.
            if (notificationError && notificationError.code !== "23505") {
              throw new DutyNotificationPartialError(notificationError.message);
            }
          }
        }
      }
      return { outcome: "completed" as const };
    },
    onSuccess: (result) => {
      if (useIcpLab) {
        toast({ title: "Duty completed locally" });
        return;
      }

      queryClient.invalidateQueries({ queryKey: eventKeys.duties(id) });
      if (result?.outcome === "completed") {
        toast({ title: "Duty completed!" });
      }
    },

    onError: (error) => {
      if (error instanceof DutyNotificationPartialError) {
        // The duty IS completed — never roll back or reopen it, and never
        // report a total failure.
        queryClient.invalidateQueries({ queryKey: eventKeys.duties(id) });
        toast({
          title: "Duty completed — notification failed",
          description: `The duty was marked complete, but administrators couldn't be notified. ${error.underlying}`,
          variant: "destructive",
        });
        return;
      }
      toast({ 
        title: "Failed to complete duty", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });


  // Undo duty completion (in case of accidental tap)
  const uncompleteDutyMutation = useMutation({
    mutationFn: async (dutyId: string) => {
      if (useIcpLab) {
        throw new Error("Duty reopening is not connected to the local events canister yet.");
      }

      const { error } = await supabase
        .from("duties")
        .update({ status: "open" as DutyStatus, completed_at: null })
        .eq("id", dutyId);
      if (error) throw error;
    },
    onSuccess: () => {
      if (useIcpLab) {
        toast({ title: "Duty reopened locally" });
        return;
      }

      queryClient.invalidateQueries({ queryKey: eventKeys.duties(id) });
      toast({ title: "Marked as not complete" });
    },
    onError: (error) => {
      toast({
        title: "Failed to undo",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteDutyMutation = useMutation({
    mutationFn: async (dutyId: string) => {
      if (useIcpLab) {
        throw new Error("Duty deletion is not connected to the local events canister yet.");
      }

      const { error } = await supabase.from("duties").delete().eq("id", dutyId);
      if (error) throw error;
    },
    onSuccess: () => {
      if (useIcpLab) {
        toast({ title: "Duty removed locally" });
        return;
      }

      queryClient.invalidateQueries({ queryKey: eventKeys.duties(id) });
      toast({ title: "Duty removed" });
    },
  });

  const assignDutyMutation = useMutation({
    mutationFn: async (userId: string | null) => {
      if (!selectedDutyId) return;

      if (useIcpLab) {
        if (!id) throw new Error("Missing event ID");
        const duty = duties?.find((candidate) => candidate.id === selectedDutyId);
        if (!duty?.name) throw new Error("Duty not found");
        if (!userId) throw new Error("Unassigning duties is not connected to the local events canister yet.");
        await setLocalEventDuty(localIcpPersona, id, userId, duty.name);
        queryClient.setQueryData(eventKeys.duties(id), (current: unknown) =>
          (Array.isArray(current) ? current : []).map((row: any) =>
            row.id === selectedDutyId
              ? { ...row, assigned_to: userId, profiles: userId === user?.id ? { display_name: profile?.display_name || "Local ICP Member", avatar_url: profile?.avatar_url || null } : null }
              : row,
          ),
        );
        return;
      }
      
      // Get the duty to check if it was previously unassigned
      const { data: dutyBefore } = await supabase
        .from("duties")
        .select("assigned_to")
        .eq("id", selectedDutyId)
        .single();
      
      const { error } = await supabase
        .from("duties")
        .update({ assigned_to: userId })
        .eq("id", selectedDutyId);
      if (error) throw error;

      // Points are now awarded 24 hours after the game via scheduled job
      // Just notify the assigned user about the duty assignment
      if (userId && (!dutyBefore?.assigned_to || dutyBefore.assigned_to !== userId)) {
        await supabase.from("notifications").insert({
          user_id: userId,
          type: "duty_assigned",
          message: "You've been assigned a duty. Points will be awarded 24 hours after the game! 🔥",
          related_id: id,
        });
      }
    },
    onSuccess: () => {
      if (useIcpLab) {
        setAssignDialogOpen(false);
        setSelectedDutyId(null);
        setSelectedUserId("");
        toast({ title: "Duty assignment updated locally" });
        return;
      }

      queryClient.invalidateQueries({ queryKey: eventKeys.duties(id) });
      setAssignDialogOpen(false);
      setSelectedDutyId(null);
      setSelectedUserId("");
      toast({ title: "Duty assigned" });
    },
  });

  return {
    addDutyMutation,
    claimDutyMutation,
    completeDutyMutation,
    uncompleteDutyMutation,
    deleteDutyMutation,
    assignDutyMutation,
  };
}
