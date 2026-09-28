/**
 * Training conflict-check policy.
 *
 * Fail-closed: if either Supabase read fails we return `error` so the caller
 * aborts creation. A successful read with `null`/empty data is `clear`.
 */

export interface ConflictRow {
  id: string;
  title: string;
  event_date: string;
  address: string | null;
  team_id?: string | null;
  teams?: { name?: string } | null;
  recurrence_end_date?: string | null;
}

export interface ConflictQueryResult<T = ConflictRow> {
  data: T[] | null;
  error: unknown;
}

export interface ConflictSummary {
  title: string;
  team_name?: string;
  start_time?: string;
}

export type ConflictCheckResult =
  | { status: "clear" }
  | { status: "conflict"; conflicts: ConflictSummary[] }
  | { status: "error" };

export const CONFLICT_CHECK_ERROR_TITLE = "Unable to check schedule";
export const CONFLICT_CHECK_ERROR_DESCRIPTION =
  "We couldn't check for other training sessions at this time and location. Please try again.";

const normalize = (value: string) => value.trim().toLowerCase();

/**
 * Pure evaluation of both query results against the desired slot.
 * Never converts an error into an empty array.
 */
export function evaluateTrainingConflicts(params: {
  targetDateTime: Date;
  address: string;
  directDateQuery: ConflictQueryResult;
  recurringParentQuery: ConflictQueryResult;
}): ConflictCheckResult {
  const { targetDateTime, address, directDateQuery, recurringParentQuery } = params;

  if (directDateQuery.error) return { status: "error" };
  if (recurringParentQuery.error) return { status: "error" };

  const normalizedAddress = normalize(address);
  const eventHour = targetDateTime.getHours();
  const eventMinute = targetDateTime.getMinutes();

  const direct = (directDateQuery.data ?? []).filter((evt) => {
    if (!evt.address || normalize(evt.address) !== normalizedAddress) return false;
    const evtDate = new Date(evt.event_date);
    return evtDate.getHours() === eventHour && evtDate.getMinutes() === eventMinute;
  });

  const seen = new Set(direct.map((c) => c.id));

  const recurring = (recurringParentQuery.data ?? []).filter((evt) => {
    if (seen.has(evt.id)) return false;
    if (!evt.address || normalize(evt.address) !== normalizedAddress) return false;
    const evtDate = new Date(evt.event_date);
    if (evtDate.getHours() !== eventHour || evtDate.getMinutes() !== eventMinute) return false;
    return evtDate.getDay() === targetDateTime.getDay();
  });

  const all = [...direct, ...recurring];
  if (all.length === 0) return { status: "clear" };

  return {
    status: "conflict",
    conflicts: all.map((e) => ({
      title: e.title,
      team_name: e.teams?.name,
      start_time: new Date(e.event_date).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    })),
  };
}
