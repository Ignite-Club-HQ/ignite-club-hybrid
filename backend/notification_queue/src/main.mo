import Cycles "mo:core/Cycles";
import Array "mo:core/Array";
import Nat "mo:core/Nat";
import Nat16 "mo:core/Nat16";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "types";

persistent actor class Main(governorInit : Principal) {
  /// Public: remaining cycles (shown in admin settings).
  public query func cycles_balance() : async Nat { Cycles.balance() };

  var items : [Types.Notification];
  var leases : [Types.Lease];
  var governor : ?Principal;

  if (governor == null and not governorInit.equal(Principal.anonymous())) {
    governor := ?governorInit;
  };
  var workers : [Principal];
  var scheduled : [Types.ScheduledMessage];
  var digests : [Types.DigestItem];
  var preferences : [Types.Preferences];
  var push_settings : ?Types.PushAlertSettings;
  var chat_notified_messages : [Text];
  // Governor-set messaging_domain canister id. Calls to
  // record_chat_notify_batch from this principal are trusted (recipients and
  // mute list accepted as-is); any other caller may only fan out their own
  // messages. Fail-closed while unset. See docs/icp-chat-notify-fanout-spec.md.
  var messagingDomainCanister : ?Principal;
  // Device push tokens owned by principal text (see Types.DeviceToken).
  // Caller-scoped writes; the delivery worker reads/prunes via worker-gated
  // methods below.
  var device_tokens : [Types.DeviceToken];

  public shared ({ caller }) func set_messaging_domain_canister(id : Principal) : async { #Ok; #Err : Text } {
    governorOnly(caller);
    if (id.equal(Principal.anonymous())) { return #Err("Invalid canister id") };
    messagingDomainCanister := ?id;
    #Ok
  };

  func authenticated(caller : Principal) {
    if (caller.equal(Principal.anonymous())) { Runtime.trap("Forbidden") };
  };

  func worker(caller : Principal) {
    authenticated(caller);
    let allowed = switch (governor) {
      case (?owner) { owner.equal(caller) or workers.any(func(principal) = principal.equal(caller)) };
      case null { false };
    };
    if (not allowed) { Runtime.trap("Worker capability required") };
  };

  func governorOnly(caller : Principal) {
    authenticated(caller);
    switch (governor) {
      case (?owner) { if (not owner.equal(caller)) { Runtime.trap("Governor required") } };
      case null { Runtime.trap("Governor required") };
    };
  };

  func valid(value : Text) : Bool { value != "" };

  func findIndex(id : Text) : ?Nat {
    var index = 0;
    for (item in items.values()) {
      if (item.id == id) { return ?index };
      index += 1;
    };
    null
  };

  func get(id : Text) : ?Types.Notification {
    switch (findIndex(id)) {
      case (?index) { ?items[index] };
      case null { null };
    }
  };

  func findLeaseIndex(id : Text) : ?Nat {
    var index = 0;
    for (lease in leases.values()) {
      if (lease.id == id) { return ?index };
      index += 1;
    };
    null
  };

  func leaseOwner(id : Text) : ?Principal {
    switch (findLeaseIndex(id)) {
      case (?index) { ?leases[index].owner };
      case null { null };
    }
  };

  func setLease(id : Text, owner : Principal) {
    let lease : Types.Lease = { id; owner };
    switch (findLeaseIndex(id)) {
      case (?index) {
        leases := Array.tabulate<Types.Lease>(leases.size(), func(position) {
          if (position == index) { lease } else { leases[position] }
        });
      };
      case null { leases := leases.concat([lease]) };
    };
  };

  func clearLease(id : Text) {
    switch (findLeaseIndex(id)) {
      case (?index) {
        leases := Array.tabulate<Types.Lease>(leases.size() - 1, func(position) {
          if (position < index) { leases[position] } else { leases[position + 1] }
        });
      };
      case null {};
    };
  };

  func ownsLease(id : Text, caller : Principal) : Bool {
    switch (leaseOwner(id)) {
      case (?owner) { owner.equal(caller) };
      case null { false };
    }
  };

  func replace(index : Nat, item : Types.Notification) {
    items := Array.tabulate<Types.Notification>(items.size(), func(position) {
      if (position == index) { item } else { items[position] }
    });
  };

  // ---- Notification preferences: category filter for fan_out ----
  // `kind` on Notification/fan_out is a free-text category tag (e.g.
  // "event_reminder", "message_new"). We map it to the matching preference
  // column by prefix so fan_out can skip recipients who disabled that
  // category. Unmapped kinds default to allowed (fail-open) so existing
  // callers are unaffected until they adopt a recognised prefix.
  func findPreferenceIndex(user : Text) : ?Nat {
    var index = 0;
    for (pref in preferences.values()) {
      if (pref.user == user) { return ?index };
      index += 1;
    };
    null
  };

  func findPreference(user : Text) : ?Types.Preferences {
    switch (findPreferenceIndex(user)) {
      case (?index) { ?preferences[index] };
      case null { null };
    }
  };

  func defaultPreferences(user : Text) : Types.Preferences {
    {
      user;
      messages_enabled = true;
      events_enabled = true;
      media_enabled = true;
      membership_enabled = true;
      pitch_board_enabled = true;
      admin_enabled = true;
      rewards_enabled = true;
      pom_enabled = true;
      email_messages_enabled = false;
      email_events_enabled = true;
      email_media_enabled = false;
      email_membership_enabled = true;
      email_admin_enabled = false;
      email_pitch_board_enabled = false;
      email_rewards_enabled = false;
      email_pom_enabled = false;
      show_message_preview = true;
      created_at_ms = 0;
      updated_at_ms = 0;
    }
  };

  func categoryAllowed(prefs : Types.Preferences, kind : Text) : Bool {
    if (Text.startsWith(kind, #text "message")) { prefs.messages_enabled }
    else if (Text.startsWith(kind, #text "event")) { prefs.events_enabled }
    else if (Text.startsWith(kind, #text "media")) { prefs.media_enabled }
    else if (Text.startsWith(kind, #text "membership")) { prefs.membership_enabled }
    else if (Text.startsWith(kind, #text "pitch_board")) { prefs.pitch_board_enabled }
    else if (Text.startsWith(kind, #text "admin")) { prefs.admin_enabled }
    else if (Text.startsWith(kind, #text "reward")) { prefs.rewards_enabled }
    else if (Text.startsWith(kind, #text "pom")) { prefs.pom_enabled }
    else if (Text.startsWith(kind, #text "player_of_match")) { prefs.pom_enabled }
    else { true }
  };

  func recipientAllowed(user : Text, kind : Text) : Bool {
    switch (findPreference(user)) {
      case (?prefs) { categoryAllowed(prefs, kind) };
      case null { true };
    }
  };

  public shared ({ caller }) func transfer_governorship(new_governor : Principal) : async { #Ok; #Err : Text } {
    governorOnly(caller);
    if (new_governor.equal(Principal.anonymous())) { return #Err("New governor cannot be anonymous") };
    governor := ?new_governor;
    #Ok
  };

  public shared ({ caller }) func grant_worker(principal : Principal) : async { #Ok; #Err : Text } {
    authenticated(caller);
    switch (governor) {
      case (?owner) {
        if (not owner.equal(caller)) { return #Err("Governor required") };
        if (principal.equal(Principal.anonymous())) { return #Err("Invalid worker") };
        if (not workers.any(func(candidate) = candidate.equal(principal))) { workers := workers.concat([principal]) };
        #Ok
      };
      case null { #Err("Governor required") };
    };
  };

  public shared ({ caller }) func enqueue(
    id : Text,
    user : Text,
    club : Text,
    kind : Text,
    body : Text,
    key : Text,
  ) : async Types.Result {
    authenticated(caller);
    if (not valid(id) or not valid(user) or not valid(club) or not valid(kind) or not valid(key)) {
      return #Err("Invalid notification fields");
    };
    switch (get(id)) {
      case (?existing) {
        if (existing.idempotency_key != key) return #Err("Notification id already exists with a different idempotency key");
        #Ok(existing)
      };
      case null {
        let notification : Types.Notification = {
          id;
          user;
          club;
          kind;
          body;
          idempotency_key = key;
          status = #Pending;
          attempts = 0;
          next_attempt_ms = 0;
          read = false;
          related_id = null;
          created_at_ms = Nat64.fromIntWrap(Time.now() / 1_000_000);
        };
        items := items.concat([notification]);
        #Ok(notification)
      };
    }
  };

  // Browser fan-out: one update call enqueues the same notification for many
  // recipients (bulk reminders, duty-completion notices, invites). Ids are
  // derived as key_prefix # "-" # user so a retried fan-out is idempotent
  // per recipient. NOTE: recipients are browser-supplied account ids —
  // provisional until account ids are bound to principals (identity_access).
  //
  // Preference filtering: if a recipient has a stored Preferences row and
  // `kind` maps to a disabled category (see categoryAllowed), that recipient
  // is silently skipped (not counted as created, no error raised) instead of
  // enqueuing a notification they opted out of. Recipients without a stored
  // preference row are fail-open (treated as allowed), matching the safe
  // defaults returned by get_preferences.
  public shared ({ caller }) func fan_out(users : [Text], club : Text, kind : Text, body : Text, key_prefix : Text, related_id : ?Text) : async Types.ResultNat16 {
    authenticated(caller);
    if (users.size() == 0 or users.size() > 500) { return #Err("Invalid recipient count") };
    if (not valid(club) or not valid(kind) or not valid(key_prefix)) { return #Err("Invalid fan-out fields") };
    if (users.any(func(u) = not valid(u))) { return #Err("Invalid recipient") };
    let stamp = Nat64.fromIntWrap(Time.now() / 1_000_000);
    var created : Nat16 = 0;
    for (user in users.values()) {
      if (recipientAllowed(user, kind)) {
        let id = key_prefix # "-" # user;
        switch (get(id)) {
          case (?_) {};
          case null {
            let notification : Types.Notification = {
              id; user; club; kind; body;
              idempotency_key = key_prefix;
              status = #Pending;
              attempts = 0;
              next_attempt_ms = 0;
              read = false;
              related_id;
              created_at_ms = stamp;
            };
            items := items.concat([notification]);
            created += 1;
          };
        };
      };
    };
    #Ok(created)
  };

  // ---- Browser inbox surface ----
  // NOTE: the `user` field carries the app's account id (a Text), not the
  // caller's II principal, so the canister cannot verify inbox ownership.
  // Provisional until account ids are bound to principals (identity_access).

  public query ({ caller }) func list_inbox(user : Text, club : ?Text, limit : Nat16) : async Types.Results {
    authenticated(caller);
    if (limit == 0 or limit > 500) { return #Err("Invalid page size") };
    var res : [Types.Notification] = [];
    for (item in items.values()) {
      let clubOk = switch (club) { case (?c) { item.club == c }; case null { true } };
      if (res.size() < Nat16.toNat(limit) and item.user == user and clubOk) {
        res := res.concat([item]);
      };
    };
    #Ok(res)
  };

  public shared ({ caller }) func mark_read(id : Text) : async Types.Result {
    authenticated(caller);
    switch (findIndex(id)) {
      case null { #Err("Unknown notification") };
      case (?index) {
        let updated : Types.Notification = { items[index] with read = true };
        replace(index, updated);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func mark_all_read(user : Text, club : ?Text) : async Types.ResultNat16 {
    authenticated(caller);
    var marked : Nat16 = 0;
    var index = 0;
    for (item in items.values()) {
      let clubOk = switch (club) { case (?c) { item.club == c }; case null { true } };
      if (item.user == user and clubOk and not item.read) {
        replace(index, { item with read = true });
        marked += 1;
      };
      index += 1;
    };
    #Ok(marked)
  };

  public shared ({ caller }) func delete_notification(id : Text) : async { #Ok; #Err : Text } {
    authenticated(caller);
    switch (findIndex(id)) {
      case null { #Err("Unknown notification") };
      case (?index) {
        items := Array.tabulate<Types.Notification>(items.size() - 1, func(position) {
          if (position < index) { items[position] } else { items[position + 1] }
        });
        clearLease(id);
        #Ok
      };
    }
  };

  public shared ({ caller }) func clear_inbox(user : Text, club : ?Text) : async Types.ResultNat16 {
    authenticated(caller);
    var kept : [Types.Notification] = [];
    var removed : Nat16 = 0;
    for (item in items.values()) {
      let clubOk = switch (club) { case (?c) { item.club == c }; case null { true } };
      if (item.user == user and clubOk) {
        if (removed == 65535) { return #Err("Inbox too large to clear in one call") };
        clearLease(item.id);
        removed += 1;
      } else {
        kept := kept.concat([item]);
      };
    };
    items := kept;
    #Ok(removed)
  };

  public shared ({ caller }) func claim(now_ms : Nat64, limit : Nat16) : async Types.Results {
    worker(caller);
    if (limit == 0 or limit > 100) { return #Err("Invalid batch size") };
    var claimed : [Types.Notification] = [];
    var index = 0;
    for (item in items.values()) {
      if (claimed.size() < Nat16.toNat(limit) and item.status == #Pending and item.next_attempt_ms <= now_ms) {
        let processing : Types.Notification = { item with status = #Processing; attempts = item.attempts + 1 };
        replace(index, processing);
        setLease(item.id, caller);
        claimed := claimed.concat([processing]);
      };
      index += 1;
    };
    #Ok(claimed)
  };

  public shared ({ caller }) func acknowledge(id : Text, key : Text) : async Types.Result {
    worker(caller);
    switch (findIndex(id)) {
      case null { #Err("Unknown notification") };
      case (?index) {
        let item = items[index];
        if (item.idempotency_key != key) { return #Err("Idempotency key mismatch") };
        if (item.status == #Delivered) { return #Ok(item) };
        if (item.status != #Processing) { return #Err("Notification is not processing") };
        if (not ownsLease(id, caller)) { return #Err("Notification lease owner required") };
        let delivered : Types.Notification = { item with status = #Delivered };
        replace(index, delivered);
        clearLease(id);
        #Ok(delivered)
      };
    }
  };

  public shared ({ caller }) func fail(id : Text, error : Text, retry_at_ms : ?Nat64) : async Types.Result {
    worker(caller);
    switch (findIndex(id)) {
      case null { #Err("Unknown notification") };
      case (?index) {
        let item = items[index];
        if (item.status != #Processing) { return #Err("Notification is not processing") };
        if (not ownsLease(id, caller)) { return #Err("Notification lease owner required") };
        let failed : Types.Notification = {
          item with
          body = error;
          status = switch (retry_at_ms) { case (?_) { #Pending }; case null { #Failed } };
          next_attempt_ms = switch (retry_at_ms) { case (?time) { time }; case null { item.next_attempt_ms } };
        };
        replace(index, failed);
        clearLease(id);
        #Ok(failed)
      };
    }
  };

  public query ({ caller }) func get_notification(id : Text) : async ?Types.Notification {
    if (caller.equal(Principal.anonymous())) { return null };
    get(id)
  };

  public shared ({ caller }) func recover() : async Types.ResultNat16 {
    worker(caller);
    var recovered : Nat16 = 0;
    var index = 0;
    for (item in items.values()) {
      if (item.status == #Processing) {
        replace(index, { item with status = #Pending });
        clearLease(item.id);
        recovered += 1;
      };
      index += 1;
    };
    #Ok(recovered)
  };

  // ======================================================================
  // Scheduled messages
  // NOTE: `author`, `team_id`, `club_id`, `group_id`, `conversation_id`,
  // `reply_to_id`, `sent_message_id`, `recurrence_parent_id` all carry the
  // app's Text ids (not principals), following the same caller-scoped-by-
  // account-id convention as the inbox surface above.
  // ======================================================================

  func findScheduledIndex(id : Text) : ?Nat {
    var index = 0;
    for (item in scheduled.values()) {
      if (item.id == id) { return ?index };
      index += 1;
    };
    null
  };

  func getScheduled(id : Text) : ?Types.ScheduledMessage {
    switch (findScheduledIndex(id)) {
      case (?index) { ?scheduled[index] };
      case null { null };
    }
  };

  func replaceScheduled(index : Nat, item : Types.ScheduledMessage) {
    scheduled := Array.tabulate<Types.ScheduledMessage>(scheduled.size(), func(position) {
      if (position == index) { item } else { scheduled[position] }
    });
  };

  func scheduledTarget(item : Types.ScheduledMessage) : ?Text {
    switch (item.team_id) {
      case (?t) { ?t };
      case null {
        switch (item.club_id) {
          case (?c) { ?c };
          case null {
            switch (item.group_id) {
              case (?g) { ?g };
              case null { item.conversation_id };
            }
          };
        }
      };
    }
  };

  public shared ({ caller }) func schedule_message(
    id : Text,
    author : Text,
    chat_type : Types.ChatType,
    team_id : ?Text,
    club_id : ?Text,
    group_id : ?Text,
    conversation_id : ?Text,
    body : Text,
    image_url : ?Text,
    reply_to_id : ?Text,
    scheduled_for_ms : Nat64,
    recurrence : Types.Recurrence,
    recurrence_until_ms : ?Nat64,
  ) : async Types.ScheduledResult {
    authenticated(caller);
    if (not valid(id) or not valid(author) or not valid(body)) {
      return #Err("Invalid scheduled message fields");
    };
    if (scheduled_for_ms == 0) { return #Err("scheduled_for_ms required") };
    switch (getScheduled(id)) {
      case (?_) { #Err("Scheduled message id already exists") };
      case null {
        let stamp = Nat64.fromIntWrap(Time.now() / 1_000_000);
        let message : Types.ScheduledMessage = {
          id; author; chat_type; team_id; club_id; group_id; conversation_id;
          body; image_url; reply_to_id;
          scheduled_for_ms;
          status = #Pending;
          sent_message_id = null;
          error_message = null;
          attempted_at_ms = null;
          created_at_ms = stamp;
          updated_at_ms = stamp;
          recurrence;
          recurrence_until_ms;
          recurrence_parent_id = null;
        };
        scheduled := scheduled.concat([message]);
        #Ok(message)
      };
    }
  };

  // Caller-scoped per target: returns the author's scheduled messages,
  // optionally narrowed to a single target id (team/club/group/conversation).
  public query ({ caller }) func list_scheduled(author : Text, target : ?Text) : async Types.ScheduledResults {
    authenticated(caller);
    if (not valid(author)) { return #Err("Invalid author") };
    var res : [Types.ScheduledMessage] = [];
    for (item in scheduled.values()) {
      let targetOk = switch (target) {
        case (?t) { switch (scheduledTarget(item)) { case (?owned) { owned == t }; case null { false } } };
        case null { true };
      };
      if (item.author == author and targetOk) { res := res.concat([item]) };
    };
    #Ok(res)
  };

  public shared ({ caller }) func update_scheduled_message(
    id : Text,
    author : Text,
    body : ?Text,
    image_url : ?Text,
    scheduled_for_ms : ?Nat64,
    recurrence : ?Types.Recurrence,
    recurrence_until_ms : ?Nat64,
  ) : async Types.ScheduledResult {
    authenticated(caller);
    switch (findScheduledIndex(id)) {
      case null { #Err("Unknown scheduled message") };
      case (?index) {
        let item = scheduled[index];
        if (item.author != author) { return #Err("Author mismatch") };
        if (item.status != #Pending) { return #Err("Only pending messages can be edited") };
        let newBody = switch (body) { case (?b) { if (not valid(b)) { return #Err("Invalid body") }; b }; case null { item.body } };
        let newImage = switch (image_url) { case (?_) { image_url }; case null { item.image_url } };
        let newScheduledFor = switch (scheduled_for_ms) { case (?s) { if (s == 0) { return #Err("scheduled_for_ms required") }; s }; case null { item.scheduled_for_ms } };
        let newRecurrence = switch (recurrence) { case (?r) { r }; case null { item.recurrence } };
        let newRecurrenceUntil = switch (recurrence_until_ms) { case (?_) { recurrence_until_ms }; case null { item.recurrence_until_ms } };
        let updated = {
          item with
          body = newBody;
          image_url = newImage;
          scheduled_for_ms = newScheduledFor;
          recurrence = newRecurrence;
          recurrence_until_ms = newRecurrenceUntil;
          updated_at_ms = Nat64.fromIntWrap(Time.now() / 1_000_000);
        };
        replaceScheduled(index, updated);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func cancel_scheduled(id : Text, author : Text) : async Types.ScheduledResult {
    authenticated(caller);
    switch (findScheduledIndex(id)) {
      case null { #Err("Unknown scheduled message") };
      case (?index) {
        let item = scheduled[index];
        if (item.author != author) { return #Err("Author mismatch") };
        if (item.status != #Pending) { return #Err("Only pending messages can be cancelled") };
        let updated = { item with status = #Cancelled; updated_at_ms = Nat64.fromIntWrap(Time.now() / 1_000_000) };
        replaceScheduled(index, updated);
        #Ok(updated)
      };
    }
  };

  // Worker/governor guarded: the timer job marks a scheduled message sent
  // once it has posted the corresponding chat message.
  public shared ({ caller }) func mark_sent(id : Text, sent_message_id : Text) : async Types.ScheduledResult {
    worker(caller);
    switch (findScheduledIndex(id)) {
      case null { #Err("Unknown scheduled message") };
      case (?index) {
        let item = scheduled[index];
        if (item.status != #Pending) { return #Err("Scheduled message is not pending") };
        let stamp = Nat64.fromIntWrap(Time.now() / 1_000_000);
        let updated = { item with status = #Sent; sent_message_id = ?sent_message_id; attempted_at_ms = ?stamp; updated_at_ms = stamp };
        replaceScheduled(index, updated);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func mark_failed(id : Text, error : Text) : async Types.ScheduledResult {
    worker(caller);
    switch (findScheduledIndex(id)) {
      case null { #Err("Unknown scheduled message") };
      case (?index) {
        let item = scheduled[index];
        if (item.status != #Pending) { return #Err("Scheduled message is not pending") };
        let stamp = Nat64.fromIntWrap(Time.now() / 1_000_000);
        let updated = { item with status = #Failed; error_message = ?error; attempted_at_ms = ?stamp; updated_at_ms = stamp };
        replaceScheduled(index, updated);
        #Ok(updated)
      };
    }
  };

  // Worker/governor guarded query for the timer worker to poll due work.
  public query ({ caller }) func due_scheduled(now_ms : Nat64, limit : Nat16) : async Types.ScheduledResults {
    worker(caller);
    if (limit == 0 or limit > 200) { return #Err("Invalid batch size") };
    var res : [Types.ScheduledMessage] = [];
    for (item in scheduled.values()) {
      if (res.size() < Nat16.toNat(limit) and item.status == #Pending and item.scheduled_for_ms <= now_ms) {
        res := res.concat([item]);
      };
    };
    #Ok(res)
  };

  // ======================================================================
  // Message digests
  // ======================================================================

  func findDigestIndex(id : Text) : ?Nat {
    var index = 0;
    for (item in digests.values()) {
      if (item.id == id) { return ?index };
      index += 1;
    };
    null
  };

  // Worker guarded: digest items are produced by the classification job that
  // reads chat messages, not directly by end users.
  public shared ({ caller }) func record_digest_item(
    id : Text,
    message_id : Text,
    message_type : Types.DigestSource,
    chat_scope_id : Text,
    message_created_at_ms : Nat64,
    classification : Types.DigestClassification,
    summary : Text,
    topic : ?Text,
    mentions : [Text],
    provider : ?Text,
  ) : async Types.DigestResult {
    worker(caller);
    if (not valid(id) or not valid(message_id) or not valid(chat_scope_id)) {
      return #Err("Invalid digest fields");
    };
    switch (findDigestIndex(id)) {
      case (?index) { #Ok(digests[index]) };
      case null {
        let item : Types.DigestItem = {
          id; message_id; message_type; chat_scope_id; message_created_at_ms;
          classification; summary; topic; mentions; provider;
          digested_at_ms = Nat64.fromIntWrap(Time.now() / 1_000_000);
        };
        digests := digests.concat([item]);
        #Ok(item)
      };
    }
  };

  public query ({ caller }) func get_digest(source : Types.DigestSource, chat_scope_id : Text, since_ms : Nat64, limit : Nat16) : async Types.DigestResults {
    authenticated(caller);
    if (not valid(chat_scope_id)) { return #Err("Invalid chat scope") };
    if (limit == 0 or limit > 500) { return #Err("Invalid page size") };
    var res : [Types.DigestItem] = [];
    for (item in digests.values()) {
      if (res.size() < Nat16.toNat(limit) and item.message_type == source and item.chat_scope_id == chat_scope_id and item.message_created_at_ms >= since_ms) {
        res := res.concat([item]);
      };
    };
    #Ok(res)
  };

  // ======================================================================
  // Notification preferences
  // ======================================================================

  public query ({ caller }) func get_preferences(user : Text) : async Types.Preferences {
    authenticated(caller);
    switch (findPreference(user)) {
      case (?prefs) { prefs };
      case null { defaultPreferences(user) };
    }
  };

  public shared ({ caller }) func upsert_preferences(user : Text, input : Types.PreferencesInput) : async Types.PreferencesResult {
    authenticated(caller);
    if (not valid(user)) { return #Err("Invalid user") };
    let stamp = Nat64.fromIntWrap(Time.now() / 1_000_000);
    switch (findPreferenceIndex(user)) {
      case (?index) {
        let existing = preferences[index];
        let updated : Types.Preferences = {
          input with
          user;
          created_at_ms = existing.created_at_ms;
          updated_at_ms = stamp;
        };
        preferences := Array.tabulate<Types.Preferences>(preferences.size(), func(position) {
          if (position == index) { updated } else { preferences[position] }
        });
        #Ok(updated)
      };
      case null {
        let created : Types.Preferences = { input with user; created_at_ms = stamp; updated_at_ms = stamp };
        preferences := preferences.concat([created]);
        #Ok(created)
      };
    }
  };

  // ======================================================================
  // Push alert settings
  // NOTE: public.push_alert_settings has no user_id column in the real
  // schema — it is a single admin-configured row that drives push-failure
  // alerting, not a per-user settings table. Modelled here as a singleton;
  // token registration and per-recipient push preferences remain out of
  // scope / on Supabase.
  // ======================================================================

  func defaultPushAlertSettings() : Types.PushAlertSettings {
    {
      failure_threshold_percent = 20;
      check_window_hours = 24;
      min_notifications = 10;
      cooldown_hours = 6;
      alerts_enabled = true;
      updated_at_ms = 0;
      updated_by = null;
    }
  };

  public query ({ caller }) func get_push_alert_settings() : async Types.PushAlertSettings {
    authenticated(caller);
    switch (push_settings) {
      case (?settings) { settings };
      case null { defaultPushAlertSettings() };
    }
  };

  public shared ({ caller }) func upsert_push_alert_settings(input : Types.PushAlertSettingsInput) : async Types.PushAlertSettings {
    governorOnly(caller);
    let updated : Types.PushAlertSettings = {
      input with
      updated_at_ms = Nat64.fromIntWrap(Time.now() / 1_000_000);
      updated_by = ?Principal.toText(caller);
    };
    push_settings := ?updated;
    updated
  };

  // ======================================================================
  // Chat notification side-effects
  // Per-recipient fan-out triggered by a new chat message. Idempotent per
  // message id: once a message_id has been processed, repeat calls (e.g.
  // retried client-side side-effect dispatch) are no-ops that report 0
  // newly-created notifications instead of erroring or double-enqueuing.
  // Recipients present in mute_list are skipped (muted conversation/thread),
  // as are recipients with the "message" category disabled in their stored
  // Preferences (see recipientAllowed/categoryAllowed above).
  // ======================================================================

  func chatMessageProcessed(message_id : Text) : Bool {
    chat_notified_messages.any(func(id) = id == message_id)
  };

  public shared ({ caller }) func record_chat_notify_batch(
    message_id : Text,
    conversation_id : Text,
    sender : Text,
    preview : Text,
    recipients : [Text],
    mute_list : [Text],
  ) : async Types.ChatNotifyBatchResult {
    authenticated(caller);
    if (not valid(message_id) or not valid(conversation_id) or not valid(sender)) {
      return #Err("Invalid chat notify fields");
    };
    if (recipients.size() > 500) { return #Err("Invalid recipient count") };
    // Caller rules: the configured messaging_domain canister is trusted
    // (it expands recipients and mutes canister-side). Any other caller may
    // only fan out their own messages, and their mute list is ignored —
    // mute state is private to messaging_domain.
    let fromMessagingDomain = switch (messagingDomainCanister) {
      case (?md) { md.equal(caller) };
      case null { false };
    };
    if (not fromMessagingDomain and Principal.toText(caller) != sender) {
      return #Err("Sender must match caller");
    };
    let effective_mute_list = if (fromMessagingDomain) { mute_list } else { [] };
    if (chatMessageProcessed(message_id)) { return #Ok(0) };
    let stamp = Nat64.fromIntWrap(Time.now() / 1_000_000);
    var created : Nat16 = 0;
    for (recipient in recipients.values()) {
      let muted = effective_mute_list.any(func(m) = m == recipient);
      if (valid(recipient) and recipient != sender and not muted and recipientAllowed(recipient, "message_chat")) {
        let id = "chat-" # message_id # "-" # recipient;
        switch (get(id)) {
          case (?_) {};
          case null {
            let notification : Types.Notification = {
              id;
              user = recipient;
              club = conversation_id;
              kind = "message_chat";
              body = preview;
              idempotency_key = message_id;
              status = #Pending;
              attempts = 0;
              next_attempt_ms = 0;
              read = false;
              related_id = ?conversation_id;
              created_at_ms = stamp;
            };
            items := items.concat([notification]);
            created += 1;
          };
        };
      };
    };
    chat_notified_messages := chat_notified_messages.concat([message_id]);
    #Ok(created)
  };

  // ======================================================================
  // Bulk preferences listing (admin aggregate views)
  // See Types.PreferencesPage NOTE: club_id is accepted for parity with
  // other admin aggregate endpoints across the app, but preferences rows
  // carry no club_id in the real schema, so this paginates the full set.
  // ======================================================================

  public query ({ caller }) func list_preferences_by_club(club_id : Text, limit : Nat32, offset : Nat32) : async Types.PreferencesPageResult {
    governorOnly(caller);
    if (not valid(club_id)) { return #Err("Invalid club") };
    let boundedLimit = Nat32.min(limit, 500);
    let start = Nat.min(Nat32.toNat(offset), preferences.size());
    let end = Nat.min(start + Nat32.toNat(boundedLimit), preferences.size());
    let page = Array.tabulate<Types.Preferences>(end - start, func(i) = preferences[start + i]);
    #Ok({ items = page; total = Nat.toNat32(preferences.size()) })
  };

  // ======================================================================
  // Device push tokens
  // Registration is caller-scoped: a token is always owned by the IC
  // caller's principal text, so a device can only ever be registered to its
  // actual owner (matching Notification.user, which carries the principal
  // text in ICP mode). The push delivery worker (same authorization as
  // claim/acknowledge/fail) reads tokens through list_device_tokens and
  // prunes tokens the push service reports as dead via remove_device_tokens.
  // ======================================================================

  public shared ({ caller }) func register_device_token(platform : Text, token : Text, p256dh : ?Text, auth : ?Text) : async { #Ok; #Err : Text } {
    authenticated(caller);
    if (not valid(platform) or not valid(token)) { return #Err("Invalid device token fields") };
    let user = Principal.toText(caller);
    let stamp = Nat64.fromIntWrap(Time.now() / 1_000_000);
    let entry : Types.DeviceToken = { user; platform; token; p256dh; auth; updated_at_ms = stamp };
    var replaced = false;
    device_tokens := device_tokens.map(func(existing : Types.DeviceToken) : Types.DeviceToken {
      if (existing.user == user and existing.token == token) { replaced := true; entry } else { existing }
    });
    if (not replaced) { device_tokens := device_tokens.concat([entry]) };
    #Ok
  };

  public shared ({ caller }) func unregister_device_token(token : Text) : async Types.DeviceTokenCountResult {
    authenticated(caller);
    let user = Principal.toText(caller);
    var removed : Nat16 = 0;
    device_tokens := device_tokens.filter(func(existing : Types.DeviceToken) : Bool {
      if (existing.user == user and existing.token == token) { removed += 1; false } else { true }
    });
    #Ok(removed)
  };

  public query ({ caller }) func list_device_tokens(users : [Text]) : async Types.DeviceTokensResult {
    worker(caller);
    if (users.size() > 100) { return #Err("Too many users") };
    #Ok(device_tokens.filter(func(entry : Types.DeviceToken) : Bool {
      users.any(func(user : Text) : Bool = user == entry.user)
    }))
  };

  public shared ({ caller }) func remove_device_tokens(user : Text, tokens : [Text]) : async Types.DeviceTokenCountResult {
    worker(caller);
    if (not valid(user)) { return #Err("Invalid user") };
    var removed : Nat16 = 0;
    device_tokens := device_tokens.filter(func(entry : Types.DeviceToken) : Bool {
      if (entry.user == user and tokens.any(func(token : Text) : Bool = token == entry.token)) { removed += 1; false } else { true }
    });
    #Ok(removed)
  };
};
