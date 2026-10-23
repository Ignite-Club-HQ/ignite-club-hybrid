// Bounded owner-name cross-check over consensus source exports. Evidence only:
// it never writes placements, permissions, media authorities or readiness.
export const OWNER_GROUP1_CLUBS = Object.freeze({
  'Winter Cats': 'c1ba8739-5368-4ca9-8143-baa1d3ecfbc6',
  'Giddy Goat': 'c1f2ed52-fda3-45b4-84d3-57fcf253116e',
  Riverdogs: 'f9f7d89c-a51f-454d-af8e-b976c10d2fc4',
});

export async function readCompleteSourceClubs(groupId, read, { maxPages = 10000 } = {}) {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 10000) throw new Error('Bounded source page budget required');
  let cursor = null, revision, scanned = 0;
  const clubs = new Map();
  for (let pages = 0; pages < maxPages; pages++) {
    const reply = await read(cursor);
    if (!reply || typeof reply !== 'object' || 'Err' in reply) throw new Error(`${groupId} source export refused: ${reply?.Err ?? 'invalid reply'}`);
    const page = reply.Ok;
    if (!page || typeof page.revision !== 'bigint' || page.revision < 1n || !Array.isArray(page.edges) || typeof page.scanned !== 'bigint' ||
        page.scanned < 0n || page.scanned > 100n || page.edges.length > Number(page.scanned) || !Array.isArray(page.next) || page.next.length > 1 ||
        (revision !== undefined && page.revision !== revision)) throw new Error(`${groupId} source export changed or exceeded bounds`);
    revision ??= page.revision; scanned += Number(page.scanned);
    for (const edge of page.edges) {
      if (!edge || typeof edge !== 'object' || Object.keys(edge).length !== 1) throw new Error(`${groupId} invalid source edge`);
      if (!('Club' in edge)) continue;
      const club = edge.Club;
      if (!club?.id || club.id.length > 64 || typeof club.deleted !== 'boolean' || clubs.has(club.id)) throw new Error(`${groupId} returned invalid or duplicate club`);
      clubs.set(club.id, club.deleted);
    }
    const next = page.next?.[0] ?? null;
    if (next === null) return { groupId, revision, scanned, clubs };
    if (!Array.isArray(page.next) || page.next.length !== 1 || next.revision !== revision || page.scanned === 0n ||
        ['phase', 'offset', 'nested'].some(k => typeof next[k] !== 'bigint' || next[k] < 0n) || next.phase > 7n ||
        (cursor && !(next.phase > cursor.phase || next.phase === cursor.phase &&
          (next.offset > cursor.offset || next.offset === cursor.offset && next.nested > cursor.nested)))) throw new Error(`${groupId} source cursor did not advance`);
    cursor = next;
  }
  throw new Error(`${groupId} source export exceeded page budget`);
}

/** Operator-only orchestration; no source grants or authority writes. Read
 * the complete registry/source set twice and recheck each source's revision
 * after the last await. Never persist raw relationship edges. */
export async function checkLegacyOwnership(transport, expected = OWNER_GROUP1_CLUBS) {
  const initial = await transport.registry();
  const valid = inventory => inventory?.fingerprint && Array.isArray(inventory.sources) && inventory.sources.length > 0 &&
    inventory.sources.some(s => s.groupId === 'g1') && new Set(inventory.sources.map(s => s.groupId)).size === inventory.sources.length &&
    new Set(inventory.sources.map(s => s.canisterId)).size === inventory.sources.length;
  if (!valid(initial)) throw new Error('Exact complete source inventory required');
  const signature = inv => JSON.stringify([inv.fingerprint, inv.sources]);
  const gate = async () => {
    const current = await transport.registry();
    if (!valid(current) || signature(current) !== signature(initial)) throw new Error('Registry source inventory changed');
  };
  const scan = async () => {
    const result = [];
    for (const source of initial.sources) {
      await gate();
      const rows = await readCompleteSourceClubs(source.groupId, cursor => transport.read(source, cursor));
      await gate(); result.push(rows);
    }
    return result;
  };
  const first = await scan(), second = await scan();
  const locations = verifyCompleteClubLocations(first, second);
  const clubs = verifyOwnerNamedGroup1Clubs(first, second, expected);
  for (const source of initial.sources) {
    const current = await transport.status(source);
    if (!current || current.revision !== second.find(s => s.groupId === source.groupId)?.revision) throw new Error(`${source.groupId} changed after source traversal`);
  }
  await gate();
  return { kind: 'operator-consensus-source-observation', registryFingerprint: initial.fingerprint,
    sources: second.map(s => ({ groupId: s.groupId, revision: String(s.revision), scanned: s.scanned, clubCount: s.clubs.size })),
    clubs, locations, ready: false, appEnabled: false };
}

/** All club IDs, not just supplied names. Conservative tombstone collisions
 * remain unresolved too; source observations never grant ownership/release. */
export function verifyCompleteClubLocations(first, second) {
  const signature = rows => rows.map(s => s.groupId).sort().join('\n');
  if (!first.length || signature(first) !== signature(second) || new Set(first.map(s => s.groupId)).size !== first.length ||
      new Set(second.map(s => s.groupId)).size !== second.length) throw new Error('Complete unchanged source inventory required');
  const locations = new Map();
  for (const source of first) {
    const again = second.find(s => s.groupId === source.groupId);
    if (!again || again.revision !== source.revision || again.scanned !== source.scanned || again.clubs.size !== source.clubs.size ||
        [...source.clubs].some(([id, deleted]) => again.clubs.get(id) !== deleted)) throw new Error(`${source.groupId} source changed during verification`);
    for (const [clubId, deleted] of source.clubs) {
      if (!clubId || clubId.length > 64 || typeof deleted !== 'boolean' || locations.has(clubId)) throw new Error('Club ID has invalid or conflicting source ownership');
      locations.set(clubId, { clubId, groupId: source.groupId, deleted, revision: String(source.revision) });
    }
  }
  return [...locations.values()].sort((a, b) => a.clubId.localeCompare(b.clubId));
}

/** Requires every registered source, rechecked unchanged, and each owner-named
 * live club exactly once in Group 1. Names are candidates; IDs are compared. */
export function verifyOwnerNamedGroup1Clubs(first, second, expected = OWNER_GROUP1_CLUBS) {
  const ids = sources => sources.map(s => s.groupId).sort().join('\n');
  if (!first.length || ids(first) !== ids(second) || new Set(first.map(s => s.groupId)).size !== first.length || !first.some(s => s.groupId === 'g1')) throw new Error('Complete unchanged source inventory required');
  for (const source of first) {
    const again = second.find(s => s.groupId === source.groupId);
    if (!again || again.revision !== source.revision || again.scanned !== source.scanned || again.clubs.size !== source.clubs.size ||
        [...source.clubs].some(([id, deleted]) => again.clubs.get(id) !== deleted)) throw new Error(`${source.groupId} source changed during verification`);
  }
  return Object.entries(expected).map(([name, clubId]) => {
    const owners = first.filter(s => s.clubs.has(clubId));
    if (owners.length !== 1 || owners[0].groupId !== 'g1' || owners[0].clubs.get(clubId) !== false) throw new Error(`${name} is not exclusively live in Group 1`);
    return { name, clubId, groupId: 'g1', revision: String(owners[0].revision) };
  });
}