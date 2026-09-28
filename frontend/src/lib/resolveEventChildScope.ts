/**
 * Single source of truth for "which children may RSVP to this event".
 *
 * Events are scoped three ways:
 *  (a) team_id set                          → single team
 *  (b) team_id NULL + target_team_ids       → club-wide event targeting teams
 *  (c) team_id NULL + no target_team_ids    → truly club-wide
 *
 * The order of checks is non-negotiable: adults-only / audience / role
 * restrictions are evaluated BEFORE any team lookup, and no step ever widens
 * the result — an empty set stays empty.
 */
import { supabase } from "@/integrations/supabase/client";
import { resolveRsvpAudience, shouldPromptPlayer } from "@/lib/rsvpAudience";
import { getEventEligibleTeamIds } from "@/lib/eventAudience";

export type RsvpChild = { id: string; name: string; parent_id?: string | null };

export type RsvpChildScopeEvent = {
  team_id: string | null;
  club_id: string | null;
  target_team_ids?: string[] | null;
  rsvp_audience?: string | null;
  adults_only?: boolean | null;
  restricted_to_roles?: string[] | null;
};

/**
 * True when children must never be shown for this event (adults-only,
 * parents-only audience, or a role-restricted event).
 */
export function childrenAreExcluded(
  event: RsvpChildScopeEvent | null | undefined,
  teamDefaultAudience?: string | null,
): boolean {
  if (!event) return true;
  if (event.adults_only === true) return true;
  const audience = resolveRsvpAudience(event.rsvp_audience ?? null, teamDefaultAudience ?? null);
  if (!shouldPromptPlayer(audience)) return true;
  if (Array.isArray(event.restricted_to_roles) && event.restricted_to_roles.length > 0) return true;
  return false;
}

/** Team ids belonging to a club (used to bound unscoped club-wide events). */
async function teamIdsForClub(clubId: string): Promise<string[]> {
  const { data } = await supabase.from("teams").select("id").eq("club_id", clubId);
  return (data ?? []).map((t: any) => t.id);
}

/** Keep only children with a child_team_assignments row in one of `teamIds`. */
async function intersectWithTeams(children: RsvpChild[], teamIds: string[]): Promise<RsvpChild[]> {
  if (children.length === 0 || teamIds.length === 0) return [];
  const { data, error } = await supabase
    .from("child_team_assignments")
    .select("child_id")
    .in("team_id", teamIds)
    .in("child_id", children.map((c) => c.id));
  if (error) return [];
  const inScope = new Set((data ?? []).map((a: any) => a.child_id));
  return children.filter((c) => inScope.has(c.id));
}

/**
 * The current user's children that are in scope for this event.
 */
export async function resolveRsvpChildren({
  event,
  userId,
  teamDefaultAudience,
}: {
  event: RsvpChildScopeEvent | null | undefined;
  userId: string | null | undefined;
  teamDefaultAudience?: string | null;
}): Promise<RsvpChild[]> {
  if (!event || !userId) return [];

  // Step 1 — adults/parents-only + role restrictions, before any team lookup.
  if (childrenAreExcluded(event, teamDefaultAudience)) return [];

  // Step 2 — candidate children (own + guardian-linked), deduped.
  const [ownRes, guardianRes] = await Promise.all([
    supabase.from("children").select("id, name, parent_id").eq("parent_id", userId),
    supabase
      .from("child_guardians")
      .select("child_id, children!inner (id, name, parent_id)")
      .eq("guardian_id", userId),
  ]);
  const candidates: RsvpChild[] = [];
  const seen = new Set<string>();
  for (const c of [
    ...((ownRes.data ?? []) as any[]),
    ...((guardianRes.data ?? []) as any[]).map((g) => g.children).filter(Boolean),
  ]) {
    if (!c?.id || seen.has(c.id)) continue;
    seen.add(c.id);
    candidates.push({ id: c.id, name: c.name, parent_id: c.parent_id ?? null });
  }
  if (candidates.length === 0) return [];

  // Step 3 — team scoping. Never widen.
  const eligible = getEventEligibleTeamIds(event);
  if (eligible) return intersectWithTeams(candidates, eligible);

  if (!event.club_id) return [];
  const clubTeamIds = await teamIdsForClub(event.club_id);
  return intersectWithTeams(candidates, clubTeamIds);
}

/**
 * Full child roster for the event (admin "not responded" list, player-of-match).
 * Same scoping and same adults-only/parents-only short-circuit.
 */
export async function resolveEventChildRoster({
  event,
  teamDefaultAudience,
}: {
  event: RsvpChildScopeEvent | null | undefined;
  teamDefaultAudience?: string | null;
}): Promise<RsvpChild[]> {
  if (!event) return [];
  if (childrenAreExcluded(event, teamDefaultAudience)) return [];

  const eligible = getEventEligibleTeamIds(event);
  let teamIds: string[] = eligible ?? [];
  if (!eligible && event.club_id) teamIds = await teamIdsForClub(event.club_id);
  if (teamIds.length === 0) return [];

  const { data, error } = await supabase
    .from("child_team_assignments")
    .select("child_id, children (id, name, parent_id)")
    .in("team_id", teamIds);
  if (error) return [];

  const out: RsvpChild[] = [];
  const seen = new Set<string>();
  for (const row of data ?? []) {
    const c: any = (row as any).children;
    if (!c?.id || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ id: c.id, name: c.name, parent_id: c.parent_id ?? null });
  }
  return out;
}
