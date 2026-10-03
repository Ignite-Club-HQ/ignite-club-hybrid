import { connectLiveClubPointsDomain } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import { candidOpt, unwrapCandid } from "./candid";
import type {
  ClubReward,
  HistoryPage,
  LeaderboardEntry,
  PointsHistoryEntry,
  RewardRedemption,
  Subject,
} from "../../lab/generated-contracts/club_points_domain/declarations/club_points_domain.did";

/**
 * Points/rewards feature -> club_points_domain canister.
 *
 * Canister-side counterpart of the Supabase points & rewards surfaces:
 * `points_history`, `club_rewards`, `reward_redemptions`, `user_club_points`,
 * `child_club_points`, `points_cooldowns`.
 *
 * PROVISIONAL MAPPINGS (verify against a live canister after deploy):
 * - `Subject.User`/`Subject.Child` carry the existing Supabase `profiles.id` /
 *   `children.id` text values unchanged — there is no principal mapping for
 *   subjects, only the caller's Internet Identity is used for `created_by` /
 *   `verified_by` (set canister-side from the authenticated caller, never
 *   passed explicitly by the client).
 * - The canister owns the points balance *and* writes the matching
 *   `PointsHistoryEntry` atomically inside `award_points` / `redeem_reward` /
 *   `cancel_redemption`. This replaces the Supabase two-step of calling an
 *   `increment_*_ignite_points` RPC and then `recordPointsHistory()` — ICP
 *   branches must call `awardLivePoints` (or `redeemLiveReward` /
 *   `cancelLiveRedemption`) exactly once instead of doing both steps.
 * - `award_points` enforces the same-day `daily_cap` cooldown only for
 *   `Subject.User` awards; `Subject.Child` awards are uncapped (mirrors the
 *   canister's documented behaviour). A cooldown denial surfaces as the
 *   canister's `#Err` text (e.g. "Daily cap reached for this action") —
 *   callers should present the same user-facing copy the Supabase path uses
 *   for its cooldown checks.
 * - Joined/display-only fields the Supabase queries select (sponsor name,
 *   club name, child name, reward `qr_code_url` via `club_rewards` embed on
 *   `reward_redemptions`, etc.) have no equivalent on the canister's
 *   `ClubReward` / `RewardRedemption` records. ICP-routed reads return the
 *   canister's flat shape only; callers must resolve any decorative joins
 *   from another already-migrated domain (or omit them) rather than invent
 *   canister fields that don't exist.
 * - `list_rewards` / `list_redemptions` / `list_points_history` all require
 *   an explicit `club_id` — there is no canister equivalent of a cross-club
 *   bulk lookup by row id. Call sites that need to resolve ownership across
 *   many clubs at once (e.g. notification fan-out) cannot be routed through
 *   this wrapper and stay on Supabase.
 */

export const subjectForUser = (userId: string): Subject => ({ User: userId });
export const subjectForChild = (childId: string): Subject => ({ Child: childId });

export function subjectFor(ids: { userId?: string | null; childId?: string | null }): Subject {
  if (ids.childId) return subjectForChild(ids.childId);
  if (ids.userId) return subjectForUser(ids.userId);
  throw new Error("subjectFor: one of userId/childId is required.");
}

async function actor(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveClubPointsDomain(ctx.target, ctx.identity);
  return actor;
}

/**
 * Awards (or deducts, with a negative `amount`) points to a user or child and
 * records the matching history entry atomically. `actionType` + `scopeId`
 * identify the cooldown bucket (e.g. action_type "duty", scope_id the duty
 * id) — pass a `dailyCap` to enforce the same-day cap Supabase's
 * `points_cooldowns` table used to track; omit it for uncapped awards.
 */
export async function awardLivePoints(
  ctx: FeatureBackendContext,
  clubId: string,
  subject: Subject,
  actionType: string,
  scopeId: string,
  amount: number,
  description: string,
  sourceId?: string | null,
  seasonId?: string | null,
  dailyCap?: number | null,
): Promise<PointsHistoryEntry> {
  const a = await actor(ctx);
  return unwrapCandid(
    a.award_points(
      clubId,
      subject,
      actionType,
      scopeId,
      amount,
      description,
      candidOpt(sourceId ?? null),
      candidOpt(seasonId ?? null),
      candidOpt(dailyCap ?? null),
    ),
    "Award points",
  );
}

