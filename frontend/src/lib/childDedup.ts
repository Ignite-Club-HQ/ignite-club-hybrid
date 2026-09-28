import { supabase } from "@/integrations/supabase/client";

/**
 * The database dedupes same-name children on a team: when a newly created child
 * row is assigned to a team that already has a child with the same name, the
 * server links the creating parent as a guardian of the canonical child and
 * removes the freshly created duplicate row.
 *
 * Any client flow that keeps using the created child id after assigning it to a
 * team must re-resolve the id through this helper, otherwise follow-up writes
 * (guardian links, mini-league assignments, roster updates) target a row that no
 * longer exists.
 *
 * Returns the surviving child id, or null when nothing could be resolved.
 */
export async function resolveCanonicalChildId(
  childId: string,
  teamId: string | null | undefined,
  childName: string | null | undefined
): Promise<string | null> {
  const { data: stillExists } = await supabase
    .from("children")
    .select("id")
    .eq("id", childId)
    .maybeSingle();

  if (stillExists?.id) return stillExists.id;
  if (!teamId || !childName) return null;

  const { data: rosterRows } = await supabase
    .from("child_team_assignments")
    .select("child_id, children:child_id(name)")
    .eq("team_id", teamId);

  const target = childName.toLowerCase().trim();
  const match = (rosterRows as any[] | null)?.find(
    (row) => row?.children?.name?.toLowerCase().trim() === target
  );

  return match?.child_id ?? null;
}

export function isDuplicateChildError(error: any): boolean {
  return (
    error?.code === "23505" ||
    (typeof error?.message === "string" &&
      error.message.includes("duplicate_child_for_parent"))
  );
}

/**
 * Finds a child this parent already has (owned or guardian-linked) with the
 * given name, case-insensitively. Used to recover from the server-side
 * duplicate guard.
 */
export async function findExistingChildForParent(
  parentId: string,
  name: string
): Promise<string | null> {
  const target = name.toLowerCase().trim();

  const { data: owned } = await supabase
    .from("children")
    .select("id, name")
    .eq("parent_id", parentId);
  const ownedMatch = (owned as any[] | null)?.find(
    (c) => c?.name?.toLowerCase().trim() === target
  );
  if (ownedMatch?.id) return ownedMatch.id;

  const { data: guarded } = await supabase
    .from("child_guardians")
    .select("child_id, children:child_id(name)")
    .eq("guardian_id", parentId);
  const guardedMatch = (guarded as any[] | null)?.find(
    (row) => row?.children?.name?.toLowerCase().trim() === target
  );
  return guardedMatch?.child_id ?? null;
}

/**
 * Creates a child for a parent, or reuses the parent's existing same-name child
 * when the server-side duplicate guard rejects the insert. Every invite/join
 * flow must use this so a blocked insert never silently drops the child (and
 * therefore its team assignment / RSVP ability).
 */
export async function createChildForParentOrReuse(
  parentId: string,
  name: string,
  yearOfBirth: number | null
): Promise<{ childId: string | null; reused: boolean; error: any | null }> {
  const { data, error } = await supabase
    .from("children")
    .insert({ parent_id: parentId, name, year_of_birth: yearOfBirth })
    .select("id")
    .maybeSingle();

  if (!error && data?.id) return { childId: data.id, reused: false, error: null };

  if (error && !isDuplicateChildError(error)) {
    return { childId: null, reused: false, error };
  }

  const existing = await findExistingChildForParent(parentId, name);
  return {
    childId: existing,
    reused: existing != null,
    error: existing ? null : error ?? new Error("child_create_failed"),
  };
}
