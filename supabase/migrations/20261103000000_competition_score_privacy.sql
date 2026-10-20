-- Raw results are never readable through fixture metadata, including SELECT *.
BEGIN;
ALTER TABLE public.competitions ADD COLUMN hide_scores boolean NOT NULL DEFAULT false;
ALTER TABLE public.competition_divisions ADD COLUMN hide_scores boolean;
CREATE FUNCTION public.competition_scores_visible(match_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT EXISTS (SELECT 1 FROM competition_matches m JOIN competitions c ON c.id=m.competition_id
 LEFT JOIN competition_divisions d ON d.id=m.division_id
 WHERE m.id=match_id AND (can_manage_competition_vault(c.id) OR NOT coalesce(d.hide_scores,c.hide_scores)))
$$;
REVOKE ALL ON FUNCTION public.competition_scores_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.competition_scores_visible(uuid) TO anon, authenticated;
CREATE TABLE public.competition_match_results (
 match_id uuid PRIMARY KEY REFERENCES public.competition_matches(id) ON DELETE CASCADE,
 home_score integer, away_score integer
);
ALTER TABLE public.competition_match_results ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.competition_match_results TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.competition_match_results TO authenticated;
CREATE POLICY visible_results ON public.competition_match_results FOR SELECT USING (
 public.competition_scores_visible(match_id) AND EXISTS (SELECT 1 FROM public.competition_matches m WHERE m.id=match_id));
CREATE POLICY manage_results ON public.competition_match_results FOR ALL TO authenticated
 USING (EXISTS (SELECT 1 FROM public.competition_matches m WHERE m.id=match_id AND public.can_manage_competition_vault(m.competition_id)))
 WITH CHECK (EXISTS (SELECT 1 FROM public.competition_matches m WHERE m.id=match_id AND public.can_manage_competition_vault(m.competition_id)));
INSERT INTO public.competition_match_results SELECT id,home_score,away_score FROM public.competition_matches WHERE home_score IS NOT NULL OR away_score IS NOT NULL;
UPDATE public.competition_matches SET home_score=NULL,away_score=NULL;
-- Direct frontend writes target results; reject accidental legacy writes rather than leak.
ALTER TABLE public.competition_matches ADD CONSTRAINT scores_stored_separately CHECK (home_score IS NULL AND away_score IS NULL);
-- Legacy aggregate outputs must not expose historic derived scores.
REVOKE SELECT ON public.competition_ladder FROM anon, authenticated;
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
COMMIT;
