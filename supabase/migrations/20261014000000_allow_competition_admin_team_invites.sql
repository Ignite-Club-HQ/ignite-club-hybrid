CREATE OR REPLACE FUNCTION public.can_invite_players_to_team(_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.teams team
    WHERE team.id = _team_id
      AND team.is_archived = false
      AND team.deleted_at IS NULL
      AND team.is_shell = false
      AND team.lifecycle_status <> 'archived'
      AND (
        EXISTS (
          SELECT 1 FROM public.team_captains captain
          WHERE captain.team_id = team.id
            AND captain.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.competition_entries entry
          JOIN public.competition_roles role
            ON role.competition_id = entry.competition_id
          WHERE entry.team_id = team.id
            AND entry.status IN ('accepted', 'registered')
            AND role.user_id = auth.uid()
            AND role.role IN ('owner', 'admin')
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_invite_players_to_team(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_invite_players_to_team(uuid) TO authenticated;

CREATE POLICY competition_admin_team_invites_select
ON public.team_invites AS PERMISSIVE FOR SELECT TO authenticated
USING (
  role IN ('player', 'parent')
  AND public.can_invite_players_to_team(team_id)
);

CREATE POLICY competition_admin_team_invites_insert
ON public.team_invites AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND role IN ('player', 'parent')
  AND public.can_invite_players_to_team(team_id)
);

CREATE POLICY competition_admin_team_invites_delete
ON public.team_invites AS PERMISSIVE FOR DELETE TO authenticated
USING (
  role IN ('player', 'parent')
  AND public.can_invite_players_to_team(team_id)
);

CREATE POLICY competition_admin_team_roster_insert
ON public.user_roles AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (
  role IN ('player'::public.app_role, 'parent'::public.app_role)
  AND team_id IS NOT NULL
  AND club_id = (SELECT team.club_id FROM public.teams team WHERE team.id = user_roles.team_id)
  AND public.can_invite_players_to_team(team_id)
);