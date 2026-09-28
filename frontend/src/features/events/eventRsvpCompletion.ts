export type RsvpCompletionOptions = {
  eventId: string;
  teamId?: string | null;
  includeGroups?: boolean;
  includePitch?: boolean;
  includePoints?: boolean;
  schedule?: (callback: () => void, delayMs: number) => unknown;
};

/** Refresh only the RSVP-derived surfaces used by the caller's workflow. */
export function completeEventRsvp(
  queryClient: any,
  options: RsvpCompletionOptions,
): void {
  queryClient.invalidateQueries({ queryKey: eventKeys.rsvps(options.eventId) });
  queryClient.invalidateQueries({ queryKey: eventKeys.goingRsvps(options.eventId) });
  if (options.includeGroups) {
    queryClient.invalidateQueries({ queryKey: eventKeys.groups(options.eventId) });
  }
  if (options.includePitch) {
    queryClient.invalidateQueries({
      queryKey: eventKeys.pitchTeamMembers(options.teamId, options.eventId),
    });
  }
  if (options.includePoints) {
    (options.schedule ?? setTimeout)(() => {
      queryClient.invalidateQueries({ queryKey: ["points-history"] });
      queryClient.invalidateQueries({ queryKey: ["points-rank"] });
      queryClient.invalidateQueries({ queryKey: ["points-rank-seasoned"] });
    }, 1500);
  }
}
import { eventKeys } from "./eventQueryKeys";
