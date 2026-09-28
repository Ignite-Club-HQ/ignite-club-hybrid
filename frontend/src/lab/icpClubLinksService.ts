import type { ClubLink, ClubLinkDraft, ClubLinksService } from './ClubLinksService';
import type { _SERVICE, Link, Listing, Operation, Request } from './bindings/declarations/club_links.did.js';

const unwrap = <T>(result: { Ok: T } | { Err: string }): T => {
  if ('Err' in result) throw new Error(result.Err);
  return result.Ok;
};
function convert(l: Link, revision: bigint): ClubLink {
  return { id: l.id, club_id: l.club_id, ...l.draft, subtitle: l.draft.subtitle[0] ?? null, sort_order: l.sort_order, created_at: new Date(Number(l.created_at_ms)).toISOString(), revision };
}
export function createIcpClubLinksService(actor: _SERVICE): ClubLinksService & { dispose(): void } {
  // Each instance belongs to one immutable identity. Never share caches across identities.
  const revisions = new Map<string, bigint>();
  const scopes = new Map<string, string>();
  let disposed = false;
  let pending: { fingerprint: string; request: Request } | undefined;
  const live = () => { if (disposed) throw new Error('Identity changed; operation discarded'); };
  const remember = (club: string, listing: Listing) => {
    live();
    const previous = revisions.get(club);
    if (previous !== undefined && listing.revision < previous) throw new Error('Stale response; refresh links');
    revisions.set(club, listing.revision);
    for (const l of listing.links) scopes.set(l.id, club);
    return listing.links.map(l => convert(l, listing.revision));
  };
  const list = async (club: string, admin: boolean) => { live(); return remember(club, unwrap(await actor.list_links(club, admin))); };
  const get = async (id: string) => {
    live(); const result = unwrap(await actor.get_link(id));
    if (result.links.length !== 1) throw new Error('Invalid get response');
    return remember(result.links[0].club_id, result)[0];
  };
  const scope = async (id: string) => scopes.get(id) ?? (await get(id)).club_id;
  let writing = false;
  const mutate = async (club: string, operation: Operation, expectedRevision?: bigint) => {
    live();
    if (writing) throw new Error('A change is already pending');
    writing = true;
    try {
      const fingerprint = JSON.stringify({ club, operation, expectedRevision: expectedRevision?.toString() });
      if (pending && pending.fingerprint !== fingerprint) throw new Error('Retry the previous change before making another; its outcome is unknown');
      if (!pending) {
        if (!revisions.has(club)) await list(club, true);
        pending = { fingerprint, request: { club, request_id: crypto.randomUUID(), expected_revision: expectedRevision ?? revisions.get(club)!, operation } };
      }
      // Keep the exact request after transport failure. A user retry cannot duplicate an accepted write.
      const result = await actor.mutate(pending.request);
      live(); pending = undefined;
      const value = unwrap(result);
      revisions.set(club, value.revision > (revisions.get(club) ?? 0n) ? value.revision : revisions.get(club)!);
      if (value.link.length) scopes.set(value.link[0].id, club);
      return value.link[0] ? convert(value.link[0], value.revision) : undefined;
    } finally { writing = false; }
  };
  return {
    listAdmin: club => list(club, true),
    // Member-preview callers use a separate signed member identity. Admin-visible reads obey RLS.
    listVisible: club => list(club, false), get,
    async save(club: string, draft: ClubLinkDraft) {
      const { id, subtitle, expectedRevision, ...fields } = draft;
      if (id && expectedRevision === undefined) throw new Error('An edit requires the revision loaded with the draft');
      const result = await mutate(club, { Save: { id: id ? [id] : [], draft: { ...fields, subtitle: subtitle === null ? [] : [subtitle] } } }, expectedRevision);
      if (!result) throw new Error('Missing saved link'); return result;
    },
    async remove(id, expectedRevision) { await mutate(await scope(id), { Remove: { id } }, expectedRevision); scopes.delete(id); },
    async setActive(id, active, expectedRevision) { await mutate(await scope(id), { SetActive: { id, active } }, expectedRevision); },
    async reorder(club, first, second, expectedRevision) { await mutate(club, { Reorder: { first, second } }, expectedRevision); },
    dispose() { disposed = true; revisions.clear(); scopes.clear(); pending = undefined; },
  };
}
