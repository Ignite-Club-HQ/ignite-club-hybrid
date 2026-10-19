import type { FeatureBackendContext } from './featureRouter';

/** Request IDs carry no club. Discover only through caller-authorized request
 * lists; denial is not a claim, transport errors must not become a fallback. */
export async function findRoleRequestOwner(
  id: string,
  listClubs: (cursor: string | null) => Promise<{ id: string }[]>,
  listRequests: (clubId: string) => Promise<{ id: string }[]>,
): Promise<string | null> {
  let cursor: string | null = null;
  let owner: string | null = null;
  for (let page = 0; page < 40; page++) {
    const clubs = await listClubs(cursor);
    for (let offset = 0; offset < clubs.length; offset += 8) {
      const hits = await Promise.all(clubs.slice(offset, offset + 8).map(async club => {
        try { return (await listRequests(club.id)).some(r => r.id === id) ? club.id : null; }
        catch (error) {
          if (error instanceof Error && /Club admin required/.test(error.message)) return null;
          throw error;
        }
      }));
      for (const hit of hits) {
        if (!hit) continue;
        if (owner && owner !== hit) throw new Error('Role request claimed by multiple clubs');
        owner = hit;
      }
    }
    if (clubs.length < 100) return owner;
    const last = clubs.at(-1);
    if (!last || last.id === cursor) throw new Error('Club directory cursor did not advance');
    cursor = last.id;
  }
  throw new Error('Role request discovery exceeds page budget');
}

export async function lookupRoleRequestOwner(ctx: FeatureBackendContext, id: string): Promise<string | null> {
  const [club, membership] = await Promise.all([import('./features/club'), import('./features/membership')]);
  return findRoleRequestOwner(id, cursor => club.listLiveClubs(ctx, cursor, 100), clubId => membership.listLiveRoleRequests(ctx, clubId));
}