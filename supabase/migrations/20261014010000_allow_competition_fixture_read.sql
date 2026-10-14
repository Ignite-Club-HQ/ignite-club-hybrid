CREATE OR REPLACE FUNCTION public.can_view_competition_fixture_event(_match_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.competition_matches cm
    JOIN public.competitions competition ON competition.id = cm.competition_id
    WHERE cm.id = _match_id
      AND (
        EXISTS (
          SELECT 1 FROM public.competition_roles role
          WHERE role.competition_id = competition.id
            AND role.user_id = auth.uid()
            AND role.role IN ('owner', 'admin')
        )
        OR EXISTS (
          SELECT 1 FROM public.user_roles role
          WHERE role.club_id = competition.organizer_club_id
            AND role.user_id = auth.uid()
            AND role.role = 'league_admin'
        )
      )
  );
$$;

  CREATE OR REPLACE FUNCTION public.get_my_viewable_competition_match_ids()
  RETURNS TABLE (match_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT cm.id
    FROM public.competition_matches cm
    JOIN public.competitions competition ON competition.id = cm.competition_id
    WHERE auth.uid() IS NOT NULL
      AND (
        EXISTS (
          SELECT 1 FROM public.competition_roles cr
          WHERE cr.competition_id = competition.id
            AND cr.user_id = auth.uid()
            AND cr.role IN ('owner', 'admin')
        )
        OR EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.club_id = competition.organizer_club_id
            AND ur.user_id = auth.uid()
            AND ur.role = 'league_admin'
        )
      );
  $$;

REVOKE ALL ON FUNCTION public.can_view_competition_fixture_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_competition_fixture_event(uuid) TO authenticated;
  REVOKE ALL ON FUNCTION public.get_my_viewable_competition_match_ids() FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.get_my_viewable_competition_match_ids() TO authenticated;

CREATE POLICY competition_admins_read_fixture_events
ON public.events AS PERMISSIVE FOR SELECT TO authenticated
USING (
  competition_match_id IS NOT NULL
  AND public.can_view_competition_fixture_event(competition_match_id)
);