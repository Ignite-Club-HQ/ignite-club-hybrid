export type ScopedAttendanceRosterRow = {
  kind: string;
  person_id: string;
  display_name: string | null;
  parent_id: string | null;
  team_ids: string[] | null;
};

export async function fetchTargetedAttendanceRoster(client: any, eventId: string) {
  const { data, error } = await client.rpc("get_targeted_event_attendance_roster", {
    p_event_id: eventId,
  });
  if (error) throw error;
  return (data ?? []) as ScopedAttendanceRosterRow[];
}

export function selectScopedChildRoster(rows: ScopedAttendanceRosterRow[] | null | undefined) {
  return (rows ?? []).filter((row) => row.kind === "child");
}

export function mergeTargetedChildren(
  visibleChildren: any[] | null | undefined,
  scopedChildren: ScopedAttendanceRosterRow[] | null | undefined,
) {
  const byId = new Map<string, any>();
  for (const child of visibleChildren ?? []) byId.set(child.id, { ...child });
  for (const row of selectScopedChildRoster(scopedChildren)) {
    const existing = byId.get(row.person_id);
    if (existing) {
      if (!existing.name && row.display_name) {
        byId.set(row.person_id, { ...existing, name: row.display_name });
      }
    } else {
      byId.set(row.person_id, {
        id: row.person_id,
        name: row.display_name,
        parent_id: row.parent_id,
      });
    }
  }
  return [...byId.values()];
}

export function selectTargetedReminderMembers(
  members: any[] | null | undefined,
  targetTeamIds: string[],
  children: any[] | null | undefined,
  guardianLinks: any[] | null | undefined,
) {
  const targetSet = new Set(targetTeamIds);
  const linkedAdultIds = new Set<string>();
  for (const child of children ?? []) if (child.parent_id) linkedAdultIds.add(child.parent_id);
  for (const link of guardianLinks ?? []) if (link.guardian_id) linkedAdultIds.add(link.guardian_id);

  return (members ?? []).filter((member) => {
    const pairs: { role: string; team_id: string | null }[] = member.role_team_pairs ?? [];
    if (pairs.some((pair) => pair.team_id && targetSet.has(pair.team_id))) return true;
    return linkedAdultIds.has(member.id);
  });
}
