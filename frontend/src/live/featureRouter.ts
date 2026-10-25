import type { Identity } from "@icp-sdk/core/agent";
import { isFeatureCanisterConfigured, type FeatureArea } from "./featureBackend";
import { getCurrentInternetIdentity, getCurrentInternetIdentityConfirmed } from "./internetIdentityAuth";
import { getEffectiveBackendForFeature, isSignedInWithEmail, tryGetActiveIcpTarget } from "./loadBackendRouting";
import { routingActive } from "./generalActivation";
import { clubDispatch } from "./groupDispatch";
import type { GroupDomain } from "./groupRouting";
import { getActiveIcpTarget, type IcpTargetConfig } from "./targetRegistry";
import { readOwnerTestRouteCached, nextOwnerTestClubId } from './ownerTestRouting';
import { hasInternetIdentitySessionStored, readAuthChoice } from "./authBackendMode";
import { reportBlockedFallback } from "./strictIcpTransport";

/**
 * Runtime dispatcher that connects feature repositories to the hybrid
 * backend architecture. Each feature area calls `withFeatureBackend` with
 * two providers; the dispatcher picks one using the placement-settings
 * routing config, the user's country, and whether the feature's canister is
 * configured (see featureBackend.ts):
 *
 * - Supabase provider: the feature's existing repository code, unchanged.
 * - ICP provider: calls the domain canister through live/domains.ts with the
 *   signed-in Internet Identity.
 *
 * Until a feature's canister ID is configured the dispatcher always takes the
 * Supabase branch, so nothing changes for anyone before canisters exist.
 */

export interface FeatureBackendContext {
  identity: Identity;
  target: IcpTargetConfig;
}

export interface FeatureBackendProviders<T> {
  supabase: () => T | Promise<T>;
  icp: (context: FeatureBackendContext) => T | Promise<T>;
}

/** Which per-group canister serves each feature once group routing is on.
 * null = app-wide (served by global services, never club-scoped). */
export const FEATURE_GROUP_DOMAIN: Record<FeatureArea, GroupDomain | null> = {
  events: "events_domain", attendance: "events_domain", messaging: "messaging_domain", media: "media_metadata",
  news: "club_domain", home: "club_domain", membership: "club_domain", competitions: "competition_domain",
  notifications: "notification_queue", vault: "vault_domain", mini_leagues: "mini_league_domain",
  points: "club_points_domain", analytics: "insights_domain", admin: null,
};
/** Club scope for a call. writeKey marks a write (idempotency key); attempts
 * 1 = never auto-retry (creates without a canister idempotency key). */
export type ClubScope = ({ clubId: string } | { photoId: string } | { galleryCardId: string } | { newsId: string } | { competitionId: string } | { competitionMatchId: string } | { eoiId: string } | { seasonId: string } | { vaultFileId: string } | { vaultFolderId: string } | { notificationId: string } | { scheduledMessageId: string } | { eventGroupId: string } | { miniLeagueId: string } | { eventId: string } | { conversationId: string } | { teamId: string } | { clubLinkId: string } | { roleRequestId: string }
  /** Not club data: person-to-person (DMs, blocks, presence) or app-wide
   * settings. Always served by the shared canisters, never by a group. */
  | { shared: 'person' | 'app' }
  /** Invite link/code/id: the invitee isn't a member yet; the group holding
   * the token serves the call. */
  | { inviteToken: string }
  | { newClubId: string }
  /** Spans the caller's clubs (inbox, unread counts, "my events"): asked of
   * the shared canisters and every group the caller belongs to at the same
   * time, then combined with merge. Reads only. */
  | { everyGroup: true; merge: (parts: unknown[]) => unknown; requireComplete?: boolean }
  | { memberGroups: true; merge: (parts: unknown[]) => unknown }
) & { writeKey?: string; attempts?: number; /** internal: club not moved, use shared canisters */ legacy?: true };
/** Combine list results from several groups (one array per group). */
export const mergeLists = <T,>(parts: T[][]): T[] => parts.flat();

