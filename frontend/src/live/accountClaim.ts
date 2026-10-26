import { Actor, HttpAgent, type Identity } from "@icp-sdk/core/agent";
import { ROUTING_GATES_SNAPSHOT } from "@/live/generated/routingGates";
import { DEPLOYED_MAINNET_CANISTER_IDS } from "@/live/generated/deployedCanisterIds";
import { GROUP_TESTED_LIMITS } from "@/live/groupTestedLimits";
import { buildGroupSpecs } from "@/live/groupUtilization";

/**
 * One-time account claim for clubs moving from Supabase to ICP. The token only
 * travels in the link's #fragment (never sent to servers or referrers) and in
 * sessionStorage across the Internet Identity sign-in; it is removed as soon as
 * the club service answers. The club service decides validity and binds the
 * signed-in principal — the browser grants nothing.
 */
const PENDING_KEY = "ignite.accountClaim.pending";
const TOKEN_RE = /^[0-9a-f]{64}$/;
const GROUP_RE = /^g\d+$/;

export type PendingClaim = { token: string; group: string };

export function parseClaimLink(search: string, hash: string): PendingClaim | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("t")?.trim().toLowerCase() ?? "";
  const group = new URLSearchParams(search).get("g")?.trim() ?? "";
  return TOKEN_RE.test(token) && GROUP_RE.test(group) ? { token, group } : null;
}

export function savePendingClaim(c: PendingClaim): void {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(c)); } catch { /* private mode: claim still works in this tab */ }
}

export function readPendingClaim(): PendingClaim | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null");
    return v && TOKEN_RE.test(v.token) && GROUP_RE.test(v.group) ? v : null;
  } catch { return null; }
}

export function clearPendingClaim(): void {
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
}

export function claimClubDomainId(group: string): string | null {
  const spec = buildGroupSpecs({ snapshot: ROUTING_GATES_SNAPSHOT ?? null, sharedCanisterIds: DEPLOYED_MAINNET_CANISTER_IDS, testedLimits: GROUP_TESTED_LIMITS })
    .groups.find((g) => g.id === group);
  return spec?.canisters.find((c) => c.key === "club_domain")?.canisterId ?? null;
}

const idl = ({ IDL }: { IDL: any }) => IDL.Service({
  redeem_account_claim: IDL.Func([IDL.Text], [IDL.Variant({ Ok: IDL.Record({ club_id: IDL.Text }), Err: IDL.Text })], []),
});

export async function redeemAccountClaim(identity: Identity, claim: PendingClaim, host = "https://icp-api.io"): Promise<{ clubId: string }> {
  const canisterId = claimClubDomainId(claim.group);
  if (!canisterId) throw new Error("This link points to a club service that isn't available.");
  const agent = await HttpAgent.create({ host, identity });
  const actor = Actor.createActor(idl, { agent, canisterId }) as unknown as {
    redeem_account_claim: (t: string) => Promise<{ Ok: { club_id: string } } | { Err: string }>;
  };
  const r = await actor.redeem_account_claim(claim.token);
  if ("Err" in r) throw new Error(r.Err);
  return { clubId: r.Ok.club_id };
}
