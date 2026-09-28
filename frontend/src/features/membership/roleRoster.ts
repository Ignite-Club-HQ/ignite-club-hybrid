export interface RoleRosterProfile {
  id: string | null;
  display_name: string | null;
  avatar_url?: string | null;
}

export interface RoleRosterRow {
  id?: string | null;
  role: string;
  profiles?: RoleRosterProfile | null;
  user_id?: string | null;
}

export type RoleRosterEntry<T extends RoleRosterRow = RoleRosterRow> = {
  profile: RoleRosterProfile | null;
  roles: T[];
};

export function groupRoleRowsByUser<T extends RoleRosterRow>(
  rows: readonly T[] | null | undefined,
  options: { excludeUserIds?: readonly string[] } = {},
): Record<string, RoleRosterEntry<T>> {
  const excluded = new Set(options.excludeUserIds ?? []);
  const grouped: Record<string, RoleRosterEntry<T>> = {};

  for (const row of rows ?? []) {
    const userId = row.profiles?.id ?? row.user_id;
    if (!userId || excluded.has(userId)) continue;

    const current = grouped[userId] ?? {
      profile: row.profiles ?? null,
      roles: [],
    };

    current.roles.push(row);
    grouped[userId] = current;
  }

  return grouped;
}
