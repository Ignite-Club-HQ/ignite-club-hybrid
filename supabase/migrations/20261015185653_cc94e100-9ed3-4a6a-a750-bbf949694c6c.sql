CREATE TABLE public.canister_memory_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'manual',
  readings jsonb NOT NULL DEFAULT '[]'::jsonb,
  analysis jsonb,
  created_by uuid
);
GRANT SELECT, INSERT ON public.canister_memory_reports TO authenticated;
GRANT ALL ON public.canister_memory_reports TO service_role;
ALTER TABLE public.canister_memory_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "App admins read memory reports" ON public.canister_memory_reports FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'app_admin'));
CREATE POLICY "App admins add manual readings" ON public.canister_memory_reports FOR INSERT TO authenticated
  WITH CHECK (source = 'manual' AND created_by = auth.uid() AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'app_admin'));