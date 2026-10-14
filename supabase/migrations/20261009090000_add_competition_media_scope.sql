ALTER TABLE public.photos
  ADD COLUMN IF NOT EXISTS competition_id uuid REFERENCES public.competitions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS photos_competition_created_at_idx
  ON public.photos (competition_id, created_at DESC)
  WHERE competition_id IS NOT NULL AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.is_competition_media_member(_user_id uuid, _competition_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.competitions c
    WHERE c.id = _competition_id
      AND (
        EXISTS (
          SELECT 1 FROM public.competition_roles cr
          WHERE cr.competition_id = c.id
            AND cr.user_id = _user_id
            AND cr.role IN ('owner', 'admin', 'referee', 'committee_member')
        )
        OR EXISTS (
          SELECT 1
          FROM public.competition_entries ce
          JOIN public.user_roles ur ON ur.team_id = ce.team_id
          WHERE ce.competition_id = c.id
            AND ce.status IN ('accepted', 'registered')
            AND ur.user_id = _user_id
            AND ur.role IN ('player', 'parent', 'coach', 'team_admin', 'club_admin', 'committee_member')
        )
        OR public.has_role(_user_id, 'club_admin'::public.app_role, c.organizer_club_id, NULL::uuid)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_competition_media_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_competition_media_member(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS photos_competition_scope_select ON public.photos;
CREATE POLICY photos_competition_scope_select
  ON public.photos AS RESTRICTIVE FOR SELECT TO authenticated
  USING (competition_id IS NULL OR public.is_competition_media_member((SELECT auth.uid()), competition_id));

DROP POLICY IF EXISTS photos_competition_scope_insert ON public.photos;
CREATE POLICY photos_competition_scope_insert
  ON public.photos AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    competition_id IS NULL
    OR (uploader_id = (SELECT auth.uid()) AND public.is_competition_media_member((SELECT auth.uid()), competition_id))
  );

DROP POLICY IF EXISTS photos_competition_scope_update ON public.photos;
CREATE POLICY photos_competition_scope_update
  ON public.photos AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (competition_id IS NULL OR public.is_competition_media_member((SELECT auth.uid()), competition_id))
  WITH CHECK (competition_id IS NULL OR public.is_competition_media_member((SELECT auth.uid()), competition_id));