CREATE OR REPLACE FUNCTION public.club_team_capacity(p_club uuid) RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.club_subscriptions; paid boolean; trial boolean;
BEGIN
 SELECT * INTO s FROM public.club_subscriptions WHERE club_id=p_club;
 IF NOT FOUND THEN RETURN 20; END IF;
 paid := coalesce(s.admin_pro_override OR s.admin_pro_football_override OR ((s.is_pro OR s.is_pro_football) AND (s.expires_at IS NULL OR s.expires_at>now())),false);
 trial := coalesce(s.is_trial AND s.trial_ends_at>now(),false);
 IF NOT (paid OR trial) THEN RETURN 20; END IF;
 IF paid AND s.plan::text='unlimited' AND s.team_limit IS NULL THEN RETURN 100000; END IF;
 IF s.team_limit IS NULL OR s.team_limit<1 THEN RETURN 20; END IF;
 IF trial AND NOT paid THEN RETURN least(20,s.team_limit); END IF;
 RETURN s.team_limit;
END $$;
REVOKE ALL ON FUNCTION public.club_team_capacity(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.club_team_capacity(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.subscription_media_allowance(p_club uuid,p_team uuid DEFAULT NULL) RETURNS TABLE(base_bytes bigint,limit_bytes bigint,team_scoped boolean,premium boolean) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.club_subscriptions; t public.team_subscriptions; club_pro boolean:=false; team_pro boolean:=false; base bigint; extra bigint:=0;
BEGIN
 IF auth.role()<>'service_role' AND NOT public.has_role(auth.uid(),'app_admin',NULL,NULL) AND NOT EXISTS(SELECT 1 FROM public.user_roles r LEFT JOIN public.teams rt ON rt.id=r.team_id WHERE r.user_id=auth.uid() AND (r.club_id=p_club OR rt.club_id=p_club)) THEN RAISE EXCEPTION 'Club membership required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clubs WHERE id=p_club) THEN RAISE EXCEPTION 'Club not found'; END IF;
 SELECT * INTO s FROM public.club_subscriptions WHERE club_id=p_club;
 club_pro:=coalesce(s.admin_pro_override OR s.admin_pro_football_override OR ((s.is_pro OR s.is_pro_football) AND (s.expires_at IS NULL OR s.expires_at>now())) OR (s.is_trial AND s.trial_ends_at>now()),false);
 IF p_team IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.teams WHERE id=p_team AND club_id=p_club AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Team does not belong to club'; END IF;
  SELECT * INTO t FROM public.team_subscriptions WHERE team_id=p_team;
  team_pro:=coalesce(t.admin_pro_override OR t.admin_pro_football_override OR ((t.is_pro OR t.is_pro_football) AND (t.expires_at IS NULL OR t.expires_at>now())) OR (t.is_trial AND t.trial_ends_at>now()),false);
 END IF;
 IF club_pro THEN base:=CASE WHEN s.plan::text='unlimited' THEN 5368709120 ELSE 3221225472 END;
 ELSIF team_pro THEN base:=1073741824;
 ELSE base:=262144000; END IF;
 IF NOT (team_pro AND NOT club_pro) THEN extra:=greatest(coalesce(s.storage_purchased_gb,0),0)::bigint*1073741824; END IF;
 RETURN QUERY SELECT base,base+extra,team_pro AND NOT club_pro,club_pro OR team_pro;
END $$;
REVOKE ALL ON FUNCTION public.subscription_media_allowance(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.subscription_media_allowance(uuid,uuid) TO authenticated,service_role;
COMMENT ON FUNCTION public.subscription_media_allowance(uuid,uuid) IS 'Authenticated member-only allowance read; authoritative subscription state, validates club/team scope. This is not by itself upload authorization.';