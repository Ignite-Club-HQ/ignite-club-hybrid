import { eventKeys } from "./eventQueryKeys";

/** Reconcile the exact payment ledger after a confirmed payment change. */
export function refreshEventPayments(queryClient: any, eventId: string): void {
  queryClient.invalidateQueries({ queryKey: eventKeys.payments(eventId) });
}
