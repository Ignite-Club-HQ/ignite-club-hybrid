ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS duty_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS events_duty_team_id_idx
  ON public.events (duty_team_id)
  WHERE duty_team_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_event_duty_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.duty_team_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.teams AS team
    WHERE team.id = NEW.duty_team_id
      AND team.club_id = NEW.club_id
      AND team.is_archived = false
      AND team.deleted_at IS NULL
      AND team.is_shell = false
      AND team.lifecycle_status <> 'archived'
  ) THEN
    RAISE EXCEPTION 'Duty team must be active and belong to the event club';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_event_duty_team() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER events_validate_duty_team
  BEFORE INSERT OR UPDATE OF duty_team_id, club_id ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.validate_event_duty_team();