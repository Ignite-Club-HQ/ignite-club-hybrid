import { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "./featureRouter";
import { connectLiveIdentityAccessClientWithIdentity } from "./identityAccess";
import { hydratePrivateProfileNames } from "./privateProfileNames";
import { connectLiveClubDomain } from "./domains";
import { unwrapCandid } from "./features/candid";

type CandidateCursor = { revision: bigint; phase: bigint; offset: bigint };

function assertActive(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Person search cancelled", "AbortError");
}

/** Bounded cold club traversal, never a full-directory request or persistent
 * private-name download. It remains unconnected until the coordinated release.
 * Every page is verified before names are read; drift discards all results. */
export async function searchScopedClubProfiles(
  ctx: FeatureBackendContext,
  clubId: string,
  query: string,
  limit = 10,
  signal?: AbortSignal,
) {
  assertActive(signal);
  if (!clubId.trim() || query.trim().length > 80 || !Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error("Invalid club person search.");
  if (query.trim().length < 2) return [];
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  const matches: Awaited<ReturnType<typeof searchScopedProfileCandidates>> = [];
  const seen = new Set<string>();
  let cursor: [] | [CandidateCursor] = [];
  let revision: bigint | undefined;
  // Hard work budget; incomplete traversal is never presented as a complete
  // empty search. A caller can narrow its search or use a scoped picker later.
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    assertActive(signal);
    const page = await unwrapCandid(actor.read_profile_candidates(clubId, cursor), "Read club person candidates");
    assertActive(signal);
    if (page.scanned > 100n || page.subjects.length > 25 || (revision !== undefined && revision !== page.revision)) throw new Error("Club person search changed; please try again.");
    revision = page.revision;
    const next = page.next[0];
    const prior = cursor[0];
    if (next && (next.revision !== revision || next.phase > 2n || (prior && (next.phase < prior.phase || (next.phase === prior.phase && next.offset <= prior.offset))))) throw new Error("Invalid club person search continuation.");
    const ids = page.subjects.map(subject => subject.toText()).filter(id => !seen.has(id));
    for (const id of ids) seen.add(id);
    const rows = await searchScopedProfileCandidates(ctx, clubId, ids, query, limit, signal);
    assertActive(signal);
    matches.push(...rows);
    if (matches.length >= limit || !next) {
      // Re-read the opening page at its revision after all name/decryption
      // awaits; a removed membership cannot return retained partial matches.
      const confirmed = await unwrapCandid(actor.read_profile_candidates(clubId, [{ revision, phase: 0n, offset: 0n }]), "Confirm club person search");
      if (confirmed.revision !== revision) throw new Error("Club person search changed; please try again.");
      assertActive(signal);
      return matches.slice(0, limit);
    }
    cursor = [next];
  }
  throw new Error("Club person search exceeded its bounded page budget.");
}

/** Additive, deliberately not connected to ordinary pickers yet. Candidate
 * membership is checked by the identity service, not by this caller's list.
 * Names match client-side so there is no new plaintext search-name sidecar. */
export async function searchScopedProfileCandidates(
  ctx: FeatureBackendContext,
  clubId: string,
  candidateIds: readonly string[],
  query: string,
  limit = 10,
  signal?: AbortSignal,
) {
  assertActive(signal);
  if (!clubId.trim() || clubId !== clubId.trim()) throw new Error("A specific club is required for person search.");
  const authorityId = ctx.target.canisterIds.club_domain;
  if (!authorityId) throw new Error("The club's connection is not configured.");
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length < 2) return [];
  if (needle.length > 80 || !Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error("Invalid person search request.");
  const ids = [...new Set(candidateIds.map(id => id.startsWith("principal:") ? id.slice(10) : id))];
  // Each request is one bounded 25-subject candidate page, not a full directory.
  if (ids.length > 25) throw new Error("Person search candidates must be paged in groups of 25.");
  const subjects = ids.map(id => {
    const p = Principal.fromText(id);
    if (p.isAnonymous()) throw new Error("Active person identities are required.");
    return p;
  });
  if (!subjects.length) return [];
  const authority = Principal.fromText(authorityId);
  if (authority.isAnonymous()) throw new Error("The club's connection is invalid.");
  const { client } = await connectLiveIdentityAccessClientWithIdentity(ctx.target, ctx.identity);
  try {
    const rows = await client.readClubProfiles(authority, clubId, subjects);
    assertActive(signal);
    // Refuse foreign server rows rather than letting a response extend scope.
    const requested = new Set(subjects.map(p => p.toText()));
    if (rows.some(row => !requested.has(row.principal.toText()))) throw new Error("Person search returned an unexpected identity.");
    const hydrated = await hydratePrivateProfileNames(ctx, rows);
    assertActive(signal);
    return hydrated.filter(row => row.display_name?.toLocaleLowerCase().includes(needle)).slice(0, limit).map(row => ({
      id: row.principal.toText(),
      account_id: row.account_id,
      display_name: row.display_name,
      avatar_ref: row.avatar_ref[0] ?? null,
    }));
  } finally {
    client.dispose();
  }
}