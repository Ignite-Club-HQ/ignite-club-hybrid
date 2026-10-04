GRANT SELECT ON public.app_settings TO anon;
DROP POLICY IF EXISTS "Visitors can read backend routing config" ON public.app_settings;
CREATE POLICY "Visitors can read backend routing config"
ON public.app_settings FOR SELECT TO anon
USING (key = 'backend_routing_config');