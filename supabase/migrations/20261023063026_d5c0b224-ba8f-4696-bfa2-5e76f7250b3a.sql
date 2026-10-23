ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS notify_suppressed boolean NOT NULL DEFAULT false;

DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.on_event_created'::regproc);
  d := replace(d,
    '-- Recurring child instances are covered by the parent dispatch.',
    '-- Bulk imports suppress per-game invites; a summary alert is sent instead.
  IF COALESCE(NEW.notify_suppressed, false) THEN
    RETURN NEW;
  END IF;

  -- Recurring child instances are covered by the parent dispatch.');
  IF position('NEW.notify_suppressed' in d) = 0 THEN
    RAISE EXCEPTION 'on_event_created patch failed';
  END IF;
  EXECUTE d;
END
$do$;

CREATE OR REPLACE FUNCTION public.send_fixture_import_summary(p_event_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_event_ids IS NULL OR array_length(p_event_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  IF array_length(p_event_ids, 1) > 500 THEN
    RAISE EXCEPTION 'too many events';
  END IF;

  FOR r IN
    SELECT e.team_id, e.club_id, t.name AS team_name,
           count(*) AS games,
           (array_agg(e.id ORDER BY e.event_date))[1] AS first_event,
           md5(string_agg(e.id::text, ',' ORDER BY e.id::text)) AS batch_hash
      FROM public.events e
      JOIN public.teams t ON t.id = e.team_id
     WHERE e.id = ANY (p_event_ids)
       AND e.team_id IS NOT NULL
       AND COALESCE(e.is_cancelled, false) = false
     GROUP BY e.team_id, e.club_id, t.name
  LOOP
    IF NOT (
      public.has_role(v_uid, 'club_admin'::app_role, r.club_id, NULL::uuid)
      OR public.has_role(v_uid, 'team_admin'::app_role, NULL::uuid, r.team_id)
      OR public.has_role(v_uid, 'coach'::app_role, NULL::uuid, r.team_id)
    ) THEN
      RAISE EXCEPTION 'not authorised for team %', r.team_id;
    END IF;

    IF r.games < 2 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.notifications (user_id, type, message, related_id, club_id, dedupe_key)
    SELECT DISTINCT ur.user_id, 'event_invite',
           'Fixtures imported — ' || r.games || ' games added to ' || r.team_name || '''s schedule',
           r.first_event, r.club_id,
           'fixture_import:' || r.team_id::text || ':' || ur.user_id::text || ':' || r.batch_hash
      FROM public.user_roles ur
     WHERE ur.team_id = r.team_id
       AND ur.user_id IS NOT NULL
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.send_fixture_import_summary(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_fixture_import_summary(uuid[]) TO authenticated;