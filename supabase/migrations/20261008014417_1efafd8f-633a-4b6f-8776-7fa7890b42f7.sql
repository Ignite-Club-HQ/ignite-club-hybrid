ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS home_country text, ADD COLUMN IF NOT EXISTS backend text NOT NULL DEFAULT 'supabase';
ALTER TABLE public.clubs ADD CONSTRAINT clubs_backend_check CHECK (backend IN ('supabase','icp') OR backend LIKE 'engine:%');
ALTER TABLE public.clubs ADD CONSTRAINT clubs_home_country_check CHECK (home_country IS NULL OR home_country ~ '^[A-Z]{2}$');
UPDATE public.clubs SET home_country = 'AU' WHERE home_country IS NULL;
CREATE OR REPLACE FUNCTION public.lock_club_backend() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.backend IS DISTINCT FROM OLD.backend AND current_setting('role', true) <> 'service_role' THEN
    NEW.backend := OLD.backend;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER clubs_lock_backend BEFORE UPDATE ON public.clubs FOR EACH ROW EXECUTE FUNCTION public.lock_club_backend();