/**
 * Pure presentation logic for the scheduled-messages banner.
 *
 * The banner used to shout "Scheduled messages could not be loaded" for ANY
 * query error — including the very common transient ones: an Android resume
 * aborting in-flight GETs, or a dropped mobile connection. That is alarming
 * and misleading: nothing is wrong with the user's schedule, the device just
 * isn't reachable right now.
 *
 * Rules:
 *  - Rows loaded            -> render the list (with a quiet inline notice if
 *                              a background refresh failed while online).
 *  - No rows, no error      -> render nothing.
 *  - No rows, error, offline-> quiet "will refresh when you're back online".
 *  - No rows, error, online -> the real warning (retries already exhausted).
 */

export type ScheduledBannerState = "hidden" | "list" | "offline" | "error";

export interface ScheduledBannerInput {
  hasRows: boolean;
  isError: boolean;
  isFetching: boolean;
  isOnline: boolean;
}

export function classifyScheduledBanner({
  hasRows,
  isError,
  isFetching,
  isOnline,
}: ScheduledBannerInput): ScheduledBannerState {
  if (hasRows) return "list";
  if (!isError) return "hidden";
  // A retry is already in flight — don't flash a failure state mid-recovery.
  if (isFetching) return "hidden";
  if (!isOnline) return "offline";
  return "error";
}

/** True when the list is shown but the latest background refresh failed. */
export function shouldShowInlineRefreshWarning({
  hasRows,
  isError,
  isFetching,
  isOnline,
}: ScheduledBannerInput): boolean {
  return hasRows && isError && !isFetching && isOnline;
}
