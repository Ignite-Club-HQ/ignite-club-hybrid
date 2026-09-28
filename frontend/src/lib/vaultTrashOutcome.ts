export interface EmptyTrashCounts {
  succeededCount: number;
  failedCount: number;
}

export type EmptyTrashOutcome =
  | { kind: "success"; message: string }
  | { kind: "warning"; message: string }
  | { kind: "error"; message: string };

/**
 * Decide the single toast to show after an "Empty trash" run.
 * Never returns a success outcome when any item failed.
 */
export function resolveEmptyTrashOutcome({
  succeededCount,
  failedCount,
}: EmptyTrashCounts): EmptyTrashOutcome {
  if (failedCount <= 0) {
    return { kind: "success", message: "Trash emptied successfully" };
  }
  if (succeededCount > 0) {
    return {
      kind: "warning",
      message: `Trash partially emptied: ${succeededCount} item(s) deleted, ${failedCount} item(s) could not be deleted`,
    };
  }
  return {
    kind: "error",
    message: `${failedCount} item(s) could not be deleted`,
  };
}
