/**
 * Team/club metadata lookups for Internet Identity (ICP) sessions. Pages that
 * show team or club names must not read Supabase in ICP mode — the rows live
 * on club_domain. All ICP modules are loaded lazily (entry-chunk rule).
 */
import { resolveAuthBackend } from "@/live/authBackendMode";

export function isIcpSession(): boolean {
  return resolveAuthBackend() === "icp";
}

async function icpCtx() {
  const [{ getCurrentInternetIdentity }, { getActiveIcpTarget }, club] = await Promise.all([
    import("@/live/internetIdentityAuth"),
    import("@/live/targetRegistry"),
    import("@/live/features/club"),
  ]);
  const identity = await getCurrentInternetIdentity();
  if (!identity) throw new Error("Internet Identity session required");
  return { ctx: { identity, target: getActiveIcpTarget() } as any, club };
}

const opt = (v: any) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export async function icpGetTeam(teamId: string): Promise<{ id: string; name: string; club_id: string } | null> {
  const { ctx, club } = await icpCtx();
  const [t] = ((await club.getLiveTeam(ctx, teamId)) ?? []) as any[];
  return t ? { id: t.id, name: t.name, club_id: t.club_id } : null;
}

export async function icpGetClubName(clubId: string): Promise<string | null> {
  const { ctx, club } = await icpCtx();
  const [p] = ((await club.getLiveClubProfile(ctx, clubId).catch(() => [])) ?? []) as any[];
  return p?.name ?? null;
}

export async function icpListTeams(clubId: string): Promise<Array<{ id: string; name: string; folder_id: string | null }>> {
  const { ctx, club } = await icpCtx();
  const rows = ((await club.listLiveTeams(ctx, clubId)) ?? []) as any[];
  return rows
    .filter((t) => !opt(t.deleted_at))
    .map((t) => ({ id: t.id, name: t.name, folder_id: opt(t.folder_id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function icpListClubs(): Promise<Array<{ id: string; name: string }>> {
  const { ctx, club } = await icpCtx();
  const out: Array<{ id: string; name: string }> = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i++) {
    const page: any = await club.listLiveClubs(ctx, cursor, 100);
    const items: any[] = page?.items ?? page?.clubs ?? (Array.isArray(page) ? page : []);
    for (const c of items) if (!opt(c.deleted_at)) out.push({ id: c.id, name: c.name });
    cursor = opt(page?.next_cursor);
    if (!cursor || items.length === 0) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
