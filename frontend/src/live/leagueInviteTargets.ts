import type { FeatureBackendContext } from './featureRouter';
import { withFeatureBackend } from './featureRouter';
import { readMembershipInScope } from './membershipRouting';
import { mergeMiniLeagueRows } from './miniLeagueRouting';
import { readLeagueClub, readManageableLeagues } from './leagueReads';

/** Optional sections never hold the sheet open: bounded and failure-tolerant. */
function optional<T>(p: Promise<T[]>, ms = 8000): Promise<T[]> {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve([]), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve([]); });
  });
}

// Home warms this quietly so the Invite sheet opens with its answer ready.
// Memory only, per signed-in principal, briefly reused.
const WARM_MS = 2 * 60_000;
let warm: { key: string; at: number; read: Promise<Awaited<ReturnType<typeof readInviteTargetsNow>>> } | null = null;
export function readLiveInviteTargets(ctx: FeatureBackendContext) {
  const key = ctx.identity.getPrincipal().toText();
  if (warm && warm.key === key && Date.now() - warm.at < WARM_MS) return warm.read;
  const read = readInviteTargetsNow(ctx);
  const entry = { key, at: Date.now(), read };
  warm = entry;
  read.catch(() => { if (warm === entry) warm = null; });
  return read;
}
export function __resetInviteTargetsWarm() { warm = null; }

async function readInviteTargetsNow(ctx: FeatureBackendContext) {
  const { getLiveMyRoleGrants } = await import('./features/membership');
  const grantsP = getLiveMyRoleGrants(ctx);
  const [grants, miniLeagues, competitions] = await Promise.all([
    grantsP,
    optional(
    withFeatureBackend('mini_leagues', {
      supabase: async () => { throw new Error('Internet Identity required'); },
      icp: readManageableLeagues,
    }, { everyGroup: true, merge: mergeMiniLeagueRows })),
    optional(withFeatureBackend('competitions', {
      supabase: async () => { throw new Error('Internet Identity required'); },
      icp: async scoped => (await import('./features/competitions')).listLiveMyNewsCompetitions(scoped),
    }, { everyGroup: true, merge: (parts) => [...new Map(parts.flat().map(row => [row.id, row])).values()] })),
  ]);
  const teamIds = [...new Set(grants.flatMap(g => g.team))];
  // A team grant already names its club: route straight there instead of
  // discovering each team across groups, and bound every read so one slow
  // service can never hold the sheet open.
  const clubOfTeam = new Map<string, string>();
  for (const g of grants) if (g.team[0] && g.club[0]) clubOfTeam.set(g.team[0], g.club[0]);
  const bounded = <T,>(p: Promise<T>, ms = 10_000) => new Promise<T | null>(resolve => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
  const grantClubIds = [...new Set(grants.flatMap(g => g.club))];
  const clubRead = new Map<string, Promise<Awaited<ReturnType<typeof readLeagueClub>> | null>>();
  const readClub = (id: string) => {
    let p = clubRead.get(id);
    if (!p) { p = bounded(readLeagueClub(ctx, id)); clubRead.set(id, p); }
    return p;
  };
  grantClubIds.forEach(readClub);
  const teams = (await Promise.all(teamIds.map(teamId => bounded(readMembershipInScope(ctx,
    clubOfTeam.has(teamId) ? { clubId: clubOfTeam.get(teamId)! } : { teamId },
    async scoped => (await (await import('./features/club')).getLiveTeam(scoped, teamId))[0] ?? null,
  ))))).filter(t => t?.is_active);
  const clubIds = [...new Set([
    ...grantClubIds, ...miniLeagues.map(l => l.club_id),
    ...teams.flatMap(t => t ? [t.club_id] : []), ...competitions.flatMap(c => c.club_id ? [c.club_id] : []),
  ])];
  const clubs = (await Promise.all(clubIds.map(readClub)))
    .filter(c => c?.is_active).map(c => ({ id: c?.id ?? '', name: c?.name ?? '' }));
  const names = new Map(clubs.map(c => [c.id, c.name]));
  return {
    clubs: clubs.sort((a, b) => a.name.localeCompare(b.name)),
    teams: teams.flatMap(t => t ? [{ ...t, clubs: { id: t.club_id, name: names.get(t.club_id) ?? '' } }] : []).sort((a, b) => a.name.localeCompare(b.name)),
    miniLeagues: miniLeagues.sort((a, b) => a.name.localeCompare(b.name)),
    competitions: competitions.map(c => ({ ...c, organizer_club_id: c.club_id, organizer_club: { name: names.get(c.club_id) ?? '' } })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}