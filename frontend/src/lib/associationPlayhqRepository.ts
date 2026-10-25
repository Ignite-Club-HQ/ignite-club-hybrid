import { withFeatureBackend } from "@/live/featureRouter";
import { writeOnce } from "@/live/clubScope";
import { connectLiveCompetitionDomain } from "@/live/domains";
import { candidOpt, unwrapCandid } from "@/live/features/candid";
const unavailable = async (): Promise<never> => { throw new Error("Internet Identity required"); };
export async function readIcpAssociationPlayhq(clubId: string) {
  return withFeatureBackend("competitions", { supabase: unavailable, icp: async ctx => {
    const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
    const rows = await unwrapCandid(actor.list_playhq_competitions(clubId), "Read linked PlayHQ competitions");
    return rows.map(({ competition, link }) => ({
      id: competition.id, name: competition.name, season: competition.season, status: competition.status,
      source: "playhq", sport: link.sport[0] ?? null, external_tenant: link.tenant, external_id: link.grade_id,
      last_synced_at: link.last_synced_at_ms[0] === undefined ? null : new Date(Number(link.last_synced_at_ms[0])).toISOString(),
    }));
  } }, { clubId });
}
export async function linkIcpAssociationPlayhq(input: { clubId: string; name: string; season: string; tenant: string; gradeId: string; sport: string | null }) {
  return withFeatureBackend("competitions", { supabase: unavailable, icp: async ctx => {
    const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
    return unwrapCandid(actor.link_playhq_competition(input.clubId, input.name.trim(), input.season.trim(), input.tenant.trim().toLowerCase(), input.gradeId.trim(), candidOpt(input.sport?.trim() || null)), "Link PlayHQ competition");
  } }, writeOnce({ clubId: input.clubId }));
}
export async function syncIcpAssociationPlayhq(clubId: string, competitionId: string, tenant: string, gradeId: string) {
  return withFeatureBackend("competitions", { supabase: unavailable, icp: async ctx => {
    const { actor } = await connectLiveCompetitionDomain(ctx.target, ctx.identity);
    return unwrapCandid(actor.sync_playhq_grade(competitionId, tenant, gradeId), "Sync linked PlayHQ competition");
  } }, writeOnce({ clubId }));
}