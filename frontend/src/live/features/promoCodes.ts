/**
 * On-chain promo codes (club_domain, promo_codes parity).
 * Management is platform-admin only canister-side; redemption is
 * team-admin gated and writes the team's Pro flags on-chain.
 */
import { connectLiveClubDomain } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import { candidOpt, unwrapCandid } from "./candid";

export interface LivePromoCodeRow {
  id: string;
  code: string;
  access_level: string;
  scope_type: string;
  club_id: string | null;
  storage_gb: number | null;
  expires_at: string | null;
  is_active: boolean;
  uses_count: number;
  created_by: string;
  created_at: string;
}

const msToIso = (ms: bigint) => new Date(Number(ms)).toISOString();

export async function listLivePromoCodes(ctx: FeatureBackendContext): Promise<LivePromoCodeRow[]> {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  const rows = await unwrapCandid(actor.list_promo_codes(), "List promo codes");
  return rows
    .map((p) => ({
      id: p.id,
      code: p.code,
      access_level: p.access_level,
      scope_type: p.scope_type,
      club_id: p.club_id[0] ?? null,
      storage_gb: p.storage_gb.length ? Number(p.storage_gb[0]) : null,
      expires_at: p.expires_at_ms.length ? msToIso(p.expires_at_ms[0]!) : null,
      is_active: p.is_active,
      uses_count: Number(p.uses_count),
      created_by: p.created_by.toText(),
      created_at: msToIso(p.created_at_ms),
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function createLivePromoCode(
  ctx: FeatureBackendContext,
  input: {
    code: string;
    accessLevel: string;
    scopeType: string;
    clubId: string | null;
    storageGb: number | null;
    expiresAt: string | null;
  },
): Promise<void> {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  await unwrapCandid(
    actor.create_promo_code(
      input.code,
      input.accessLevel,
      input.scopeType,
      candidOpt(input.clubId),
      input.storageGb == null ? [] : [input.storageGb],
      input.expiresAt ? [BigInt(new Date(input.expiresAt).getTime())] : [],
    ),
    "Create promo code",
  );
}

export async function setLivePromoCodeActive(ctx: FeatureBackendContext, id: string, isActive: boolean) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  await unwrapCandid(actor.set_promo_code_active(id, isActive), "Update promo code");
}

export async function deleteLivePromoCode(ctx: FeatureBackendContext, id: string) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  await unwrapCandid(actor.delete_promo_code(id), "Delete promo code");
}

/** Returns the ISO expiry of the granted Pro access. */
export async function redeemLiveTeamPromoCode(
  ctx: FeatureBackendContext,
  input: { code: string; teamId: string; tier: "pro" | "pro_football"; isAnnual: boolean },
): Promise<string> {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  const expiry = await unwrapCandid(
    actor.redeem_team_promo_code(input.code, input.teamId, input.tier, input.isAnnual),
    "Redeem promo code",
  );
  return msToIso(expiry);
}

/** Storage add-on GB granted on-chain for a club (storage promo redemptions). */
export async function getLiveClubStoragePurchasedGb(ctx: FeatureBackendContext, clubId: string): Promise<number> {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return Number(await unwrapCandid(actor.get_club_storage_purchased(clubId), "Load club storage"));
}

/** Redeems a storage promo code for a club; returns the new add-on total (GB). */
export async function redeemLiveClubStoragePromoCode(
  ctx: FeatureBackendContext,
  input: { code: string; clubId: string },
): Promise<number> {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return Number(
    await unwrapCandid(actor.redeem_club_storage_promo_code(input.code, input.clubId), "Redeem promo code"),
  );
}
