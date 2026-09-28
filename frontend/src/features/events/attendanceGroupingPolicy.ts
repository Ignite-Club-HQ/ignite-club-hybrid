export type AttendanceGroup = { key: string; label: string };
export type AttendanceGroupLookup = (identity: {
  userId?: string | null;
  childId?: string | null;
}) => AttendanceGroup | null;

export type AttendanceBucket<T> = AttendanceGroup & { items: T[] };
export type MixedAttendanceBucket<C, A> = AttendanceGroup & {
  children: C[];
  adults: A[];
};

/** Child identity wins so a guardian response is grouped with the child. */
export function rsvpAttendanceIdentity(rsvp: any): {
  userId: string | null;
  childId: string | null;
} {
  const childId = rsvp.child_id ?? rsvp.mini_league_players?.child_id ?? null;
  return { userId: childId ? null : (rsvp.user_id ?? null), childId };
}

export function bucketAttendance<T>(
  items: T[],
  orderedGroups: AttendanceGroup[],
  identityOf: (item: T) => { userId?: string | null; childId?: string | null },
  groupOf: AttendanceGroupLookup,
): AttendanceBucket<T>[] {
  const byKey = new Map<string, T[]>();
  for (const item of items) {
    const group = groupOf(identityOf(item));
    if (!group) continue;
    const bucket = byKey.get(group.key) ?? [];
    bucket.push(item);
    byKey.set(group.key, bucket);
  }
  return orderedGroups
    .map((group) => ({ ...group, items: byKey.get(group.key) ?? [] }))
    .filter((group) => group.items.length > 0);
}

export function bucketNonResponders<C, A>(
  children: C[],
  adults: A[],
  orderedGroups: AttendanceGroup[],
  childIdentity: (child: C) => { childId: string | null; userId?: null },
  adultIdentity: (adult: A) => { userId: string | null; childId?: null },
  groupOf: AttendanceGroupLookup,
): MixedAttendanceBucket<C, A>[] {
  const childBuckets = bucketAttendance(children, orderedGroups, childIdentity, groupOf);
  const adultBuckets = bucketAttendance(adults, orderedGroups, adultIdentity, groupOf);
  const childrenByKey = new Map(childBuckets.map((bucket) => [bucket.key, bucket.items]));
  const adultsByKey = new Map(adultBuckets.map((bucket) => [bucket.key, bucket.items]));
  return orderedGroups.map((group) => ({
    ...group,
    children: childrenByKey.get(group.key) ?? [],
    adults: adultsByKey.get(group.key) ?? [],
  })).filter((group) => group.children.length + group.adults.length > 0);
}
