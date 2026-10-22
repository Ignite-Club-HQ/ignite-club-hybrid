DO $$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.reserve_measured_media(uuid,uuid,uuid,text,text,bigint,boolean)'::regprocedure) INTO definition;
 IF position('IF NOT manager AND NOT public.can_manage_competition_vault(sub_id)' in definition)=0 THEN RAISE EXCEPTION 'Unexpected reservation wrapper'; END IF;
 definition:=replace(definition,'IF NOT manager AND NOT public.can_manage_competition_vault(sub_id)','IF NOT public.can_manage_competition_vault(sub_id)');
 definition:=replace(definition,$text$public.has_role(p_user,'team_admin',p_club,p_team)$text$,$text$public.has_role(p_user,'team_admin',NULL,p_team)$text$);
 definition:=replace(definition,$text$public.has_role(p_user,'coach',p_club,p_team)$text$,$text$public.has_role(p_user,'coach',NULL,p_team)$text$);
 EXECUTE definition;
 SELECT pg_get_functiondef('public.reserve_measured_media_internal(uuid,uuid,text,text,bigint,boolean)'::regprocedure) INTO definition;
 IF position('IF NOT coalesce(authorized,false)' in definition)=0 THEN RAISE EXCEPTION 'Unexpected internal reservation'; END IF;
 definition:=replace(definition,'IF NOT coalesce(authorized,false)', 'IF seg[3]=''competitions'' THEN authorized:=public.can_manage_competition_vault(seg[4]::uuid); ELSIF seg[3]=''mini-leagues'' THEN authorized:=authorized OR EXISTS(SELECT 1 FROM public.mini_league_admins WHERE mini_league_id=seg[4]::uuid AND user_id=me); END IF; IF NOT coalesce(authorized,false)');
 definition:=replace(definition,$text$IF p_vault OR p_bucket='competition-vault' THEN$text$, $text$IF (p_vault OR p_bucket='competition-vault') AND seg[3] NOT IN ('competitions','mini-leagues') THEN$text$);
 EXECUTE definition;
END $$;
REVOKE ALL ON FUNCTION public.reserve_measured_media_internal(uuid,uuid,text,text,bigint,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reserve_measured_media(uuid,uuid,uuid,text,text,bigint,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_measured_media_internal(uuid,uuid,text,text,bigint,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_measured_media(uuid,uuid,uuid,text,text,bigint,boolean) TO service_role;
CREATE POLICY measured_competition_vault_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='competition-vault' AND split_part(name,'/',1)='clubs' AND split_part(name,'/',3)='competitions' AND CASE WHEN split_part(name,'/',2)~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND split_part(name,'/',4)~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN EXISTS(SELECT 1 FROM public.competitions c WHERE c.id=split_part(name,'/',4)::uuid AND c.organizer_club_id=split_part(name,'/',2)::uuid AND public.can_manage_competition_vault(c.id)) ELSE false END);
CREATE POLICY measured_competition_vault_delete ON storage.objects FOR DELETE TO authenticated USING(bucket_id='competition-vault' AND split_part(name,'/',1)='clubs' AND split_part(name,'/',3)='competitions' AND CASE WHEN split_part(name,'/',2)~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND split_part(name,'/',4)~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN EXISTS(SELECT 1 FROM public.competitions c WHERE c.id=split_part(name,'/',4)::uuid AND c.organizer_club_id=split_part(name,'/',2)::uuid AND public.can_manage_competition_vault(c.id)) ELSE false END);