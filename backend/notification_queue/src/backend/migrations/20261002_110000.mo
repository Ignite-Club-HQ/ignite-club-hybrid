import Principal "mo:core/Principal";

module {
  type Status = { #Pending; #Processing; #Delivered; #Failed };

  type Notification = {
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

  type Lease = {
    id : Text;
    owner : Principal;
  };

  type ChatType = { #Team; #Club; #Group; #Direct; #ClubAdmin; #Broadcast };
  type Recurrence = { #None; #Daily; #Weekly; #Monthly };
  type ScheduledStatus = { #Pending; #Sent; #Failed; #Cancelled };

  type ScheduledMessage = {
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

  type DigestSource = { #Club; #Team; #Group };
  type DigestClassification = { #Action; #Question; #Decision; #Social; #Info };

  type DigestItem = {
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

  type Preferences = {
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

  type PushAlertSettings = {
    failure_threshold_percent : Nat32;
    check_window_hours : Nat32;
    min_notifications : Nat32;
    cooldown_hours : Nat32;
    alerts_enabled : Bool;
    updated_at_ms : Nat64;
    updated_by : ?Text;
  };

  type OldActor = {
    var items : [Notification];
    var leases : [Lease];
    var governor : ?Principal;
    var workers : [Principal];
    var scheduled : [ScheduledMessage];
    var digests : [DigestItem];
    var preferences : [Preferences];
    var push_settings : ?PushAlertSettings;
    var chat_notified_messages : [Text];
  };

  type NewActor = {
    var items : [Notification];
    var leases : [Lease];
    var governor : ?Principal;
    var workers : [Principal];
    var scheduled : [ScheduledMessage];
    var digests : [DigestItem];
    var preferences : [Preferences];
    var push_settings : ?PushAlertSettings;
    var chat_notified_messages : [Text];
    var messagingDomainCanister : ?Principal;
  };

  // Adds the governor-set messaging_domain canister id used to trust
  // record_chat_notify_batch callers (docs/icp-chat-notify-fanout-spec.md).
  // Starts unset (fail-closed): non-canister callers may only fan out their
  // own messages; the deploy script sets it immediately after initialize().
  public func migration(old : OldActor) : NewActor {
    {
      var items = old.items;
      var leases = old.leases;
      var governor = old.governor;
      var workers = old.workers;
      var scheduled = old.scheduled;
      var digests = old.digests;
      var preferences = old.preferences;
      var push_settings = old.push_settings;
      var chat_notified_messages = old.chat_notified_messages;
      var messagingDomainCanister = null : ?Principal;
    }
  };
};
