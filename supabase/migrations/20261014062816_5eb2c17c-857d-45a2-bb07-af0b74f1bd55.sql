CREATE OR REPLACE FUNCTION public.club_is_paid(_club_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT ((cs.is_pro OR cs.is_pro_football OR cs.admin_pro_override OR cs.admin_pro_football_override)
              AND (cs.expires_at IS NULL OR cs.expires_at > now()))
           OR (cs.is_trial AND (cs.trial_ends_at IS NULL OR cs.trial_ends_at > now()))
    FROM public.club_subscriptions cs WHERE cs.club_id = _club_id LIMIT 1), false)
$$;

-- Lists stored files older than 6 months that belong to free clubs.
CREATE OR REPLACE FUNCTION public.list_expired_free_media(_limit int DEFAULT 1000)
RETURNS TABLE(bucket_id text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, storage AS $$
  WITH o AS (
    SELECT so.bucket_id, so.name,
      CASE WHEN so.name LIKE 'clubs/%' THEN split_part(so.name, '/', 2) ELSE split_part(so.name, '/', 1) END AS club_txt
    FROM storage.objects so
    WHERE so.bucket_id IN ('photos', 'chat-attachments')
      AND so.created_at < now() - interval '6 months'
      AND so.name NOT LIKE '%/drive-sync/%'
  )
  SELECT o.bucket_id, o.name FROM o
  JOIN public.clubs c ON c.id::text = o.club_txt
  WHERE NOT public.club_is_paid(c.id)
  LIMIT _limit
$$;

-- Removes gallery and vault records older than 6 months for free clubs.
CREATE OR REPLACE FUNCTION public.purge_expired_free_media_rows()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n1 int; n2 int;
BEGIN
  DELETE FROM public.photos p
   WHERE p.created_at < now() - interval '6 months' AND NOT public.club_is_paid(p.club_id);
  GET DIAGNOSTICS n1 = ROW_COUNT;
  DELETE FROM public.vault_files v
   WHERE v.created_at < now() - interval '6 months' AND v.is_external_link = false
     AND v.drive_file_id IS NULL AND v.club_id IS NOT NULL AND NOT public.club_is_paid(v.club_id);
  GET DIAGNOSTICS n2 = ROW_COUNT;
  RETURN n1 + n2;
END $$;

REVOKE ALL ON FUNCTION public.club_is_paid(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_expired_free_media(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_expired_free_media_rows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_is_paid(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_expired_free_media(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_free_media_rows() TO service_role;