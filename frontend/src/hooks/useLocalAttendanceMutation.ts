import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { eventKeys } from "@/lab/eventQueryKeys";
import { setLocalEventAttendance } from "@/lab/localEventsService";

export interface UseLocalAttendanceMutationArgs {
  id: string | undefined;
  localIcpPersona: string;
  localAccountId: string | undefined;
}

/**
 * Marks the current local ICP persona present/absent for an event. Extracted
 * verbatim from `EventDetailPage.tsx` — no control flow or decision logic
 * changed, only file location.
 */
export function useLocalAttendanceMutation(params: UseLocalAttendanceMutationArgs) {
  const { id, localIcpPersona, localAccountId } = params;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const localAttendanceMutation = useMutation({
    mutationFn: async (present: boolean) => {
      if (!id) throw new Error("Missing event ID");
      return setLocalEventAttendance(localIcpPersona, id, localAccountId, present, "");
    },
    onSuccess: async (attendance) => {
      queryClient.setQueryData(eventKeys.rsvps(id), (current: unknown) => {
        if (!Array.isArray(current)) return current;
        return current.map((row: any) =>
          row.user_id === localAccountId && !row.child_id
            ? { ...row, notes: `${attendance.present ? "Present" : "Absent"}${attendance.note ? `: ${attendance.note}` : ""}` }
            : row,
        );
      });
      toast({ title: attendance.present ? "Attendance marked present" : "Attendance marked absent" });
    },
    onError: (mutationError: Error) => toast({ title: "Could not save attendance", description: mutationError.message, variant: "destructive" }),
  });

  return { localAttendanceMutation };
}
