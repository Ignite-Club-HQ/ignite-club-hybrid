import { connectLiveClubDomain } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import { routingActive } from "../generalActivation";
import { readOwnerTestRoute } from '../ownerTestRouting';

type Grant = Awaited<ReturnType<Awaited<ReturnType<typeof connectLiveClubDomain>>["actor"]["my_role_grants"]>>[number];

async function rawGrants(ctx: FeatureBackendContext): Promise<Grant[]> {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return actor.my_role_grants();
}

/** Key identifying one grant so the shared and group copies of the same
 * grant (during a move) count once. */
const grantKey = (g: Grant) => `${g.role}|${g.club?.[0] ?? ""}|${g.team?.[0] ?? ""}`;

/** Combine grant lists from the shared canisters and each group, dropping duplicates. */
export function mergeRoleGrants(parts: Grant[][]): Grant[] {
  const seen = new Set<string>(); const out: Grant[] = [];
  for (const g of parts.flat()) { const k = grantKey(g); if (!seen.has(k)) { seen.add(k); out.push(g); } }
  return out;
}

/**
 * The caller's role grants across every club. Roles live with each club, so
 * once group routing is on a moved club's roles sit in its group's
 * club_domain: ask the shared canister and every group the caller belongs to
 * at once and merge. Routing off (shipped): one shared call, as before.
 */
export async function fetchMyRoleGrantsEverywhere(ctx: FeatureBackendContext): Promise<Grant[]> {
  if (!await routingActive(ctx) && !await readOwnerTestRoute(ctx)) return rawGrants(ctx);
  const { clubDispatch } = await import("../groupDispatch");
  return clubDispatch.readAcross("membership", "club_domain", rawGrants, mergeRoleGrants);
}
