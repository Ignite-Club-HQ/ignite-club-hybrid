CREATE TABLE public.competition_role_email_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE CHECK (char_length(token) BETWEEN 32 AND 128),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('referee', 'committee_member')),
  invited_email text NOT NULL,
  verification_code_hash text NOT NULL CHECK (verification_code_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'locked')),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '48 hours',
  accepted_user_id uuid REFERENCES auth.users(id),
  accepted_at timestamptz
);

CREATE INDEX competition_role_email_invites_manager_idx
  ON public.competition_role_email_invites (competition_id, created_at DESC);

ALTER TABLE public.competition_role_email_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.competition_role_email_invites FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.competition_role_email_invites TO authenticated;

CREATE POLICY competition_role_email_invites_select_manager
ON public.competition_role_email_invites AS PERMISSIVE FOR SELECT TO authenticated
USING (public.is_competition_admin(auth.uid(), competition_id));

CREATE OR REPLACE FUNCTION public.create_competition_role_email_invite(
  _competition_id uuid,
  _role text,
  _token text,
  _email text,
  _verification_code_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text := lower(btrim(COALESCE(_email, '')));
  v_id uuid;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_competition_admin(v_user_id, _competition_id) THEN
    RAISE EXCEPTION 'Competition admin required';
  END IF;
  IF _role NOT IN ('referee', 'committee_member') THEN RAISE EXCEPTION 'Invalid official role'; END IF;
  IF _token IS NULL OR char_length(_token) NOT BETWEEN 32 AND 128 THEN RAISE EXCEPTION 'Invalid invitation token'; END IF;
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' THEN RAISE EXCEPTION 'Invalid email address'; END IF;
  IF _verification_code_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid verification code'; END IF;

  INSERT INTO public.competition_role_email_invites (
    token, competition_id, role, invited_email, verification_code_hash, created_by
  ) VALUES (
    _token, _competition_id, _role, v_email, _verification_code_hash, v_user_id
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_competition_role_email_invite_status(p_token text)
RETURNS TABLE(status text, competition_id uuid, competition_name text, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
           WHEN c.id IS NULL OR invite.status IN ('revoked', 'locked') THEN 'invalid'
           WHEN invite.status = 'accepted' THEN 'used'
           WHEN invite.expires_at <= now() THEN 'expired'
           WHEN c.status = 'archived' THEN 'archived'
           ELSE 'valid'
         END,
         invite.competition_id,
         c.name,
         invite.role
  FROM public.competition_role_email_invites invite
  LEFT JOIN public.competitions c ON c.id = invite.competition_id
  WHERE invite.token = p_token
  UNION ALL
  SELECT 'invalid', NULL::uuid, NULL::text, NULL::text
  WHERE NOT EXISTS (
    SELECT 1 FROM public.competition_role_email_invites invite WHERE invite.token = p_token
  )
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.accept_competition_role_email_invite(
  p_token text,
  p_verification_code_hash text
)
RETURNS TABLE(status text, competition_id uuid, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_account_email text;
  v_email_confirmed_at timestamptz;
  v_invite public.competition_role_email_invites%ROWTYPE;
  v_name text;
  v_club_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT lower(btrim(email)), email_confirmed_at
  INTO v_account_email, v_email_confirmed_at
  FROM auth.users
  WHERE id = v_user_id;
  IF v_account_email IS NULL OR v_email_confirmed_at IS NULL THEN
    RETURN QUERY SELECT 'email_unverified'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_invite
  FROM public.competition_role_email_invites
  WHERE token = p_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_invite.status = 'accepted' AND v_invite.accepted_user_id = v_user_id THEN
    RETURN QUERY SELECT 'already'::text, v_invite.competition_id, v_invite.role;
    RETURN;
  END IF;
  IF v_invite.status <> 'pending' OR v_invite.expires_at <= now() THEN
    RETURN QUERY SELECT 'invalid'::text, v_invite.competition_id, v_invite.role;
    RETURN;
  END IF;
  IF v_account_email <> lower(btrim(v_invite.invited_email))
    OR p_verification_code_hash <> v_invite.verification_code_hash
  THEN
    UPDATE public.competition_role_email_invites
    SET attempts = attempts + 1,
        status = CASE WHEN attempts + 1 >= 5 THEN 'locked' ELSE status END
    WHERE id = v_invite.id;
    RETURN QUERY SELECT CASE WHEN v_invite.attempts + 1 >= 5 THEN 'locked' ELSE 'code_invalid' END,
                        v_invite.competition_id, v_invite.role;
    RETURN;
  END IF;

  SELECT name, organizer_club_id INTO v_name, v_club_id
  FROM public.competitions
  WHERE id = v_invite.competition_id AND status <> 'archived';
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'archived'::text, v_invite.competition_id, v_invite.role;
    RETURN;
  END IF;

  INSERT INTO public.competition_roles (competition_id, user_id, role)
  SELECT v_invite.competition_id, v_user_id, v_invite.role
  WHERE NOT EXISTS (
    SELECT 1 FROM public.competition_roles
    WHERE competition_id = v_invite.competition_id AND user_id = v_user_id AND role = v_invite.role
  );
  INSERT INTO public.notifications (user_id, type, message, related_id, club_id)
  VALUES (v_user_id, 'membership', 'You joined as a ' || v_invite.role || ' for ' || v_name,
          v_invite.competition_id, v_club_id);
  UPDATE public.competition_role_email_invites
  SET status = 'accepted', accepted_user_id = v_user_id, accepted_at = now()
  WHERE id = v_invite.id;

  RETURN QUERY SELECT 'joined'::text, v_invite.competition_id, v_invite.role;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_competition_role_email_invite(_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.competition_role_email_invites
  SET status = 'revoked'
  WHERE token = _token
    AND status = 'pending'
    AND public.is_competition_admin(auth.uid(), competition_id);
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.create_competition_role_email_invite(uuid, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_competition_role_email_invite_status(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_competition_role_email_invite(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_competition_role_email_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_competition_role_email_invite(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_competition_role_email_invite_status(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_competition_role_email_invite(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_competition_role_email_invite(text) TO authenticated;