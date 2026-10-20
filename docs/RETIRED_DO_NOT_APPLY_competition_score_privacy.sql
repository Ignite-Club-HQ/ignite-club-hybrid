-- Raw results are never readable through fixture metadata, including SELECT *.
BEGIN;
ALTER TABLE public.competitions ADD COLUMN IF NOT EXISTS hide_scores boolean NOT NULL DEFAULT false;
ALTER TABLE public.competition_divisions ADD COLUMN IF NOT EXISTS hide_scores boolean;
CREATE FUNCTION public.competition_scores_visible(match_id uuid) RETURNS boolean
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
  is_service boolean := (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role';
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
-- Disable old score fan-out. Protected results are the only score source, even
-- for visible competitions; schedule/history rows must not become stale caches.
CREATE OR REPLACE FUNCTION public.sync_competition_result_to_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.sync_competition_result_to_events() FROM PUBLIC, anon, authenticated;
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
CREATE TABLE public.competition_pending_scores (
 match_id uuid PRIMARY KEY, home_score integer, away_score integer
);
REVOKE ALL ON public.competition_pending_scores FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.redirect_legacy_competition_scores() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.home_score IS NOT NULL OR NEW.away_score IS NOT NULL THEN
  IF NOT (coalesce(current_setting('role',true),'')='service_role'
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

-- Existing broad event/history readers cannot authorize competition privacy.
-- Do not duplicate competition results into those tables (including manual boards).
CREATE FUNCTION public.protect_competition_event_scores() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.competition_match_id IS NOT NULL THEN
  NEW.final_score_home := NULL; NEW.final_score_away := NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zzz_protect_competition_event_scores BEFORE INSERT OR UPDATE ON public.events
 FOR EACH ROW EXECUTE FUNCTION public.protect_competition_event_scores();
CREATE FUNCTION public.protect_competition_game_results() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.events WHERE id=NEW.event_id AND competition_match_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Save competition scores through competition results' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zzz_protect_competition_game_results BEFORE INSERT OR UPDATE ON public.game_results
 FOR EACH ROW EXECUTE FUNCTION public.protect_competition_game_results();
REVOKE ALL ON FUNCTION public.protect_competition_event_scores(), public.protect_competition_game_results() FROM PUBLIC, anon, authenticated;
DELETE FROM public.game_results gr USING public.events e WHERE gr.event_id=e.id AND e.competition_match_id IS NOT NULL;
UPDATE public.events SET final_score_home=NULL,final_score_away=NULL WHERE competition_match_id IS NOT NULL;
-- Raw PlayHQ caches contain scores/aggregates/raw JSON with no reliable local
-- competition authorization (including unmatched grades). Fail closed globally.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['playhq_fixtures','playhq_ladder','playhq_player_stats'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',t);
  END IF;
 END LOOP;
END $$;
-- Existing helper consumers must use the same default/override semantics.
CREATE OR REPLACE FUNCTION public.match_scores_hidden(_match_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce((SELECT coalesce(d.hide_scores,c.hide_scores) FROM competition_matches m
 JOIN competitions c ON c.id=m.competition_id LEFT JOIN competition_divisions d ON d.id=m.division_id
 WHERE m.id=_match_id),true)
$$;
-- Replace legacy ladder with a caller-RLS view below.
-- Serialize against concurrent result saves and fixture deletion. The authorization
-- helper is deliberately identical to manage_results RLS above.
CREATE FUNCTION public.save_competition_match_result(
 p_match_id uuid, p_home_score integer, p_away_score integer, p_status text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target public.competition_matches%ROWTYPE;
BEGIN
 SELECT * INTO target FROM public.competition_matches WHERE id=p_match_id FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_competition_vault(target.competition_id) THEN
   RAISE EXCEPTION 'Competition manager required' USING ERRCODE = '42501';
 END IF;
 IF p_home_score < 0 OR p_away_score < 0 THEN
   RAISE EXCEPTION 'Scores must be nonnegative' USING ERRCODE = '22023';
 END IF;
 INSERT INTO public.competition_match_results(match_id,home_score,away_score)
 VALUES(p_match_id,p_home_score,p_away_score)
 ON CONFLICT(match_id) DO UPDATE SET home_score=excluded.home_score,away_score=excluded.away_score;
 UPDATE public.competition_matches SET status=coalesce(p_status,target.status),
 manually_overridden_at=CASE WHEN target.source IS DISTINCT FROM 'manual' THEN coalesce(target.manually_overridden_at,now()) ELSE target.manually_overridden_at END WHERE id=p_match_id;
END
$$;
REVOKE ALL ON FUNCTION public.save_competition_match_result(uuid,integer,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_competition_match_result(uuid,integer,integer,text) TO authenticated;
DROP VIEW public.competition_ladder;

CREATE VIEW public.competition_ladder WITH (security_invoker=true) AS
WITH per_team AS (
  SELECT m.competition_id,
         COALESCE(e.division_id, m.division_id) AS division_id,
         m.home_team_id AS team_id,
         1 AS played,
         CASE WHEN r.home_score > r.away_score THEN 1 ELSE 0 END AS wins,
         CASE WHEN r.home_score = r.away_score THEN 1 ELSE 0 END AS draws,
         CASE WHEN r.home_score < r.away_score THEN 1 ELSE 0 END AS losses,
         COALESCE(r.home_score, 0) AS goals_for,
         COALESCE(r.away_score, 0) AS goals_against
    FROM public.competition_matches m
    JOIN public.competition_match_results r ON r.match_id = m.id
    LEFT JOIN public.competition_entries e ON e.competition_id = m.competition_id AND e.team_id = m.home_team_id
   WHERE m.status = 'completed' AND r.home_score IS NOT NULL AND r.away_score IS NOT NULL AND m.home_team_id IS NOT NULL
     AND public.competition_scores_visible(m.id)
  UNION ALL
  SELECT m.competition_id,
         COALESCE(e.division_id, m.division_id) AS division_id,
         m.away_team_id,
         1,
         CASE WHEN r.away_score > r.home_score THEN 1 ELSE 0 END,
         CASE WHEN r.away_score = r.home_score THEN 1 ELSE 0 END,
         CASE WHEN r.away_score < r.home_score THEN 1 ELSE 0 END,
         COALESCE(r.away_score, 0),
         COALESCE(r.home_score, 0)
    FROM public.competition_matches m
    JOIN public.competition_match_results r ON r.match_id = m.id
    LEFT JOIN public.competition_entries e ON e.competition_id = m.competition_id AND e.team_id = m.away_team_id
   WHERE m.status = 'completed' AND r.home_score IS NOT NULL AND r.away_score IS NOT NULL AND m.away_team_id IS NOT NULL
     AND public.competition_scores_visible(m.id)
)
SELECT pt.competition_id,
       pt.division_id,
       pt.team_id,
       sum(pt.played)::integer AS played,
       sum(pt.wins)::integer AS wins,
       sum(pt.draws)::integer AS draws,
       sum(pt.losses)::integer AS losses,
       sum(pt.goals_for)::integer AS goals_for,
       sum(pt.goals_against)::integer AS goals_against,
       (sum(pt.goals_for) - sum(pt.goals_against))::integer AS goal_diff,
       ((sum(pt.wins) * COALESCE(max(c.points_win), 3)) + (sum(pt.draws) * COALESCE(max(c.points_draw), 1)) + (sum(pt.losses) * COALESCE(max(c.points_loss), 0)))::integer AS points
  FROM per_team pt
  JOIN public.competitions c ON c.id = pt.competition_id
 WHERE (public.is_competition_admin(auth.uid(), pt.competition_id)
    OR (NOT c.hide_ladder AND NOT EXISTS (
      SELECT 1 FROM public.competition_divisions hd
       WHERE hd.competition_id = pt.competition_id AND hd.hide_ladder = true)))
 GROUP BY pt.competition_id, pt.division_id, pt.team_id;

GRANT SELECT ON public.competition_ladder TO anon;
GRANT SELECT ON public.competition_ladder TO authenticated;
GRANT SELECT ON public.competition_ladder TO service_role;
COMMIT;
