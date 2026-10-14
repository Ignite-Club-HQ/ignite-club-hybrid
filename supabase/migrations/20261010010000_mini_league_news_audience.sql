ALTER TABLE public.club_news
  ADD COLUMN IF NOT EXISTS target_mini_league_id uuid
    REFERENCES public.mini_leagues(id) ON DELETE CASCADE;

ALTER TABLE public.club_news
  ADD COLUMN IF NOT EXISTS target_competition_id uuid
    REFERENCES public.competitions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS club_news_target_mini_league_idx
  ON public.club_news(target_mini_league_id)
  WHERE target_mini_league_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS club_news_target_competition_idx
  ON public.club_news(target_competition_id)
  WHERE target_competition_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.is_competition_news_admin(_user_id uuid, _competition_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.competition_roles cr
    WHERE cr.competition_id = _competition_id
      AND cr.user_id = _user_id
      AND cr.role IN ('competition_admin', 'admin', 'owner')
  ) OR EXISTS (
    SELECT 1 FROM public.competitions c
    JOIN public.user_roles ur ON ur.club_id = c.organizer_club_id
    WHERE c.id = _competition_id AND ur.user_id = _user_id AND ur.role = 'club_admin'
  )
$$;
REVOKE EXECUTE ON FUNCTION public.is_competition_news_admin(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_competition_news_admin(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_competition_audience(_user_id uuid, _competition_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_competition_news_admin(_user_id, _competition_id)
    OR EXISTS (
      SELECT 1 FROM public.competition_entries ce
      JOIN public.user_roles ur ON ur.team_id = ce.team_id
      WHERE ce.competition_id = _competition_id
        AND ce.status IN ('accepted', 'registered')
        AND ur.user_id = _user_id
    )
$$;
REVOKE EXECUTE ON FUNCTION public.is_competition_audience(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_competition_audience(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_club_news_mini_league_audience()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.target_mini_league_id IS NOT NULL
     AND NEW.target_team_ids IS NOT NULL
     AND cardinality(NEW.target_team_ids) > 0 THEN
    RAISE EXCEPTION 'News can target teams or a mini league, not both';
  END IF;

    IF (CASE WHEN NEW.target_competition_id IS NOT NULL THEN 1 ELSE 0 END)
      + (CASE WHEN NEW.target_mini_league_id IS NOT NULL THEN 1 ELSE 0 END)
      + (CASE WHEN NEW.target_team_ids IS NOT NULL AND cardinality(NEW.target_team_ids) > 0 THEN 1 ELSE 0 END) > 1 THEN
    RAISE EXCEPTION 'News can target only one audience';
  END IF;

  IF NEW.target_mini_league_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.mini_leagues
    WHERE id = NEW.target_mini_league_id
      AND club_id = NEW.club_id
  ) THEN
    RAISE EXCEPTION 'Mini league does not belong to this club';
  END IF;

  IF NEW.target_competition_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.competitions c
    WHERE c.id = NEW.target_competition_id AND c.organizer_club_id = NEW.club_id
  ) THEN
    RAISE EXCEPTION 'Competition news must use the organizer club';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_club_news_mini_league_audience
  ON public.club_news;
CREATE TRIGGER trg_validate_club_news_mini_league_audience
  BEFORE INSERT OR UPDATE ON public.club_news
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_club_news_mini_league_audience();

DROP POLICY IF EXISTS "Club members can view audience news" ON public.club_news;
DROP POLICY IF EXISTS "Mini league members can view targeted club news" ON public.club_news;

CREATE POLICY "Club members can view audience news"
  ON public.club_news
  FOR SELECT
  TO authenticated
  USING (
    is_published
    AND published_at <= now()
    AND (
      (
        target_mini_league_id IS NULL
        AND target_competition_id IS NULL
        AND public.is_club_member(auth.uid(), club_id)
        AND (
          target_team_ids IS NULL
          OR cardinality(target_team_ids) = 0
          OR EXISTS (
            SELECT 1
            FROM unnest(club_news.target_team_ids) AS target(team_id)
            WHERE public.is_team_member(auth.uid(), target.team_id)
          )
        )
      )
      OR (
        target_mini_league_id IS NOT NULL
        AND public.can_view_mini_league(auth.uid(), target_mini_league_id)
      )
      OR (
        target_competition_id IS NOT NULL
        AND public.is_competition_audience(auth.uid(), target_competition_id)
      )
    )
  );

DROP POLICY IF EXISTS "Competition admins can view competition news" ON public.club_news;
CREATE POLICY "Competition admins can view competition news"
  ON public.club_news FOR SELECT TO authenticated
  USING (target_competition_id IS NOT NULL AND public.is_competition_news_admin(auth.uid(), target_competition_id));

CREATE POLICY "Competition admins can insert competition news"
  ON public.club_news FOR INSERT TO authenticated
  WITH CHECK (
    target_competition_id IS NOT NULL
    AND public.is_competition_news_admin(auth.uid(), target_competition_id)
    AND EXISTS (
      SELECT 1 FROM public.competitions c
      WHERE c.id = target_competition_id AND c.organizer_club_id = club_id
    )
  );

CREATE POLICY "Competition admins can update competition news"
  ON public.club_news FOR UPDATE TO authenticated
  USING (target_competition_id IS NOT NULL AND public.is_competition_news_admin(auth.uid(), target_competition_id))
  WITH CHECK (
    target_competition_id IS NOT NULL
    AND public.is_competition_news_admin(auth.uid(), target_competition_id)
    AND EXISTS (
      SELECT 1 FROM public.competitions c
      WHERE c.id = target_competition_id AND c.organizer_club_id = club_id
    )
  );

CREATE POLICY "Competition admins can delete competition news"
  ON public.club_news FOR DELETE TO authenticated
  USING (target_competition_id IS NOT NULL AND public.is_competition_news_admin(auth.uid(), target_competition_id));

CREATE OR REPLACE FUNCTION public.club_news_competition_ids(_club_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id
  FROM public.competitions c
  WHERE c.organizer_club_id = _club_id
    AND public.is_club_member(auth.uid(), _club_id)
  UNION
  SELECT ce.competition_id
  FROM public.competition_entries ce
  JOIN public.teams t ON t.id = ce.team_id
  WHERE t.club_id = _club_id
    AND ce.status IN ('accepted', 'registered')
    AND public.is_club_member(auth.uid(), _club_id)
$$;
REVOKE EXECUTE ON FUNCTION public.club_news_competition_ids(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.club_news_competition_ids(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_mini_league_news(
  _news_id uuid,
  _send_push boolean DEFAULT true
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  news_row public.club_news;
  inserted integer := 0;
  author uuid;
BEGIN
  SELECT * INTO news_row
  FROM public.club_news
  WHERE id = _news_id;

  IF news_row.id IS NULL THEN
    RAISE EXCEPTION 'News post not found';
  END IF;
  IF news_row.target_mini_league_id IS NULL
     OR NOT public.is_club_admin_for(news_row.club_id) THEN
    RAISE EXCEPTION 'Not authorised to notify for this mini-league news';
  END IF;

  author := COALESCE(news_row.author_id, '00000000-0000-0000-0000-000000000000'::uuid);

  WITH audience AS (
    SELECT mlp.parent_user_id AS user_id
    FROM public.mini_league_players mlp
    WHERE mlp.mini_league_id = news_row.target_mini_league_id
      AND mlp.parent_user_id IS NOT NULL
    UNION
    SELECT mla.user_id
    FROM public.mini_league_admins mla
    WHERE mla.mini_league_id = news_row.target_mini_league_id
  ), notifications_insert AS (
    INSERT INTO public.notifications (
      user_id,
      type,
      message,
      related_id,
      club_id,
      skip_push,
      dedupe_key
    )
    SELECT DISTINCT ON (audience.user_id)
      audience.user_id,
      'club_news',
      CASE WHEN news_row.is_important THEN 'Important news: ' ELSE 'New news: ' END || news_row.title,
      news_row.id,
      news_row.club_id,
      NOT _send_push,
      'club_news:' || news_row.id::text || ':' || audience.user_id::text
    FROM audience
    WHERE audience.user_id <> author
    ORDER BY audience.user_id
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO inserted FROM notifications_insert;

  RETURN inserted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_mini_league_news(uuid, boolean)
  FROM anon, public;
GRANT EXECUTE ON FUNCTION public.notify_mini_league_news(uuid, boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_competition_news(
  _news_id uuid,
  _send_push boolean DEFAULT true
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  news_row public.club_news;
  inserted integer := 0;
  author uuid;
BEGIN
  SELECT * INTO news_row FROM public.club_news WHERE id = _news_id;
  IF news_row.id IS NULL OR news_row.target_competition_id IS NULL THEN
    RAISE EXCEPTION 'Competition news post not found';
  END IF;
  IF NOT public.is_competition_news_admin(auth.uid(), news_row.target_competition_id) THEN
    RAISE EXCEPTION 'Not authorized to notify for this competition';
  END IF;

  author := COALESCE(news_row.author_id, '00000000-0000-0000-0000-000000000000'::uuid);
  WITH audience AS (
    SELECT ur.user_id, news_row.club_id AS club_id
    FROM public.competition_entries ce
    JOIN public.user_roles ur ON ur.team_id = ce.team_id
    WHERE ce.competition_id = news_row.target_competition_id
      AND ce.status IN ('accepted', 'registered')
    UNION
    SELECT cr.user_id, news_row.club_id
    FROM public.competition_roles cr
    WHERE cr.competition_id = news_row.target_competition_id
  ), inserted_rows AS (
    INSERT INTO public.notifications (user_id, type, message, related_id, club_id, skip_push, dedupe_key)
    SELECT DISTINCT ON (audience.user_id)
      audience.user_id,
      'club_news',
      CASE WHEN news_row.is_important THEN 'Important news: ' ELSE 'New news: ' END || news_row.title,
      news_row.id,
      audience.club_id,
      NOT _send_push,
      'club_news:' || news_row.id::text || ':' || audience.user_id::text
    FROM audience
    WHERE audience.user_id <> author
    ORDER BY audience.user_id
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO inserted FROM inserted_rows;

  RETURN inserted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_competition_news(uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.notify_competition_news(uuid, boolean) TO authenticated;
