import type { Identity } from "@icp-sdk/core/agent";
import { Principal } from "@icp-sdk/core/principal";
import { connectLiveIdentityAccessClientWithIdentity, isLiveIdentityAccessConfigured } from "./identityAccess";
import { getActiveIcpTarget, type IcpTargetConfig } from "./targetRegistry";
import {
  cacheIcpEntitlements,
  getCachedIcpEntitlements,
  type IcpEntitlementSummary,
} from "./identityEntitlementsCache";

/**
 * Resolves Pro entitlement state for an Internet Identity principal from the
 * identity_access canister — the ICP-only counterpart of the Supabase
 * `club_subscriptions` / IAP tables. Cache-first (identityEntitlementsCache),
 * mirroring identityProfile.ts. Pulls in the ICP agent SDK — import it
 * dynamically from callers, never statically.
 */

export type { IcpEntitlementSummary } from "./identityEntitlementsCache";

export function getCachedIcpIsPro(principal: string): boolean {
  return getCachedIcpEntitlements(principal)?.isPro ?? false;
}

/** Fetches the caller's entitlement records and caches a Pro summary. */
export async function fetchIcpEntitlements(
  identity: Identity,
  principal: string,
  target: IcpTargetConfig = getActiveIcpTarget(),
): Promise<IcpEntitlementSummary> {
  if (!isLiveIdentityAccessConfigured(target)) {
    throw new Error(`Identity access canister is not configured for ICP target ${target.alias}.`);
  }
  const { client } = await connectLiveIdentityAccessClientWithIdentity(target, identity);
  try {
    const entitlements = await client.getMyEntitlements();
    const nowMs = Date.now();
    const active = entitlements.filter((e) => Number(e.expires_at_ms) > nowMs);
    const summary: IcpEntitlementSummary = {
      isPro: active.length > 0,
      productIds: active.map((e) => e.product_id),
      resolvedAtMs: nowMs,
    };
    cacheIcpEntitlements(principal, summary);
    return summary;
  } finally {
    client.dispose();
  }
}

/**
 * Returns whether `principal` currently holds Pro, per the canister's
 * `is_pro` query (boolean-only, no entitlement detail leaked). Does not
 * populate the local entitlement cache since it may be checking a different
 * principal than the caller's own.
 */
export async function isIcpPrincipalPro(
  identity: Identity,
  principal: string,
  target: IcpTargetConfig = getActiveIcpTarget(),
): Promise<boolean> {
  if (!isLiveIdentityAccessConfigured(target)) return false;
  const { client } = await connectLiveIdentityAccessClientWithIdentity(target, identity);
  try {
    return await client.isPro(Principal.fromText(principal));
  } finally {
    client.dispose();
  }
}

export interface RedeemIcpEntitlementInput {
  productId: string;
  transactionId: string;
  expiresAtMs: number;
  source: string;
  signatureHex: string;
}

/**
 * Submits an attestation (minted by the session-free `verify-iap-receipt-icp`
 * edge function) to `redeem_entitlement`, then refreshes & caches the
 * caller's entitlement summary.
 */
export async function redeemIcpEntitlement(
  identity: Identity,
  principal: string,
  input: RedeemIcpEntitlementInput,
  target: IcpTargetConfig = getActiveIcpTarget(),
): Promise<IcpEntitlementSummary> {
  if (!isLiveIdentityAccessConfigured(target)) {
    throw new Error(`Identity access canister is not configured for ICP target ${target.alias}.`);
  }
  const { client } = await connectLiveIdentityAccessClientWithIdentity(target, identity);
  try {
    await client.redeemEntitlement(
      input.productId,
      input.transactionId,
      BigInt(Math.trunc(input.expiresAtMs)),
      input.source,
      input.signatureHex,
    );
  } finally {
    client.dispose();
  }
  return fetchIcpEntitlements(identity, principal, target);
}
