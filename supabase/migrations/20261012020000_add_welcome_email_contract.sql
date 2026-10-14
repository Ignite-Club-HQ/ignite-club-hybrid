CREATE TABLE public.welcome_email_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  competition_id uuid REFERENCES public.competitions(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  subject text NOT NULL DEFAULT 'Welcome to your team',
  message text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT welcome_email_settings_single_scope CHECK (
    (team_id IS NOT NULL) <> (competition_id IS NOT NULL)
  ),
  CONSTRAINT welcome_email_settings_subject_length CHECK (char_length(subject) BETWEEN 1 AND 160),
  CONSTRAINT welcome_email_settings_message_length CHECK (char_length(message) <= 4000)
);

CREATE UNIQUE INDEX welcome_email_settings_team_unique
  ON public.welcome_email_settings(team_id)
  WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX welcome_email_settings_competition_unique
  ON public.welcome_email_settings(competition_id)
  WHERE competition_id IS NOT NULL;

ALTER TABLE public.welcome_email_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY welcome_email_settings_team_read
  ON public.welcome_email_settings FOR SELECT TO authenticated
  USING (team_id IS NOT NULL AND public.can_manage_team_roster(team_id, auth.uid()));
CREATE POLICY welcome_email_settings_team_insert
  ON public.welcome_email_settings FOR INSERT TO authenticated
  WITH CHECK (team_id IS NOT NULL AND public.can_manage_team_roster(team_id, auth.uid()));
CREATE POLICY welcome_email_settings_team_update
  ON public.welcome_email_settings FOR UPDATE TO authenticated
  USING (team_id IS NOT NULL AND public.can_manage_team_roster(team_id, auth.uid()))
  WITH CHECK (team_id IS NOT NULL AND public.can_manage_team_roster(team_id, auth.uid()));
CREATE POLICY welcome_email_settings_team_delete
  ON public.welcome_email_settings FOR DELETE TO authenticated
  USING (team_id IS NOT NULL AND public.can_manage_team_roster(team_id, auth.uid()));

CREATE POLICY welcome_email_settings_competition_read
  ON public.welcome_email_settings FOR SELECT TO authenticated
  USING (competition_id IS NOT NULL AND public.is_competition_admin(auth.uid(), competition_id));
CREATE POLICY welcome_email_settings_competition_insert
  ON public.welcome_email_settings FOR INSERT TO authenticated
  WITH CHECK (competition_id IS NOT NULL AND public.is_competition_admin(auth.uid(), competition_id));
CREATE POLICY welcome_email_settings_competition_update
  ON public.welcome_email_settings FOR UPDATE TO authenticated
  USING (competition_id IS NOT NULL AND public.is_competition_admin(auth.uid(), competition_id))
  WITH CHECK (competition_id IS NOT NULL AND public.is_competition_admin(auth.uid(), competition_id));
CREATE POLICY welcome_email_settings_competition_delete
  ON public.welcome_email_settings FOR DELETE TO authenticated
  USING (competition_id IS NOT NULL AND public.is_competition_admin(auth.uid(), competition_id));

CREATE TABLE public.welcome_email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL UNIQUE,
  scope_kind text NOT NULL CHECK (scope_kind IN ('team', 'competition')),
  scope_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.welcome_email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.welcome_email_deliveries FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.welcome_email_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.is_welcome_email_recipient(
  _scope_kind text,
  _scope_id uuid,
  _recipient_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND auth.uid() = _recipient_user_id
    AND CASE _scope_kind
      WHEN 'team' THEN
        EXISTS (
          SELECT 1 FROM public.user_roles role
          WHERE role.team_id = _scope_id AND role.user_id = _recipient_user_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.team_memberships membership
          JOIN public.club_players player ON player.id = membership.club_player_id
          WHERE membership.team_id = _scope_id
            AND membership.status = 'active'
            AND membership.removed_at IS NULL
            AND player.is_active
            AND player.profile_id = _recipient_user_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.child_team_assignments assignment
          JOIN public.children child ON child.id = assignment.child_id
          WHERE assignment.team_id = _scope_id
            AND (
              child.parent_id = _recipient_user_id
              OR EXISTS (
                SELECT 1 FROM public.child_guardians guardian
                WHERE guardian.child_id = child.id
                  AND guardian.guardian_id = _recipient_user_id
              )
            )
        )
      WHEN 'competition' THEN public.can_access_competition_vault(_scope_id)
      ELSE false
    END;
$$;

CREATE OR REPLACE FUNCTION public.claim_welcome_email_delivery(
  _dedupe_key text,
  _scope_kind text,
  _scope_id uuid,
  _recipient_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  delivery_id uuid;
BEGIN
  INSERT INTO public.welcome_email_deliveries (
    dedupe_key, scope_kind, scope_id, recipient_user_id, status, attempts, locked_at
  ) VALUES (
    _dedupe_key, _scope_kind, _scope_id, _recipient_user_id, 'processing', 1, now()
  )
  ON CONFLICT (dedupe_key) DO UPDATE
    SET status = 'processing', attempts = welcome_email_deliveries.attempts + 1,
        locked_at = now(), updated_at = now(), last_error = NULL
    WHERE welcome_email_deliveries.status IN ('pending', 'failed')
       OR (welcome_email_deliveries.status = 'processing'
           AND welcome_email_deliveries.locked_at < now() - interval '10 minutes')
  RETURNING id INTO delivery_id;

  RETURN delivery_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_welcome_email_delivery(
  _delivery_id uuid,
  _sent boolean,
  _provider_message_id text DEFAULT NULL,
  _error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.welcome_email_deliveries
  SET status = CASE WHEN _sent THEN 'sent' ELSE 'failed' END,
      sent_at = CASE WHEN _sent THEN now() ELSE sent_at END,
      provider_message_id = CASE WHEN _sent THEN _provider_message_id ELSE provider_message_id END,
      last_error = CASE WHEN _sent THEN NULL ELSE left(COALESCE(_error, 'Delivery failed'), 500) END,
      locked_at = NULL,
      updated_at = now()
  WHERE id = _delivery_id AND status = 'processing';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.is_welcome_email_recipient(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_welcome_email_recipient(text, uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_welcome_email_delivery(text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_welcome_email_delivery(uuid, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_welcome_email_delivery(text, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_welcome_email_delivery(uuid, boolean, text, text) TO service_role;