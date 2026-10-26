import { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "./featureRouter";
import { connectLiveIdentityAccessClientWithIdentity } from "./identityAccess";
import { hydratePrivateProfileNames } from "./privateProfileNames";

/** Additive, deliberately not connected to ordinary pickers yet. Candidate
 * membership is checked by the identity service, not by this caller's list.
 * Names match client-side so there is no new plaintext search-name sidecar. */
export async function searchScopedProfileCandidates(
  ctx: FeatureBackendContext,
  clubId: string,
  candidateIds: readonly string[],
  query: string,
  limit = 10,
) {
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
    // Refuse foreign server rows rather than letting a response extend scope.
    const requested = new Set(subjects.map(p => p.toText()));
    if (rows.some(row => !requested.has(row.principal.toText()))) throw new Error("Person search returned an unexpected identity.");
    const hydrated = await hydratePrivateProfileNames(ctx, rows);
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