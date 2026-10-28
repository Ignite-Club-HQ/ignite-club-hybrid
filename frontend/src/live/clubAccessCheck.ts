/** Read-only, signed-in self check of each step the app uses to build the
 * caller's club list. Shows only the caller's own counts and error text; it
 * never writes, grants or widens access. Caches are cleared first so the
 * answer reflects the live services, not a saved list. */
import type { FeatureBackendContext } from './featureRouter';

export type ClubAccessStep = { name: string; ok: boolean; detail: string; ms: number };

const short = (e: unknown) => String((e as Error)?.message ?? e).replace(/\s+/g, ' ').slice(0, 220);

export async function runClubAccessCheck(): Promise<ClubAccessStep[]> {
  const steps: ClubAccessStep[] = [];
  const step = async (name: string, fn: () => Promise<string>) => {
    const t = Date.now();
    try { steps.push({ name, ok: true, detail: await fn(), ms: Date.now() - t }); }
    catch (e) { steps.push({ name, ok: false, detail: short(e), ms: Date.now() - t }); }
  };
  const [{ getCurrentInternetIdentityConfirmed }, { getActiveIcpTarget }, { clearRoleGrantsMemo }, { clearGroupDispatchCache }, { clearGeneralRoutingCache }] = await Promise.all([
    import('./internetIdentityAuth'), import('./targetRegistry'), import('./roleGrantsMemo'), import('./groupDispatch'), import('./generalActivation'),
  ]);
  const identity = await getCurrentInternetIdentityConfirmed(3, 1000);
  if (!identity) return [{ name: 'Sign-in', ok: false, detail: 'Not signed in with Internet Identity', ms: 0 }];
  const ctx: FeatureBackendContext = { identity, target: getActiveIcpTarget() };
  steps.push({ name: 'Sign-in ID', ok: true, detail: identity.getPrincipal().toText(), ms: 0 });
  clearRoleGrantsMemo(); clearGroupDispatchCache(); clearGeneralRoutingCache();

  await step('Original club service roles', async () => {
    const { connectLiveClubDomain } = await import('./domains');
    const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
    const grants = await actor.my_role_grants();
    return `${grants.length} role(s) in ${new Set(grants.map(g => g.club?.[0]).filter(Boolean)).size} club(s)`;
  });
  let routing = false;
  await step('Group routing', async () => {
    const { generalRoutingStatus } = await import('./generalActivation');
    routing = (await generalRoutingStatus(ctx)).active;
    return routing ? 'on' : 'off';
  });
  if (routing) {
    await step('Group session', async () => {
      const paths: string[] = [];
      const info = console.info;
      console.info = (...args: unknown[]) => {
        if (args[0] === '[Membership discovery]') paths.push(String((args[1] as { path?: string })?.path));
        info(...args);
      };
      try {
        const { openLiveGroupReadSession } = await import('./groupSessionLive');
        const s = await openLiveGroupReadSession(ctx);
        s.dispose();
        return `opened (${paths.join(' → ') || 'no path'})`;
      } catch (e) { throw new Error(`${short(e)}${paths.length ? ` [${paths.join(' → ')}]` : ''}`); }
      finally { console.info = info; }
    });
    clearGroupDispatchCache();
  }
  await step('All roles across groups', async () => {
    const { fetchMyRoleGrantsEverywhere } = await import('./features/myRoleGrants');
    const grants = await fetchMyRoleGrantsEverywhere(ctx);
    return `${grants.length} role(s) in ${new Set(grants.map(g => g.club?.[0]).filter(Boolean)).size} club(s)`;
  });
  await step('Club details', async () => {
    const { listMyClubsAcrossGroups } = await import('./crossGroupClubs');
    const r = await listMyClubsAcrossGroups(ctx);
    return `${r.values.length} club(s) loaded${r.failed ? `, ${r.failed} failed` : ''}`;
  });
  clearRoleGrantsMemo(); clearGroupDispatchCache();
  return steps;
}
