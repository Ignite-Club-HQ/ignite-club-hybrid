-- Focused History/score-privacy release; PlayHQ sync is deferred.
BEGIN;
LOCK TABLE public.competition_matches,public.events,public.game_results IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE public.events ADD COLUMN history_competition_id uuid;
ALTER TABLE public.events ADD COLUMN history_match_id uuid;
UPDATE public.events e SET history_competition_id=m.competition_id,history_match_id=m.id FROM public.competition_matches m WHERE e.competition_match_id=m.id;
ALTER TABLE public.events DROP CONSTRAINT events_competition_match_id_fkey;
ALTER TABLE public.events ADD CONSTRAINT events_competition_match_id_fkey FOREIGN KEY(competition_match_id) REFERENCES public.competition_matches(id) ON DELETE SET NULL;
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
 WHERE m.id=match_id AND public.can_view_competition(auth.uid(),c.id) AND (can_manage_competition_vault(c.id) OR NOT coalesce(d.hide_scores,c.hide_scores)))
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
-- Scoped rollout against the inspected live schema.
ALTER TABLE public.competition_divisions ALTER COLUMN hide_scores DROP NOT NULL;
ALTER TABLE public.competition_divisions ALTER COLUMN hide_scores DROP DEFAULT;
-- Prod false meant no extra hiding (competition true still won). Preserve that
-- behavior by treating legacy false as inherit; explicit show is available after rollout.

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
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
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

DROP TRIGGER IF EXISTS trg_sync_competition_match_events ON public.competition_matches;
DROP TRIGGER IF EXISTS trg_sync_competition_match_events_d ON public.competition_matches;
DROP TRIGGER IF EXISTS trg_sync_competition_match_events_iu ON public.competition_matches;
-- 6. Match->event sync: stop copying scores (handled by the results trigger now)
CREATE OR REPLACE FUNCTION public.sync_competition_match_events() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c record;t record;side text;tid uuid;v_opponent text;ev uuid;h uuid;a uuid;v_title text;
BEGIN
 IF pg_trigger_depth()>1 THEN RETURN NEW;END IF;
 IF TG_OP='DELETE' THEN UPDATE events SET is_cancelled=true WHERE competition_match_id=OLD.id;RETURN OLD;END IF;
 SELECT * INTO c FROM competitions WHERE id=NEW.competition_id;
 IF c.status='draft' AND NEW.home_event_id IS NULL AND NEW.away_event_id IS NULL THEN RETURN NEW;END IF;
 IF NEW.scheduled_at IS NULL THEN UPDATE events SET is_cancelled=true WHERE competition_match_id=NEW.id;RETURN NEW;END IF;
 FOREACH side IN ARRAY ARRAY['home','away'] LOOP
  tid:=CASE WHEN side='home' THEN NEW.home_team_id ELSE NEW.away_team_id END;
  SELECT * INTO t FROM teams WHERE id=tid;
  IF NOT FOUND THEN UPDATE events SET is_cancelled=true WHERE competition_match_id=NEW.id AND competition_side=side;CONTINUE;END IF;
  SELECT name INTO v_opponent FROM teams WHERE id=CASE WHEN side='home' THEN NEW.away_team_id ELSE NEW.home_team_id END;
  v_title:=coalesce((SELECT name FROM teams WHERE id=NEW.home_team_id),'TBD')||' vs '||coalesce((SELECT name FROM teams WHERE id=NEW.away_team_id),'TBD');
  IF NEW.round_number IS NOT NULL THEN v_title:='R'||NEW.round_number||': '||v_title;END IF;
  SELECT id INTO ev FROM events WHERE competition_match_id=NEW.id AND competition_side=side AND team_id=tid LIMIT 1;
  IF ev IS NULL THEN
   INSERT INTO events(club_id,team_id,title,event_date,type,opponent,is_home_game,location,description,created_by,is_cancelled,competition_match_id,competition_side)
   VALUES(t.club_id,tid,v_title,NEW.scheduled_at,'game',coalesce(v_opponent,'TBD'),side='home',NEW.venue,'Competition: '||c.name,coalesce(NEW.created_by,c.created_by),NEW.status IN ('cancelled','postponed'),NEW.id,side) RETURNING id INTO ev;
  ELSE
   UPDATE events SET title=v_title,event_date=NEW.scheduled_at,opponent=coalesce(v_opponent,'TBD'),location=NEW.venue,is_cancelled=NEW.status IN ('cancelled','postponed') WHERE id=ev;
  END IF;
  IF side='home' THEN h:=ev;ELSE a:=ev;END IF;
 END LOOP;
 NEW.home_event_id:=h;NEW.away_event_id:=a;
 IF TG_OP='INSERT' THEN UPDATE competition_matches SET home_event_id=h,away_event_id=a WHERE id=NEW.id;END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_sync_competition_match_events_iu BEFORE UPDATE ON public.competition_matches FOR EACH ROW EXECUTE FUNCTION public.sync_competition_match_events();
