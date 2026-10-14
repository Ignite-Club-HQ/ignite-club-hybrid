CREATE EXTENSION IF NOT EXISTS pg_cron;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS duty_team_reminder_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS individual_duty_reminder_sent boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.event_reminder_recipient_ids(_event_id uuid)
RETURNS TABLE (user_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO event_row FROM public.events WHERE id = _event_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF COALESCE(cardinality(event_row.target_team_ids), 0) > 0 THEN
    RETURN QUERY
      SELECT recipients.user_id
      FROM public.get_targeted_event_notification_recipients(_event_id) AS recipients;
  ELSIF event_row.mini_league_id IS NOT NULL THEN
    RETURN QUERY
      SELECT DISTINCT audience.user_id
      FROM (
        SELECT mlp.parent_user_id AS user_id
        FROM public.mini_league_players mlp
        WHERE mlp.mini_league_id = event_row.mini_league_id
          AND mlp.parent_user_id IS NOT NULL
        UNION
        SELECT ur.user_id
        FROM public.user_roles ur
        WHERE ur.club_id = event_row.club_id
          AND ur.role::text IN ('club_admin', 'league_admin', 'coach')
      ) AS audience;
  ELSIF event_row.team_id IS NOT NULL THEN
    RETURN QUERY
      SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
      WHERE ur.team_id = event_row.team_id;
  ELSE
    RETURN QUERY
      SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
      WHERE ur.club_id = event_row.club_id
        AND (
          COALESCE(cardinality(event_row.restricted_to_roles), 0) = 0
          OR ur.role = ANY(event_row.restricted_to_roles)
          OR ur.role::text IN ('club_admin', 'app_admin')
        );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_scheduled_event_notice(
  _event_id uuid,
  _club_id uuid,
  _type text,
  _message text,
  _dedupe_prefix text,
  _recipient_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count integer;
BEGIN
  INSERT INTO public.notifications (
    user_id, type, message, related_id, club_id, skip_push, dedupe_key
  )
  SELECT DISTINCT
    recipients.user_id,
    _type,
    _message,
    _event_id,
    _club_id,
    false,
    _dedupe_prefix || ':' || _event_id::text || ':' || recipients.user_id::text
  FROM unnest(COALESCE(_recipient_ids, ARRAY[]::uuid[])) AS recipients(user_id)
  LEFT JOIN public.notification_preferences preferences
    ON preferences.user_id = recipients.user_id
  WHERE recipients.user_id IS NOT NULL
    AND COALESCE(preferences.events_enabled, true)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_scheduled_event_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_row public.events%ROWTYPE;
  recipients uuid[];
  processed_count integer := 0;
  now_at timestamptz := clock_timestamp();
BEGIN
  FOR event_row IN
    SELECT event.*
    FROM public.events AS event
    WHERE NOT event.is_cancelled
      AND event.event_date > now_at
      AND (
        (event.reminder_hours_before IS NOT NULL AND NOT COALESCE(event.reminder_sent, false)
          AND event.event_date <= now_at + event.reminder_hours_before * interval '1 hour')
        OR (event.type::text = 'game' AND event.mini_league_id IS NULL
          AND NOT COALESCE(event.points_reminder_sent, false)
          AND event.event_date <= now_at + interval '4 days')
        OR (event.duty_team_id IS NOT NULL AND NOT event.duty_team_reminder_sent
          AND event.event_date <= now_at + interval '24 hours')
        OR (NOT event.individual_duty_reminder_sent
          AND event.event_date <= now_at + interval '24 hours'
          AND EXISTS (
            SELECT 1 FROM public.duties duty
            WHERE duty.event_id = event.id
              AND duty.assigned_to IS NOT NULL
              AND duty.completed_at IS NULL
          ))
      )
    ORDER BY event.event_date
    FOR UPDATE SKIP LOCKED
  LOOP
    IF event_row.reminder_hours_before IS NOT NULL
      AND NOT COALESCE(event_row.reminder_sent, false)
      AND event_row.event_date <= now_at + event_row.reminder_hours_before * interval '1 hour'
    THEN
      SELECT array_agg(audience.user_id) INTO recipients
      FROM public.event_reminder_recipient_ids(event_row.id) AS audience
      WHERE NOT EXISTS (
        SELECT 1 FROM public.rsvps rsvp
        WHERE rsvp.event_id = event_row.id AND rsvp.user_id = audience.user_id
      );

      PERFORM public.enqueue_scheduled_event_notice(
        event_row.id,
        event_row.club_id,
        'event_reminder',
        'Reminder: Please RSVP for "' || event_row.title || '"',
        'scheduled-event-rsvp',
        recipients
      );
      UPDATE public.events SET reminder_sent = true WHERE id = event_row.id;
      processed_count := processed_count + 1;
    END IF;

    IF event_row.type::text = 'game'
      AND event_row.mini_league_id IS NULL
      AND NOT COALESCE(event_row.points_reminder_sent, false)
      AND event_row.event_date <= now_at + interval '4 days'
    THEN
      SELECT array_agg(audience.user_id) INTO recipients
      FROM public.event_reminder_recipient_ids(event_row.id) AS audience
      WHERE NOT EXISTS (
        SELECT 1 FROM public.rsvps rsvp
        WHERE rsvp.event_id = event_row.id
          AND rsvp.user_id = audience.user_id
          AND rsvp.status::text = 'going'
      );

      PERFORM public.enqueue_scheduled_event_notice(
        event_row.id,
        event_row.club_id,
        'event_reminder',
        'Please RSVP for "' || event_row.title || '" to earn your game points',
        'scheduled-event-points',
        recipients
      );
      UPDATE public.events SET points_reminder_sent = true WHERE id = event_row.id;
      processed_count := processed_count + 1;
    END IF;

    IF event_row.duty_team_id IS NOT NULL
      AND NOT event_row.duty_team_reminder_sent
      AND event_row.event_date <= now_at + interval '24 hours'
    THEN
      SELECT array_agg(DISTINCT audience.user_id) INTO recipients
      FROM (
        SELECT role.user_id
        FROM public.user_roles role
        WHERE role.team_id = event_row.duty_team_id
        UNION
        SELECT player.profile_id AS user_id
        FROM public.team_memberships membership
        JOIN public.club_players player ON player.id = membership.club_player_id
        WHERE membership.team_id = event_row.duty_team_id
          AND membership.status = 'active'
          AND membership.removed_at IS NULL
          AND player.is_active
          AND player.profile_id IS NOT NULL
        UNION
        SELECT child.parent_id AS user_id
        FROM public.team_memberships membership
        JOIN public.club_players player ON player.id = membership.club_player_id
        JOIN public.children child ON child.id = player.child_id
        WHERE membership.team_id = event_row.duty_team_id
          AND membership.status = 'active'
          AND membership.removed_at IS NULL
          AND player.is_active
          AND child.parent_id IS NOT NULL
        UNION
        SELECT guardian.guardian_id AS user_id
        FROM public.team_memberships membership
        JOIN public.club_players player ON player.id = membership.club_player_id
        JOIN public.child_guardians guardian ON guardian.child_id = player.child_id
        WHERE membership.team_id = event_row.duty_team_id
          AND membership.status = 'active'
          AND membership.removed_at IS NULL
          AND player.is_active
        UNION
        SELECT child.parent_id AS user_id
        FROM public.child_team_assignments assignment
        JOIN public.children child ON child.id = assignment.child_id
        WHERE assignment.team_id = event_row.duty_team_id
          AND child.parent_id IS NOT NULL
        UNION
        SELECT guardian.guardian_id AS user_id
        FROM public.child_team_assignments assignment
        JOIN public.child_guardians guardian ON guardian.child_id = assignment.child_id
        WHERE assignment.team_id = event_row.duty_team_id
      ) AS audience
      JOIN public.teams team ON team.id = event_row.duty_team_id
      WHERE team.club_id = event_row.club_id
        AND team.is_archived = false
        AND team.deleted_at IS NULL
        AND team.is_shell = false
        AND team.lifecycle_status <> 'archived';

      PERFORM public.enqueue_scheduled_event_notice(
        event_row.id,
        event_row.club_id,
        'duty_reminder',
        'Your team is on duty for "' || event_row.title || '"',
        'scheduled-event-duty-team',
        recipients
      );
      UPDATE public.events SET duty_team_reminder_sent = true WHERE id = event_row.id;
      processed_count := processed_count + 1;
    END IF;

    IF NOT event_row.individual_duty_reminder_sent
      AND event_row.event_date <= now_at + interval '24 hours'
      AND EXISTS (
        SELECT 1 FROM public.duties duty
        WHERE duty.event_id = event_row.id
          AND duty.assigned_to IS NOT NULL
          AND duty.completed_at IS NULL
      )
    THEN
      SELECT array_agg(DISTINCT duty.assigned_to) INTO recipients
      FROM public.duties duty
      WHERE duty.event_id = event_row.id
        AND duty.assigned_to IS NOT NULL
        AND duty.completed_at IS NULL;

      PERFORM public.enqueue_scheduled_event_notice(
        event_row.id,
        event_row.club_id,
        'event_reminder',
        'Reminder: you are assigned a duty for "' || event_row.title || '"',
        'scheduled-event-duty-individual',
        recipients
      );
      UPDATE public.events SET individual_duty_reminder_sent = true WHERE id = event_row.id;
      processed_count := processed_count + 1;
    END IF;
  END LOOP;

  RETURN processed_count;
END;
$$;

REVOKE ALL ON FUNCTION public.event_reminder_recipient_ids(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_scheduled_event_notice(uuid, uuid, text, text, text, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_scheduled_event_reminders() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  existing_job record;
BEGIN
  FOR existing_job IN
    SELECT jobid FROM cron.job WHERE jobname = 'process-scheduled-event-reminders'
  LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;
  PERFORM cron.schedule(
    'process-scheduled-event-reminders',
    '*/15 * * * *',
    'SELECT public.process_scheduled_event_reminders();'
  );
END;
$$;