CREATE OR REPLACE FUNCTION public.read_history_player_stats(p_team_id uuid,p_event_id uuid DEFAULT NULL,p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(dto),'[]'::jsonb) FROM (
 SELECT (to_jsonb(s)-'goals_scored')||jsonb_build_object('goals_scored',CASE WHEN public.history_scores_visible(e.id) THEN s.goals_scored END,
 'profiles',CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('display_name',p.display_name,'avatar_url',p.avatar_url) END) dto
 FROM public.game_player_stats s JOIN public.events e ON e.id=s.event_id LEFT JOIN public.profiles p ON p.id=s.user_id
 WHERE e.team_id=p_team_id AND public.can_read_history_row(e.team_id,e.id)
 AND (p_event_id IS NULL OR e.id=p_event_id) AND (p_from IS NULL OR e.event_date>=p_from) AND (p_to IS NULL OR e.event_date<=p_to)
 ORDER BY e.event_date DESC LIMIT 1000) bounded
$$;
CREATE OR REPLACE FUNCTION public.read_history_summary(p_event_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('id',s.id,'event_id',s.event_id,'team_id',s.team_id,'total_game_time',s.total_game_time,
 'half_duration',s.half_duration,'total_substitutions',s.total_substitutions,'formation_used',s.formation_used)
 FROM public.game_summaries s JOIN public.events e ON e.id=s.event_id
 WHERE e.id=p_event_id AND public.can_read_history_row(e.team_id,e.id)
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
GRANT EXECUTE ON FUNCTION public.read_history_player_stats(uuid,uuid,timestamptz,timestamptz),public.read_history_summary(uuid),public.read_history_report_events(uuid) TO authenticated;