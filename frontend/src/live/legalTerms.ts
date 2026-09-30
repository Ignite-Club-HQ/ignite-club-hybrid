import type { Identity } from "@icp-sdk/core/agent";
import { connectLiveIdentityAccessClientWithIdentity, isLiveIdentityAccessConfigured } from "./identityAccess";
import { getActiveIcpTarget, type IcpTargetConfig } from "./targetRegistry";

/**
 * Typed wrapper around identity_access's caller-scoped terms-acceptance
 * surface (`set_terms_acceptance` / `my_terms_acceptance` /
 * `get_terms_acceptance`) — the ICP counterpart of the Supabase
 * `profiles.terms_accepted_at` / `privacy_accepted_at` columns consumed by
 * `useLegalReacceptance`. Mirrors identityProfile.ts: this module pulls in
 * the ICP agent SDK, so import it dynamically, never statically.
 */

export interface IcpTermsAcceptance {
  accountId: string;
  termsVersion: number;
  acceptedAtMs: number;
}

function mapTermsAcceptance(raw: { account_id: string; terms_version: number; accepted_at_ms: bigint }): IcpTermsAcceptance {
  return {
    accountId: raw.account_id,
    termsVersion: raw.terms_version,
    acceptedAtMs: Number(raw.accepted_at_ms),
  };
}

/**
 * The caller's own terms acceptance, or `null` when they have never accepted
 * (first sign-in, or before the terms-acceptance feature existed for them).
 * Canister/network failures throw so callers don't silently treat an error as
 * "not accepted yet".
 */
export async function fetchMyIcpTermsAcceptance(
  identity: Identity,
  target: IcpTargetConfig = getActiveIcpTarget(),
): Promise<IcpTermsAcceptance | null> {
  if (!isLiveIdentityAccessConfigured(target)) {
    throw new Error(`Identity access canister is not configured for ICP target ${target.alias}.`);
  }
  const { client } = await connectLiveIdentityAccessClientWithIdentity(target, identity);
  try {
    const result = await client.myTermsAcceptance();
    return result.length === 0 ? null : mapTermsAcceptance(result[0]);
  } finally {
    client.dispose();
  }
}

/**
 * Records the caller's acceptance of a given terms version. The canister
 * enforces this is caller-scoped and monotonic (rejects a version lower than
 * a previously recorded one), so a stale client retrying an old version
 * fails rather than silently regressing the recorded acceptance.
 */
export async function setIcpTermsAcceptance(
  identity: Identity,
  termsVersion: number,
  target: IcpTargetConfig = getActiveIcpTarget(),
): Promise<IcpTermsAcceptance> {
  if (!isLiveIdentityAccessConfigured(target)) {
    throw new Error(`Identity access canister is not configured for ICP target ${target.alias}.`);
  }
  const { client } = await connectLiveIdentityAccessClientWithIdentity(target, identity);
  try {
    const result = await client.setTermsAcceptance(termsVersion);
    return mapTermsAcceptance(result);
  } finally {
    client.dispose();
  }
}

/**
 * Owner/governor-gated lookup of another account's terms acceptance (admin
 * surfaces only — the canister rejects callers who are neither the account
 * owner nor the governor).
 */
export async function fetchIcpTermsAcceptanceFor(
  identity: Identity,
  accountId: string,
  target: IcpTargetConfig = getActiveIcpTarget(),
): Promise<IcpTermsAcceptance | null> {
  if (!isLiveIdentityAccessConfigured(target)) {
    throw new Error(`Identity access canister is not configured for ICP target ${target.alias}.`);
  }
  const { client } = await connectLiveIdentityAccessClientWithIdentity(target, identity);
  try {
    const result = await client.getTermsAcceptance(accountId);
    return result.length === 0 ? null : mapTermsAcceptance(result[0]);
  } finally {
    client.dispose();
  }
}
