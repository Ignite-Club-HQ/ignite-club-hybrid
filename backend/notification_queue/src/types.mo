import Principal "mo:core/Principal";

module {
  public type Status = {
    #Pending;
    #Processing;
    #Delivered;
    #Failed;
  };

  public type Notification = {
    id : Text;
    user : Text;
    club : Text;
    kind : Text;
    body : Text;
    idempotency_key : Text;
    status : Status;
    attempts : Nat32;
    next_attempt_ms : Nat64;
    read : Bool;
    related_id : ?Text;
    created_at_ms : Nat64;
  };

  public type Lease = {
    id : Text;
    owner : Principal;
  };

  public type Result = { #Ok : Notification; #Err : Text };
  public type Results = { #Ok : [Notification]; #Err : Text };
  public type ResultNat16 = { #Ok : Nat16; #Err : Text };

  // ---- Scheduled messages (mirrors public.scheduled_messages) ----

  public type ChatType = {
    #Team;
    #Club;
    #Group;
    #Direct;
    #ClubAdmin;
    #Broadcast;
  };

  public type Recurrence = {
    #None;
    #Daily;
    #Weekly;
    #Monthly;
  };

  public type ScheduledStatus = {
    #Pending;
    #Sent;
    #Failed;
    #Cancelled;
  };

  public type ScheduledMessage = {
    id : Text;
    author : Text;
    chat_type : ChatType;
    team_id : ?Text;
    club_id : ?Text;
    group_id : ?Text;
    conversation_id : ?Text;
    body : Text;
    image_url : ?Text;
    reply_to_id : ?Text;
    scheduled_for_ms : Nat64;
    status : ScheduledStatus;
    sent_message_id : ?Text;
    error_message : ?Text;
    attempted_at_ms : ?Nat64;
    created_at_ms : Nat64;
    updated_at_ms : Nat64;
    recurrence : Recurrence;
    recurrence_until_ms : ?Nat64;
    recurrence_parent_id : ?Text;
  };

  public type ScheduledResult = { #Ok : ScheduledMessage; #Err : Text };
  public type ScheduledResults = { #Ok : [ScheduledMessage]; #Err : Text };

  // ---- Message digests (mirrors public.message_digests) ----

  public type DigestSource = {
    #Club;
    #Team;
    #Group;
  };

  public type DigestClassification = {
    #Action;
    #Question;
    #Decision;
    #Social;
    #Info;
  };

  public type DigestItem = {
    id : Text;
    message_id : Text;
    message_type : DigestSource;
    chat_scope_id : Text;
    message_created_at_ms : Nat64;
    classification : DigestClassification;
    summary : Text;
    topic : ?Text;
    mentions : [Text];
    provider : ?Text;
    digested_at_ms : Nat64;
  };

  public type DigestResult = { #Ok : DigestItem; #Err : Text };
  public type DigestResults = { #Ok : [DigestItem]; #Err : Text };

  // ---- Notification preferences (mirrors public.notification_preferences) ----

  public type Preferences = {
    user : Text;
    messages_enabled : Bool;
    events_enabled : Bool;
    media_enabled : Bool;
    membership_enabled : Bool;
    pitch_board_enabled : Bool;
    admin_enabled : Bool;
    rewards_enabled : Bool;
    pom_enabled : Bool;
    email_messages_enabled : Bool;
    email_events_enabled : Bool;
    email_media_enabled : Bool;
    email_membership_enabled : Bool;
    email_admin_enabled : Bool;
    email_pitch_board_enabled : Bool;
    email_rewards_enabled : Bool;
    email_pom_enabled : Bool;
    show_message_preview : Bool;
    created_at_ms : Nat64;
    updated_at_ms : Nat64;
  };

  public type PreferencesInput = {
    messages_enabled : Bool;
    events_enabled : Bool;
    media_enabled : Bool;
    membership_enabled : Bool;
    pitch_board_enabled : Bool;
    admin_enabled : Bool;
    rewards_enabled : Bool;
    pom_enabled : Bool;
    email_messages_enabled : Bool;
    email_events_enabled : Bool;
    email_media_enabled : Bool;
    email_membership_enabled : Bool;
    email_admin_enabled : Bool;
    email_pitch_board_enabled : Bool;
    email_rewards_enabled : Bool;
    email_pom_enabled : Bool;
    show_message_preview : Bool;
  };

  public type PreferencesResult = { #Ok : Preferences; #Err : Text };

  // ---- Push alert settings (mirrors public.push_alert_settings) ----
  // NOTE: the Supabase table has no user_id column — it is a single global
  // admin-configured row governing push-failure alerting, not per-user. We
  // model it as a singleton here to match the real schema.

  public type PushAlertSettings = {
    failure_threshold_percent : Nat32;
    check_window_hours : Nat32;
    min_notifications : Nat32;
    cooldown_hours : Nat32;
    alerts_enabled : Bool;
    updated_at_ms : Nat64;
    updated_by : ?Text;
  };

  public type PushAlertSettingsInput = {
    failure_threshold_percent : Nat32;
    check_window_hours : Nat32;
    min_notifications : Nat32;
    cooldown_hours : Nat32;
    alerts_enabled : Bool;
  };
}
