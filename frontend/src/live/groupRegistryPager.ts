/** Consensus-only transport. Pin every page; multi-page registries get both complete reads; never retry
 * a revision conflict into a different inventory. Recheck identity per await. */
export async function readPinnedGroupRegistry<G extends { id: string }, P extends { group_id: string }>(
  read: (revision: [] | [bigint], cursor: [] | [string], limit: number) => Promise<
    { Ok: { revision: bigint; configuration_revision?: [] | [bigint]; groups: G[]; placements: P[]; next_cursor: [] | [string] } } | { Err: string }>,
  expected?: bigint, recheck: () => void = () => {},
) {
  let pinned = expected;
  let pageCount = 0;
  const once = async () => {
    const groups: G[] = [], placements: P[] = [];
    let configurationRevision: bigint | undefined;
    let firstPage = true;
    let cursor: [] | [string] = [];
    pageCount = 0;
    const ids = new Set<string>();
    for (let pages = 0; pages < 4096; pages++) {
      recheck();
      const reply = await read(pinned === undefined ? [] : [pinned], cursor, 64);
      recheck();
      if ('Err' in reply) throw new Error(reply.Err);
      const page = reply.Ok;
      pinned ??= page.revision;
      const config = page.configuration_revision?.[0];
      if (firstPage) { configurationRevision = config; firstPage = false; }
      else if (config !== configurationRevision) throw new Error("Configuration revision changed between pages");
      if (page.revision !== pinned || page.groups.length > 64 || page.groups.length !== page.placements.length ||
          page.next_cursor.length && cursor.length && page.next_cursor[0] <= cursor[0]) throw new Error('Registry revision or cursor changed');
      for (const g of page.groups) {
        if (ids.has(g.id)) throw new Error('Duplicate registry group');
        ids.add(g.id);
      }
      pageCount++;
      groups.push(...page.groups); placements.push(...page.placements);
      if (groups.length > 4096) throw new Error('Registry safety bound exceeded');
      if (!page.next_cursor.length) return { revision: pinned, configurationRevision, groups, placements };
      cursor = page.next_cursor;
    }
    throw new Error('Registry cursor safety bound exceeded');
  };
  const first = await once();
  // One page = one atomic, revision-pinned consensus reply: nothing can change
  // between pages, so the confirming second pass only adds a round trip.
  // Multi-page registries still get both complete reads.
  if (pageCount === 1) return first;
  const second = await once();
  const fingerprint = (v: unknown) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x);
  if (fingerprint(first) !== fingerprint(second)) throw new Error('Registry changed between consensus reads');
  return second;
}
