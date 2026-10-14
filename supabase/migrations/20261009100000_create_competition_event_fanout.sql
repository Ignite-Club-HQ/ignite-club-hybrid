CREATE TABLE IF NOT EXISTS public.competition_event_operations (
  id uuid PRIMARY KEY,
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  request_fingerprint text NOT NULL,
  result_count integer NOT NULL DEFAULT 0 CHECK (result_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.competition_event_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.competition_event_operations FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_competition_event(
  p_operation_id uuid,
  p_competition_id uuid,
  p_title text,
  p_event_type public.event_type,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_location text DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_organizer_club_id uuid;
  v_fingerprint text;
  v_existing public.competition_event_operations%ROWTYPE;
  v_inserted integer;
  v_created integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_title IS NULL OR length(btrim(p_title)) = 0 OR length(p_title) > 200
    OR (p_description IS NOT NULL AND length(p_description) > 2000)
    OR p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at <= p_starts_at
    OR (p_location IS NOT NULL AND length(p_location) > 256) THEN
    RAISE EXCEPTION 'Invalid competition event';
  END IF;

  SELECT c.organizer_club_id
    INTO v_organizer_club_id
    FROM public.competitions c
   WHERE c.id = p_competition_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competition not found';
  END IF;
  IF NOT (
    EXISTS (
      SELECT 1
        FROM public.competition_roles cr
       WHERE cr.competition_id = p_competition_id
         AND cr.user_id = v_user_id
         AND cr.role IN ('owner', 'admin')
    )
    OR public.has_role(v_user_id, 'club_admin'::public.app_role, v_organizer_club_id, NULL::uuid)
  ) THEN
    RAISE EXCEPTION 'Competition management forbidden';
  END IF;

  v_fingerprint := md5(concat_ws(chr(31),
    p_competition_id::text,
    p_title,
    p_event_type::text,
    p_starts_at::text,
    p_ends_at::text,
    coalesce(p_location, ''),
    coalesce(p_description, '')
  ));

  INSERT INTO public.competition_event_operations (
    id, competition_id, requested_by, request_fingerprint
  ) VALUES (
    p_operation_id, p_competition_id, v_user_id, v_fingerprint
  ) ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    SELECT * INTO v_existing
      FROM public.competition_event_operations
     WHERE id = p_operation_id
     FOR UPDATE;
    IF v_existing.competition_id <> p_competition_id
      OR v_existing.requested_by <> v_user_id
      OR v_existing.request_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'Operation id already used';
    END IF;
    RETURN v_existing.result_count;
  END IF;

  INSERT INTO public.events (
    title, type, club_id, team_id, event_date, start_time, end_time,
    location, description, created_by, is_recurring
  )
  SELECT
    btrim(p_title), p_event_type, t.club_id, ce.team_id,
    p_starts_at, p_starts_at, p_ends_at,
    nullif(btrim(p_location), ''), nullif(btrim(p_description), ''),
    v_user_id, false
  FROM public.competition_entries ce
  JOIN public.teams t ON t.id = ce.team_id
  WHERE ce.competition_id = p_competition_id
    AND ce.status IN ('accepted', 'registered');
  GET DIAGNOSTICS v_created = ROW_COUNT;

  UPDATE public.competition_event_operations
     SET result_count = v_created
   WHERE id = p_operation_id;
  RETURN v_created;
END;
$$;

REVOKE ALL ON FUNCTION public.create_competition_event(uuid, uuid, text, public.event_type, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_competition_event(uuid, uuid, text, public.event_type, timestamptz, timestamptz, text, text) TO authenticated;