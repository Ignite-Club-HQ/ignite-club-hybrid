import { withFeatureBackend } from "@/live/featureRouter";

export async function readIcpActiveBoards(teamId?: string) {
  const ids = teamId ? [teamId] : await withFeatureBackend("membership", {
    supabase: async (): Promise<string[]> => { throw new Error("Internet Identity required"); },
    icp: async ctx => {
      const { getLiveMyRoleGrants } = await import("@/live/features/membership");
      return [...new Set((await getLiveMyRoleGrants(ctx)).flatMap(role => role.team))];
    },
  }, { shared: "person" });
  const boards = await Promise.all(ids.map(id => withFeatureBackend("events", {
    supabase: async () => { throw new Error("Internet Identity required"); },
    icp: async ctx => {
      const { readMembershipInScope } = await import("@/live/membershipRouting");
      const { listLiveTeamRoleGrants } = await import("@/live/features/membership");
      await readMembershipInScope(ctx, { teamId: id }, scoped => listLiveTeamRoleGrants(scoped, id));
      const [{ getLiveActiveGame }, { getLiveTeam, getLiveClubProfile }] = await Promise.all([
        import("@/live/features/events"), import("@/live/features/club"),
      ]);
      const [board] = await getLiveActiveGame(ctx, id);
      if (!board || board.is_active !== true) return null;
      const [team] = await getLiveTeam(ctx, id);
      if (!team) return null;
      const [club] = await getLiveClubProfile(ctx, team.club_id);
      const decode = (value: unknown): Record<string, unknown> => {
        if (typeof value !== "string") return {};
        try { const parsed: unknown = JSON.parse(value); return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}; }
        catch { return {}; }
      };
      return { id, team_id: id, updated_at: new Date(Number(board.updated_at_ms)).toISOString(),
        pitch_state: decode(board.pitch_state_json), timer_state: decode(board.timer_state_json),
        teams: { id, name: team.name, club_id: team.club_id, clubs: { sport: club?.sport[0] ?? null } } };
    },
  }, { teamId: id })));
  return boards.filter(board => board !== null).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}