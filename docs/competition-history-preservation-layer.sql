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
 SELECT CASE WHEN p_event IS NULL THEN true ELSE coalesce((SELECT CASE WHEN e.competition_match_id IS NULL THEN true
 ELSE public.competition_scores_visible(e.competition_match_id) END FROM public.events e WHERE e.id=p_event),false) END
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
 IF NEW.event_id IS NOT NULL THEN
 SELECT * INTO e FROM public.events WHERE id=NEW.event_id;
 IF NOT FOUND OR e.team_id IS DISTINCT FROM NEW.team_id THEN RAISE EXCEPTION 'History event/team mismatch' USING ERRCODE='42501'; END IF;
 IF e.competition_match_id IS NOT NULL THEN
 SELECT * INTO m FROM public.competition_matches WHERE id=e.competition_match_id;
 NEW.competition_id:=m.competition_id;NEW.competition_match_id:=m.id;NEW.competition_side:=e.competition_side;
 ELSIF TG_OP='UPDATE' AND OLD.competition_id IS NOT NULL THEN
 RAISE EXCEPTION 'Cannot unlink protected History' USING ERRCODE='42501';
 END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.competition_id IS NOT NULL AND (NEW.competition_id IS DISTINCT FROM OLD.competition_id OR NEW.competition_match_id IS DISTINCT FROM OLD.competition_match_id) THEN
 RAISE EXCEPTION 'Cannot relabel protected History' USING ERRCODE='42501';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zzz_protect_competition_game_results BEFORE INSERT OR UPDATE ON public.game_results FOR EACH ROW EXECUTE FUNCTION public.protect_competition_game_results();
CREATE POLICY history_protected_read ON public.game_results AS RESTRICTIVE FOR SELECT TO authenticated USING(public.history_row_scores_visible(competition_id,competition_match_id));
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
BEGIN IF NEW.competition_match_id IS NOT NULL THEN NEW.final_score_home:=NULL;NEW.final_score_away:=NULL;END IF;RETURN NEW;END $$;
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
CREATE OR REPLACE FUNCTION public.read_competition_playhq(p_competition_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('matches',coalesce((SELECT jsonb_agg(jsonb_build_object('tenant',coalesce(c.external_tenant,'default'),'external_id',m.external_id,'external_home_team_id',m.external_home_team_id,'external_away_team_id',m.external_away_team_id,'home_team_name',m.home_team_name,'away_team_name',m.away_team_name,'division_id',m.division_id,'competition_divisions',jsonb_build_object('name',d.name))) FROM public.competition_matches m LEFT JOIN public.competition_divisions d ON d.id=m.division_id WHERE m.competition_id=p_competition_id AND m.source='playhq'),'[]'::jsonb),
 'stats',coalesce((SELECT jsonb_agg(jsonb_build_object('playhq_game_id',s.playhq_game_id,'playhq_team_id',s.playhq_team_id,'playhq_player_id',s.playhq_player_id,'player_name',s.player_name,'stats',s.stats,'tenant',coalesce(c.external_tenant,'default'))) FROM public.playhq_player_stats s JOIN public.competition_matches m ON m.external_id=s.playhq_game_id AND m.source='playhq' WHERE m.competition_id=c.id AND public.competition_scores_visible(m.id)),'[]'::jsonb),
 'links',coalesce((SELECT jsonb_agg(jsonb_build_object('playhq_player_id',l.playhq_player_id,'mine',true,'tenant',l.tenant)) FROM public.playhq_player_links l WHERE l.user_id=auth.uid() AND l.tenant=coalesce(c.external_tenant,'default') AND EXISTS(SELECT 1 FROM public.playhq_player_stats s JOIN public.competition_matches m ON m.external_id=s.playhq_game_id WHERE m.competition_id=c.id AND s.playhq_player_id=l.playhq_player_id AND public.competition_scores_visible(m.id))),'[]'::jsonb))
 FROM public.competitions c WHERE c.id=p_competition_id AND public.can_view_competition(auth.uid(),c.id)
$$;
CREATE OR REPLACE FUNCTION public.playhq_game_scores_visible(p_game text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.competition_matches m WHERE m.source='playhq' AND m.external_id=p_game)
 AND NOT EXISTS(SELECT 1 FROM public.competition_matches m WHERE m.source='playhq' AND m.external_id=p_game AND (NOT public.competition_scores_visible(m.id) OR NOT public.can_view_competition(auth.uid(),m.competition_id)))
$$;
CREATE POLICY protected_playhq_fixtures ON public.playhq_fixtures AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(public.playhq_game_scores_visible(playhq_game_id));
CREATE POLICY protected_playhq_stats ON public.playhq_player_stats AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(public.playhq_game_scores_visible(playhq_game_id));
-- Raw all-game aggregates cannot be selectively masked. The existing canonical
-- competition_ladder is rebuilt from only authorized matches in this migration.
CREATE POLICY protected_playhq_ladder ON public.playhq_ladder AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(
 EXISTS(SELECT 1 FROM public.competitions c WHERE c.external_id=playhq_grade_id AND c.source='playhq' AND public.can_manage_competition_vault(c.id))
 OR (EXISTS(SELECT 1 FROM public.playhq_fixtures f WHERE f.playhq_grade_id=playhq_ladder.playhq_grade_id)
 AND NOT EXISTS(SELECT 1 FROM public.playhq_fixtures f WHERE f.playhq_grade_id=playhq_ladder.playhq_grade_id AND NOT public.playhq_game_scores_visible(f.playhq_game_id))));
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('history_row_scores_visible','history_scores_visible','can_read_history_row','mask_history_players','history_result_dto','read_game_result','read_game_history','protect_competition_game_results','retain_competition_history_link','protect_competition_event_scores','save_game_history','sync_competition_result_to_events','read_competition_playhq','playhq_game_scores_visible') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
 END LOOP;END $$;
GRANT EXECUTE ON FUNCTION public.history_scores_visible(uuid),public.history_row_scores_visible(uuid,uuid),public.playhq_game_scores_visible(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_game_result(uuid),public.read_game_history(uuid,uuid,integer),public.save_game_history(jsonb,boolean),public.read_competition_playhq(uuid) TO authenticated;