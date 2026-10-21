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
