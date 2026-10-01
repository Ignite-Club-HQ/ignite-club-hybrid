import { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "./featureRouter";
import { listLiveRoleGrants } from "./features/membership";
import { getCachedIcpIdentityProfile } from "./identityProfileCache";

/**
 * Shared candidate-resolution helper for the messaging "pick people" dialogs
 * (AddGroupMembersDialog, CreateGroupDialog, StartDMDialog) when messaging is
 * routed to ICP. Builds the addressable-person list from club_domain role
 * grants (the canister counterpart of the Supabase `user_roles` membership
 * roster) since there is no Supabase `profiles`/`user_roles` table to query
 * for Internet-Identity-only accounts.
 *
 * Display names come from the identity_access profile cache when available
 * (populated after sign-in / profile completion); accounts with no cached
 * profile fall back to a short, readable form of their principal text so the
 * picker never shows a blank row.
 */

export interface LiveMessagingCandidateRole {
  role: string;
  clubId: string | null;
  teamId: string | null;
}

export interface LiveMessagingCandidate {
  /** Principal text — the canonical id for an Internet Identity account. */
  id: string;
  principal: Principal;
  display_name: string;
  avatar_url: string | null;
  roles: LiveMessagingCandidateRole[];
}

export function shortPrincipalLabel(principalText: string): string {
  if (principalText.length <= 12) return principalText;
  return `${principalText.slice(0, 5)}…${principalText.slice(-4)}`;
}

/**
 * Resolves the set of principals holding a role in any of `clubIds`,
 * excluding the caller and anyone in `excludeIds` (e.g. existing group
 * participants). Safe to call with an empty `clubIds` list — returns [].
 */
export async function fetchLiveMessagingCandidates(
  ctx: FeatureBackendContext,
  clubIds: string[],
  excludeIds: Set<string> = new Set(),
): Promise<LiveMessagingCandidate[]> {
  const uniqueClubIds = [...new Set(clubIds.filter(Boolean))];
  if (uniqueClubIds.length === 0) return [];

  const selfText = ctx.identity.getPrincipal().toText();
  const grantLists = await Promise.all(
    uniqueClubIds.map((clubId) => listLiveRoleGrants(ctx, clubId)),
  );

  const byAccount = new Map<string, LiveMessagingCandidateRole[]>();
  for (const grants of grantLists) {
    for (const grant of grants) {
      const accountId = grant.account_id;
      if (accountId === selfText || excludeIds.has(accountId)) continue;
      const roles = byAccount.get(accountId) ?? [];
      roles.push({
        role: grant.role,
        clubId: grant.club[0] ?? null,
        teamId: grant.team[0] ?? null,
      });
      byAccount.set(accountId, roles);
    }
  }

  const candidates: LiveMessagingCandidate[] = [];
  for (const [accountId, roles] of byAccount.entries()) {
    let principal: Principal;
    try {
      principal = Principal.fromText(accountId);
    } catch {
      continue;
    }
    const cachedProfile = getCachedIcpIdentityProfile(accountId);
    candidates.push({
      id: accountId,
      principal,
      display_name: cachedProfile?.displayName || shortPrincipalLabel(accountId),
      avatar_url: cachedProfile?.avatarRef ?? null,
      roles,
    });
  }
  return candidates;
}
