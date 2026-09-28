export interface DriveTitleResolutionSummary {
  scanned: number;
  updated: number;
  unresolved: number;
  errors: number;
  hasOAuth: boolean;
}

interface FunctionInvokeResult {
  data: unknown;
  error: unknown;
}

type FunctionInvoker = (
  name: string,
  options: { body: { clubId: string } },
) => Promise<FunctionInvokeResult>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readSummary(data: unknown): DriveTitleResolutionSummary | null {
  if (!isRecord(data) || !isRecord(data.summary)) return null;
  const { scanned, updated, unresolved, errors, hasOAuth } = data.summary;
  if (
    typeof scanned !== "number" ||
    typeof updated !== "number" ||
    typeof unresolved !== "number" ||
    typeof errors !== "number"
  ) {
    return null;
  }

  return {
    scanned,
    updated,
    unresolved,
    errors,
    hasOAuth: hasOAuth === true,
  };
}

/**
 * Calls the Drive-title resolver and narrows its untrusted function payload.
 * Page-local loading, notifications, and cache invalidation stay at the call site.
 */
export async function resolveDriveTitlesForClub(
  clubId: string,
  invoke: FunctionInvoker,
): Promise<DriveTitleResolutionSummary | null> {
  const { data, error } = await invoke("resolve-drive-titles", { body: { clubId } });
  if (error) throw error;
  return readSummary(data);
}