CREATE TRIGGER history_sync_competition_match_insert AFTER INSERT ON public.competition_matches FOR EACH ROW EXECUTE FUNCTION public.sync_competition_match_events();
CREATE TRIGGER trg_sync_competition_match_events_d BEFORE DELETE ON public.competition_matches FOR EACH ROW EXECUTE FUNCTION public.sync_competition_match_events();

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

-- Applied together with the non-destructive foundation, never after the retired draft.
ALTER TABLE public.game_results ADD COLUMN IF NOT EXISTS competition_id uuid;
ALTER TABLE public.game_results ADD COLUMN IF NOT EXISTS competition_match_id uuid;
ALTER TABLE public.game_results ADD COLUMN IF NOT EXISTS competition_side text;
UPDATE public.game_results g SET competition_id=m.competition_id,competition_match_id=m.id,competition_side=e.competition_side
FROM public.events e JOIN public.competition_matches m ON m.id=e.competition_match_id WHERE g.event_id=e.id;
-- Match identity is retained without a cascading FK, so deleting a fixture does not
-- make its detached History public. Unresolvable archived rows remain manager-only.
CREATE OR REPLACE FUNCTION public.history_row_scores_visible(p_comp uuid,p_match uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE WHEN p_comp IS NULL THEN true ELSE public.can_manage_competition_vault(p_comp)
 OR coalesce((SELECT public.competition_scores_visible(m.id) FROM public.competition_matches m WHERE m.id=p_match AND m.competition_id=p_comp),false) END
$$;
CREATE OR REPLACE FUNCTION public.history_scores_visible(p_event uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE WHEN p_event IS NULL THEN true ELSE coalesce((SELECT public.history_row_scores_visible(e.history_competition_id,e.history_match_id) FROM public.events e WHERE e.id=p_event),false) END
$$;
CREATE OR REPLACE FUNCTION public.can_read_history_row(p_team uuid,p_event uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT auth.uid() IS NOT NULL AND (p_event IS NULL OR EXISTS(SELECT 1 FROM public.events e WHERE e.id=p_event AND e.team_id=p_team))
 AND CASE WHEN p_event IS NOT NULL THEN public.can_access_targeted_event(auth.uid(),p_event)
 ELSE public.can_manage_game_result(_user_id=>auth.uid(),_team_id=>p_team,_event_id=>NULL)
 OR EXISTS(SELECT 1 FROM public.teams t WHERE t.id=p_team AND public.is_club_member(auth.uid(),t.club_id)) END
$$;
CREATE OR REPLACE FUNCTION public.mask_history_players(p_players jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(safe),'[]'::jsonb) FROM (
 SELECT coalesce(jsonb_object_agg(k,v) FILTER(WHERE k IN ('id','name','secondsPlayed','finalPosition','fouls','isFouledOut','isInjured','yellow','red','award')
 AND jsonb_typeof(v) NOT IN ('array','object')),'{}'::jsonb) safe
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_players)='array' THEN p_players ELSE '[]'::jsonb END) WITH ORDINALITY AS player(value,position)
 LEFT JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(player.value)='object' THEN player.value ELSE '{}'::jsonb END) AS fields(k,v) ON true
 GROUP BY player.position ORDER BY player.position) bounded
