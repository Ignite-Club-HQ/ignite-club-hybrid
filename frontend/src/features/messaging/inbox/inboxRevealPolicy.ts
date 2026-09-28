export interface InboxSortSourceState {
  isFetched: boolean;
  isFetching: boolean;
  isError: boolean;
}

export interface InboxRevealPolicyInput {
  isOnline: boolean;
  hasAnyDisplayData: boolean;
  hasCachedData: boolean;
  hasLoadingSource: boolean;
  sortSources: readonly InboxSortSourceState[];
  sortGateExpired: boolean;
  hasRevealedStableInbox: boolean;
}

export interface InboxRevealPolicy {
  sortSourcesSettled: boolean;
  isLoadingFreshData: boolean;
  freshSortDataReady: boolean;
  initialRevealBlocked: boolean;
  showSkeletonLoading: boolean;
}

export function areInboxSortSourcesSettled(
  sources: readonly InboxSortSourceState[],
): boolean {
  return sources.every(
    (source) => (source.isFetched || source.isError) && !source.isFetching,
  );
}

/**
 * Pure first-reveal policy for the messages inbox.
 *
 * Cached data prevents the loading half of the gate, but it deliberately does
 * not bypass authoritative ordering on the session's first online reveal.
 * Once the reveal latch is set, later refetches can never remount the skeleton.
 */
export function resolveInboxRevealPolicy(
  input: InboxRevealPolicyInput,
): InboxRevealPolicy {
  const sortSourcesSettled = areInboxSortSourcesSettled(input.sortSources);
  const isLoadingFreshData =
    !input.hasAnyDisplayData && !input.hasCachedData && input.hasLoadingSource;
  const freshSortDataReady =
    !input.isOnline || sortSourcesSettled || input.sortGateExpired;
  const initialRevealBlocked =
    input.isOnline && (isLoadingFreshData || !freshSortDataReady);
  const showSkeletonLoading =
    input.isOnline && !input.hasRevealedStableInbox && initialRevealBlocked;

  return {
    sortSourcesSettled,
    isLoadingFreshData,
    freshSortDataReady,
    initialRevealBlocked,
    showSkeletonLoading,
  };
}
