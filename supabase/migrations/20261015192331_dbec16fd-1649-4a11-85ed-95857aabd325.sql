CREATE TABLE public.competition_role_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  email text NOT NULL,
  invited_name text,
  role text NOT NULL,
  invited_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  accepted_user_id uuid,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competition_role_invites_role_chk CHECK (role IN ('referee','committee')),
  CONSTRAINT competition_role_invites_status_chk CHECK (status IN ('pending','accepted','cancelled'))
);
CREATE UNIQUE INDEX competition_role_invites_pending_uq
  ON public.competition_role_invites (competition_id, lower(email), role) WHERE status = 'pending';
GRANT SELECT, DELETE ON public.competition_role_invites TO authenticated;
GRANT ALL ON public.competition_role_invites TO service_role;
ALTER TABLE public.competition_role_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Competition admins view role invites" ON public.competition_role_invites
FOR SELECT TO authenticated USING (public.is_competition_admin((SELECT auth.uid()), competition_id));
CREATE POLICY "Competition admins cancel role invites" ON public.competition_role_invites
FOR DELETE TO authenticated USING (public.is_competition_admin((SELECT auth.uid()), competition_id));
CREATE TRIGGER competition_role_invites_updated_at BEFORE UPDATE ON public.competition_role_invites
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.invite_competition_official(
  p_competition_id uuid, p_email text, p_name text, p_role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email,'')));
  v_user uuid;
  v_comp record;
BEGIN
  IF v_me IS NULL OR NOT public.is_competition_admin(v_me, p_competition_id) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('referee','committee') THEN RAISE EXCEPTION 'invalid_role'; END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' THEN RAISE EXCEPTION 'invalid_email'; END IF;
  SELECT id, name, organizer_club_id INTO v_comp FROM public.competitions WHERE id = p_competition_id;
  SELECT au.id INTO v_user FROM auth.users au WHERE lower(au.email) = v_email LIMIT 1;
  IF v_user IS NOT NULL THEN
    INSERT INTO public.competition_roles (competition_id, user_id, role)
    SELECT p_competition_id, v_user, p_role
    WHERE NOT EXISTS (SELECT 1 FROM public.competition_roles
      WHERE competition_id = p_competition_id AND user_id = v_user AND role = p_role);
    INSERT INTO public.notifications (user_id, type, message, related_id, club_id)
    VALUES (v_user, 'membership',
      'You have been added as a ' || CASE p_role WHEN 'referee' THEN 'referee' ELSE 'committee member' END
        || ' for ' || v_comp.name, p_competition_id, v_comp.organizer_club_id);
    RETURN jsonb_build_object('status','added','user_id',v_user);
  END IF;
  INSERT INTO public.competition_role_invites (competition_id, email, invited_name, role, invited_by)
  VALUES (p_competition_id, v_email, nullif(btrim(p_name),''), p_role, v_me)
  ON CONFLICT (competition_id, lower(email), role) WHERE status = 'pending'
  DO UPDATE SET invited_name = EXCLUDED.invited_name, invited_by = EXCLUDED.invited_by, updated_at = now();
  RETURN jsonb_build_object('status','invited');
