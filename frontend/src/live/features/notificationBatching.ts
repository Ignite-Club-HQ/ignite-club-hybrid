/**
 * Splits a recipient id list into chunks the notification_queue canister's
 * `fan_out` can accept in a single update call. Kept as a pure function so
 * SendUpdateReminderPage's ICP branch can be covered by a plain unit test
 * without standing up a canister.
 */
export const FAN_OUT_MAX_BATCH_SIZE = 500;

export function batchRecipientIds(
  ids: string[],
  batchSize: number = FAN_OUT_MAX_BATCH_SIZE,
): string[][] {
  if (batchSize <= 0) throw new Error("batchSize must be positive");
  const unique = Array.from(new Set(ids));
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += batchSize) {
    batches.push(unique.slice(i, i + batchSize));
  }
  return batches;
}
