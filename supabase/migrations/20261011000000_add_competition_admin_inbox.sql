CREATE OR REPLACE FUNCTION public.ensure_competition_admin_thread(_competition_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_group_id uuid;
  v_competition_name text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT name INTO v_competition_name
  FROM public.competitions
  WHERE id = _competition_id;
  IF v_competition_name IS NULL THEN
    RAISE EXCEPTION 'Competition not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.competition_roles
    WHERE competition_id = _competition_id
      AND role IN ('competition_admin', 'admin', 'owner')
  ) THEN
    RAISE EXCEPTION 'Competition admins are not configured';
  END IF;

  IF NOT (
    EXISTS (
      SELECT 1 FROM public.competition_roles
      WHERE competition_id = _competition_id AND user_id = v_user_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.competition_entries e
      JOIN public.teams t ON t.id = e.team_id
      WHERE e.competition_id = _competition_id
        AND e.status IN ('accepted', 'registered')
        AND (
          EXISTS (
            SELECT 1
            FROM public.team_memberships tm
            JOIN public.club_players cp ON cp.id = tm.club_player_id
            WHERE tm.team_id = e.team_id
              AND tm.status = 'active'
              AND tm.removed_at IS NULL
              AND cp.is_active
              AND (
                cp.profile_id = v_user_id
                OR EXISTS (
                  SELECT 1 FROM public.children c
                  WHERE c.id = cp.child_id AND c.parent_id = v_user_id
                )
                OR EXISTS (
                  SELECT 1 FROM public.child_guardians cg
                  WHERE cg.child_id = cp.child_id AND cg.guardian_id = v_user_id
                )
              )
          )
          OR EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = v_user_id
              AND ur.team_id = e.team_id
              AND ur.role IN ('team_admin', 'coach')
          )
           OR EXISTS (
             SELECT 1
             FROM public.child_team_assignments cta
             JOIN public.children c ON c.id = cta.child_id
             WHERE cta.team_id = e.team_id
               AND (
                 c.parent_id = v_user_id
                 OR EXISTS (
                   SELECT 1 FROM public.child_guardians cg
                   WHERE cg.child_id = c.id AND cg.guardian_id = v_user_id
                 )
               )
           )
          OR EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = v_user_id
              AND ur.club_id = t.club_id
              AND ur.role = 'club_admin'
          )
        )
    )
  ) THEN
    RAISE EXCEPTION 'Competition membership required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_competition_id::text || ':' || v_user_id::text, 0));

  SELECT id INTO v_group_id
  FROM public.chat_groups
  WHERE competition_id = _competition_id
    AND competition_scope = 'admin_contact'
    AND created_by = v_user_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_group_id IS NULL THEN
    INSERT INTO public.chat_groups (
      name,
      created_by,
      competition_id,
      competition_scope,
      allowed_roles,
      membership_mode
    ) VALUES (
      v_competition_name || ' admins',
      v_user_id,
      _competition_id,
      'admin_contact',
      ARRAY[]::public.app_role[],
      'manual'
    )
    RETURNING id INTO v_group_id;
  END IF;

  DELETE FROM public.group_members gm
  WHERE gm.group_id = v_group_id
    AND gm.user_id <> v_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.competition_roles cr
      WHERE cr.competition_id = _competition_id
        AND cr.user_id = gm.user_id
        AND cr.role IN ('competition_admin', 'admin', 'owner')
    );

  INSERT INTO public.group_members (group_id, user_id, added_by)
  SELECT v_group_id, cr.user_id, v_user_id
  FROM public.competition_roles cr
  WHERE cr.competition_id = _competition_id
    AND cr.role IN ('competition_admin', 'admin', 'owner')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.group_members (group_id, user_id, added_by)
  VALUES (v_group_id, v_user_id, v_user_id)
  ON CONFLICT DO NOTHING;

  RETURN v_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_competition_admin_thread(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_competition_admin_thread(uuid) TO authenticated;