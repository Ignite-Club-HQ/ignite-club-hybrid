ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_country_format CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');