END $$;
REVOKE ALL ON FUNCTION public.invite_competition_official(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_competition_official(uuid,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_competition_role_invites_on_profile_create()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email text; inv record;
BEGIN
  SELECT lower(btrim(email)) INTO v_email FROM auth.users WHERE id = NEW.id;
  IF v_email IS NULL THEN RETURN NEW; END IF;
  FOR inv IN SELECT * FROM public.competition_role_invites
             WHERE status = 'pending' AND lower(email) = v_email LOOP
    BEGIN
      INSERT INTO public.competition_roles (competition_id, user_id, role)
      SELECT inv.competition_id, NEW.id, inv.role
      WHERE NOT EXISTS (SELECT 1 FROM public.competition_roles
        WHERE competition_id = inv.competition_id AND user_id = NEW.id AND role = inv.role);
      UPDATE public.competition_role_invites
        SET status = 'accepted', accepted_user_id = NEW.id, accepted_at = now()
        WHERE id = inv.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'claim_competition_role_invites: % (%)', inv.id::text, SQLERRM;
    END;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.claim_competition_role_invites_on_profile_create() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER claim_competition_role_invites_on_profile_create_trigger
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.claim_competition_role_invites_on_profile_create();

CREATE TABLE public.competition_role_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('referee','committee')),
  token text NOT NULL UNIQUE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  max_uses integer,
  use_count integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX competition_role_links_one_per_role ON public.competition_role_links (competition_id, role);
GRANT SELECT, INSERT, DELETE ON public.competition_role_links TO authenticated;
GRANT ALL ON public.competition_role_links TO service_role;
ALTER TABLE public.competition_role_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Competition admins view role links" ON public.competition_role_links
FOR SELECT TO authenticated USING (public.is_competition_admin((SELECT auth.uid()), competition_id));
CREATE POLICY "Competition admins create role links" ON public.competition_role_links
FOR INSERT TO authenticated WITH CHECK (created_by = (SELECT auth.uid())
  AND public.is_competition_admin((SELECT auth.uid()), competition_id));
CREATE POLICY "Competition admins revoke role links" ON public.competition_role_links
FOR DELETE TO authenticated USING (public.is_competition_admin((SELECT auth.uid()), competition_id));

CREATE OR REPLACE FUNCTION public.get_competition_role_link_status(p_token text)
RETURNS TABLE(status text, competition_id uuid, competition_name text, role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE l record; v_name text;
BEGIN
  SELECT * INTO l FROM public.competition_role_links WHERE token = p_token;
  IF l.id IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::text, NULL::text; RETURN;
  END IF;
  SELECT c.name INTO v_name FROM public.competitions c WHERE c.id = l.competition_id;
  RETURN QUERY SELECT
    CASE WHEN l.expires_at IS NOT NULL AND l.expires_at <= now() THEN 'expired'
         WHEN l.max_uses IS NOT NULL AND l.use_count >= l.max_uses THEN 'used_up'
         ELSE 'valid' END,
    l.competition_id, v_name, l.role;
END $$;
REVOKE ALL ON FUNCTION public.get_competition_role_link_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_competition_role_link_status(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.accept_competition_role_link(p_token text)
RETURNS TABLE(status text, competition_id uuid, chat_group_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_me uuid := auth.uid(); l record; v_club uuid; v_name text; v_scope text; v_chat uuid; v_status text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  SELECT * INTO l FROM public.competition_role_links WHERE token = p_token FOR UPDATE;
  IF l.id IS NULL THEN RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid; RETURN; END IF;
  v_scope := CASE l.role WHEN 'referee' THEN 'referees' ELSE 'committee' END;
  IF EXISTS (SELECT 1 FROM public.competition_roles cr
             WHERE cr.competition_id = l.competition_id AND cr.user_id = v_me AND cr.role = l.role) THEN
    v_status := 'already';
  ELSIF l.expires_at IS NOT NULL AND l.expires_at <= now() THEN
    RETURN QUERY SELECT 'expired'::text, l.competition_id, NULL::uuid; RETURN;
  ELSIF l.max_uses IS NOT NULL AND l.use_count >= l.max_uses THEN
    RETURN QUERY SELECT 'used_up'::text, l.competition_id, NULL::uuid; RETURN;
  ELSE
    SELECT organizer_club_id, name INTO v_club, v_name FROM public.competitions WHERE id = l.competition_id;
    INSERT INTO public.competition_roles (competition_id, user_id, role) VALUES (l.competition_id, v_me, l.role);
    UPDATE public.competition_role_links SET use_count = use_count + 1 WHERE id = l.id;
    INSERT INTO public.notifications (user_id, type, message, related_id, club_id)
    VALUES (v_me, 'membership', 'You have been added as a '
      || CASE l.role WHEN 'referee' THEN 'referee' ELSE 'committee member' END || ' for ' || v_name,
      l.competition_id, v_club);
    v_status := 'joined';
  END IF;
  SELECT g.id INTO v_chat FROM public.chat_groups g
   WHERE g.competition_id = l.competition_id AND g.competition_scope = v_scope AND g.deleted_at IS NULL LIMIT 1;
  IF v_chat IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = v_chat AND gm.user_id = v_me) THEN
    INSERT INTO public.group_members (group_id, user_id) VALUES (v_chat, v_me);
  END IF;
  RETURN QUERY SELECT v_status, l.competition_id, v_chat;
END $$;
REVOKE ALL ON FUNCTION public.accept_competition_role_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_competition_role_link(text) TO authenticated;