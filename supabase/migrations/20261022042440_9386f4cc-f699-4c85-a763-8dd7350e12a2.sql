CREATE OR REPLACE FUNCTION public.subscription_media_allowance(p_club uuid,p_team uuid DEFAULT NULL) RETURNS TABLE(base_bytes bigint,limit_bytes bigint,team_scoped boolean,premium boolean) LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE s public.club_subscriptions; t public.team_subscriptions; club_pro boolean:=false; team_pro boolean:=false; base bigint; extra bigint:=0;
BEGIN
 IF p_club IS NULL THEN RAISE EXCEPTION 'Club required'; END IF;
 IF auth.role()<>'service_role' AND NOT public.has_role(auth.uid(),'app_admin',NULL,NULL) AND NOT EXISTS(SELECT 1 FROM public.user_roles r LEFT JOIN public.teams rt ON rt.id=r.team_id WHERE r.user_id=auth.uid() AND (r.club_id=p_club OR rt.club_id=p_club)) THEN RAISE EXCEPTION 'Club membership required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clubs WHERE id=p_club) THEN RAISE EXCEPTION 'Club not found'; END IF;
 SELECT * INTO s FROM public.club_subscriptions WHERE club_id=p_club;
 club_pro:=coalesce(s.admin_pro_override OR s.admin_pro_football_override OR ((s.is_pro OR s.is_pro_football) AND (s.expires_at IS NULL OR s.expires_at>now())) OR (s.is_trial AND s.trial_ends_at>now()),false);
 IF p_team IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.teams WHERE id=p_team AND club_id=p_club AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Team does not belong to club'; END IF;
  SELECT * INTO t FROM public.team_subscriptions WHERE team_id=p_team;
  team_pro:=coalesce(t.admin_pro_override OR t.admin_pro_football_override OR ((t.is_pro OR t.is_pro_football) AND (t.expires_at IS NULL OR t.expires_at>now())) OR (t.is_trial AND t.trial_ends_at>now()),false);
 END IF;
 IF club_pro THEN base:=CASE WHEN s.plan::text='unlimited' OR (s.pricing_version IS DISTINCT FROM 'usd_v2' AND s.plan::text IN ('starter','standard')) THEN 5368709120 ELSE 3221225472 END;
 ELSIF team_pro THEN base:=1073741824;
 ELSE base:=262144000; END IF;
 IF NOT (team_pro AND NOT club_pro) THEN extra:=greatest(coalesce(s.storage_purchased_gb,0),0)::bigint*1073741824; END IF;
 RETURN QUERY SELECT base,base+extra,team_pro AND NOT club_pro,club_pro OR team_pro;
