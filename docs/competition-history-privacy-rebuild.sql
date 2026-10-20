-- STAGED REPLACEMENT DESIGN: do NOT run the old 20261103000000 migration.
-- This preservation layer must replace its destructive History/cache section,
-- before any History deletion. It is not a standalone deployment migration.
-- Existing fixture/results privacy setup and atomic result RPC remain required.
BEGIN;

-- Preserve History rows, JSON, MVPs and future writes in protected storage.
-- A restrictive policy intersects EVERY existing permissive read policy.
CREATE OR REPLACE FUNCTION public.history_scores_visible(p_event uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id=p_event
    AND e.competition_match_id IS NOT NULL
    AND NOT public.competition_scores_visible(e.competition_match_id)
  )
$$;
REVOKE ALL ON FUNCTION public.history_scores_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.history_scores_visible(uuid) TO authenticated;
CREATE POLICY protected_history_scores ON public.game_results AS RESTRICTIVE
FOR SELECT TO authenticated USING (public.history_scores_visible(event_id));

-- Only a competition manager can modify its mirrored results. A team role or
-- saved_by alone is never authority to alter another competition's result.
-- Command-specific policies keep visible competition member reads intact.
CREATE OR REPLACE FUNCTION public.can_write_competition_history(p_event uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT NOT EXISTS (SELECT 1 FROM public.events e JOIN public.competition_matches m ON m.id=e.competition_match_id
 WHERE e.id=p_event AND NOT public.can_manage_competition_vault(m.competition_id))
$$;
REVOKE ALL ON FUNCTION public.can_write_competition_history(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_write_competition_history(uuid) TO authenticated;
CREATE POLICY competition_history_insert ON public.game_results AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK(public.can_write_competition_history(event_id));
CREATE POLICY competition_history_update ON public.game_results AS RESTRICTIVE FOR UPDATE TO authenticated
USING(public.can_write_competition_history(event_id)) WITH CHECK(public.can_write_competition_history(event_id));
CREATE POLICY competition_history_delete ON public.game_results AS RESTRICTIVE FOR DELETE TO authenticated
USING(public.can_write_competition_history(event_id));

-- Explicit original-human authorization, not a service-role browser read.
CREATE OR REPLACE FUNCTION public.can_read_history_row(p_team uuid,p_event uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT auth.uid() IS NOT NULL AND (
   public.can_manage_game_result(auth.uid(),p_team,p_event)
   OR EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.team_id=p_team)
   OR EXISTS(SELECT 1 FROM public.events e JOIN public.competition_matches m ON m.id=e.competition_match_id
             WHERE e.id=p_event AND public.can_manage_competition_vault(m.competition_id))
 )
$$;
REVOKE ALL ON FUNCTION public.can_read_history_row(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_history_row(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mask_history_players(p_players jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(safe),'[]'::jsonb) FROM (
  SELECT coalesce(jsonb_object_agg(k,v) FILTER (WHERE k IN
   ('id','name','secondsPlayed','finalPosition','fouls','isFouledOut','isInjured','yellow','red','award')
   AND jsonb_typeof(v) NOT IN ('array','object')),'{}'::jsonb) AS safe
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_players)='array' THEN p_players ELSE '[]'::jsonb END)
   WITH ORDINALITY AS player(value,position)
  CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(player.value)='object' THEN player.value ELSE '{}'::jsonb END) AS fields(k,v)
  GROUP BY player.position ORDER BY player.position
 ) bounded
$$;
REVOKE ALL ON FUNCTION public.mask_history_players(jsonb) FROM PUBLIC;

-- No hidden score copy in the broadly visible events row. The result DTO
-- overlays authorized canonical scores for calendar/History readers instead.
CREATE OR REPLACE FUNCTION public.read_game_history(
 p_team_id uuid DEFAULT NULL,p_club_id uuid DEFAULT NULL,p_limit integer DEFAULT 100
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(dto ORDER BY played_at DESC),'[]'::jsonb) FROM (
   SELECT gr.played_at,
   (to_jsonb(gr) - 'home_score' - 'away_score' - 'period_scores' - 'player_stats' - 'notes') ||
   jsonb_build_object(
    'home_score',CASE WHEN public.history_scores_visible(gr.event_id) THEN coalesce(
      CASE WHEN e.competition_side='away' THEN r.away_score ELSE r.home_score END,gr.home_score) END,
    'away_score',CASE WHEN public.history_scores_visible(gr.event_id) THEN coalesce(
      CASE WHEN e.competition_side='away' THEN r.home_score ELSE r.away_score END,gr.away_score) END,
    'scores_hidden',NOT public.history_scores_visible(gr.event_id),
    'period_scores',CASE WHEN public.history_scores_visible(gr.event_id) THEN gr.period_scores ELSE '[]'::jsonb END,
    'player_stats',CASE WHEN public.history_scores_visible(gr.event_id) THEN gr.player_stats ELSE public.mask_history_players(gr.player_stats) END,
    'notes',CASE WHEN public.history_scores_visible(gr.event_id) THEN gr.notes ELSE NULL END,
    'events',CASE WHEN e.id IS NOT NULL THEN jsonb_build_object('id',e.id,'title',e.title,'start_time',e.start_time) END,
    'teams',jsonb_build_object('id',t.id,'name',t.name)
   ) AS dto
   FROM public.game_results gr JOIN public.teams t ON t.id=gr.team_id
   LEFT JOIN public.events e ON e.id=gr.event_id
   LEFT JOIN public.competition_match_results r ON r.match_id=e.competition_match_id
   WHERE (p_team_id IS NOT NULL OR p_club_id IS NOT NULL)
    AND (p_team_id IS NULL OR gr.team_id=p_team_id) AND (p_club_id IS NULL OR t.club_id=p_club_id)
    AND public.can_read_history_row(gr.team_id,gr.event_id)
   ORDER BY gr.played_at DESC LIMIT greatest(1,least(coalesce(p_limit,100),100))
 ) bounded
$$;
REVOKE ALL ON FUNCTION public.read_game_history(uuid,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_game_history(uuid,uuid,integer) TO authenticated;

-- Result fan-out updates scores only. Never replace quarter/player/MVP fields.
CREATE OR REPLACE FUNCTION public.sync_competition_result_to_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e record; m record; home integer; away integer;
BEGIN
 SELECT cm.*,c.created_by AS competition_creator,c.sport AS competition_sport
 INTO m FROM public.competition_matches cm JOIN public.competitions c ON c.id=cm.competition_id WHERE cm.id=NEW.match_id;
 IF NOT FOUND OR NEW.home_score IS NULL OR NEW.away_score IS NULL THEN RETURN NEW; END IF;
 FOR e IN SELECT * FROM public.events WHERE competition_match_id=NEW.match_id LOOP
  home := CASE WHEN e.competition_side='away' THEN NEW.away_score ELSE NEW.home_score END;
  away := CASE WHEN e.competition_side='away' THEN NEW.home_score ELSE NEW.away_score END;
  INSERT INTO public.game_results(team_id,event_id,sport,home_label,away_label,home_score,away_score,saved_by,played_at)
  VALUES(e.team_id,e.id,coalesce(m.competition_sport,'soccer'),
    coalesce((SELECT name FROM public.teams WHERE id=e.team_id),'Home'),coalesce(e.opponent,'Opponent'),
    home,away,coalesce(m.created_by,m.competition_creator),coalesce(e.event_date,now()))
  ON CONFLICT(event_id) DO UPDATE SET home_score=excluded.home_score,away_score=excluded.away_score,updated_at=now();
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_competition_result_to_events() FROM PUBLIC,anon,authenticated;

-- Raw cache rows remain stored and service sync remains authorized. Restrictive
-- RLS intersects existing public policies rather than revoking every screen.
CREATE OR REPLACE FUNCTION public.playhq_game_scores_visible(p_game text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.competition_matches m
 WHERE m.source='playhq' AND m.external_id=p_game AND NOT public.competition_scores_visible(m.id))
$$;
CREATE OR REPLACE FUNCTION public.playhq_grade_scores_visible(p_grade text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.playhq_fixtures f JOIN public.competition_matches m
 ON m.source='playhq' AND m.external_id=f.playhq_game_id
 WHERE f.playhq_grade_id=p_grade AND NOT public.competition_scores_visible(m.id))
$$;
REVOKE ALL ON FUNCTION public.playhq_game_scores_visible(text),public.playhq_grade_scores_visible(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.playhq_game_scores_visible(text),public.playhq_grade_scores_visible(text) TO anon,authenticated;
ALTER TABLE public.playhq_fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playhq_ladder ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playhq_player_stats ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.playhq_fixtures,public.playhq_ladder,public.playhq_player_stats TO anon,authenticated;
GRANT ALL ON public.playhq_fixtures,public.playhq_ladder,public.playhq_player_stats TO service_role;
CREATE POLICY protected_playhq_fixtures ON public.playhq_fixtures AS RESTRICTIVE FOR SELECT TO anon,authenticated
USING(public.playhq_game_scores_visible(playhq_game_id));
CREATE POLICY protected_playhq_stats ON public.playhq_player_stats AS RESTRICTIVE FOR SELECT TO anon,authenticated
USING(public.playhq_game_scores_visible(playhq_game_id));
-- A published aggregate cannot subtract one hidden game safely. Only that
-- affected grade is withheld; unaffected grades and authorized managers remain.
CREATE POLICY protected_playhq_ladder ON public.playhq_ladder AS RESTRICTIVE FOR SELECT TO anon,authenticated
USING(public.playhq_grade_scores_visible(playhq_grade_id));
COMMIT;