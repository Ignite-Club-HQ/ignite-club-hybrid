/**
 * Shared ICP Pro-access resolution.
 *
 * Supabase gates read `team_subscriptions` / `club_subscriptions` rows; in
 * ICP mode those records live on club_domain (written by the app-admin
 * "Free Pro" toggles and the club subscription page). An active IAP
 * entitlement (identity_access) is global Pro for its holder — mirroring
 * useIcpProAccess / fetchIcpCallerIsPro — so every gate resolves:
 *   team grant → club grant → caller's IAP entitlement.
 */
import type { FeatureBackendContext } from "@/live/featureRouter";
import {
  getLiveClubSubscription,
  getLiveTeamSubscription,
  type LiveClubSubscription,
  type LiveTeamSubscription,
} from "./club";
import { fetchIcpEntitlements } from "@/live/identityEntitlements";

export interface LiveProFlags {
  is_pro: boolean;
  is_pro_football: boolean;
  admin_pro_override: boolean;
  admin_pro_football_override: boolean;
}

export function liveHasAnyPro(row: LiveProFlags | null | undefined): boolean {
  return Boolean(
    row?.is_pro || row?.is_pro_football || row?.admin_pro_override || row?.admin_pro_football_override,
  );
}

export function liveHasFootballPro(row: LiveProFlags | null | undefined): boolean {
  return Boolean(row?.is_pro_football || row?.admin_pro_football_override);
}

/** The caller's own IAP entitlement — global Pro for that member in ICP mode. */
export async function fetchLiveCallerIapPro(ctx: FeatureBackendContext): Promise<boolean> {
  const summary = await fetchIcpEntitlements(
    ctx.identity,
    ctx.identity.getPrincipal().toText(),
    ctx.target,
  );
  return summary.isPro;
}

export interface LiveProScope {
  teamId?: string | null;
  clubId?: string | null;
}

/** Any-Pro gate: team subscription → club subscription → caller IAP. */
export async function resolveLiveProAccess(
  ctx: FeatureBackendContext,
  scope: LiveProScope,
): Promise<boolean> {
  if (scope.teamId && liveHasAnyPro(await getLiveTeamSubscription(ctx, scope.teamId))) return true;
  if (scope.clubId && liveHasAnyPro(await getLiveClubSubscription(ctx, scope.clubId))) return true;
  return fetchLiveCallerIapPro(ctx);
}

/** Pro Football gate: team subscription → club subscription → caller IAP. */
export async function resolveLiveProFootballAccess(
  ctx: FeatureBackendContext,
  scope: LiveProScope,
): Promise<boolean> {
  if (scope.teamId && liveHasFootballPro(await getLiveTeamSubscription(ctx, scope.teamId))) return true;
  if (scope.clubId && liveHasFootballPro(await getLiveClubSubscription(ctx, scope.clubId))) return true;
  return fetchLiveCallerIapPro(ctx);
}

/** Batch team-subscription reads (one query per id; per-id failures read as unset). */
export async function listLiveTeamSubscriptions(
  ctx: FeatureBackendContext,
  teamIds: readonly string[],
): Promise<Map<string, LiveTeamSubscription | null>> {
  const unique = [...new Set(teamIds)];
  const rows = await Promise.all(unique.map((id) => getLiveTeamSubscription(ctx, id).catch(() => null)));
  return new Map(unique.map((id, index) => [id, rows[index] ?? null]));
}

/** Batch club-subscription reads (one query per id; per-id failures read as unset). */
export async function listLiveClubSubscriptions(
  ctx: FeatureBackendContext,
  clubIds: readonly string[],
): Promise<Map<string, LiveClubSubscription | null>> {
  const unique = [...new Set(clubIds)];
  const rows = await Promise.all(unique.map((id) => getLiveClubSubscription(ctx, id).catch(() => null)));
  return new Map(unique.map((id, index) => [id, rows[index] ?? null]));
}

/** Maps a canister team subscription onto the Supabase `team_subscriptions` row shape. */
export function mapLiveTeamSubscriptionToRow(sub: LiveTeamSubscription) {
  return {
    team_id: sub.team_id,
    is_pro: sub.is_pro,
    is_pro_football: sub.is_pro_football,
    is_trial: sub.is_trial,
    trial_ends_at: sub.trial_ends_at_ms.length ? new Date(Number(sub.trial_ends_at_ms[0])).toISOString() : null,
    cancelled_at: sub.cancelled_at_ms.length ? new Date(Number(sub.cancelled_at_ms[0])).toISOString() : null,
    disable_auto_subs: sub.disable_auto_subs,
    rotation_speed: Number(sub.rotation_speed),
    disable_position_swaps: sub.disable_position_swaps,
    disable_batch_subs: sub.disable_batch_subs,
    rotate_gk_at_halftime: sub.rotate_gk_at_halftime,
    minutes_per_half: sub.minutes_per_half.length ? Number(sub.minutes_per_half[0]) : null,
    max_spread_minutes: sub.max_spread_minutes.length ? Number(sub.max_spread_minutes[0]) : null,
    team_size: sub.team_size.length ? Number(sub.team_size[0]) : null,
    formation: sub.formation.length ? sub.formation[0] : null,
    show_lineup_picker: sub.show_lineup_picker,
    disable_team_pom_rewards: sub.disable_team_pom_rewards,
    admin_pro_override: sub.admin_pro_override,
    admin_pro_football_override: sub.admin_pro_football_override,
  };
}

/** Maps a canister club subscription onto the Supabase `club_subscriptions` row shape. */
export function mapLiveClubSubscriptionToRow(sub: LiveClubSubscription) {
  return {
    club_id: sub.club_id,
    is_pro: sub.is_pro,
    is_pro_football: sub.is_pro_football,
    admin_pro_override: sub.admin_pro_override,
    admin_pro_football_override: sub.admin_pro_football_override,
    expires_at: sub.expires_at_ms.length ? new Date(Number(sub.expires_at_ms[0])).toISOString() : null,
    plan: sub.plan,
    team_limit: sub.team_limit.length ? Number(sub.team_limit[0]) : null,
  };
}
