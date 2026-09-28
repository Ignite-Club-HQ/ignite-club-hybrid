export async function fetchPendingInviteByToken(client: any, token: string) {
  const { data, error } = await client.rpc("get_pending_invite_by_token", {
    _token: token,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function fetchTeamInviteByToken(client: any, token: string) {
  const { data, error } = await client.rpc("get_team_invite_by_token", {
    _token: token,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;

  return {
    id: row.id,
    team_id: row.team_id,
    role: row.role,
    token: row.token,
    uses_count: row.uses_count,
    max_uses: row.max_uses,
    expires_at: row.expires_at,
    created_at: row.created_at,
    created_by: row.created_by,
    metadata: row.metadata as {
      child_name?: string;
      child_year_of_birth?: number;
    } | null,
    teams: {
      id: row.team_id,
      name: row.team_name,
      logo_url: row.team_logo_url,
      club_id: row.club_id,
      clubs: {
        name: row.club_name,
        logo_url: undefined as string | undefined,
      },
    },
  };
}
