ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS hide_ladder boolean NOT NULL DEFAULT false;