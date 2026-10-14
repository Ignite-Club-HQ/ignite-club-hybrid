CREATE TABLE public.icp_welcome_email_deliveries (
  invite_id text PRIMARY KEY CHECK (char_length(invite_id) BETWEEN 1 AND 128),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 1,
  locked_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.icp_welcome_email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.icp_welcome_email_deliveries FROM anon, authenticated;

-- Returns true when this caller owns the send: a first attempt, a retry after
-- failure, or a stale lock. A sent or in-flight invite returns false.
CREATE OR REPLACE FUNCTION public.claim_icp_welcome_email(_invite_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed text;
BEGIN
  INSERT INTO public.icp_welcome_email_deliveries (invite_id, locked_at)
  VALUES (_invite_id, now())
  ON CONFLICT (invite_id) DO UPDATE
    SET status = 'processing',
        attempts = icp_welcome_email_deliveries.attempts + 1,
        locked_at = now(),
        updated_at = now(),
        last_error = NULL
    WHERE icp_welcome_email_deliveries.status = 'failed'
       OR (icp_welcome_email_deliveries.status = 'processing'
           AND icp_welcome_email_deliveries.locked_at < now() - interval '10 minutes')
  RETURNING invite_id INTO claimed;

  RETURN claimed IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_icp_welcome_email(
  _invite_id text,
  _sent boolean,
  _provider_message_id text DEFAULT NULL,
  _error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.icp_welcome_email_deliveries
  SET status = CASE WHEN _sent THEN 'sent' ELSE 'failed' END,
      sent_at = CASE WHEN _sent THEN now() ELSE sent_at END,
      provider_message_id = CASE WHEN _sent THEN _provider_message_id ELSE provider_message_id END,
      last_error = CASE WHEN _sent THEN NULL ELSE left(COALESCE(_error, 'Delivery failed'), 500) END,
      locked_at = NULL,
      updated_at = now()
  WHERE invite_id = _invite_id AND status = 'processing';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_icp_welcome_email(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_icp_welcome_email(text, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_icp_welcome_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_icp_welcome_email(text, boolean, text, text) TO service_role;
