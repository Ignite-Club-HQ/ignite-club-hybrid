import { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "./featureRouter";
import { connectLiveIdentityAccessClientWithIdentity } from "./identityAccess";
import { hydratePrivateProfileNames } from "./privateProfileNames";
import type { PrivateProfileAuthorityResolver } from "./privateProfileAuthority";
import { withReadDeadline } from "./readDeadline";

/** Rehearsal connection to exact-child-authorized directory pages. No names
 * are sent as a server-side query, indexed readably or persisted on the device.
 * PII key delivery still requires its separately verified guardian audience. */
export async function searchEncryptedGuardianProfiles(
  ctx: FeatureBackendContext, childId: string, query: string, limit = 6,
  options: { signal?: AbortSignal; resolveAuthority?: PrivateProfileAuthorityResolver } = {},
) {
  const identity = ctx.identity;
  const caller = identity.getPrincipal().toText();
  const target = JSON.stringify(ctx.target);
  const active = () => {
    if (options.signal?.aborted || ctx.identity !== identity || identity.getPrincipal().toText() !== caller || JSON.stringify(ctx.target) !== target) throw new Error("Guardian search cancelled or identity changed.");
  };
  active();
  const needle = query.trim().toLocaleLowerCase();
  if (!childId || childId !== childId.trim() || childId.length > 128 || !Number.isInteger(limit) || limit < 1 || limit > 25 || needle.length > 80) throw new Error("Invalid guardian search.");
  if (needle.length < 2) return [];
  const id = ctx.target.canisterIds.club_domain;
  if (!id) throw new Error("The child's authority is not configured.");
  const authority = Principal.fromText(id);
  const { client } = await connectLiveIdentityAccessClientWithIdentity(ctx.target, identity);
  type Row = Awaited<ReturnType<typeof client.readGuardianProfiles>>[number];
  let cursor: Parameters<typeof client.readGuardianProfileCandidates>[2] = [];
  let revision: bigint | undefined;
  const seen = new Set<string>();
  const originals = new Map<string, Row>();
  const matches: Array<{ id: string; display_name: string | null; avatar_url: string | null }> = [];
  try {
    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
      active();
      const page = await withReadDeadline(client.readGuardianProfileCandidates(authority, childId, cursor), "Guardian candidates", 20_000, options.signal);
      active();
      if (page.rows.length > 25 || page.scanned > 100 || page.scanned < page.rows.length || (revision !== undefined && revision !== page.revision)) throw new Error("Guardian search directory changed.");
      revision = page.revision;
      const next = page.next[0];
      const prior = cursor[0];
      if (next && (next.revision !== revision || !next.after || (prior && (next.after <= prior.after || next.expires_at_ns !== prior.expires_at_ns || String(next.binding) !== String(prior.binding))))) throw new Error("Invalid guardian search continuation.");
      const subjects = new Set<string>();
      for (const row of page.rows) {
        const subject = row.principal.toText();
        if (subjects.has(subject) || seen.has(subject) || row.principal.isAnonymous()) throw new Error("Invalid guardian search candidates.");
        subjects.add(subject); seen.add(subject); originals.set(subject, row);
      }
      const hydrated = await hydratePrivateProfileNames(ctx, page.rows, { ...options, audience: { kind: 'guardian_search', authority, resource: childId, profile_revision: revision } });
      active();
      // Re-read exact bindings after decryption; labels never authorize linking.
      const confirmed = await withReadDeadline(client.readGuardianProfiles(authority, childId, page.rows.map(row => row.principal), revision), "Guardian verification", 20_000, options.signal);
      active();
      verifyBindings(page.rows, confirmed);
      for (const row of hydrated) {
        const subject = row.principal.toText();
        if (subject !== caller && row.display_name?.toLocaleLowerCase().includes(needle) && matches.length < limit) matches.push({ id: subject, display_name: row.display_name, avatar_url: row.avatar_ref[0] ?? null });
      }
      if (matches.length >= limit || !next) {
        // A later page can invalidate an earlier name without reusing its key.
        const retained = matches.map(row => originals.get(row.id)).filter((row): row is Row => !!row);
        const final = await withReadDeadline(client.readGuardianProfiles(authority, childId, retained.map(row => row.principal), revision), "Guardian verification", 20_000, options.signal);
        active(); verifyBindings(retained, final);
        return matches;
      }
      cursor = [next];
    }
    throw new Error("Guardian search exceeded its bounded page budget; narrow the search.");
  } finally { client.dispose(); }
}

function verifyBindings<T extends { principal: Principal; account_id: string; display_name: string | null }>(original: readonly T[], confirmed: readonly T[]) {
  const bindings = new Map(original.map(row => [row.principal.toText(), row]));
  if (confirmed.length !== original.length || new Set(confirmed.map(row => row.principal.toText())).size !== confirmed.length || confirmed.some(row => {
    const prior = bindings.get(row.principal.toText());
    return !prior || prior.account_id !== row.account_id || prior.display_name !== row.display_name;
  })) throw new Error("Guardian relationship or profile binding changed.");
}