/**
 * Awards points once per (club, subject, actionType, scopeId) — the
 * canister-side counterpart of the Supabase early_rsvp_points_awarded
 * optimistic lock. The dedup check and the award are atomic in one update
 * call. An "Already awarded" #Err is returned by the canister when the
 * award was already made; callers should treat that as a no-op, not an
 * error to surface.
 */
export async function awardLivePointsOnce(
  ctx: FeatureBackendContext,
  clubId: string,
  subject: Subject,
  actionType: string,
  scopeId: string,
  amount: number,
  description: string,
  sourceId?: string | null,
  seasonId?: string | null,
): Promise<PointsHistoryEntry> {
  const a = await actor(ctx);
  return unwrapCandid(
    a.award_points_once(
      clubId,
      subject,
      actionType,
      scopeId,
      amount,
      description,
      candidOpt(sourceId ?? null),
      candidOpt(seasonId ?? null),
    ),
    "Award points once",
  );
}

/**
 * Consecutive UTC days (ending today or yesterday) with an engagement entry
 * — the canister-side counterpart of the Supabase `get_engagement_streak`
 * RPC. Self-readable (and club staff) per the canister's canReadSubject rule.
 */
export async function getLiveEngagementStreak(
  ctx: FeatureBackendContext,
  clubId: string,
  userId: string,
): Promise<number> {
  const a = await actor(ctx);
  const result = await a.get_engagement_streak(clubId, userId);
  if ("Err" in result) throw new Error(`Get engagement streak failed: ${result.Err}`);
  return Number(result.Ok);
}

/** Per-club points-module settings (kill switch + display name); null when unset (defaults). */
export async function getLiveClubPointsSettings(
  ctx: FeatureBackendContext,
  clubId: string,
): Promise<{ display_name: [] | [string]; disabled: boolean } | null> {
  const a = await actor(ctx);
  const row = await unwrapCandid(a.get_club_points_settings(clubId), "Get club points settings");
  return row.length ? row[0] : null;
}

export async function saveLiveClubPointsSettings(
  ctx: FeatureBackendContext,
  clubId: string,
  displayName: string | null,
  disabled: boolean,
): Promise<void> {
  const a = await actor(ctx);
  unwrapCandid(a.save_club_points_settings(clubId, candidOpt(displayName ?? null), disabled), "Save club points settings");
}

export async function getLiveUserPoints(
  ctx: FeatureBackendContext,
  clubId: string,
  userId: string,
): Promise<number> {
  const a = await actor(ctx);
  return unwrapCandid(a.get_user_points(clubId, userId), "Get user points");
}

export async function getLiveChildPoints(
  ctx: FeatureBackendContext,
  clubId: string,
  childId: string,
): Promise<number> {
  const a = await actor(ctx);
  return unwrapCandid(a.get_child_points(clubId, childId), "Get child points");
}

export async function getLiveLeaderboard(
  ctx: FeatureBackendContext,
  clubId: string,
  subjectKind: "User" | "Child",
  window: string,
  topN: number,
): Promise<LeaderboardEntry[]> {
  const a = await actor(ctx);
  return unwrapCandid(
    a.get_leaderboard(clubId, subjectKind === "Child" ? { Child: null } : { User: null }, window, BigInt(topN)),
    "Get leaderboard",
  );
}

export async function listLivePointsHistory(
  ctx: FeatureBackendContext,
  clubId: string,
  subject: Subject | null,
  offset: number,
  limit: number,
): Promise<HistoryPage> {
  const a = await actor(ctx);
  return unwrapCandid(
    a.list_points_history(clubId, candidOpt(subject), BigInt(offset), BigInt(limit)),
    "List points history",
  );
}

export async function listLiveClubRewards(
  ctx: FeatureBackendContext,
  clubId: string,
  teamId: string | null,
  activeOnly: boolean,
): Promise<ClubReward[]> {
  const a = await actor(ctx);
  return unwrapCandid(a.list_rewards(clubId, candidOpt(teamId), activeOnly), "List club rewards");
}

export async function createLiveClubReward(
  ctx: FeatureBackendContext,
  clubId: string,
  name: string,
  description: string | null,
  pointsRequired: number,
  isDefault: boolean,
  rewardType: string,
  logoUrl: string | null,
  showQrCode: boolean,
  sponsorId: string | null,
  teamId: string | null,
): Promise<ClubReward> {
  const a = await actor(ctx);
  return unwrapCandid(
    a.create_reward(
      clubId,
      name,
      candidOpt(description),
      pointsRequired,
      isDefault,
      rewardType,
      candidOpt(logoUrl),
      showQrCode,
      candidOpt(sponsorId),
      candidOpt(teamId),
    ),
    "Create club reward",
  );
}