END $$;
REVOKE ALL ON FUNCTION public.subscription_media_allowance(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.subscription_media_allowance(uuid,uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.reserve_measured_media(p_user uuid,p_club uuid,p_team uuid,p_bucket text,p_path text,p_bytes bigint,p_vault boolean DEFAULT false) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result uuid; previous_sub text; seg text[]; sub_id uuid; manager boolean;
BEGIN
 IF p_user IS NULL OR p_club IS NULL OR p_bucket IS NULL OR p_path IS NULL OR p_bytes IS NULL OR p_vault IS NULL THEN RAISE EXCEPTION 'Complete upload scope required'; END IF;
 IF p_bytes<1 OR p_bytes>10485760 OR length(p_path)>512 OR p_path~'[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid media upload'; END IF;
 seg:=string_to_array(p_path,'/');
 IF cardinality(seg)<4 OR EXISTS(SELECT 1 FROM unnest(seg) v WHERE v='') THEN RAISE EXCEPTION 'Invalid upload path'; END IF;
 previous_sub:=current_setting('request.jwt.claim.sub',true);
 PERFORM set_config('request.jwt.claim.sub',p_user::text,true);
 manager:=public.has_role(p_user,'app_admin',NULL,NULL) OR public.has_role(p_user,'club_admin',p_club,NULL);
 IF seg[3]='mini-leagues' THEN
  BEGIN sub_id:=seg[4]::uuid; EXCEPTION WHEN others THEN RAISE EXCEPTION 'Invalid mini-league'; END;
  IF NOT EXISTS(SELECT 1 FROM public.mini_leagues WHERE id=sub_id AND club_id=p_club) THEN RAISE EXCEPTION 'Mini-league does not belong to club'; END IF;
  IF NOT manager AND NOT EXISTS(SELECT 1 FROM public.mini_league_admins WHERE mini_league_id=sub_id AND user_id=p_user) THEN RAISE EXCEPTION 'Mini-league staff access required' USING ERRCODE='42501'; END IF;
 ELSIF seg[3]='competitions' OR p_bucket='competition-vault' THEN
  IF seg[3]<>'competitions' THEN RAISE EXCEPTION 'Competition scope required'; END IF;
  BEGIN sub_id:=seg[4]::uuid; EXCEPTION WHEN others THEN RAISE EXCEPTION 'Invalid competition'; END;
  IF NOT EXISTS(SELECT 1 FROM public.competitions WHERE id=sub_id AND organizer_club_id=p_club) THEN RAISE EXCEPTION 'Competition does not belong to club'; END IF;
  IF NOT manager AND NOT public.can_manage_competition_vault(sub_id) THEN RAISE EXCEPTION 'Competition staff access required' USING ERRCODE='42501'; END IF;
 END IF;
 IF p_vault AND NOT manager THEN
  IF p_team IS NOT NULL AND NOT (public.has_role(p_user,'team_admin',p_club,p_team) OR public.has_role(p_user,'coach',p_club,p_team)) THEN RAISE EXCEPTION 'Team staff access required' USING ERRCODE='42501'; END IF;
  IF p_team IS NULL AND seg[3] NOT IN ('competitions','mini-leagues') THEN RAISE EXCEPTION 'Club staff access required' USING ERRCODE='42501'; END IF;
 END IF;
 SELECT public.reserve_measured_media_internal(p_club,p_team,p_bucket,p_path,p_bytes,p_vault) INTO result;
 PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.reserve_measured_media(uuid,uuid,uuid,text,text,bigint,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_measured_media(uuid,uuid,uuid,text,text,bigint,boolean) TO service_role;
CREATE OR REPLACE FUNCTION public.settle_measured_media(p_id uuid,p_completed boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.media_upload_reservations; actual bigint; allowance record; prefix text; used bigint; pending bigint;
BEGIN
 IF p_id IS NULL OR p_completed IS NULL THEN RAISE EXCEPTION 'Upload confirmation required'; END IF;
 SELECT * INTO r FROM public.media_upload_reservations WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('media:'||r.club_id::text,0));
 SELECT * INTO r FROM public.media_upload_reservations WHERE id=p_id FOR UPDATE;
 IF r.state<>'pending' THEN RETURN; END IF;
 SELECT (metadata->>'size')::bigint INTO actual FROM storage.objects WHERE bucket_id=r.bucket AND name=r.path;
 IF p_completed THEN
  IF actual IS NULL OR actual<>r.bytes THEN RAISE EXCEPTION 'Uploaded size not confirmed'; END IF;
  SELECT * INTO allowance FROM public.subscription_media_allowance(r.club_id,r.team_id);
  prefix:='clubs/'||r.club_id::text||'/';
  IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id IN ('photos','chat-attachments','competition-vault') AND left(name,length(prefix))=prefix AND (metadata->>'size' IS NULL OR metadata->>'size'!~'^[0-9]+$')) THEN RAISE EXCEPTION 'Storage usage unavailable'; END IF;
  SELECT coalesce(sum((metadata->>'size')::bigint),0) INTO used FROM storage.objects WHERE bucket_id IN ('photos','chat-attachments','competition-vault') AND left(name,length(prefix))=prefix AND (NOT allowance.team_scoped OR left(name,length(prefix||'teams/'||r.team_id::text||'/'))=prefix||'teams/'||r.team_id::text||'/' OR left(name,length(prefix||'vault/teams/'||r.team_id::text||'/'))=prefix||'vault/teams/'||r.team_id::text||'/');
  SELECT coalesce(sum(m.bytes),0) INTO pending FROM public.media_upload_reservations m WHERE m.club_id=r.club_id AND m.state='pending' AND (NOT allowance.team_scoped OR m.team_id=r.team_id) AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=m.bucket AND o.name=m.path);
  IF used+pending>allowance.limit_bytes THEN RAISE EXCEPTION 'Current storage allowance exceeded; existing files retained'; END IF;
  UPDATE public.media_upload_reservations SET state='completed',updated_at=now() WHERE id=p_id;
 ELSE
  IF actual IS NOT NULL THEN RAISE EXCEPTION 'Uploaded file exists; cannot release reservation'; END IF;
  UPDATE public.media_upload_reservations SET state='aborted',updated_at=now() WHERE id=p_id;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.settle_measured_media(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_measured_media(uuid,boolean) TO service_role;