$$;
CREATE OR REPLACE FUNCTION public.history_result_dto(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('id',g.id,'team_id',g.team_id,'event_id',g.event_id,'sport',g.sport,
 'home_label',g.home_label,'away_label',g.away_label,'played_at',g.played_at,'saved_by',g.saved_by,
 'home_score',CASE WHEN v.visible THEN CASE WHEN g.competition_id IS NULL THEN g.home_score
 ELSE coalesce(CASE WHEN g.competition_side='away' THEN r.away_score ELSE r.home_score END,g.home_score) END END,
 'away_score',CASE WHEN v.visible THEN CASE WHEN g.competition_id IS NULL THEN g.away_score
 ELSE coalesce(CASE WHEN g.competition_side='away' THEN r.home_score ELSE r.away_score END,g.away_score) END END,
 'scores_hidden',NOT v.visible,'period_scores',CASE WHEN v.visible THEN g.period_scores ELSE '[]'::jsonb END,
 'player_stats',CASE WHEN v.visible THEN g.player_stats ELSE public.mask_history_players(g.player_stats) END,
 'mvp_player_id',g.mvp_player_id,'mvp_player_name',g.mvp_player_name,'notes',CASE WHEN v.visible THEN g.notes END,
 'events',CASE WHEN e.id IS NOT NULL THEN jsonb_build_object('id',e.id,'title',e.title,'start_time',e.start_time) END,
 'teams',jsonb_build_object('id',t.id,'name',t.name))
 FROM public.game_results g JOIN public.teams t ON t.id=g.team_id LEFT JOIN public.events e ON e.id=g.event_id
 LEFT JOIN public.competition_match_results r ON r.match_id=g.competition_match_id
 CROSS JOIN LATERAL(SELECT public.history_row_scores_visible(g.competition_id,g.competition_match_id) visible) v
 WHERE g.id=p_id AND (public.can_read_history_row(g.team_id,g.event_id) OR (g.competition_id IS NOT NULL AND public.can_manage_competition_vault(g.competition_id)))
$$;
CREATE OR REPLACE FUNCTION public.read_game_result(p_event_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.history_result_dto(g.id) FROM public.game_results g WHERE g.event_id=p_event_id
$$;
CREATE OR REPLACE FUNCTION public.read_game_history(p_team_id uuid DEFAULT NULL,p_club_id uuid DEFAULT NULL,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(dto ORDER BY played_at DESC),'[]'::jsonb) FROM (
 SELECT g.played_at,public.history_result_dto(g.id) dto FROM public.game_results g JOIN public.teams t ON t.id=g.team_id
 WHERE (p_team_id IS NOT NULL OR p_club_id IS NOT NULL) AND (p_team_id IS NULL OR g.team_id=p_team_id)
 AND (p_club_id IS NULL OR t.club_id=p_club_id)
 AND (public.can_read_history_row(g.team_id,g.event_id) OR (g.competition_id IS NOT NULL AND public.can_manage_competition_vault(g.competition_id)))
 ORDER BY g.played_at DESC LIMIT greatest(1,least(coalesce(p_limit,100),100))) bounded WHERE dto IS NOT NULL
$$;
CREATE OR REPLACE FUNCTION public.protect_competition_game_results() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e public.events%ROWTYPE; m public.competition_matches%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND OLD.competition_id IS NOT NULL AND NEW.team_id IS DISTINCT FROM OLD.team_id THEN RAISE EXCEPTION 'Cannot reassign protected History team' USING ERRCODE='42501';END IF;
 IF NEW.event_id IS NOT NULL THEN
 SELECT * INTO e FROM public.events WHERE id=NEW.event_id;
 IF NOT FOUND OR e.team_id IS DISTINCT FROM NEW.team_id THEN RAISE EXCEPTION 'History event/team mismatch' USING ERRCODE='42501'; END IF;
 IF e.competition_match_id IS NOT NULL THEN
 SELECT * INTO m FROM public.competition_matches WHERE id=e.competition_match_id;
 NEW.competition_id:=m.competition_id;NEW.competition_match_id:=m.id;NEW.competition_side:=e.competition_side;
 ELSIF e.history_competition_id IS NOT NULL THEN
 NEW.competition_id:=e.history_competition_id;NEW.competition_match_id:=e.history_match_id;NEW.competition_side:=e.competition_side;
 ELSE NEW.competition_id:=NULL;NEW.competition_match_id:=NULL;NEW.competition_side:=NULL;
 END IF;
 ELSE
 IF TG_OP='INSERT' THEN NEW.competition_id:=NULL;NEW.competition_match_id:=NULL;NEW.competition_side:=NULL;END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.competition_id IS NOT NULL AND (NEW.competition_id IS DISTINCT FROM OLD.competition_id OR NEW.competition_match_id IS DISTINCT FROM OLD.competition_match_id) THEN
 RAISE EXCEPTION 'Cannot relabel protected History' USING ERRCODE='42501';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zzz_protect_competition_game_results BEFORE INSERT OR UPDATE ON public.game_results FOR EACH ROW EXECUTE FUNCTION public.protect_competition_game_results();
CREATE POLICY history_protected_read ON public.game_results AS RESTRICTIVE FOR SELECT TO authenticated USING(public.history_row_scores_visible(competition_id,competition_match_id) AND public.can_read_history_row(team_id,event_id));
CREATE POLICY history_manager_read ON public.game_results FOR SELECT TO authenticated USING(competition_id IS NOT NULL AND public.can_manage_competition_vault(competition_id));
CREATE POLICY history_protected_insert ON public.game_results AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(competition_id IS NULL OR public.can_manage_competition_vault(competition_id));
CREATE POLICY history_protected_update ON public.game_results AS RESTRICTIVE FOR UPDATE TO authenticated USING(competition_id IS NULL OR public.can_manage_competition_vault(competition_id)) WITH CHECK(competition_id IS NULL OR public.can_manage_competition_vault(competition_id));
CREATE POLICY history_protected_delete ON public.game_results AS RESTRICTIVE FOR DELETE TO authenticated USING(competition_id IS NULL OR public.can_manage_competition_vault(competition_id));
-- Preserve the History association before the FK sets event_id NULL.
CREATE OR REPLACE FUNCTION public.retain_competition_history_link() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF OLD.competition_match_id IS NOT NULL THEN UPDATE public.game_results g SET competition_id=m.competition_id,competition_match_id=m.id,competition_side=OLD.competition_side FROM public.competition_matches m WHERE g.event_id=OLD.id AND m.id=OLD.competition_match_id; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER aaa_retain_history_link BEFORE DELETE ON public.events FOR EACH ROW EXECUTE FUNCTION public.retain_competition_history_link();
-- Scores in broadly visible event rows are compatibility metadata only.
CREATE OR REPLACE FUNCTION public.protect_competition_event_scores() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.history_match_id IS NOT NULL AND (NEW.history_match_id IS DISTINCT FROM OLD.history_match_id OR NEW.history_competition_id IS DISTINCT FROM OLD.history_competition_id OR NEW.team_id IS DISTINCT FROM OLD.team_id) THEN RAISE EXCEPTION 'Cannot relabel archived fixture' USING ERRCODE='42501';END IF;
 IF NEW.competition_match_id IS NOT NULL THEN
 SELECT m.competition_id,m.id INTO NEW.history_competition_id,NEW.history_match_id FROM public.competition_matches m WHERE m.id=NEW.competition_match_id;
 ELSIF TG_OP='INSERT' THEN NEW.history_competition_id:=NULL;NEW.history_match_id:=NULL;END IF;
 IF NEW.history_match_id IS NOT NULL THEN NEW.final_score_home:=NULL;NEW.final_score_away:=NULL;END IF;RETURN NEW;
END $$;
CREATE TRIGGER zzz_protect_competition_event_scores BEFORE INSERT OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.protect_competition_event_scores();
-- Preserve event-only values before clearing compatibility slots; canonical wins.
INSERT INTO public.competition_match_results(match_id,home_score,away_score)
SELECT DISTINCT ON(e.competition_match_id) e.competition_match_id,
CASE WHEN e.competition_side='away' THEN e.final_score_away ELSE e.final_score_home END,
CASE WHEN e.competition_side='away' THEN e.final_score_home ELSE e.final_score_away END
FROM public.events e WHERE e.competition_match_id IS NOT NULL AND (e.final_score_home IS NOT NULL OR e.final_score_away IS NOT NULL)
ORDER BY e.competition_match_id,e.updated_at DESC ON CONFLICT(match_id) DO NOTHING;
INSERT INTO public.competition_match_results(match_id,home_score,away_score)
SELECT DISTINCT ON(g.competition_match_id) g.competition_match_id,
CASE WHEN g.competition_side='away' THEN g.away_score ELSE g.home_score END,
CASE WHEN g.competition_side='away' THEN g.home_score ELSE g.away_score END
FROM public.game_results g WHERE g.competition_match_id IS NOT NULL ORDER BY g.competition_match_id,g.updated_at DESC ON CONFLICT(match_id) DO NOTHING;
UPDATE public.events SET final_score_home=NULL,final_score_away=NULL WHERE competition_match_id IS NOT NULL AND (final_score_home IS NOT NULL OR final_score_away IS NOT NULL);
CREATE OR REPLACE FUNCTION public.sync_competition_result_to_events() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e record; m record;
BEGIN
 SELECT cm.*,c.sport,c.created_by creator INTO m FROM public.competition_matches cm JOIN public.competitions c ON c.id=cm.competition_id WHERE cm.id=NEW.match_id;
 IF NOT FOUND THEN RETURN NEW;END IF;
 IF NEW.home_score IS NOT NULL AND NEW.away_score IS NOT NULL THEN
 FOR e IN SELECT * FROM public.events WHERE competition_match_id=NEW.match_id AND team_id IS NOT NULL LOOP
 INSERT INTO public.game_results(team_id,event_id,sport,home_label,away_label,home_score,away_score,saved_by,played_at)
 VALUES(e.team_id,e.id,coalesce(m.sport,'soccer'),coalesce((SELECT name FROM public.teams WHERE id=e.team_id),'Home'),coalesce(e.opponent,'Opponent'),
 CASE WHEN e.competition_side='away' THEN NEW.away_score ELSE NEW.home_score END,
 CASE WHEN e.competition_side='away' THEN NEW.home_score ELSE NEW.away_score END,coalesce(m.created_by,m.creator),e.event_date)
 ON CONFLICT(event_id) WHERE event_id IS NOT NULL DO UPDATE SET home_score=excluded.home_score,away_score=excluded.away_score;
 END LOOP;END IF;RETURN NEW;
END $$;
CREATE TRIGGER privacy_result_fanout AFTER INSERT OR UPDATE ON public.competition_match_results FOR EACH ROW EXECUTE FUNCTION public.sync_competition_result_to_events();
CREATE OR REPLACE FUNCTION public.save_game_history(p_result jsonb,p_only_if_missing boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=auth.uid(); team uuid:=(p_result->>'team_id')::uuid; event uuid:=nullif(p_result->>'event_id','')::uuid;
 e public.events%ROWTYPE; comp uuid; h integer:=(p_result->>'home_score')::integer; a integer:=(p_result->>'away_score')::integer;
BEGIN
 IF uid IS NULL OR h IS NULL OR a IS NULL OR h<0 OR a<0 THEN RAISE EXCEPTION 'Invalid game result' USING ERRCODE='22023';END IF;
 IF event IS NOT NULL THEN SELECT * INTO e FROM public.events WHERE id=event FOR UPDATE;
 IF NOT FOUND OR e.team_id IS DISTINCT FROM team THEN RAISE EXCEPTION 'Event/team mismatch' USING ERRCODE='42501';END IF;
 IF e.history_competition_id IS NOT NULL AND e.competition_match_id IS NULL THEN RAISE EXCEPTION 'Archived fixture is read-only' USING ERRCODE='42501';END IF;
 IF e.competition_match_id IS NOT NULL THEN SELECT competition_id INTO comp FROM public.competition_matches WHERE id=e.competition_match_id FOR UPDATE;
 IF NOT public.can_manage_competition_vault(comp) THEN RAISE EXCEPTION 'Competition manager required' USING ERRCODE='42501';END IF;
 END IF;END IF;
 IF comp IS NULL AND NOT public.can_manage_game_result(_user_id=>uid,_team_id=>team,_event_id=>event) THEN RAISE EXCEPTION 'Game management forbidden' USING ERRCODE='42501';END IF;
 IF p_only_if_missing AND EXISTS(SELECT 1 FROM public.game_results WHERE event_id=event) THEN RETURN;END IF;
 IF comp IS NOT NULL THEN
 INSERT INTO public.competition_match_results(match_id,home_score,away_score,entered_by) VALUES(e.competition_match_id,CASE WHEN e.competition_side='away' THEN a ELSE h END,CASE WHEN e.competition_side='away' THEN h ELSE a END,uid)
 ON CONFLICT(match_id) DO UPDATE SET home_score=excluded.home_score,away_score=excluded.away_score,entered_by=uid;
 UPDATE public.competition_matches SET status='completed',manually_overridden_at=CASE WHEN source!='manual' THEN coalesce(manually_overridden_at,now()) ELSE manually_overridden_at END WHERE id=e.competition_match_id;
 END IF;
 INSERT INTO public.game_results(team_id,event_id,sport,home_label,away_label,home_score,away_score,period_scores,player_stats,mvp_player_id,mvp_player_name,notes,saved_by)
 VALUES(team,event,p_result->>'sport',p_result->>'home_label',p_result->>'away_label',h,a,coalesce(p_result->'period_scores','[]'),coalesce(p_result->'player_stats','[]'),p_result->>'mvp_player_id',p_result->>'mvp_player_name',p_result->>'notes',uid)
 ON CONFLICT(event_id) WHERE event_id IS NOT NULL DO UPDATE SET home_score=excluded.home_score,away_score=excluded.away_score,period_scores=excluded.period_scores,player_stats=excluded.player_stats,mvp_player_id=excluded.mvp_player_id,mvp_player_name=excluded.mvp_player_name,notes=excluded.notes;
END $$;
-- Protect raw score-bearing JSON while preserving unrelated games and service writers.
CREATE POLICY game_stats_score_privacy ON public.game_player_stats AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(public.history_scores_visible(event_id));
CREATE POLICY game_summary_score_privacy ON public.game_summaries AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(public.history_scores_visible(event_id));

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('history_row_scores_visible','history_scores_visible','can_read_history_row','mask_history_players','history_result_dto','read_game_result','read_game_history','protect_competition_game_results','retain_competition_history_link','protect_competition_event_scores','save_game_history','sync_competition_result_to_events') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
 END LOOP;END $$;
GRANT EXECUTE ON FUNCTION public.history_scores_visible(uuid),public.history_row_scores_visible(uuid,uuid),public.can_read_history_row(uuid,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_game_result(uuid),public.read_game_history(uuid,uuid,integer),public.save_game_history(jsonb,boolean) TO authenticated;
CREATE OR REPLACE FUNCTION public.read_history_player_stats(p_team_id uuid,p_event_id uuid DEFAULT NULL,p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(dto),'[]'::jsonb) FROM (
 SELECT (to_jsonb(s)-'goals_scored'-'assists')||jsonb_build_object('goals_scored',CASE WHEN public.history_scores_visible(e.id) THEN s.goals_scored END,
 'assists',CASE WHEN public.history_scores_visible(e.id) THEN s.assists END,
 'profiles',CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('display_name',p.display_name,'avatar_url',p.avatar_url) END) dto
 FROM public.game_player_stats s JOIN public.events e ON e.id=s.event_id LEFT JOIN public.profiles p ON p.id=s.user_id
 WHERE s.team_id=p_team_id AND e.team_id=p_team_id AND public.can_read_history_row(e.team_id,e.id)
 AND (p_event_id IS NULL OR e.id=p_event_id) AND (p_from IS NULL OR e.event_date>=p_from) AND (p_to IS NULL OR e.event_date<=p_to)
 ORDER BY e.event_date DESC LIMIT 1000) bounded
$$;
CREATE OR REPLACE FUNCTION public.read_history_summary(p_event_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('id',s.id,'event_id',s.event_id,'team_id',s.team_id,'total_game_time',s.total_game_time,
 'half_duration',s.half_duration,'total_substitutions',s.total_substitutions,'formation_used',s.formation_used)
 FROM public.game_summaries s JOIN public.events e ON e.id=s.event_id
 WHERE s.team_id=e.team_id AND e.id=p_event_id AND public.can_read_history_row(e.team_id,e.id)
$$;
CREATE OR REPLACE FUNCTION public.read_history_report_events(p_team_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(row)),'[]'::jsonb) FROM (
 SELECT e.id,e.title,e.event_date,e.opponent FROM public.events e
 WHERE e.team_id=p_team_id AND e.type='game' AND public.can_read_history_row(e.team_id,e.id)
 AND (EXISTS(SELECT 1 FROM public.game_summaries s WHERE s.event_id=e.id) OR EXISTS(SELECT 1 FROM public.game_player_stats s WHERE s.event_id=e.id) OR EXISTS(SELECT 1 FROM public.game_results r WHERE r.event_id=e.id))
 ORDER BY e.event_date DESC LIMIT 100) row
$$;
REVOKE ALL ON FUNCTION public.read_history_player_stats(uuid,uuid,timestamptz,timestamptz),public.read_history_summary(uuid),public.read_history_report_events(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_history_player_stats(uuid,uuid,timestamptz,timestamptz),public.read_history_summary(uuid),public.read_history_report_events(uuid) TO authenticated;-- Existing helper consumers must use the same default/override semantics.
CREATE OR REPLACE FUNCTION public.match_scores_hidden(_match_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce((SELECT coalesce(d.hide_scores,c.hide_scores) FROM competition_matches m
 JOIN competitions c ON c.id=m.competition_id LEFT JOIN competition_divisions d ON d.id=m.division_id
 WHERE m.id=_match_id),true)
$$;
-- Replace legacy ladder with a caller-RLS view below.
-- Serialize against concurrent result saves and fixture deletion. The authorization
-- helper is deliberately identical to manage_results RLS above.
CREATE OR REPLACE FUNCTION public.save_competition_match_result(
 p_match_id uuid, p_home_score integer, p_away_score integer, p_status text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target public.competition_matches%ROWTYPE;
BEGIN
 SELECT * INTO target FROM public.competition_matches WHERE id=p_match_id FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_competition_vault(target.competition_id) THEN
   RAISE EXCEPTION 'Competition manager required' USING ERRCODE = '42501';
 END IF;
 IF p_home_score IS NULL OR p_away_score IS NULL OR p_home_score < 0 OR p_away_score < 0 OR p_status NOT IN ('scheduled','completed','cancelled','postponed') THEN
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
CREATE OR REPLACE VIEW public.competition_ladder WITH (security_invoker=true) AS
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
CREATE TRIGGER competition_result_updated_at BEFORE UPDATE ON public.competition_match_results FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
REVOKE ALL ON FUNCTION public.guard_external_competition_match_edits(),public.sync_competition_match_events(),public.match_scores_hidden(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_scores_hidden(uuid) TO anon,authenticated;
COMMIT;