/**
 * Full update of a reward. The canister's `update_reward` takes a flat
 * positional argument list (no partial-patch semantics) — pass every field,
 * not just the ones that changed, mirroring the current record.
 */
export async function updateLiveClubReward(
  ctx: FeatureBackendContext,
  id: string,
  name: string,
  description: string | null,
  pointsRequired: number,
  isDefault: boolean,
  isActive: boolean,
  rewardType: string,
  logoUrl: string | null,
  qrCodeUrl: string | null,
  showQrCode: boolean,
  sponsorId: string | null,
  teamId: string | null,
): Promise<ClubReward> {
  const a = await actor(ctx);
  return unwrapCandid(
    a.update_reward(
      id,
      name,
      candidOpt(description),
      pointsRequired,
      isDefault,
      isActive,
      rewardType,
      candidOpt(logoUrl),
      candidOpt(qrCodeUrl),
      showQrCode,
      candidOpt(sponsorId),
      candidOpt(teamId),
    ),
    "Update club reward",
  );
}

export async function deleteLiveClubReward(ctx: FeatureBackendContext, id: string): Promise<void> {
  const a = await actor(ctx);
  await unwrapCandid(a.delete_reward(id), "Delete club reward");
}

export async function redeemLiveReward(
  ctx: FeatureBackendContext,
  clubId: string,
  subject: Subject,
  rewardId: string,
  idempotencyKey?: string | null,
): Promise<RewardRedemption> {
  const a = await actor(ctx);
  return unwrapCandid(
    a.redeem_reward(clubId, subject, rewardId, candidOpt(idempotencyKey ?? null)),
    "Redeem reward",
  );
}

export async function approveLiveRedemption(
  ctx: FeatureBackendContext,
  id: string,
): Promise<RewardRedemption> {
  const a = await actor(ctx);
  return unwrapCandid(a.approve_redemption(id), "Approve redemption");
}

export async function fulfillLiveRedemption(
  ctx: FeatureBackendContext,
  id: string,
): Promise<RewardRedemption> {
  const a = await actor(ctx);
  return unwrapCandid(a.fulfill_redemption(id), "Fulfill redemption");
}

/** Cancels a redemption; the canister refunds the spent points with a compensating history entry. */
export async function cancelLiveRedemption(
  ctx: FeatureBackendContext,
  id: string,
): Promise<RewardRedemption> {
  const a = await actor(ctx);
  return unwrapCandid(a.cancel_redemption(id), "Cancel redemption");
}

export async function listLiveRedemptions(
  ctx: FeatureBackendContext,
  clubId: string,
  subject: Subject | null,
): Promise<RewardRedemption[]> {
  const a = await actor(ctx);
  return unwrapCandid(a.list_redemptions(clubId, candidOpt(subject)), "List redemptions");
}

/** Balances for a user across every club they can be read for. */
export async function getLiveUserPointsAllClubs(
  ctx: FeatureBackendContext,
  userId: string,
): Promise<Array<{ clubId: string; points: number }>> {
  const a = await actor(ctx);
  const rows = await unwrapCandid(a.get_user_points_all_clubs(userId), "Get user points (all clubs)");
  return rows.map(([clubId, points]) => ({ clubId, points }));
}

/** Balances for a child across every club they can be read for. */
export async function getLiveChildPointsAllClubs(
  ctx: FeatureBackendContext,
  childId: string,
): Promise<Array<{ clubId: string; points: number }>> {
  const a = await actor(ctx);
  const rows = await unwrapCandid(a.get_child_points_all_clubs(childId), "Get child points (all clubs)");
  return rows.map(([clubId, points]) => ({ clubId, points }));
}

/** Bulk balances for many children within a single club (max 500 ids per call). */
export async function getLiveChildPointsBatch(
  ctx: FeatureBackendContext,
  clubId: string,
  childIds: string[],
): Promise<Array<{ childId: string; points: number }>> {
  const a = await actor(ctx);
  const rows = await unwrapCandid(a.get_child_points_batch(clubId, childIds), "Get child points (batch)");
  return rows.map(([childId, points]) => ({ childId, points }));
}
