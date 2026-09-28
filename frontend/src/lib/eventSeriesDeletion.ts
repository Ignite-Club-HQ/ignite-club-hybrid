/**
 * Event deletion primitives shared by every deletion entry point.
 *
 * The series delete is two database operations (children by `parent_event_id`,
 * then the root row). Each Supabase result must be inspected: if the children
 * delete is denied we must NOT attempt the root delete, and if the children
 * commit but the root fails the user must be told the series was only partially
 * deleted. Complete success is only reported when every write committed AND the
 * database returned the id(s) it actually removed — a silent zero-row delete
 * (e.g. RLS filtered the row out) must never be reported as success.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type DeleteType = "single" | "series";

export type EventDeletionOutcome =
  | { kind: "success"; deletedIds: string[] }
  | { kind: "failed"; message: string }
  | { kind: "partial-series"; message: string; deletedIds: string[] };

export interface DeletableEvent {
  id: string;
  is_recurring?: boolean | null;
  parent_event_id?: string | null;
}

/** The root id of the series the given event belongs to, for both shapes. */
export function resolveSeriesRootId(event: DeletableEvent): string {
  return event.parent_event_id ?? event.id;
}

function idsOf(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((row: any) => (row && typeof row.id === "string" ? row.id : null))
    .filter((v): v is string => !!v);
}

export async function performEventDeletion(
  supabase: SupabaseClient<any, any, any>,
  event: DeletableEvent,
  deleteType: DeleteType,
): Promise<EventDeletionOutcome> {
  const isSeries =
    deleteType === "series" && (!!event.parent_event_id || !!event.is_recurring);

  if (!isSeries) {
    // "This event only" must never touch siblings: id equality, nothing else.
    const { data, error } = await supabase
      .from("events")
      .delete()
      .eq("id", event.id)
      .select("id");
    if (error) return { kind: "failed", message: error.message };
    const deletedIds = idsOf(data);
    if (!deletedIds.includes(event.id)) {
      return {
        kind: "failed",
        message:
          "The database did not confirm the deletion — you may not have permission to delete this event.",
      };
    }
    return { kind: "success", deletedIds };
  }

  const rootId = resolveSeriesRootId(event);

  const { data: childData, error: childError } = await supabase
    .from("events")
    .delete()
    .eq("parent_event_id", rootId)
    .select("id");
  // Children delete denied → stop immediately, never touch the root row.
  if (childError) return { kind: "failed", message: childError.message };
  const childIds = idsOf(childData);

  const { data: rootData, error: rootError } = await supabase
    .from("events")
    .delete()
    .eq("id", rootId)
    .select("id");
  if (rootError) {
    return { kind: "partial-series", message: rootError.message, deletedIds: childIds };
  }
  const rootIds = idsOf(rootData);
  if (!rootIds.includes(rootId)) {
    return {
      kind: "partial-series",
      message:
        "The database did not confirm deletion of the original event in the series.",
      deletedIds: childIds,
    };
  }

  return { kind: "success", deletedIds: [...childIds, ...rootIds] };
}
