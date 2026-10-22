CREATE TABLE public.subscription_price_catalog (product_id text PRIMARY KEY, entity_type text NOT NULL, tier text NOT NULL, plan text, team_limit integer, monthly_usd numeric(12,2) NOT NULL, annual_usd numeric(12,2) NOT NULL, media_bytes bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.subscription_price_catalog TO anon, authenticated;
GRANT ALL ON public.subscription_price_catalog TO service_role;
ALTER TABLE public.subscription_price_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public subscription prices" ON public.subscription_price_catalog FOR SELECT TO anon, authenticated USING (true);
INSERT INTO public.subscription_price_catalog(product_id,entity_type,tier,plan,team_limit,monthly_usd,annual_usd,media_bytes) VALUES
('team_pro','team','pro',null,1,24.99,269,1073741824),('team_pf','team','pro_football',null,1,34.99,379,1073741824),
('pro_small','club','pro','small',3,44.99,489,3221225472),('pf_small','club','pro_football','small',3,59.99,649,3221225472),
('pro_growing','club','pro','growing',5,64.99,699,3221225472),('pf_growing','club','pro_football','growing',5,84.99,929,3221225472),
('pro_starter','club','pro','starter',10,109.99,1199,3221225472),('pf_starter','club','pro_football','starter',10,139.99,1539,3221225472),
('pro_standard','club','pro','standard',20,209.99,2299,3221225472),('pf_standard','club','pro_football','standard',20,259.99,2849,3221225472);
CREATE TRIGGER subscription_price_catalog_updated BEFORE UPDATE ON public.subscription_price_catalog FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TYPE public.club_subscription_plan ADD VALUE IF NOT EXISTS 'small';
ALTER TYPE public.club_subscription_plan ADD VALUE IF NOT EXISTS 'growing';
ALTER TABLE public.club_subscriptions ADD COLUMN IF NOT EXISTS pricing_version text NOT NULL DEFAULT 'legacy', ADD COLUMN IF NOT EXISTS paid_extra_teams integer NOT NULL DEFAULT 0;
ALTER TABLE public.team_subscriptions ADD COLUMN IF NOT EXISTS pricing_version text NOT NULL DEFAULT 'legacy';
CREATE OR REPLACE FUNCTION public.club_team_capacity(p_club uuid) RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.club_subscriptions; paid boolean; trial boolean;
BEGIN
 SELECT * INTO s FROM public.club_subscriptions WHERE club_id=p_club;
 IF NOT FOUND THEN RETURN 20; END IF;
 paid := s.admin_pro_override OR s.admin_pro_football_override OR ((s.is_pro OR s.is_pro_football) AND (s.expires_at IS NULL OR s.expires_at>now()));
 trial := s.is_trial AND s.trial_ends_at>now();
 IF NOT coalesce(paid OR trial,false) THEN RETURN 20; END IF;
 IF s.team_limit IS NULL OR s.team_limit<1 THEN RETURN 20; END IF;
 IF trial AND NOT paid THEN RETURN least(20,s.team_limit); END IF;
 RETURN s.team_limit;
END $$;
REVOKE ALL ON FUNCTION public.club_team_capacity(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.club_team_capacity(uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.enforce_paid_team_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE used integer; cap integer;
BEGIN
 IF NEW.club_id IS NULL OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
   IF OLD.club_id IS NOT DISTINCT FROM NEW.club_id AND OLD.deleted_at IS NULL THEN RETURN NEW; END IF;
 END IF;
 -- Serialize every addition against the same club, including simultaneous devices.
 PERFORM 1 FROM public.clubs WHERE id=NEW.club_id FOR UPDATE;
 cap := public.club_team_capacity(NEW.club_id);
 SELECT count(*) INTO used FROM public.teams WHERE club_id=NEW.club_id AND deleted_at IS NULL AND id<>NEW.id;
 IF used>=cap THEN RAISE EXCEPTION 'TeamLimitReached: Upgrade your club plan or pay for additional teams before adding another team.' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enforce_paid_team_capacity BEFORE INSERT OR UPDATE OF club_id,deleted_at ON public.teams FOR EACH ROW EXECUTE FUNCTION public.enforce_paid_team_capacity();
CREATE OR REPLACE FUNCTION public.protect_subscription_entitlements() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.role()='service_role' OR (auth.uid() IS NULL AND session_user IN ('postgres','supabase_admin')) OR public.has_role(auth.uid(),'app_admin',NULL,NULL) THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN RAISE EXCEPTION 'Verified payment or platform administrator required for subscription entitlements' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='club_subscriptions' THEN
 IF (to_jsonb(NEW)-ARRAY['member_payments_enabled','member_subscription_amount','disable_team_pom_rewards','disable_points_system','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['member_payments_enabled','member_subscription_amount','disable_team_pom_rewards','disable_points_system','updated_at']) THEN RAISE EXCEPTION 'Verified payment or platform administrator required for subscription entitlements' USING ERRCODE='42501'; END IF;
 ELSE
 IF (to_jsonb(NEW)->'is_pro',to_jsonb(NEW)->'is_pro_football',to_jsonb(NEW)->'admin_pro_override',to_jsonb(NEW)->'admin_pro_football_override',to_jsonb(NEW)->'expires_at',to_jsonb(NEW)->'is_trial',to_jsonb(NEW)->'trial_ends_at',to_jsonb(NEW)->'pricing_version') IS DISTINCT FROM (to_jsonb(OLD)->'is_pro',to_jsonb(OLD)->'is_pro_football',to_jsonb(OLD)->'admin_pro_override',to_jsonb(OLD)->'admin_pro_football_override',to_jsonb(OLD)->'expires_at',to_jsonb(OLD)->'is_trial',to_jsonb(OLD)->'trial_ends_at',to_jsonb(OLD)->'pricing_version') THEN RAISE EXCEPTION 'Verified payment or platform administrator required for subscription entitlements' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_club_paid_entitlements BEFORE INSERT OR UPDATE ON public.club_subscriptions FOR EACH ROW EXECUTE FUNCTION public.protect_subscription_entitlements();
CREATE TRIGGER protect_team_paid_entitlements BEFORE INSERT OR UPDATE ON public.team_subscriptions FOR EACH ROW EXECUTE FUNCTION public.protect_subscription_entitlements();