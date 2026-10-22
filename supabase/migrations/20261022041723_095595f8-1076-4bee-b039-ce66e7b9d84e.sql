CREATE TABLE public.media_upload_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, club_id uuid NOT NULL, team_id uuid,
 bucket text NOT NULL, path text NOT NULL, bytes bigint NOT NULL, state text NOT NULL DEFAULT 'pending',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(bucket,path)
);
GRANT ALL ON public.media_upload_reservations TO service_role;
ALTER TABLE public.media_upload_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY media_upload_service_only ON public.media_upload_reservations FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE INDEX media_upload_reservations_scope ON public.media_upload_reservations(club_id,state);
CREATE OR REPLACE FUNCTION public.reserve_measured_media(p_club uuid,p_team uuid,p_bucket text,p_path text,p_bytes bigint,p_vault boolean DEFAULT false) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE me uuid:=auth.uid(); allowance record; used bigint; pending bigint; token uuid; prefix text; seg text[]; authorized boolean;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE='42501'; END IF;
 IF p_bucket NOT IN ('photos','chat-attachments','competition-vault') OR p_bytes<1 OR p_bytes>10485760 OR length(p_path)>512 OR p_path~'(^|/)\.\.?(/|$)' OR p_path~'[%\\]' THEN RAISE EXCEPTION 'Invalid media upload'; END IF;
 prefix:='clubs/'||p_club::text||'/'; seg:=string_to_array(p_path,'/');
 IF left(p_path,length(prefix))<>prefix THEN RAISE EXCEPTION 'Upload must belong to club'; END IF;
 IF p_team IS NOT NULL THEN
  IF seg[3]<>'teams' OR seg[4]<>p_team::text THEN RAISE EXCEPTION 'Upload must belong to team'; END IF;
 ELSE IF seg[3]='teams' THEN RAISE EXCEPTION 'Team scope required'; END IF; END IF;
 authorized:=public.has_role(me,'app_admin',NULL,NULL) OR public.has_role(me,'club_admin',p_club,NULL);
 IF p_team IS NOT NULL THEN
  authorized:=authorized OR public.is_team_member(me,p_team);
 ELSE authorized:=authorized OR public.is_club_member(me,p_club); END IF;
 IF NOT coalesce(authorized,false) THEN RAISE EXCEPTION 'Membership required' USING ERRCODE='42501'; END IF;
 IF p_vault OR p_bucket='competition-vault' THEN
  IF NOT (public.has_role(me,'app_admin',NULL,NULL) OR public.has_role(me,'club_admin',p_club,NULL) OR EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=me AND r.role::text IN ('team_admin','coach','league_admin','competition_admin') AND (r.club_id=p_club OR (p_team IS NOT NULL AND r.team_id=p_team)))) THEN RAISE EXCEPTION 'Staff access required' USING ERRCODE='42501'; END IF;
 END IF;
 -- One lock serializes every scope of a club, including concurrent devices.
 PERFORM pg_advisory_xact_lock(hashtextextended('media:'||p_club::text,0));
 SELECT * INTO allowance FROM public.subscription_media_allowance(p_club,p_team);
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=p_bucket AND name=p_path) THEN RAISE EXCEPTION 'File already exists'; END IF;
 IF EXISTS(SELECT 1 FROM public.media_upload_reservations WHERE bucket=p_bucket AND path=p_path) THEN RAISE EXCEPTION 'Upload already reserved'; END IF;
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id IN ('photos','chat-attachments','competition-vault') AND left(name,length(prefix))=prefix AND (metadata->>'size' IS NULL OR metadata->>'size'!~'^[0-9]+$')) THEN RAISE EXCEPTION 'Storage usage unavailable'; END IF;
 SELECT coalesce(sum((metadata->>'size')::bigint),0) INTO used FROM storage.objects
 WHERE bucket_id IN ('photos','chat-attachments','competition-vault') AND left(name,length(prefix))=prefix
 AND (NOT allowance.team_scoped OR left(name,length(prefix||'teams/'||p_team::text||'/'))=prefix||'teams/'||p_team::text||'/' OR left(name,length(prefix||'vault/teams/'||p_team::text||'/'))=prefix||'vault/teams/'||p_team::text||'/');
 SELECT coalesce(sum(r.bytes),0) INTO pending FROM public.media_upload_reservations r WHERE r.club_id=p_club AND r.state='pending' AND (NOT allowance.team_scoped OR r.team_id=p_team)
 AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=r.bucket AND o.name=r.path);
 IF used+pending+p_bytes>allowance.limit_bytes THEN RAISE EXCEPTION 'Storage allowance full'; END IF;
 INSERT INTO public.media_upload_reservations(user_id,club_id,team_id,bucket,path,bytes) VALUES(me,p_club,p_team,p_bucket,p_path,p_bytes) RETURNING id INTO token;
 RETURN token;
END $$;
REVOKE ALL ON FUNCTION public.reserve_measured_media(uuid,uuid,text,text,bigint,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reserve_measured_media(uuid,uuid,text,text,bigint,boolean) TO authenticated;
CREATE OR REPLACE FUNCTION public.settle_measured_media(p_id uuid,p_completed boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.media_upload_reservations; actual bigint;
BEGIN
 SELECT * INTO r FROM public.media_upload_reservations WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('media:'||r.club_id::text,0));
 SELECT * INTO r FROM public.media_upload_reservations WHERE id=p_id FOR UPDATE;
 IF r.state<>'pending' THEN RETURN; END IF;
 SELECT (metadata->>'size')::bigint INTO actual FROM storage.objects WHERE bucket_id=r.bucket AND name=r.path;
 IF p_completed THEN
  IF actual IS NULL OR actual<>r.bytes THEN RAISE EXCEPTION 'Uploaded size not confirmed'; END IF;
  UPDATE public.media_upload_reservations SET state='completed',updated_at=now() WHERE id=p_id;
 ELSE
  IF actual IS NOT NULL THEN RAISE EXCEPTION 'Uploaded file exists; cannot release reservation'; END IF;
  UPDATE public.media_upload_reservations SET state='aborted',updated_at=now() WHERE id=p_id;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.settle_measured_media(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_measured_media(uuid,boolean) TO service_role;