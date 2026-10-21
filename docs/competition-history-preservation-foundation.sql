-- Raw results are never readable through fixture metadata, including SELECT *.
BEGIN;
CREATE OR REPLACE FUNCTION public.can_manage_game_result(_user_id uuid,_team_id uuid,_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_roles u WHERE u.user_id=_user_id AND u.team_id=_team_id AND u.role IN ('team_admin','coach','club_admin'))
 OR EXISTS(SELECT 1 FROM public.teams t JOIN public.user_roles u ON u.club_id=t.club_id WHERE t.id=_team_id AND u.user_id=_user_id AND u.team_id IS NULL AND u.role IN ('club_admin','committee_member'))
 OR EXISTS(SELECT 1 FROM public.user_roles u WHERE u.user_id=_user_id AND u.role='app_admin')
 OR (_event_id IS NOT NULL AND public.is_subs_manager_for_event(_user_id,_event_id))
$$;
REVOKE ALL ON FUNCTION public.can_manage_game_result(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_game_result(uuid,uuid,uuid) TO authenticated;

-- Original-human role helper is independent of the vault feature's rollout.
CREATE OR REPLACE FUNCTION public.can_manage_competition_vault(_competition_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT auth.uid() IS NOT NULL AND (public.is_competition_admin(auth.uid(),_competition_id)
 OR EXISTS(SELECT 1 FROM public.competitions c JOIN public.user_roles u ON u.club_id=c.organizer_club_id
 WHERE c.id=_competition_id AND u.user_id=auth.uid() AND u.role='club_admin'))
$$;
REVOKE ALL ON FUNCTION public.can_manage_competition_vault(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_competition_vault(uuid) TO authenticated,anon;

ALTER TABLE public.competitions ADD COLUMN IF NOT EXISTS hide_scores boolean NOT NULL DEFAULT false;
ALTER TABLE public.competition_divisions ADD COLUMN IF NOT EXISTS hide_scores boolean;
CREATE OR REPLACE FUNCTION public.competition_scores_visible(match_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT EXISTS (SELECT 1 FROM competition_matches m JOIN competitions c ON c.id=m.competition_id
 LEFT JOIN competition_divisions d ON d.id=m.division_id
 WHERE m.id=match_id AND (can_manage_competition_vault(c.id) OR NOT coalesce(d.hide_scores,c.hide_scores)))
$$;
REVOKE ALL ON FUNCTION public.competition_scores_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.competition_scores_visible(uuid) TO anon, authenticated;
CREATE TABLE IF NOT EXISTS public.competition_match_results (
 match_id uuid PRIMARY KEY REFERENCES public.competition_matches(id) ON DELETE CASCADE,
 home_score integer, away_score integer
);
GRANT SELECT ON public.competition_match_results TO anon, authenticated;
GRANT INSERT,UPDATE,DELETE ON public.competition_match_results TO authenticated;
GRANT ALL ON public.competition_match_results TO service_role;
-- Prod already has this table and permissive policies: policies combine with OR.
ALTER TABLE public.competition_divisions ALTER COLUMN hide_scores DROP NOT NULL;
ALTER TABLE public.competition_divisions ALTER COLUMN hide_scores DROP DEFAULT;
-- Prod false meant no extra hiding (competition true still won). Preserve that
-- behavior by treating legacy false as inherit; explicit show is available after rollout.
UPDATE public.competition_divisions SET hide_scores=NULL WHERE hide_scores=false;
ALTER TABLE public.competition_match_results ADD COLUMN IF NOT EXISTS entered_by uuid;
ALTER TABLE public.competition_match_results ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.competition_match_results ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DO $$ DECLARE p record; BEGIN
 FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='competition_match_results' LOOP
  EXECUTE format('DROP POLICY %I ON public.competition_match_results',p.policyname);
 END LOOP;
END $$;
ALTER TABLE public.competition_match_results ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.competition_match_results TO service_role;
GRANT SELECT ON public.competition_match_results TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.competition_match_results TO authenticated;
CREATE POLICY visible_results ON public.competition_match_results FOR SELECT USING (
 public.competition_scores_visible(match_id) AND EXISTS (SELECT 1 FROM public.competition_matches m WHERE m.id=match_id));
CREATE POLICY manage_results ON public.competition_match_results FOR ALL TO authenticated
 USING (EXISTS (SELECT 1 FROM public.competition_matches m WHERE m.id=match_id AND public.can_manage_competition_vault(m.competition_id)))
 WITH CHECK (EXISTS (SELECT 1 FROM public.competition_matches m WHERE m.id=match_id AND public.can_manage_competition_vault(m.competition_id)));
CREATE OR REPLACE FUNCTION public.guard_external_competition_match_edits()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  is_service boolean := coalesce((current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role',false);
BEGIN
  IF NEW.source IS DISTINCT FROM 'manual' AND NOT is_service THEN
    IF NEW.manually_overridden_at IS NOT NULL AND OLD.manually_overridden_at IS NULL THEN
      RETURN NEW;
    END IF;
    IF OLD.manually_overridden_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
    IF NEW.scheduled_at  IS DISTINCT FROM OLD.scheduled_at
    OR NEW.home_team_id  IS DISTINCT FROM OLD.home_team_id
    OR NEW.away_team_id  IS DISTINCT FROM OLD.away_team_id
    OR NEW.status        IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'This match is synced from % and cannot be edited directly. Set manually_overridden_at first to take local control.', NEW.source
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 6. Match->event sync: stop copying scores (handled by the results trigger now)
CREATE OR REPLACE FUNCTION public.sync_competition_match_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_home_team RECORD; v_away_team RECORD; v_comp RECORD;
  v_creator uuid; v_title text; v_cancelled boolean; v_description text;
  v_location text; v_location_name text; v_home_event uuid; v_away_event uuid;
  v_placeholder boolean; v_home_name text; v_away_name text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.events WHERE competition_match_id = OLD.id;
    IF OLD.home_event_id IS NOT NULL THEN DELETE FROM public.events WHERE id = OLD.home_event_id; END IF;
    IF OLD.away_event_id IS NOT NULL THEN DELETE FROM public.events WHERE id = OLD.away_event_id; END IF;
    RETURN OLD;
  END IF;

  SELECT id, name, club_id INTO v_home_team FROM public.teams WHERE id = NEW.home_team_id;
  SELECT id, name, club_id INTO v_away_team FROM public.teams WHERE id = NEW.away_team_id;
  SELECT id, name, created_by, status INTO v_comp FROM public.competitions WHERE id = NEW.competition_id;

  IF v_comp.status = 'draft'
     AND NEW.home_event_id IS NULL AND NEW.away_event_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.events WHERE competition_match_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Both sides unknown: nothing to put on a schedule yet.
  IF v_home_team.id IS NULL AND v_away_team.id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Finals placeholder: one real team vs TBD. Its event is created silently.
  v_placeholder := v_home_team.id IS NULL OR v_away_team.id IS NULL;
  v_home_name := COALESCE(v_home_team.name, 'TBD');
  v_away_name := COALESCE(v_away_team.name, 'TBD');

  v_creator := COALESCE(NEW.created_by, v_comp.created_by);
  IF v_creator IS NULL THEN RETURN NEW; END IF;

  v_title := v_home_name || ' vs ' || v_away_name;
  IF NEW.round_number IS NOT NULL THEN
    v_title := 'R' || NEW.round_number || ': ' || v_title;
  END IF;

  v_cancelled := NEW.status IN ('cancelled', 'postponed');

  IF v_comp.name IS NOT NULL THEN
    v_description := 'Competition: ' || v_comp.name;
    IF NEW.round_number IS NOT NULL THEN
      v_description := v_description || E'\nRound ' || NEW.round_number;
    END IF;
  ELSE
    v_description := NULL;
  END IF;

  v_location := NULLIF(btrim(COALESCE(NEW.venue, '')), '');
  IF v_location IS NOT NULL THEN
    v_location_name := split_part(v_location, ',', 1);
    IF NEW.pitch_number IS NOT NULL AND btrim(NEW.pitch_number::text) <> '' THEN
      v_location_name := v_location_name || ' - Pitch ' || NEW.pitch_number;
    END IF;
  ELSIF NEW.pitch_number IS NOT NULL AND btrim(NEW.pitch_number::text) <> '' THEN
    v_location_name := 'Pitch ' || NEW.pitch_number;
  ELSE
    v_location_name := NULL;
  END IF;

  IF NEW.scheduled_at IS NULL THEN
    DELETE FROM public.events WHERE competition_match_id = NEW.id;
    IF NEW.home_event_id IS NOT NULL THEN DELETE FROM public.events WHERE id = NEW.home_event_id; NEW.home_event_id := NULL; END IF;
    IF NEW.away_event_id IS NOT NULL THEN DELETE FROM public.events WHERE id = NEW.away_event_id; NEW.away_event_id := NULL; END IF;
    RETURN NEW;
  END IF;

  -- ===== HOME =====
  IF v_home_team.id IS NULL THEN
    DELETE FROM public.events WHERE competition_match_id = NEW.id AND competition_side = 'home';
    NEW.home_event_id := NULL;
  ELSE
    SELECT id INTO v_home_event FROM public.events
     WHERE competition_match_id = NEW.id AND competition_side = 'home' LIMIT 1;
    IF v_home_event IS NULL AND NEW.home_event_id IS NOT NULL THEN
      SELECT id INTO v_home_event FROM public.events WHERE id = NEW.home_event_id;
    END IF;
    IF v_home_event IS NULL THEN
      SELECT id INTO v_home_event FROM public.events
       WHERE club_id = v_home_team.club_id AND team_id = v_home_team.id AND type = 'game'
         AND lower(btrim(title)) = lower(btrim(v_title)) AND event_date = NEW.scheduled_at LIMIT 1;
    END IF;
    IF v_home_event IS NULL THEN
      INSERT INTO public.events (
        club_id, team_id, title, event_date, type, opponent, is_home_game,
        location, location_name, description, created_by, is_cancelled,
        competition_match_id, competition_side, notify_suppressed
      ) VALUES (
        v_home_team.club_id, v_home_team.id, v_title, NEW.scheduled_at, 'game',
        v_away_name, true, v_location, v_location_name, v_description,
        v_creator, v_cancelled, NEW.id, 'home', v_placeholder
      ) RETURNING id INTO v_home_event;
    ELSE
      UPDATE public.events
         SET title = v_title, event_date = NEW.scheduled_at, team_id = v_home_team.id,
             club_id = v_home_team.club_id, opponent = v_away_name, location = v_location,
             location_name = v_location_name, description = v_description, is_cancelled = v_cancelled,
             is_home_game = true,
             competition_match_id = NEW.id, competition_side = 'home'
       WHERE id = v_home_event;
    END IF;
    NEW.home_event_id := v_home_event;
  END IF;

  -- ===== AWAY =====
  IF v_away_team.id IS NULL THEN
    DELETE FROM public.events WHERE competition_match_id = NEW.id AND competition_side = 'away';
    NEW.away_event_id := NULL;
  ELSE
    SELECT id INTO v_away_event FROM public.events
     WHERE competition_match_id = NEW.id AND competition_side = 'away' LIMIT 1;
    IF v_away_event IS NULL AND NEW.away_event_id IS NOT NULL THEN
      SELECT id INTO v_away_event FROM public.events WHERE id = NEW.away_event_id;
    END IF;
    IF v_away_event IS NULL THEN
      SELECT id INTO v_away_event FROM public.events
       WHERE club_id = v_away_team.club_id AND team_id = v_away_team.id AND type = 'game'
         AND lower(btrim(title)) = lower(btrim(v_title)) AND event_date = NEW.scheduled_at LIMIT 1;
    END IF;
    IF v_away_event IS NULL THEN
      INSERT INTO public.events (
        club_id, team_id, title, event_date, type, opponent, is_home_game,
        location, location_name, description, created_by, is_cancelled,
        competition_match_id, competition_side, notify_suppressed
      ) VALUES (
        v_away_team.club_id, v_away_team.id, v_title, NEW.scheduled_at, 'game',
        v_home_name, false, v_location, v_location_name, v_description,
        v_creator, v_cancelled, NEW.id, 'away', v_placeholder
      ) RETURNING id INTO v_away_event;
    ELSE
      UPDATE public.events
         SET title = v_title, event_date = NEW.scheduled_at, team_id = v_away_team.id,
             club_id = v_away_team.club_id, opponent = v_home_name, location = v_location,
             location_name = v_location_name, description = v_description, is_cancelled = v_cancelled,
             is_home_game = false,
             competition_match_id = NEW.id, competition_side = 'away'
       WHERE id = v_away_event;
    END IF;
    NEW.away_event_id := v_away_event;
  END IF;

  RETURN NEW;
END;
$$;


-- Production dropped legacy columns; restore null-only compatibility slots.
ALTER TABLE public.competition_matches ADD COLUMN IF NOT EXISTS home_score integer;
ALTER TABLE public.competition_matches ADD COLUMN IF NOT EXISTS away_score integer;
CREATE OR REPLACE FUNCTION public.sync_competition_result_to_events() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN RETURN NEW; END $$;
INSERT INTO public.competition_match_results(match_id,home_score,away_score)
 SELECT id,home_score,away_score FROM public.competition_matches
 WHERE home_score IS NOT NULL OR away_score IS NOT NULL
 ON CONFLICT(match_id) DO NOTHING; -- Existing protected results are authoritative.
UPDATE public.competition_matches SET home_score=NULL,away_score=NULL
 WHERE home_score IS NOT NULL OR away_score IS NOT NULL;
ALTER TABLE public.competition_matches ADD CONSTRAINT scores_stored_separately CHECK (home_score IS NULL AND away_score IS NULL);

-- AFTER trigger runs only after fixture RLS and FK checks; BEFORE scrubs legacy
-- slots before constraints/RETURNING/realtime. The temporary handoff is NOT a
-- session setting: row-scoped protected pending data cannot be forged by callers.
CREATE TABLE IF NOT EXISTS public.competition_pending_scores (
 match_id uuid PRIMARY KEY, home_score integer, away_score integer
);
GRANT ALL ON public.competition_pending_scores TO service_role;
REVOKE ALL ON public.competition_pending_scores FROM PUBLIC,anon,authenticated;
ALTER TABLE public.competition_pending_scores ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.redirect_legacy_competition_scores() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.source='playhq' AND NEW.external_id IS NOT NULL THEN
  NEW.id:=coalesce((SELECT m.id FROM public.competition_matches m WHERE m.source=NEW.source AND m.external_id=NEW.external_id),NEW.id);
 END IF;
 IF NEW.home_score IS NOT NULL OR NEW.away_score IS NOT NULL THEN
  IF NOT (coalesce(current_setting('request.jwt.claims',true)::jsonb->>'role','')='service_role'
          OR public.can_manage_competition_vault(NEW.competition_id)) THEN
   RAISE EXCEPTION 'Competition manager required' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.competition_pending_scores VALUES(NEW.id,NEW.home_score,NEW.away_score)
   ON CONFLICT(match_id) DO UPDATE SET home_score=excluded.home_score,away_score=excluded.away_score;
  NEW.home_score := NULL; NEW.away_score := NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.finish_legacy_competition_scores() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 WITH pending AS (DELETE FROM public.competition_pending_scores WHERE match_id=NEW.id RETURNING *)
 INSERT INTO public.competition_match_results(match_id,home_score,away_score)
 SELECT match_id,home_score,away_score FROM pending
 ON CONFLICT(match_id) DO UPDATE SET home_score=excluded.home_score,away_score=excluded.away_score;
 RETURN NEW;
END $$;
CREATE TRIGGER aaa_redirect_legacy_scores BEFORE INSERT OR UPDATE ON public.competition_matches
 FOR EACH ROW EXECUTE FUNCTION public.redirect_legacy_competition_scores();
CREATE TRIGGER zzz_finish_legacy_scores AFTER INSERT OR UPDATE ON public.competition_matches
 FOR EACH ROW EXECUTE FUNCTION public.finish_legacy_competition_scores();
REVOKE ALL ON FUNCTION public.redirect_legacy_competition_scores(), public.finish_legacy_competition_scores() FROM PUBLIC, anon, authenticated;

