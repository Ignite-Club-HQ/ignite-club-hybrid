import { connectLiveClubDomain } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import { routingActive } from "../generalActivation";
import { readOwnerTestRoute } from '../ownerTestRouting';
import { isScopedContext } from '../scopedContext';
import { memoizedGrants } from '../roleGrantsMemo';

type Grant = Awaited<ReturnType<Awaited<ReturnType<typeof connectLiveClubDomain>>["actor"]["my_role_grants"]>>[number];

const who = (ctx: FeatureBackendContext) => { try { return ctx.identity.getPrincipal().toText(); } catch { return '?'; } };
async function rawGrants(ctx: FeatureBackendContext): Promise<Grant[]> {
  return memoizedGrants(`raw|${who(ctx)}|${ctx.target?.canisterIds?.club_domain ?? ''}`, async () => {
    const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
    return actor.my_role_grants();
  });
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
  // Inside one leg of a fan-out: this canister only (no nested fan-out).
  if (isScopedContext(ctx)) return rawGrants(ctx);
  if (!await routingActive(ctx) && !await readOwnerTestRoute(ctx)) return rawGrants(ctx);
  const { clubDispatch } = await import("../groupDispatch");
  return memoizedGrants(`all|${who(ctx)}`, async () => {
    const grants = await clubDispatch.readAcross("membership", "club_domain", rawGrants, mergeRoleGrants);
    // Team grants already name the team's club: record that so team-scoped
    // reads (events, names, chats) go straight to the club's group instead of
    // asking every group which one owns each team.
    const pairs = grants.flatMap((g) => (g.team?.[0] && g.club?.[0] ? [[g.team[0], g.club[0]] as const] : []));
    if (pairs.length && typeof clubDispatch.remember === "function") await clubDispatch.remember("team", pairs).catch(() => undefined);
    return grants;
  });
}
