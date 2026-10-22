ALTER FUNCTION public.reserve_measured_media(uuid,uuid,text,text,bigint,boolean) RENAME TO reserve_measured_media_internal;
CREATE OR REPLACE FUNCTION public.reserve_measured_media(p_user uuid,p_club uuid,p_team uuid,p_bucket text,p_path text,p_bytes bigint,p_vault boolean DEFAULT false) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result uuid;
BEGIN
 IF p_user IS NULL THEN RAISE EXCEPTION 'Sign-in required'; END IF;
 PERFORM set_config('request.jwt.claim.sub',p_user::text,true);
 SELECT public.reserve_measured_media_internal(p_club,p_team,p_bucket,p_path,p_bytes,p_vault) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.reserve_measured_media_internal(uuid,uuid,text,text,bigint,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_measured_media_internal(uuid,uuid,text,text,bigint,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.reserve_measured_media(uuid,uuid,uuid,text,text,bigint,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_measured_media(uuid,uuid,uuid,text,text,bigint,boolean) TO service_role;