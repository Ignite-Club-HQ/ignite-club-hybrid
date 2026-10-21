import AccountAdmission "../../shared/AccountAdmission";
import OpeningConfiguration "../../shared/OpeningConfiguration";
import RemovalReceiver "../../shared/RemovalReceiver";
import Map "mo:core/Map";
import Error "mo:core/Error";
import PrimMem "mo:⛔";
import Cycles "mo:core/Cycles";
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Nat "mo:core/Nat";
import Nat16 "mo:core/Nat16";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Timer "mo:core/Timer";
import Types "types";
import ScheduleAccess "scheduleAccess";
import ScheduleCalendar "scheduleCalendar";
import SchedulePatch "schedulePatch";
import UpdateReminderAccess "updateReminderAccess";

persistent actor class Main(governorInit : Principal) = this {
  // Opt-in local rehearsal only; production deploy scripts must never set these.
  transient let accountAdmissionEnabled = Runtime.envVar<system>("IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL") == ?"1";
  transient let accountAdmissionAuthority = switch (Runtime.envVar<system>("IGNITE_ACCOUNT_SERVICE_IDENTITY")) {
    case (?id) ?Principal.fromText(id); case null null
  };
  transient let accountAdmission = AccountAdmission.Gate(accountAdmissionEnabled, accountAdmissionAuthority);
  var removal_intents : Map.Map<Text, RemovalReceiver.Request>;
  var removal_subjects : Map.Map<Principal, Text>;
  var removal_active : Map.Map<Principal, Nat>;
  transient let removalReceiver = RemovalReceiver.Gate(accountAdmissionEnabled, accountAdmissionAuthority, removal_intents, removal_subjects, removal_active);
  func admitAccount(subject : Principal) : async () {
    if (removalReceiver.denied(subject)) throw Error.reject("Account removal fenced");
    let eligible = await accountAdmission.eligible(subject);
    if (removalReceiver.denied(subject) or not eligible) throw Error.reject("Account admission denied or unavailable");
  };
  func denyLegacyAccountQuery() {
    if (accountAdmissionEnabled) Runtime.trap("Use protected consensus account read");
  };

  /// Public: remaining cycles (shown in admin settings).
  public query func cycles_balance() : async Nat { Cycles.balance() };
  public shared ({ caller }) func read_group_opening_configuration() : async [(Text, Text)] {
    governorOnly(caller);
    if (workers.size() > 64) Runtime.trap("Opening worker set exceeds bounded owner scope");
    [("club_domain", OpeningConfiguration.optional(clubDomainCanister)),
     ("messaging_domain", OpeningConfiguration.optional(messagingDomainCanister)),
     ("identity_access", OpeningConfiguration.optional(identityAccessCanister))]
      .concat(workers.map(func p = ("worker", p.toText())))
  };
  // Live memory reading for the admin health page (public, like cycles_balance).
  public query func memory_stats() : async { heap_bytes : Nat; memory_bytes : Nat; stable_bytes : Nat } {
    {
      heap_bytes = PrimMem.rts_heap_size();
      memory_bytes = PrimMem.rts_memory_size();
      stable_bytes = PrimMem.nat64ToNat(PrimMem.stableMemorySize()) * 65536;
    }
  };

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
  // Governor-set club_domain canister id, used to verify app_admin grants
  // for admin-only endpoints (push health, stale token cleanup).
  var clubDomainCanister : ?Principal;
  // Governor-set identity_access canister id, used to bind the caller's
  // principal to their app account id so inbox reads/mutations can verify
  // ownership instead of trusting the browser-supplied `user` argument.
  // Fail-closed while unset.
  var identityAccessCanister : ?Principal;
  // Device push tokens owned by principal text (see Types.DeviceToken).
  // Caller-scoped writes; the delivery worker reads/prunes via worker-gated
  // methods below.
  var device_tokens : [Types.DeviceToken];
  var deviceVersions : [{ user : Text; platform : Text; app_version : ?Text; build_number : ?Text }];
  var transferFences : [Text];
  // Local-only bounded polling experiment; resets on upgrade, never authority.
  transient var rehearsalClaimCursor : Nat = 0;

  public shared ({ caller }) func set_messaging_domain_canister(id : Principal) : async { #Ok; #Err : Text } {
    governorOnly(caller);
    if (id.equal(Principal.anonymous())) { return #Err("Invalid canister id") };
    messagingDomainCanister := ?id;
    #Ok
  };

  public shared ({ caller }) func set_club_domain_canister(id : Principal) : async { #Ok; #Err : Text } {
    governorOnly(caller);
    if (id.equal(Principal.anonymous())) { return #Err("Invalid canister id") };
    clubDomainCanister := ?id;
    #Ok
  };

  public shared ({ caller }) func set_identity_access_canister(id : Principal) : async { #Ok; #Err : Text } {
    governorOnly(caller);
    if (id.equal(Principal.anonymous())) { return #Err("Invalid canister id") };
    identityAccessCanister := ?id;
    #Ok
  };

  // Resolve the caller's app account id via identity_access.whoami().
  // Returns null while unconfigured or on any error — callers treat null as
  // "ownership unproven" and refuse, so inbox data fails closed.

  // ---- Club transfer fence + snapshot (governor-only operator tooling) ----
  // Inspect is advisory only; the runner re-digests the source before cutover.
  func fenceGov(caller : Principal) : Bool = not caller.equal(Principal.anonymous()) and (switch (governor) { case (?g) g.equal(caller); case null false });
  func isFenced(club : Text) : Bool = transferFences.any(func(c) = c == club);
  func fenceBlobHas(hay : Blob, needle : Text) : Bool {
    let h = Blob.toArray(hay); let n = Blob.toArray(Text.encodeUtf8(needle));
    if (n.size() == 0 or n.size() > h.size()) return false;
    var i = 0;
    while (i + n.size() <= h.size()) { var j = 0; while (j < n.size() and h[i + j] == n[j]) j += 1; if (j == n.size()) return true; i += 1 };
    false
  };
  system func inspect({ caller : Principal; arg : Blob }) : Bool {
    if (transferFences.size() == 0 or fenceGov(caller)) return true;
    not transferFences.any(func(c) = fenceBlobHas(arg, c))
  };
  public shared ({ caller }) func set_transfer_fence(club : Text, fenced : Bool) : async { #Ok; #Err : Text } {
    if (not fenceGov(caller)) return #Err("Governor required");
    transferFences := transferFences.filter(func(c) = c != club);
    if (fenced) transferFences := transferFences.concat([club]);
    #Ok
  };
  func scheduledFenced(id : Text) : Bool = transferFences.size() > 0 and scheduled.any(func(x) = x.id == id and (switch (x.club_id) { case (?c) isFenced(c); case null false }));
  type FenceSnapshot = { items : [Types.Notification]; scheduled : [Types.ScheduledMessage] };
  func fenceSnapshot(c : Text) : FenceSnapshot {

    { items = items.filter(func(x) = x.club == c);
      scheduled = scheduled.filter(func(x) = x.club_id == ?c) }
  };
  func fenceDrop(c : Text) {
    if (items.any(func(x) = x.club == c and x.status == #Processing)) Runtime.trap("Unsettled delivery must be retained");
    items := items.filter(func(x) = not (x.club == c));
    scheduled := scheduled.filter(func(x) = not (x.club_id == ?c));
  };
  public query ({ caller }) func export_club_snapshot(club : Text) : async { #Ok : Blob; #Err : Text } {
    if (not fenceGov(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before export");
    if (items.any(func(x) = x.club == club and x.status == #Processing)) return #Err("Club has notifications being delivered; retry after the worker finishes");
    #Ok(to_candid (fenceSnapshot(club)))
  };
  public shared ({ caller }) func import_club_snapshot(club : Text, snapshot : Blob) : async { #Ok : Nat; #Err : Text } {
    if (not fenceGov(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before import");
    let decoded : ?FenceSnapshot = from_candid (snapshot);
    let s = switch (decoded) { case (?x) x; case null return #Err("Invalid snapshot") };
    let c = club;

    if (s.items.any(func(x) = not (x.club == c))
        or s.scheduled.any(func(x) = not (x.club_id == ?c))) return #Err("Snapshot contains foreign records");
    if (s.items.any(func(x) = recipientFenced(x.user) or x.status == #Processing)
        or s.scheduled.any(func(x) = recipientFenced(x.author))) return #Err("Snapshot restores fenced or unsettled delivery");
    if (false) return #Err("Snapshot id collides with another club");
    fenceDrop(club); // idempotent replace
    items := items.concat(s.items);
    scheduled := scheduled.concat(s.scheduled);
    #Ok(s.items.size())
  };
  public shared ({ caller }) func purge_club_snapshot(club : Text) : async { #Ok : Nat; #Err : Text } {
    if (not fenceGov(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before purge");
    let n = fenceSnapshot(club).items.size(); fenceDrop(club); #Ok(n)
  };


  func eligibleUsers(users : [Text]) : async [Text] {
    if (not accountAdmissionEnabled) return users;
    if (users.size() > 200) Runtime.trap("Admission batch exceeds 200");
    var allowed : [Text] = [];
    for (user in users.values()) {
      // Isolate parsing in an async message so one malformed ID cannot abort a batch.
      let subject = try { await async { ?Principal.fromText(user) } } catch (_) { null };
      switch (subject) {
        case null {};
        case (?principal) {
          if (not removalReceiver.enter(principal)) continue;
          try {
            let eligible = await accountAdmission.eligible(principal);
            if (eligible and not removalReceiver.denied(principal)) allowed := allowed.concat([user]);
          } finally { removalReceiver.leave(principal) };
        }
      };
    };
    allowed
  };

  func callerAccountId(caller : Principal) : async ?Text {
    // Resolve the supplied human, never remote whoami() (which sees this queue).
    let configured = identityAccessCanister;
    let gate = AccountAdmission.Gate(true, configured);
    switch (await gate.account(caller)) {
      case (?account) { if (configured == identityAccessCanister) ?account.id else null };
      case null null
    }
  };
  func ownsInbox(caller : Principal, user : Text) : async Bool {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    // Current ICP rows use principal text; historical account-id rows require
    // authoritative subject-bound resolution. No browser account assertion.
    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (user == caller.toText()) return true;
    switch (do { let removalReply = await callerAccountId(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }) { case (?id) id == user; case null false }
  
    } finally { removalReceiver.leave(caller) };
  };

  // Governor or club_domain app_admin grant. Fail-closed while
  // clubDomainCanister is unset (mirrors messaging_domain/events_domain).
  func appAdminOnly(caller : Principal) : async { #Ok; #Err : Text } {
    authenticated(caller);
    switch (governor) {
      case (?owner) { if (owner.equal(caller)) { return #Ok } };
      case null {};
    };
    switch (clubDomainCanister) {
      case null { #Err("club_domain canister not configured") };
      case (?cd) {
        let clubDomain = actor (Principal.toText(cd)) : actor { is_app_admin : shared query (Principal) -> async Bool };
        let isAdmin = try { await clubDomain.is_app_admin(caller) } catch (_) { false };
        if (isAdmin) { #Ok } else { #Err("App admin required") };
      };
    };
  };

  func authenticated(caller : Principal) {
    if (caller.equal(Principal.anonymous())) { Runtime.trap("Forbidden") };
  };

  func authorizeUpdateReminder(caller : Principal, users : [Text], club : Text) : async { #Ok; #Err : Text } {
    let cd = switch (clubDomainCanister) {
      case null { return #Err("club_domain canister not configured") };
      case (?id) { id };
    };
    let clubs = actor (Principal.toText(cd)) : actor {
      is_club_member : shared query (Principal, Text) -> async Bool;
    };
    func adminCheck(p : Principal) : async Bool {
      switch (await appAdminOnly(p)) { case (#Ok) { true }; case (#Err(_)) { false } }
    };
    func memberCheck(p : Principal, clubId : Text) : async Bool {
      await clubs.is_club_member(p, clubId)
    };
    await UpdateReminderAccess.authorize(caller, users, club, adminCheck, memberCheck)
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    let trustedService = clubDomainCanister == ?caller or messagingDomainCanister == ?caller;
    if (not trustedService) do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (isFenced(club)) return #Err("Club is temporarily locked for a transfer");
    authenticated(caller);
    if (not valid(id) or not valid(user) or not valid(club) or not valid(kind) or not valid(key)) {
      return #Err("Invalid notification fields");
    };
    if (UpdateReminderAccess.protectedKind(kind)) {
      switch (do { let removalReply = await authorizeUpdateReminder(caller, [user], club); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }) {
        case (#Err(e)) { return #Err(e) };
        case (#Ok) {};
      };
    };
    if (not trustedService) do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (isFenced(club)) return #Err("Notification scope changed");
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
  
    } finally { removalReceiver.leave(caller) };
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
  public shared ({ caller }) func fan_out(inputUsers : [Text], club : Text, kind : Text, body : Text, key_prefix : Text, related_id : ?Text) : async Types.ResultNat16 {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    let trustedService = clubDomainCanister == ?caller or messagingDomainCanister == ?caller;
    if (not trustedService) do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (isFenced(club)) return #Err("Club is temporarily locked for a transfer");
    authenticated(caller);
    if (inputUsers.size() == 0 or inputUsers.size() > 500) { return #Err("Invalid recipient count") };
    if (not valid(club) or not valid(kind) or not valid(key_prefix)) { return #Err("Invalid fan-out fields") };
    var users : [Text] = [];
    for (raw in inputUsers.values()) {
      let trimmed = Text.trim(raw, #predicate(func(c) = c == ' ' or c == '\n' or c == '\r' or c == '\t'));
      let text = switch (Text.stripStart(trimmed, #text "principal:")) { case (?bare) bare; case null trimmed };
      let parsed = try { await async { ?Principal.fromText(text) } } catch (_) { null };
      let ?principal = parsed else return #Err("Invalid recipient");
      if (Principal.isAnonymous(principal)) return #Err("Invalid recipient");
      let user = principal.toText();
      if (not users.any(func(u) = u == user)) users := users.concat([user]);
    };
    if (UpdateReminderAccess.protectedKind(kind)) {
      switch (do { let removalReply = await authorizeUpdateReminder(caller, users, club); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }) {
        case (#Err(e)) { return #Err(e) };
        case (#Ok) {};
      };
    };
    // Schedule refresh is a staff command, not a browser-authorized action.
    if (kind == "schedule_refresh") {
      let cd = switch (clubDomainCanister) {
        case null { return #Err("club_domain canister not configured") };
        case (?id) { id };
      };
      let clubs = actor (Principal.toText(cd)) : actor {
        list_user_club_roles : shared query (Principal, Text) -> async [(Text, ?Text)];
        is_app_admin : shared query (Principal) -> async Bool;
      };
      let permitted = try {
        let roles = do { let removalReply = await clubs.list_user_club_roles(caller, club); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
        if (ScheduleAccess.canBroadcast(roles, related_id)) { true }
        else { do { let removalReply = await clubs.is_app_admin(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply } }
      } catch (_) { false };
      if (not permitted) { return #Err("Schedule manager required") };
      // Validate the full batch before writing any notification. Never trust
      // a manager's browser to choose recipients from another club/team.
      for (user in users.values()) {
        let principal = Principal.fromText(user);
        if (Principal.isAnonymous(principal)) { return #Err("Invalid recipient") };
        let roles = try { do { let removalReply = await clubs.list_user_club_roles(principal, club); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply } }
          catch (_) { return #Err("Could not verify schedule recipient") };
        if (not ScheduleAccess.recipient(roles, related_id)) {
          return #Err("Recipient is not in the schedule scope")
        };
      };
    };
    if (not trustedService) do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (isFenced(club)) return #Err("Notification scope changed");
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
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Browser inbox surface ----
  // Latest durable schedule signal per club/team for the actual caller.
  // Kept separate from inbox pagination so old notifications cannot mask it.
  public query ({ caller }) func get_schedule_refreshes(clubs : [Text]) : async [{ club : Text; team : ?Text; key : Text }] {
    denyLegacyAccountQuery();
    authenticated(caller);
    if (clubs.size() > 100) { return [] };
    let user = Principal.toText(caller);
    var signals : [{ club : Text; team : ?Text; key : Text }] = [];
    for (item in items.values()) {
      if (item.user == user and item.kind == "schedule_refresh" and clubs.any(func(id) = id == item.club)) {
        signals := signals.filter(func(s) = not (s.club == item.club and s.team == item.related_id));
        signals := signals.concat([{ club = item.club; team = item.related_id; key = item.idempotency_key }]);
      };
    };
    signals
  };
  // Inbox ownership is verified against the caller's account id resolved
  // from identity_access — the browser-supplied `user` argument is never
  // trusted on its own. These are update calls (not queries) because the
  // ownership check awaits an inter-canister lookup.

  public shared ({ caller }) func list_inbox(user : Text, club : ?Text, limit : Nat16) : async Types.Results {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    authenticated(caller);
    if (limit == 0 or limit > 500) { return #Err("Invalid page size") };
    if (not (do { let removalReply = await ownsInbox(caller, user); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Not your inbox or account unavailable");
    var res : [Types.Notification] = [];
    for (item in items.values()) {
      let clubOk = switch (club) { case (?c) { item.club == c }; case null { true } };
      if (res.size() < Nat16.toNat(limit) and item.user == user and clubOk) {
        res := res.concat([item]);
      };
    };
    #Ok(res)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func mark_read(id : Text) : async Types.Result {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    authenticated(caller);
    let captured = switch (get(id)) { case null return #Err("Unknown notification"); case (?n) n };
    if (not (do { let removalReply = await ownsInbox(caller, captured.user); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Not your notification");
    let index = switch (findIndex(id)) { case null return #Err("Unknown notification"); case (?i) i };
    if (items[index] != captured) return #Err("Notification changed");
    let updated : Types.Notification = { items[index] with read = true };
    replace(index, updated); #Ok(updated)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func mark_all_read(user : Text, club : ?Text) : async Types.ResultNat16 {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    authenticated(caller);
    if (not (do { let removalReply = await ownsInbox(caller, user); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Not your inbox or account unavailable");
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
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func delete_notification(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    authenticated(caller);
    let captured = switch (get(id)) { case null return #Err("Unknown notification"); case (?n) n };
    if (not (do { let removalReply = await ownsInbox(caller, captured.user); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Not your notification");
    let index = switch (findIndex(id)) { case null return #Err("Unknown notification"); case (?i) i };
    if (items[index] != captured) return #Err("Notification changed");
    if (captured.status == #Processing) return #Err("Notification delivery must settle before deletion");
    items := items.filter(func(item) = item.id != id); clearLease(id); #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func clear_inbox(user : Text, club : ?Text) : async Types.ResultNat16 {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    if (not (do { let removalReply = await ownsInbox(caller, user); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Not your inbox");
    authenticated(caller);
    var kept : [Types.Notification] = [];
    var removed : Nat16 = 0;
    if (items.any(func(item) = item.user == user and item.status == #Processing and (switch (club) { case (?c) item.club == c; case null true }))) return #Err("Notification delivery must settle before clearing");
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
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func claim(now_ms : Nat64, limit : Nat16) : async Types.Results {
    worker(caller);
    if (limit == 0 or limit > 100) return #Err("Invalid batch size");
    var candidates : [Types.Notification] = [];
    do {
      // Advance even if admission denies every candidate; otherwise a denied
      // prefix can permanently starve an eligible notification behind it.
      let count = items.size();
      var scanned = 0;
      while (scanned < Nat.min(count, 200) and candidates.size() < Nat16.toNat(limit)) {
        let index = (rehearsalClaimCursor + scanned) % count;
        let item = items[index];
        if (item.status == #Pending and item.next_attempt_ms <= now_ms and not isFenced(item.club)) candidates := candidates.concat([item]);
        scanned += 1;
      };
      if (count > 0) rehearsalClaimCursor := (rehearsalClaimCursor + scanned) % count;
    };
    let allowed = await eligibleUsers(candidates.map(func(n) = n.user));
    worker(caller); // worker may have been revoked during admission
    var claimed : [Types.Notification] = [];
    for (candidate in candidates.values()) {
      switch (findIndex(candidate.id)) {
        case null {};
        case (?index) {
          let item = items[index];
          if (item == candidate and item.status == #Pending and not isFenced(item.club) and allowed.any(func(u) = u == item.user) and not recipientFenced(item.user)) {
            let processing : Types.Notification = { item with status = #Processing; attempts = item.attempts + 1 };
            replace(index, processing); setLease(item.id, caller); claimed := claimed.concat([processing]);
          }
        }
      }
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

  // Fresh private-delivery permission, separate from claim and shared devices.
  // False is a definitive denial; Err is unavailable/changed evidence (retry).
  public shared ({ caller }) func authorize_delivery(id : Text, key : Text) : async { #Ok : Bool; #Err : Text } {
    worker(caller);
    let captured = switch (get(id)) { case null return #Err("Unknown notification"); case (?n) n };
    if (captured.status != #Processing or captured.idempotency_key != key or not ownsLease(id, caller)) return #Err("Notification lease required");
    if (isFenced(captured.club)) return #Err("Notification scope locked");
    let subject = try { await async { ?Principal.fromText(captured.user) } } catch (_) { null };
    let ?user = subject else return #Err("Recipient identity unresolved");
    if (Principal.isAnonymous(user)) return #Ok(false);
    if (not removalReceiver.enter(user)) return #Ok(false);
    try {
    do { let removalReply = await admitAccount(user); if (removalReceiver.denied(user)) throw Error.reject("Account removal fenced after callback"); removalReply };
    let cd = clubDomainCanister;
    let md = messagingDomainCanister;
    let allowed = try {
      if (captured.kind == "message_chat") {
        let ?authority = md else return #Err("Messaging authority unavailable");
        let messaging : actor { read_account_can_read_digest : shared (Principal, Text) -> async Bool } = actor(authority.toText());
        do { let removalReply = await (with timeout = 10) messaging.read_account_can_read_digest(user, captured.club); if (removalReceiver.denied(user)) throw Error.reject("Account removal fenced after callback"); removalReply }
      } else if (captured.club == "" or captured.club == "global" or captured.club == "app" or captured.kind == "club_invite" or captured.kind == "team_invite" or captured.kind == "membership_removed" or captured.kind == "role_removed") {
        true // App/personal and access-change notices do not grant club access.
      } else {
        let ?authority = cd else return #Err("Club authority unavailable");
        let clubs : actor { read_has_club_membership : shared (Principal, Text) -> async Bool } = actor(authority.toText());
        do { let removalReply = await (with timeout = 10) clubs.read_has_club_membership(user, captured.club); if (removalReceiver.denied(user)) throw Error.reject("Account removal fenced after callback"); removalReply }
      }
    } catch (_) { return #Err("Delivery authority unavailable") };
    worker(caller);
    if (cd != clubDomainCanister or md != messagingDomainCanister or isFenced(captured.club)) return #Err("Delivery authority changed");
    switch (get(id)) {
      case (?fresh) { if (fresh != captured or not ownsLease(id, caller)) return #Err("Notification changed") };
      case null return #Err("Notification removed")
    };
    if (removalReceiver.denied(user)) return #Ok(false);
    #Ok(allowed and recipientAllowed(captured.user, captured.kind))
    } finally { removalReceiver.leave(user) };
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
          // Preserve the original notification on retry; errors are worker logs.
          status = switch (retry_at_ms) { case (?_) { #Pending }; case null { #Failed } };
          next_attempt_ms = switch (retry_at_ms) { case (?time) { time }; case null { item.next_attempt_ms } };
        };
        replace(index, failed);
        clearLease(id);
        #Ok(failed)
      };
    }
  };

  public shared ({ caller }) func get_notification(id : Text) : async ?Types.Notification {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    if (Principal.isAnonymous(caller)) return null;
    let captured = switch (get(id)) { case null return null; case (?n) n };
    if (not (do { let removalReply = await ownsInbox(caller, captured.user); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return null;
    switch (get(id)) { case (?fresh) { if (fresh == captured) ?fresh else null }; case null null }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func recover() : async Types.ResultNat16 {
    worker(caller);
    var recovered : Nat16 = 0;
    var index = 0;
    for (item in items.values()) {
      if (item.status == #Processing and not accountAdmissionEnabled) {
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    authenticated(caller);
    if (not ScheduleAccess.owns(caller, author)) { return #Err("Author mismatch") };
    if (not valid(id) or not valid(author) or (not valid(body) and image_url == null)) {
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
  
    } finally { removalReceiver.leave(caller) };
  };

  // Caller-scoped per target: returns the author's scheduled messages,
  // optionally narrowed to a single target id (team/club/group/conversation).
  public query ({ caller }) func list_scheduled(author : Text, target : ?Text) : async Types.ScheduledResults {
    denyLegacyAccountQuery();
    authenticated(caller);
    if (not ScheduleAccess.owns(caller, author)) { return #Err("Author mismatch") };
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    authenticated(caller);
    if (not ScheduleAccess.owns(caller, author)) { return #Err("Author mismatch") };
    switch (findScheduledIndex(id)) {
      case null { #Err("Unknown scheduled message") };
      case (?index) {
        let item = scheduled[index];
        if (item.author != author) { return #Err("Author mismatch") };
        if (item.status != #Pending) { return #Err("Only pending messages can be edited") };
        let newImage = SchedulePatch.image(item.image_url, image_url);
        let newBody = switch (body) { case (?b) { b }; case null { item.body } };
        if (not valid(newBody) and newImage == null) { return #Err("Invalid body") };
        let newScheduledFor = switch (scheduled_for_ms) { case (?s) { if (s == 0) { return #Err("scheduled_for_ms required") }; s }; case null { item.scheduled_for_ms } };
        let newRecurrence = switch (recurrence) { case (?r) { r }; case null { item.recurrence } };
        let newRecurrenceUntil = SchedulePatch.endDate(item.recurrence_until_ms, recurrence_until_ms);
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
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func cancel_scheduled(id : Text, author : Text) : async Types.ScheduledResult {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    authenticated(caller);
    if (not ScheduleAccess.owns(caller, author)) { return #Err("Author mismatch") };
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
  
    } finally { removalReceiver.leave(caller) };
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
  public shared ({ caller }) func due_scheduled(now_ms : Nat64, limit : Nat16) : async Types.ScheduledResults {
    worker(caller);
    if (limit == 0 or limit > 200) { return #Err("Invalid batch size") };
    var res : [Types.ScheduledMessage] = [];
    for (item in scheduled.values()) {
      if (res.size() < Nat16.toNat(limit) and item.status == #Pending and item.scheduled_for_ms <= now_ms) {
        res := res.concat([item]);
      };
    };
    let allowed = await eligibleUsers(res.map(func(n) = n.author));
    worker(caller);
    #Ok(res.filter(func(n) = allowed.any(func(u) = u == n.author) and getScheduled(n.id) == ?n and not scheduledFenced(n.id)))
  };


  // ======================================================================
  // Scheduled-message delivery. A transient 5-minute timer posts every due
  // Pending scheduled message to messaging_domain as its author (via
  // deliver_scheduled_message, which trusts only this canister and re-runs
  // all send checks). Recurring messages roll forward to their next slot.
  // Idempotency key "sched:<id>:<slot>" makes a repeated tick a no-op.
  // ======================================================================

  transient var deliveringScheduled = false;
  transient let SCHEDULED_BATCH = 20;

  func scheduledConversation(item : Types.ScheduledMessage) : ?Text {
    switch (item.chat_type) {
      case (#Broadcast) { ?"broadcast" };
      case (#Direct or #ClubAdmin) { item.conversation_id };
      case _ { scheduledTarget(item) };
    }
  };

  func looksLikePrincipal(t : Text) : Bool {
    t.size() >= 5 and t.size() <= 63 and t.contains(#char '-')
  };

  func nextSlot(item : Types.ScheduledMessage) : ?Nat64 {
    let now = Nat64.fromIntWrap(Time.now() / 1_000_000);
    ScheduleCalendar.next(item.scheduled_for_ms, item.recurrence, now, item.recurrence_until_ms)
  };

  func settleScheduled(id : Text, slot : Nat64, outcome : { #Sent : Text; #Failed : Text }) {
    switch (findScheduledIndex(id)) {
      case null {};
      case (?index) {
        let item = scheduled[index];
        // Edited/cancelled while in flight: leave the newer state alone.
        if (item.status != #Pending or item.scheduled_for_ms != slot) { return };
        let stamp = Nat64.fromIntWrap(Time.now() / 1_000_000);
        let updated = switch (outcome) {
          case (#Sent(msgId)) {
            switch (nextSlot(item)) {
              case (?next) { { item with scheduled_for_ms = next; sent_message_id = ?msgId; attempted_at_ms = ?stamp; updated_at_ms = stamp } };
              case null { { item with status = #Sent; sent_message_id = ?msgId; attempted_at_ms = ?stamp; updated_at_ms = stamp } };
            }
          };
          case (#Failed(err)) { { item with status = #Failed; error_message = ?err; attempted_at_ms = ?stamp; updated_at_ms = stamp } };
        };
        replaceScheduled(index, updated);
      };
    }
  };

  func deliverDueScheduled() : async () {
    if (deliveringScheduled) { return };
    let messaging = switch (messagingDomainCanister) { case (?m) { m }; case null { return } };
    let now = Nat64.fromIntWrap(Time.now() / 1_000_000);
    var due : [Types.ScheduledMessage] = [];
    for (item in scheduled.values()) {
      if (due.size() < SCHEDULED_BATCH and item.status == #Pending and item.scheduled_for_ms <= now) {
        due := due.concat([item]);
      };
    };
    if (due.size() == 0) { return };
    deliveringScheduled := true;
    let chat : actor {
      deliver_scheduled_message : shared (Principal, Text, Text, Text, ?{ kind : Text; ref_id : Text; url : ?Text }, ?Text) -> async { #Ok : { id : Text }; #Err : Text };
    } = actor (Principal.toText(messaging));
    for (item in due.values()) {
      if (not looksLikePrincipal(item.author)) continue;
      let subject = try { await async { ?Principal.fromText(item.author) } } catch (_) { null };
      let ?author = subject else continue;
      if (not removalReceiver.enter(author)) continue;
      try {
      if (accountAdmissionEnabled) {
        let allowed = await eligibleUsers([item.author]);
        if (allowed.size() == 0 or getScheduled(item.id) != ?item or scheduledFenced(item.id) or messagingDomainCanister != ?messaging) continue;
      };
      let slot = item.scheduled_for_ms;
      switch (scheduledConversation(item)) {
        case null { settleScheduled(item.id, slot, #Failed("No chat to post to")) };
        case (?conversation) {
          if (not looksLikePrincipal(item.author)) {
            settleScheduled(item.id, slot, #Failed("Author is not a blockchain account"));
          } else {
            let attachment = switch (item.image_url) {
              case (?url) { ?{ kind = "image"; ref_id = "sched-" # item.id; url = ?url } };
              case null { null };
            };
            let body = if (item.body == "" and attachment != null) { " " } else { item.body };
            try {
              switch (await chat.deliver_scheduled_message(Principal.fromText(item.author), conversation, body, "sched:" # item.id # ":" # Nat64.toText(slot), attachment, item.reply_to_id)) {
                case (#Ok(msg)) { if (not removalReceiver.denied(author) and messagingDomainCanister == ?messaging) settleScheduled(item.id, slot, #Sent(msg.id)) };
                case (#Err(e)) { if (not removalReceiver.denied(author) and messagingDomainCanister == ?messaging) settleScheduled(item.id, slot, #Failed(e)) };
              };
            } catch (_) {
              // Transient call failure: stay Pending, retried next tick.
            };
          };
        };
      };
      } finally { removalReceiver.leave(author) };
    };
    deliveringScheduled := false;
  };

  transient let _scheduledTimer = Timer.recurringTimer<system>(#seconds(300), func() : async () {
    try { await deliverDueScheduled() } catch (_) { deliveringScheduled := false };
  });

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
    denyLegacyAccountQuery();
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
    denyLegacyAccountQuery();
    if (user != caller.toText()) Runtime.trap("Not your preferences");
    authenticated(caller);
    switch (findPreference(user)) {
      case (?prefs) { prefs };
      case null { defaultPreferences(user) };
    }
  };

  public shared ({ caller }) func upsert_preferences(user : Text, input : Types.PreferencesInput) : async Types.PreferencesResult {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    if (not (do { let removalReply = await ownsInbox(caller, user); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Not your preferences");
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
  
    } finally { removalReceiver.leave(caller) };
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
    denyLegacyAccountQuery();
    authenticated(caller);
    switch (push_settings) {
      case (?settings) { settings };
      case null { defaultPushAlertSettings() };
    }
  };

  public shared ({ caller }) func upsert_push_alert_settings(input : Types.PushAlertSettingsInput) : async Types.PushAlertSettings {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    governorOnly(caller);
    let updated : Types.PushAlertSettings = {
      input with
      updated_at_ms = Nat64.fromIntWrap(Time.now() / 1_000_000);
      updated_by = ?Principal.toText(caller);
    };
    push_settings := ?updated;
    updated
  
    } finally { removalReceiver.leave(caller) };
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

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
    if (not fromMessagingDomain) do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    let effective_mute_list = if (fromMessagingDomain) { mute_list } else { [] };
    if (chatMessageProcessed(message_id)) { return #Ok(0) };
    let stamp = Nat64.fromIntWrap(Time.now() / 1_000_000);
    if (accountAdmissionEnabled and recipients.size() > 200) return #Err("Recipient admission batch exceeds 200");
    let allowedRecipients = do { let removalReply = await eligibleUsers(recipients); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (chatMessageProcessed(message_id)) return #Ok(0);
    var created : Nat16 = 0;
    for (recipient in recipients.values()) {
      let muted = effective_mute_list.any(func(m) = m == recipient);
      if ((not accountAdmissionEnabled or allowedRecipients.any(func(u) = u == recipient)) and valid(recipient) and recipient != sender and not muted and recipientAllowed(recipient, "message_chat")) {
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
  
    } finally { removalReceiver.leave(caller) };
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
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
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
  
    } finally { removalReceiver.leave(caller) };
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

  public shared ({ caller }) func register_device_version(platform : Text, app_version : ?Text, build_number : ?Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    authenticated(caller);
    if (platform != "ios" and platform != "android" and platform != "web") return #Err("Invalid platform");
    for (value in [app_version, build_number].values()) {
      switch (value) { case (?v) { if (v.size() == 0 or v.size() > 64) return #Err("Invalid version") }; case null {} };
    };
    let user = Principal.toText(caller);
    if (not device_tokens.any(func(t) = t.user == user and t.platform == platform)) return #Err("Register a device first");
    deviceVersions := deviceVersions.filter(func(v) = v.user != user or v.platform != platform);
    deviceVersions := deviceVersions.concat([{ user; platform; app_version; build_number }]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  // Version metadata is device-reported, not attestation. Never return push tokens.
  public shared ({ caller }) func get_update_reminder_audience(users : [Text], club : Text) : async { #Ok : [{ user : Text; platform : Text; app_version : ?Text; build_number : ?Text }]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (isFenced(club)) return #Err("Club is temporarily locked for a transfer");
    if (users.size() > 500) return #Err("Too many recipients");
    switch (do { let removalReply = await authorizeUpdateReminder(caller, users, club); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }) { case (#Err(e)) { return #Err(e) }; case (#Ok) {} };
    #Ok(deviceVersions.filter(func(v) = users.any(func(u) = u == v.user) and
      device_tokens.any(func(t) = t.user == v.user and t.platform == v.platform)))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func list_device_tokens(users : [Text]) : async Types.DeviceTokensResult {
    worker(caller);
    if (users.size() > 100) { return #Err("Too many users") };
    let allowed = await eligibleUsers(users);
    worker(caller);
    #Ok(device_tokens.filter(func(entry : Types.DeviceToken) : Bool {
      allowed.any(func(user : Text) : Bool = user == entry.user)
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

  // ---- Admin: 24h push delivery health + stale device-token cleanup ----
  // App-admin gated (governor or club_domain app_admin). Backs
  // PushAnalyticsPage's health dashboard and "Cleanup Stale" button.
  public shared ({ caller }) func get_push_delivery_health(now_ms : Nat64) : async Types.PushDeliveryHealthResult {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (do { let removalReply = await appAdminOnly(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }) {
      case (#Err(e)) { return #Err(e) };
      case (#Ok) {};
    };
    let windowMs : Nat64 = 24 * 3_600_000;
    let cutoff : Nat64 = if (now_ms > windowMs) { now_ms - windowMs } else { 0 };
    var total : Nat32 = 0;
    var pending : Nat32 = 0;
    var processing : Nat32 = 0;
    var delivered : Nat32 = 0;
    var failed : Nat32 = 0;
    for (item in items.values()) {
      if (item.created_at_ms >= cutoff) {
        total += 1;
        switch (item.status) {
          case (#Pending) { pending += 1 };
          case (#Processing) { processing += 1 };
          case (#Delivered) { delivered += 1 };
          case (#Failed) { failed += 1 };
        };
      };
    };
    #Ok({
      window_hours = 24;
      generated_at_ms = now_ms;
      total_24h = total;
      pending_24h = pending;
      processing_24h = processing;
      delivered_24h = delivered;
      failed_24h = failed;
      device_token_count = Nat.toNat32(device_tokens.size());
    });
  
    } finally { removalReceiver.leave(caller) };
  };

  // Removes device tokens untouched for more than `max_age_ms` (stale/dead
  // registrations — same intent as the Supabase cleanup-push-subscriptions
  // edge function). Returns the number removed.
  public shared ({ caller }) func cleanup_stale_device_tokens(now_ms : Nat64, max_age_ms : Nat64) : async Types.DeviceTokenCountResult {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (do { let removalReply = await appAdminOnly(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }) {
      case (#Err(e)) { return #Err(e) };
      case (#Ok) {};
    };
    let cutoff : Nat64 = if (now_ms > max_age_ms) { now_ms - max_age_ms } else { 0 };
    let before = device_tokens.size();
    device_tokens := device_tokens.filter(func(t : Types.DeviceToken) : Bool { t.updated_at_ms >= cutoff });
    #Ok(Nat.toNat16(before - device_tokens.size()));
  
    } finally { removalReceiver.leave(caller) };
  };

  // Governor-only: moves every stored reference of one user's sign-in ID (old) to a new one.
  // Any NEW stored principal / principal-text field added to this canister must be added here.
  //
  // Covered: Notification.user, ScheduledMessage.author, DigestItem.mentions
  // (Text elements; exact match only), Preferences.user, PushAlertSettings.updated_by,
  // DeviceToken.user. Device tokens and preferences are the ephemeral/allowed
  // collections called out by the spec: on collision we keep the NEW row and
  // drop the OLD one instead of erroring or merging.
  // Not touched: governor (governor variable itself), workers (worker wiring),
  // Lease.owner (always a worker principal), messagingDomainCanister
  // (canister wiring), chat_notified_messages (message ids, not identities).
  public shared ({ caller }) func rekey_principal(old : Principal, new : Principal, dry_run : Bool) : async { #ok : Nat; #err : Text } {
    if (removalReceiver.denied(old) or removalReceiver.denied(new)) return #err("Account removal fenced");
    rekeyImpl(caller, old, new, dry_run, false)
  };

  // Same as rekey_principal, but allowed when the new sign-in ID already has data:
  // both IDs' records end up under the new one (keyed duplicates keep the new row).
  public shared ({ caller }) func merge_principal(old : Principal, new : Principal, dry_run : Bool) : async { #ok : Nat; #err : Text } {
    rekeyImpl(caller, old, new, dry_run, true)
  };

  func rekeyImpl(caller : Principal, old : Principal, new : Principal, dry_run : Bool, allowMerge : Bool) : { #ok : Nat; #err : Text } {
    if (removalReceiver.denied(old) or removalReceiver.denied(new)) return #err("Account removal fenced");
    if (removalReceiver.denied(old) or removalReceiver.denied(new)) return #err("Account removal fenced");
    authenticated(caller);
    let isGov = switch (governor) { case (?g) { g.equal(caller) }; case null { false } };
    if (not isGov) return #err("Forbidden");
    if (old.equal(Principal.anonymous()) or new.equal(Principal.anonymous())) return #err("Invalid principal");
    if (old.equal(new)) return #err("old and new principal must differ");
    let governorIsOld = switch (governor) { case (?g) { g.equal(old) }; case null { false } };
    if (governorIsOld) return #err("Cannot rekey the governor");

    let oldText = Principal.toText(old);
    let newText = Principal.toText(new);
    let newDeviceVersions = deviceVersions.filter(func(v) = v.user != oldText).concat(
      deviceVersions.filter(func(v) = v.user == oldText and not deviceVersions.any(func(n) = n.user == newText and n.platform == v.platform))
        .map(func(v) = { v with user = newText })
    );

    // Conflict guard: non-ephemeral records already referencing `new`.
    // (device_tokens and preferences are excluded — they are the
    // ephemeral/allowed collections, handled by keep-new-drop-old below.)
    var conflicts = 0;
    conflicts += items.filter(func(n : Types.Notification) : Bool = n.user == newText).size();
    conflicts += scheduled.filter(func(s : Types.ScheduledMessage) : Bool = s.author == newText).size();
    conflicts += digests.filter(func(d : Types.DigestItem) : Bool = d.mentions.any(func(m : Text) : Bool = m == newText)).size();
    conflicts += switch (push_settings) { case (?p) { if (p.updated_by == ?newText) { 1 } else { 0 } }; case null { 0 } };
    if (conflicts > 0 and not allowMerge) return #err("New sign-in ID already has " # Nat.toText(conflicts) # " record(s) in notification_queue");

    var changed = 0;

    let newItems = items.map(func(n : Types.Notification) : Types.Notification {
      if (n.user == oldText) { changed += 1; { n with user = newText } } else { n }
    });

    let newScheduled = scheduled.map(func(s : Types.ScheduledMessage) : Types.ScheduledMessage {
      if (s.author == oldText) { changed += 1; { s with author = newText } } else { s }
    });

    let newDigests = digests.map(func(d : Types.DigestItem) : Types.DigestItem {
      if (d.mentions.any(func(m : Text) : Bool = m == oldText)) {
        changed += 1;
        var seenNew = d.mentions.any(func(m : Text) : Bool = m == newText);
        var out : [Text] = [];
        for (m in d.mentions.values()) {
          if (m == oldText) {
            if (not seenNew) { out := out.concat([newText]); seenNew := true };
          } else {
            out := out.concat([m]);
          };
        };
        { d with mentions = out }
      } else { d }
    });

    let newPushSettings = switch (push_settings) {
      case (?p) { if (p.updated_by == ?oldText) { changed += 1; ?{ p with updated_by = ?newText } } else { ?p } };
      case null { null };
    };

    // Device tokens: caller-scoped, keyed by (user, token). On collision
    // (same token already registered under both old and new text) keep the
    // NEW row and drop the OLD one; otherwise just rename old -> new.
    var deviceChanged = 0;
    var dedupedDeviceTokens : [Types.DeviceToken] = [];
    for (t in device_tokens.values()) {
      let renamed : Types.DeviceToken = if (t.user == oldText) { { t with user = newText } } else { t };
      if (t.user == oldText) { deviceChanged += 1 };
      if (not dedupedDeviceTokens.any(func(x : Types.DeviceToken) : Bool = x.user == renamed.user and x.token == renamed.token)) {
        dedupedDeviceTokens := dedupedDeviceTokens.concat([renamed]);
      };
    };
    changed += deviceChanged;

    // Preferences: one row per user. On collision (both old and new already
    // have a stored Preferences row) keep the NEW row and drop the OLD one.
    var prefsChanged = 0;
    let oldPrefs = findPreference(oldText);
    let newPrefsExisting = findPreference(newText);
    let newPreferences = switch (oldPrefs) {
      case (?op) {
        prefsChanged += 1;
        switch (newPrefsExisting) {
          case (?_) { preferences.filter(func(p : Types.Preferences) : Bool = p.user != oldText) };
          case null { preferences.map(func(p : Types.Preferences) : Types.Preferences = if (p.user == oldText) { { op with user = newText } } else { p }) };
        };
      };
      case null { preferences };
    };
    changed += prefsChanged;

    if (not dry_run) {
      items := newItems;
      scheduled := newScheduled;
      digests := newDigests;
      push_settings := newPushSettings;
      device_tokens := dedupedDeviceTokens;
      preferences := newPreferences;
      deviceVersions := newDeviceVersions;
    };

    #ok(changed)
  };

  // Protected consensus reads for the opt-in local account-removal rehearsal.
  public shared ({ caller }) func read_account_get_schedule_refreshes(clubs : [Text]) : async [{ club : Text; team : ?Text; key : Text }] {
    await admitAccount(caller);
    authenticated(caller);
    if (clubs.size() > 100) { return [] };
    let user = Principal.toText(caller);
    var signals : [{ club : Text; team : ?Text; key : Text }] = [];
    for (item in items.values()) {
      if (item.user == user and item.kind == "schedule_refresh" and clubs.any(func(id) = id == item.club)) {
        signals := signals.filter(func(s) = not (s.club == item.club and s.team == item.related_id));
        signals := signals.concat([{ club = item.club; team = item.related_id; key = item.idempotency_key }]);
      };
    };
    signals
  };

  public shared ({ caller }) func read_account_list_scheduled(author : Text, target : ?Text) : async Types.ScheduledResults {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    authenticated(caller);
    if (not ScheduleAccess.owns(caller, author)) { return #Err("Author mismatch") };
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
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_digest(source : Types.DigestSource, chat_scope_id : Text, since_ms : Nat64, limit : Nat16) : async Types.DigestResults {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    let configured = messagingDomainCanister;
    let messaging = switch (configured) { case null return #Err("Chat authority unavailable"); case (?id) id };
    let domain : actor { read_account_can_read_digest : shared (Principal, Text) -> async Bool } = actor(messaging.toText());
    let allowed = try { do { let removalReply = await domain.read_account_can_read_digest(caller, chat_scope_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply } } catch (_) { false };
    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (not allowed or configured != messagingDomainCanister) return #Err("Chat scope access forbidden");
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
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_preferences(user : Text) : async Types.Preferences {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    if (not (do { let removalReply = await ownsInbox(caller, user); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) Runtime.trap("Not your preferences");
    authenticated(caller);
    switch (findPreference(user)) {
      case (?prefs) { prefs };
      case null { defaultPreferences(user) };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_push_alert_settings() : async Types.PushAlertSettings {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    authenticated(caller);
    switch (push_settings) {
      case (?settings) { settings };
      case null { defaultPushAlertSettings() };
    }
  
    } finally { removalReceiver.leave(caller) };
  };
  func recipientFenced(user : Text) : Bool {
    for ((subject, _) in removal_subjects.entries()) {
      if (subject.toText() == user or "principal:" # subject.toText() == user) return true;
    };
    false
  };
  public shared ({ caller }) func prepare_account_removal(request : RemovalReceiver.Request) : async { #Ok; #Err : Text } {
    switch (removalReceiver.prepare(caller, request)) {
      case (#Err(e)) #Err(e);
      case (#Ok) {
        // Processing rows and worker leases remain durable drain obligations.
        // Cancelling an unclaimed notification is not evidence an external send ended.
        items := items.map(func(item) = if (recipientFenced(item.user) and item.status == #Pending) ({ item with status = #Failed }) else item);
        scheduled := scheduled.map(func(item) = if (recipientFenced(item.author) and item.status == #Pending) ({ item with status = #Cancelled }) else item);
        #Ok
      }
    }
  };
  public shared ({ caller }) func read_account_removal_drain(request : RemovalReceiver.Request) : async { #Ok : RemovalReceiver.Receipt; #Err : Text } {
    let outstanding = items.filter(func(item) = item.status == #Processing and request.subjects.any(func(p) = p.toText() == item.user or "principal:" # p.toText() == item.user)).size();
    removalReceiver.receipt(caller, request, Principal.fromActor(this), outstanding)
  };

  public shared ({ caller }) func seal_account_removal(request : RemovalReceiver.Request) : async { #Ok : RemovalReceiver.Receipt; #Err : Text } {
    let outstanding = items.filter(func(item) = item.status == #Processing and request.subjects.any(func(p) = p.toText() == item.user or "principal:" # p.toText() == item.user)).size();
    removalReceiver.seal(caller, request, Principal.fromActor(this), outstanding)
  };
};
