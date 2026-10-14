ALTER TABLE public.vault_folders
  ADD COLUMN IF NOT EXISTS competition_id uuid REFERENCES public.competitions(id) ON DELETE CASCADE;

ALTER TABLE public.vault_files
  ADD COLUMN IF NOT EXISTS competition_id uuid REFERENCES public.competitions(id) ON DELETE CASCADE;

INSERT INTO storage.buckets (id, name, public)
VALUES ('competition-vault', 'competition-vault', false)
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE INDEX IF NOT EXISTS vault_folders_competition_scope_idx
  ON public.vault_folders (competition_id, parent_id)
  WHERE competition_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS vault_files_competition_scope_idx
  ON public.vault_files (competition_id, folder_id, created_at DESC)
  WHERE competition_id IS NOT NULL AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.can_access_competition_vault(_competition_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1
      FROM public.competition_roles cr
      WHERE cr.competition_id = _competition_id
        AND cr.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.competitions c
      JOIN public.user_roles ur ON ur.club_id = c.organizer_club_id
      WHERE c.id = _competition_id
        AND ur.user_id = auth.uid()
        AND ur.role = 'club_admin'
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
                cp.profile_id = auth.uid()
                OR EXISTS (
                  SELECT 1 FROM public.children c
                  WHERE c.id = cp.child_id AND c.parent_id = auth.uid()
                )
                OR EXISTS (
                  SELECT 1 FROM public.child_guardians cg
                  WHERE cg.child_id = cp.child_id AND cg.guardian_id = auth.uid()
                )
              )
          )
          OR EXISTS (
            SELECT 1 FROM public.child_team_assignments cta
            JOIN public.children c ON c.id = cta.child_id
            WHERE cta.team_id = e.team_id
              AND (
                c.parent_id = auth.uid()
                OR EXISTS (
                  SELECT 1 FROM public.child_guardians cg
                  WHERE cg.child_id = c.id AND cg.guardian_id = auth.uid()
                )
              )
          )
          OR EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.team_id = e.team_id
              AND ur.role IN ('team_admin', 'coach')
          )
          OR EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.club_id = t.club_id
              AND ur.role = 'club_admin'
          )
        )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_competition_vault(_competition_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.competition_roles cr
      WHERE cr.competition_id = _competition_id
        AND cr.user_id = auth.uid()
        AND cr.role IN ('competition_admin', 'admin', 'owner')
    )
    OR EXISTS (
      SELECT 1
      FROM public.competitions c
      JOIN public.user_roles ur ON ur.club_id = c.organizer_club_id
      WHERE c.id = _competition_id
        AND ur.user_id = auth.uid()
        AND ur.role = 'club_admin'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.competition_vault_storage_access(_object_name text, _manage boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competition_id uuid;
  v_club_id uuid;
BEGIN
  IF split_part(_object_name, '/', 1) <> 'clubs'
    OR split_part(_object_name, '/', 3) <> 'competitions'
    OR split_part(_object_name, '/', 2) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR split_part(_object_name, '/', 4) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN
    RETURN false;
  END IF;

  v_club_id := split_part(_object_name, '/', 2)::uuid;
  v_competition_id := split_part(_object_name, '/', 4)::uuid;

  RETURN EXISTS (
    SELECT 1
    FROM public.competitions c
    WHERE c.id = v_competition_id
      AND c.organizer_club_id = v_club_id
      AND CASE
        WHEN _manage THEN public.can_manage_competition_vault(c.id)
        ELSE public.can_access_competition_vault(c.id)
      END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_competition_vault(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_competition_vault(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.competition_vault_storage_access(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_competition_vault(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_competition_vault(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.competition_vault_storage_access(text, boolean) TO authenticated;

CREATE POLICY competition_vault_objects_select_grant
ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
USING (
  bucket_id = 'competition-vault'
  AND public.competition_vault_storage_access(name, false)
);

CREATE POLICY competition_vault_objects_insert_grant
ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'competition-vault'
  AND public.competition_vault_storage_access(name, true)
);

CREATE POLICY competition_vault_objects_update_grant
ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
USING (
  bucket_id = 'competition-vault'
  AND public.competition_vault_storage_access(name, true)
)
WITH CHECK (
  bucket_id = 'competition-vault'
  AND public.competition_vault_storage_access(name, true)
);

CREATE POLICY competition_vault_objects_delete_grant
ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
USING (
  bucket_id = 'competition-vault'
  AND public.competition_vault_storage_access(name, true)
);

CREATE POLICY competition_vault_objects_select
ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  bucket_id <> 'competition-vault'
  OR public.competition_vault_storage_access(name, false)
);

CREATE POLICY competition_vault_objects_insert
ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (
  bucket_id <> 'competition-vault'
  OR public.competition_vault_storage_access(name, true)
);

CREATE POLICY competition_vault_objects_update
ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
USING (
  bucket_id <> 'competition-vault'
  OR public.competition_vault_storage_access(name, true)
)
WITH CHECK (
  bucket_id <> 'competition-vault'
  OR public.competition_vault_storage_access(name, true)
);

CREATE POLICY competition_vault_objects_delete
ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
USING (
  bucket_id <> 'competition-vault'
  OR public.competition_vault_storage_access(name, true)
);

CREATE POLICY vault_folders_competition_select_grant
ON public.vault_folders AS PERMISSIVE FOR SELECT TO authenticated
USING (
  competition_id IS NOT NULL
  AND public.can_access_competition_vault(competition_id)
);

CREATE POLICY vault_folders_competition_insert_grant
ON public.vault_folders AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (
  competition_id IS NOT NULL
  AND public.can_manage_competition_vault(competition_id)
);

CREATE POLICY vault_folders_competition_update_grant
ON public.vault_folders AS PERMISSIVE FOR UPDATE TO authenticated
USING (
  competition_id IS NOT NULL
  AND public.can_manage_competition_vault(competition_id)
)
WITH CHECK (
  competition_id IS NOT NULL
  AND public.can_manage_competition_vault(competition_id)
);

CREATE POLICY vault_folders_competition_delete_grant
ON public.vault_folders AS PERMISSIVE FOR DELETE TO authenticated
USING (
  competition_id IS NOT NULL
  AND public.can_manage_competition_vault(competition_id)
);

CREATE POLICY vault_folders_competition_select
ON public.vault_folders AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  competition_id IS NULL
  OR public.can_access_competition_vault(competition_id)
);

CREATE POLICY vault_folders_competition_insert
ON public.vault_folders AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (
  competition_id IS NULL
  OR (
    public.can_manage_competition_vault(competition_id)
    AND club_id = (
      SELECT c.organizer_club_id FROM public.competitions c WHERE c.id = competition_id
    )
    AND (
      parent_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.vault_folders parent
        WHERE parent.id = parent_id
          AND parent.club_id = club_id
          AND parent.competition_id = competition_id
      )
    )
  )
);

CREATE POLICY vault_folders_competition_update
ON public.vault_folders AS RESTRICTIVE FOR UPDATE TO authenticated
USING (
  competition_id IS NULL
  OR public.can_manage_competition_vault(competition_id)
)
WITH CHECK (
  competition_id IS NULL
  OR (
    public.can_manage_competition_vault(competition_id)
    AND club_id = (
      SELECT c.organizer_club_id FROM public.competitions c WHERE c.id = competition_id
    )
    AND (
      parent_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.vault_folders parent
        WHERE parent.id = parent_id
          AND parent.club_id = club_id
          AND parent.competition_id = competition_id
      )
    )
  )
);

CREATE POLICY vault_folders_competition_delete
ON public.vault_folders AS RESTRICTIVE FOR DELETE TO authenticated
USING (
  competition_id IS NULL
  OR public.can_manage_competition_vault(competition_id)
);

CREATE POLICY vault_files_competition_select_grant
ON public.vault_files AS PERMISSIVE FOR SELECT TO authenticated
USING (
  competition_id IS NOT NULL
  AND public.can_access_competition_vault(competition_id)
);

CREATE POLICY vault_files_competition_insert_grant
ON public.vault_files AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (
  competition_id IS NOT NULL
  AND public.can_manage_competition_vault(competition_id)
);

CREATE POLICY vault_files_competition_update_grant
ON public.vault_files AS PERMISSIVE FOR UPDATE TO authenticated
USING (
  competition_id IS NOT NULL
  AND public.can_manage_competition_vault(competition_id)
)
WITH CHECK (
  competition_id IS NOT NULL
  AND public.can_manage_competition_vault(competition_id)
);

CREATE POLICY vault_files_competition_delete_grant
ON public.vault_files AS PERMISSIVE FOR DELETE TO authenticated
USING (
  competition_id IS NOT NULL
  AND public.can_manage_competition_vault(competition_id)
);

CREATE POLICY vault_files_competition_select
ON public.vault_files AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  competition_id IS NULL
  OR public.can_access_competition_vault(competition_id)
);

CREATE POLICY vault_files_competition_insert
ON public.vault_files AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (
  competition_id IS NULL
  OR (
    public.can_manage_competition_vault(competition_id)
    AND club_id = (
      SELECT c.organizer_club_id FROM public.competitions c WHERE c.id = competition_id
    )
    AND (
      folder_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.vault_folders folder
        WHERE folder.id = folder_id
          AND folder.club_id = club_id
          AND folder.competition_id = competition_id
      )
    )
  )
);

CREATE POLICY vault_files_competition_update
ON public.vault_files AS RESTRICTIVE FOR UPDATE TO authenticated
USING (
  competition_id IS NULL
  OR public.can_manage_competition_vault(competition_id)
)
WITH CHECK (
  competition_id IS NULL
  OR (
    public.can_manage_competition_vault(competition_id)
    AND club_id = (
      SELECT c.organizer_club_id FROM public.competitions c WHERE c.id = competition_id
    )
    AND (
      folder_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.vault_folders folder
        WHERE folder.id = folder_id
          AND folder.club_id = club_id
          AND folder.competition_id = competition_id
      )
    )
  )
);

CREATE POLICY vault_files_competition_delete
ON public.vault_files AS RESTRICTIVE FOR DELETE TO authenticated
USING (
  competition_id IS NULL
  OR public.can_manage_competition_vault(competition_id)
);