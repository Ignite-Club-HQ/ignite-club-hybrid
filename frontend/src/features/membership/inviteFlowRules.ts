/** Token metadata does not imply that a child was supplied with the invite. */
export function needsInviteChildEntry(roles: readonly string[], hasPresetChild: boolean, completedChildren: number): boolean {
  return roles.includes("parent") && !hasPresetChild && completedChildren === 0;
}

export function allowedInviteRole<T extends string>(preferred: T, allowed: readonly T[]): T | undefined {
  return allowed.includes(preferred) ? preferred : allowed[0];
}

/** The team page supplies resolved manager access; player-only access is not management. */
export function canManageTeamInviteLinks(canBulkInvite: boolean, playersOnly: boolean): boolean {
  return canBulkInvite && !playersOnly;
}
