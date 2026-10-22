import { connectLiveClubDomain } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import { routingActive } from "../generalActivation";
import { readOwnerTestRoute } from '../ownerTestRouting';
import { isScopedContext } from '../scopedContext';

type Grant = Awaited<ReturnType<Awaited<ReturnType<typeof connectLiveClubDomain>>["actor"]["my_role_grants"]>>[number];

// Short shared memo: one page asks for grants from several lists at once;
// they must share one call per canister instead of repeating it.
const MEMO_MS = 30_000;
const memo = new Map<string, { at: number; value: Promise<Grant[]> }>();
export function clearRoleGrantsMemo() { memo.clear(); }
function memoized(key: string, run: () => Promise<Grant[]>): Promise<Grant[]> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.value;
  const value = run(); memo.set(key, { at: Date.now(), value });
  value.catch(() => { if (memo.get(key)?.value === value) memo.delete(key); });
  return value;
}
const who = (ctx: FeatureBackendContext) => { try { return ctx.identity.getPrincipal().toText(); } catch { return '?'; } };
async function rawGrants(ctx: FeatureBackendContext): Promise<Grant[]> {
  return memoized(`raw|${who(ctx)}|${ctx.target?.canisterIds?.club_domain ?? ''}`, async () => {
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
  return memoized(`all|${who(ctx)}`, () => clubDispatch.readAcross("membership", "club_domain", rawGrants, mergeRoleGrants));
}