export async function withFeatureBackend<T>(
  feature: FeatureArea,
  providers: FeatureBackendProviders<T>,
  scope?: ClubScope,
): Promise<T> {
  if (isSignedInWithEmail()) return providers.supabase();
  const knownIcpSession = hasInternetIdentitySessionStored() || readAuthChoice() === "icp";
  if (knownIcpSession) {
    const target = tryGetActiveIcpTarget();
    if (!target || !isFeatureCanisterConfigured(target, feature)) {
      reportBlockedFallback(`coverage ${feature}`);
      throw new Error(`The ${feature} connection is not configured. Please report this problem to Ignite.`);
    }
    const identity = await getCurrentInternetIdentityConfirmed(3, 1000);
    if (!identity) throw new Error("No active Internet Identity session. Sign in again to continue.");
    return dispatchIcp(feature, providers, { identity, target }, scope);
  }
  if (getEffectiveBackendForFeature(feature) !== "icp") {
    // An Internet Identity user has no Supabase account or data: if routing
    // momentarily resolves to Supabase (club-membership pin not loaded yet,
    // unpinned ICP-created club), sending their read/write to Supabase hits
    // rows that don't exist (e.g. "team does not exist" on event create).
    // Keep them on the canister whenever it is configured for this feature.
    const target = tryGetActiveIcpTarget();
    if (target && isFeatureCanisterConfigured(target, feature)) {
      const iiIdentity = await getCurrentInternetIdentity().catch(() => null);
      if (iiIdentity) return dispatchIcp(feature, providers, { identity: iiIdentity, target }, scope);
    }
    return providers.supabase();
  }
  // Signed in with email (Supabase session, no Internet Identity): an ICP
  // club pin can't be served without an identity, so read their Supabase data
  // instead of failing every request.
  if (hasSupabaseSession() && !(await getCurrentInternetIdentity().catch(() => null))) {
    return providers.supabase();
  }
  // Ride out the brief "no session" gap while the session renews itself.
  const identity = await getCurrentInternetIdentityConfirmed(3, 1000);
  if (!identity) {
    throw new Error(
      `The "${feature}" feature is routed to the Internet Computer backend, ` +
        "but there is no active Internet Identity session. Sign in again to continue.",
    );
  }
  return dispatchIcp(feature, providers, { identity, target: getActiveIcpTarget() }, scope);
}

/** Both ICP sign-in paths obey the same scope/activation boundary. */
async function dispatchIcp<T>(feature: FeatureArea, providers: FeatureBackendProviders<T>, context: FeatureBackendContext, scope?: ClubScope): Promise<T> {
  if (scope && 'newClubId' in scope && !scope.legacy) {
    scope.newClubId = await nextOwnerTestClubId(context, scope.newClubId);
  }
  // Group routing switch-on lock: shipped off, so every club uses the shared
  // canisters. If ever switched on without the club-scoped dispatcher, fail
  // closed instead of silently sending a moved club to the old group.
  // Person/app-wide data always lives on the shared canisters: answer it
  // without waiting on group routing checks (typing, DMs, notifications).
  if (scope && 'shared' in scope && !scope.legacy) return providers.icp(context);
  if (!scope?.legacy && (await routingActive(context) || Boolean(await readOwnerTestRouteCached(context)))) {
    const domain = FEATURE_GROUP_DOMAIN[feature];
    if (scope && 'shared' in scope) return providers.icp(context);
    if (scope && 'newClubId' in scope) return clubDispatch.forNewClub(feature, scope.newClubId, async ctx => providers.icp(ctx));
    if (scope && 'inviteToken' in scope) return clubDispatch.forInvite(feature, scope.inviteToken, async ctx => providers.icp(ctx));
    if (scope && domain && 'everyGroup' in scope) {
      if (scope.writeKey) throw new Error(`"${feature}" writes must name one club; group routing cannot fan them out.`);
      return clubDispatch.readAcross(feature, domain, async ctx => providers.icp(ctx), scope.merge, scope.requireComplete) as Promise<T>;
    }
    if (scope && domain && 'memberGroups' in scope) {
      if (scope.writeKey) throw new Error(`"${feature}" writes must name one club.`);
      return clubDispatch.readMemberGroups(feature, domain, async ctx => providers.icp(ctx), scope.merge) as Promise<T>;
    }
    if (scope && domain && !('shared' in scope) && !('everyGroup' in scope) && !('memberGroups' in scope) && !('inviteToken' in scope) && !('newClubId' in scope)) {
      return scope.writeKey
        ? clubDispatch.writeFor(feature, scope, domain, scope.writeKey, async ctx => providers.icp(ctx), scope.attempts)
        : clubDispatch.readFor(feature, scope, domain, async ctx => providers.icp(ctx));
    }
    // Unscoped club data would reach the shared canisters even for a moved club.
    if (domain) throw new Error(`"${feature}" call has no club scope; group routing cannot place it.`);
  }
  return providers.icp(context);
}

function hasSupabaseSession(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sb-") && k.endsWith("-auth-token") && localStorage.getItem(k)) return true;
    }
  } catch { /* ignore */ }
  return false;
}

export { writeOnce } from "./clubScope";
/** Use after backend selection: Supabase UUID creation remains unchanged. */
