/** Token metadata does not imply that a child was supplied with the invite. */
export function needsInviteChildEntry(roles: readonly string[], hasPresetChild: boolean, completedChildren: number): boolean {
  return roles.includes("parent") && !hasPresetChild && completedChildren === 0;
}

export function allowedInviteRole<T extends string>(preferred: T, allowed: readonly T[]): T | undefined {
  return allowed.includes(preferred) ? preferred : allowed[0];
}

/** Never acknowledge child/guardian data that the invitation contract cannot retain. */
export function assertSimpleIcpInvite(children: readonly { name: string; existingChildId?: string | null }[], secondParent: boolean): void {
  if (children.some(c => c.name.trim() || c.existingChildId) || secondParent) {
    throw new Error("Create the parent invite first, then add children and invite their other parent from the team roster.");
  }
}