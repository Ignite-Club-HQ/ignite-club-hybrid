/** Caller-private directory results are display hints, never resource grants.
 * No live transport is registered until the directory release is verified. */
export type DirectoryAssignment = { clubId: string; groupId: string; revision: bigint };
export type DirectoryContinuation = { instance: bigint; sequence: bigint };
export type DirectoryPage = {
  caller: string;
  accountVersion: bigint;
  generation: bigint;
  directoryRevision: bigint;
  registryFingerprint: string;
  releaseBinding?: string;
  instance: bigint;
  verifiedCurrent: boolean;
  assignments: DirectoryAssignment[];
  legacyClubs: string[];
  next: DirectoryContinuation | null;
};
export type DirectoryResult = { assignments: DirectoryAssignment[]; legacyClubs: string[] };
/** A failed, partial, drifting or unavailable directory never supplies an
 * empty membership answer: the caller must run complete existing discovery. */
export async function readCompleteMembershipDirectory(
  caller: string,
  registryFingerprint: string,
  read: (continuation: DirectoryContinuation | null) => Promise<DirectoryPage>,
  assertIdentity: () => void,
): Promise<DirectoryResult> {
  let continuation: DirectoryContinuation | null = null;
  let binding: string | undefined;
  const assignments = new Map<string, DirectoryAssignment>();
  const legacy = new Set<string>();
  for (let pages = 0; pages < 50_000; pages++) {
    const page = await read(continuation);
    assertIdentity();
    if (!page.verifiedCurrent || page.caller !== caller || page.registryFingerprint !== registryFingerprint ||
        page.accountVersion < 1n || page.generation < 1n || page.directoryRevision < 1n || page.instance < 1n ||
        (continuation !== null && page.instance !== continuation.instance) ||
        page.assignments.length + page.legacyClubs.length > 100 ||
        (page.next !== null && (page.next.instance !== page.instance || page.next.sequence !== (continuation?.sequence ?? 0n) + 1n))) throw new Error('Membership directory is incomplete or changed');
    const current = JSON.stringify([String(page.instance), String(page.accountVersion), String(page.generation), String(page.directoryRevision), page.registryFingerprint, page.releaseBinding]);
    if (binding !== undefined && current !== binding) throw new Error('Membership directory continuation changed');
    binding = current;
    for (const row of page.assignments) {
      if (!row.clubId || row.clubId.length > 64 || !row.groupId || row.groupId.length > 64 || row.revision < 1n || legacy.has(row.clubId)) throw new Error('Invalid directory club assignment');
      const prior = assignments.get(row.clubId);
      if (prior && (prior.groupId !== row.groupId || prior.revision !== row.revision)) throw new Error('Conflicting directory club assignment');
      assignments.set(row.clubId, row);
    }
    for (const club of page.legacyClubs) {
      if (!club || club.length > 64 || assignments.has(club)) throw new Error('Conflicting legacy directory club');
      legacy.add(club);
    }
    if (assignments.size + legacy.size > 1000) throw new Error('Membership directory exceeds club budget');
    if (page.next === null) return { assignments: [...assignments.values()], legacyClubs: [...legacy] };
    continuation = page.next;
  }
  throw new Error('Membership directory exceeds page budget');
}