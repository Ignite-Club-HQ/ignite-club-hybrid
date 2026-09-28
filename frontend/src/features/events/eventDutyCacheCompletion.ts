import { eventKeys } from "./eventQueryKeys";

/** Reconcile the duty list after a committed duty mutation or partial commit. */
export function refreshEventDuties(queryClient: any, eventId: string): void {
  queryClient.invalidateQueries({ queryKey: eventKeys.duties(eventId) });
}
