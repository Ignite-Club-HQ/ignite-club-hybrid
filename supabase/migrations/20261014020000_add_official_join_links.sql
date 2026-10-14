CREATE TABLE public.competition_role_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('referee', 'committee_member')),
  token text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE UNIQUE INDEX competition_role_links_one_active_per_role
  ON public.competition_role_links (competition_id, role)
  WHERE revoked_at IS NULL;

ALTER TABLE public.competition_role_links ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.competition_role_links TO authenticated;

CREATE POLICY competition_role_links_select_manager
ON public.competition_role_links AS PERMISSIVE FOR SELECT TO authenticated
USING (public.is_competition_admin(auth.uid(), competition_id));

CREATE POLICY competition_role_links_insert_manager
ON public.competition_role_links AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND public.is_competition_admin(auth.uid(), competition_id)
);

CREATE POLICY competition_role_links_update_manager
ON public.competition_role_links AS PERMISSIVE FOR UPDATE TO authenticated
USING (public.is_competition_admin(auth.uid(), competition_id))
WITH CHECK (
  created_by = auth.uid()
  AND public.is_competition_admin(auth.uid(), competition_id)
);

CREATE OR REPLACE FUNCTION public.get_competition_role_link_status(p_token text)
RETURNS TABLE(status text, competition_id uuid, competition_name text, organizer_club_id uuid, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN c.id IS NULL THEN 'invalid'
      WHEN c.status = 'archived' THEN 'archived'
      ELSE 'valid'
    END,
    c.id,
    c.name,
    c.organizer_club_id,
    link.role
  FROM public.competition_role_links link
  LEFT JOIN public.competitions c ON c.id = link.competition_id
  WHERE link.token = p_token
    AND link.revoked_at IS NULL
  UNION ALL
  SELECT 'invalid', NULL::uuid, NULL::text, NULL::uuid, NULL::text
  WHERE NOT EXISTS (
    SELECT 1 FROM public.competition_role_links link
    WHERE link.token = p_token AND link.revoked_at IS NULL
  )
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.accept_competition_role_link(p_token text)
RETURNS TABLE(status text, competition_id uuid, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_link public.competition_role_links%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_link
  FROM public.competition_role_links
  WHERE token = p_token AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.competitions
    WHERE id = v_link.competition_id AND status <> 'archived'
  ) THEN
    RETURN QUERY SELECT 'archived'::text, v_link.competition_id, v_link.role;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.competition_roles
    WHERE competition_id = v_link.competition_id
      AND user_id = v_user_id
      AND role = v_link.role
  ) THEN
    RETURN QUERY SELECT 'already'::text, v_link.competition_id, v_link.role;
    RETURN;
  END IF;

  INSERT INTO public.competition_roles (competition_id, user_id, role)
  VALUES (v_link.competition_id, v_user_id, v_link.role);

  INSERT INTO public.notifications (user_id, type, message, related_id, club_id)
  SELECT v_user_id, 'membership',
    'You joined as a ' || CASE v_link.role WHEN 'referee' THEN 'referee' ELSE 'committee member' END || ' for ' || c.name,
    c.id, c.organizer_club_id
  FROM public.competitions c WHERE c.id = v_link.competition_id;

  RETURN QUERY SELECT 'joined'::text, v_link.competition_id, v_link.role;
END;
$$;

REVOKE ALL ON FUNCTION public.get_competition_role_link_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_competition_role_link_status(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_competition_role_link(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_competition_role_link(text) TO authenticated;