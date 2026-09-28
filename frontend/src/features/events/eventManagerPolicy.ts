/**
 * Role sets used to resolve frontend event-management capability.
 * Backend RLS and RPC checks remain authoritative.
 */
export const EVENT_MANAGER_ROLES = {
  club: ["club_admin", "committee_member"],
  team: ["team_admin", "coach"],
  miniLeague: ["league_admin", "coach", "committee_member"],
} as const;

export type EventManagerScope = keyof typeof EVENT_MANAGER_ROLES;

type RoleRow = { role?: string | null };

export function hasEventManagerRole(
  scope: EventManagerScope,
  rows: RoleRow[] | null | undefined,
): boolean {
  const allowed = EVENT_MANAGER_ROLES[scope] as readonly string[];
  return Boolean(rows?.some((row) => row.role != null && allowed.includes(row.role)));
}
