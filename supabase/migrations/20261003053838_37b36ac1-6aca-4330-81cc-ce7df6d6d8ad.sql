CREATE OR REPLACE FUNCTION public.send_welcome_dm(p_user_id uuid, p_message text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_system uuid := '00000000-0000-0000-0000-000000000001';
  v_conv uuid;
  p1 uuid;
  p2 uuid;
  v_text text;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  v_text := left(
    coalesce(
      nullif(trim(p_message), ''),
      'Welcome to Ignite! I''m here if you need a hand getting your club set up — just reply to this message any time.'
    ),
    4000
  );

  IF v_system < p_user_id THEN
    p1 := v_system;
    p2 := p_user_id;
  ELSE
    p1 := p_user_id;
    p2 := v_system;
  END IF;

  SELECT id INTO v_conv
  FROM direct_conversations
  WHERE participant_1 = p1 AND participant_2 = p2;

  IF v_conv IS NULL THEN
    INSERT INTO direct_conversations (participant_1, participant_2, created_by)
    VALUES (p1, p2, p_user_id)
    RETURNING id INTO v_conv;
  END IF;

  IF EXISTS (
    SELECT 1 FROM direct_messages
    WHERE conversation_id = v_conv AND author_id = v_system
  ) THEN
    RETURN v_conv;
  END IF;

  INSERT INTO direct_messages (conversation_id, author_id, text, is_system_message)
  VALUES (v_conv, v_system, v_text, true);

  RETURN v_conv;
END;
$$;

REVOKE ALL ON FUNCTION public.send_welcome_dm(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_welcome_dm(uuid, text) TO authenticated;