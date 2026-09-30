import Array "mo:core/Array";
import Nat "mo:core/Nat";
import Nat16 "mo:core/Nat16";
import Nat64 "mo:core/Nat64";
import Int "mo:core/Int";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Types "types";

persistent actor {
  var governor : Principal;
  var roles : [Types.RoleGrant];
  var conversations : [Types.Conversation];
  var messages : [Types.Message];
  var receipts : [Types.Receipt];
  var unread : [Types.Unread];
  var bulkAccessPrincipals : [Principal];
  var groupMetadata : [Types.GroupMetadata];
  var clubMemberships : [Types.ClubMembership];
  var competitionAdmins : [Types.CompetitionAdmin];
  var dmAttachmentsDisabled : [Principal];

  public shared ({ caller }) func initialize() : async { #Ok; #Err : Text } {
    auth(caller);
    if (not governor.equal(Principal.anonymous())) return #Err("Already initialized");
    governor := caller;
    #Ok
  };

  func auth(caller : Principal) {
    if (caller.equal(Principal.anonymous())) Runtime.trap("Authenticated caller required");
  };

  func valid(value : Text) : Bool { value != "" and value.size() <= 128 };

  func nowMs() : Nat64 { Nat.toNat64(Int.abs(Time.now()) / 1_000_000) };

  func validAttachment(attachment : Types.Attachment) : Bool {
    valid(attachment.kind) and valid(attachment.ref_id) and
    (switch (attachment.url) { case null { true }; case (?url) { url.size() <= 2048 } })
  };

  func isGovernor(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and governor.equal(caller)
  };

  func hasBulkAccess(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and bulkAccessPrincipals.any(func(p) = p.equal(caller))
  };
  public shared ({ caller }) func grant_role(principal : Principal, role : Text, club_id : ?Text, team_id : ?Text) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (principal.equal(Principal.anonymous()) or not validRoleAssignment(role, club_id, team_id)) return #Err("Invalid role assignment");
    if (not roles.any(func(grant) = grant.user.equal(principal) and grant.role == role and grant.club_id == club_id and grant.team_id == team_id)) {
      roles := roles.concat([{ user = principal; role; club_id; team_id }]);
    };
    #Ok
  };


  func hasRole(caller : Principal, role : Text, club_id : ?Text, team_id : ?Text) : Bool {
    roles.any(func(grant) {
      grant.user.equal(caller) and grant.role == role and grant.club_id == club_id and grant.team_id == team_id
    })
  };

  func validRoleAssignment(role : Text, club_id : ?Text, team_id : ?Text) : Bool {
    switch (role) {
      case ("app_admin") { club_id == null and team_id == null };
      case ("club_admin") { club_id != null and team_id == null };
      case ("team_admin") { club_id != null and team_id != null };
      case ("coach") { club_id != null and team_id != null };
      case (_) { false };
    }
  };

  func canModerateTeamMessage(caller : Principal, message : Types.Message) : Bool {
    for (conversation in conversations.values()) {
      if (conversation.id == message.conversation_id) {
        switch (conversation.team_id) {
          case null { return false };
          case (?team_id) {
            return hasRole(caller, "team_admin", ?conversation.club_id, ?team_id)
              or hasRole(caller, "coach", ?conversation.club_id, ?team_id)
              or hasRole(caller, "club_admin", ?conversation.club_id, null)
              or hasRole(caller, "app_admin", null, null);
          };
        };
      };
    };
    false
  };

  func findGroupMetadataIndex(conversation_id : Text) : ?Nat {
    var idx = 0;
    for (m in groupMetadata.values()) {
      if (m.conversation_id == conversation_id) { return ?idx };
      idx += 1;
    };
    null
  };

  func getGroupMetadataFor(conversation_id : Text) : ?Types.GroupMetadata {
    switch (findGroupMetadataIndex(conversation_id)) {
      case null { null };
      case (?i) { ?groupMetadata[i] };
    }
  };

  func isCompetitionAdminFor(caller : Principal, conversation_id : Text) : Bool {
    isGovernor(caller) or hasRole(caller, "app_admin", null, null) or
    competitionAdmins.any(func(a) = a.conversation_id == conversation_id and a.user.equal(caller))
  };

  func sharesClub(a : Principal, b : Principal) : Bool {
    let clubsOfA = clubMemberships.filter(func(m) = m.user.equal(a));
    clubsOfA.any(func(ma) = clubMemberships.any(func(mb) = mb.user.equal(b) and mb.club_id == ma.club_id))
  };

  func inferConversationKind(conversation : Types.Conversation) : Text {
    switch (getGroupMetadataFor(conversation.id)) {
      case (?meta) { meta.kind };
      case null {
        switch (conversation.team_id) {
          case (?_) { "team" };
          case null { if (conversation.participants.size() <= 2) "direct" else "group" };
        }
      };
    }
  };

  func canAccessConversation(caller : Principal, conversation_id : Text) : Bool {
    for (item in conversations.values()) {
      if (item.id == conversation_id) {
        return item.participants.any(func(p) = p.equal(caller));
      };
    };
    false
  };
  func canReadTeamMessages(caller : Principal, conversation_id : Text) : Bool {
    if (caller.equal(Principal.anonymous())) return false;
    for (conversation in conversations.values()) {
      if (conversation.id == conversation_id) {
        if (conversation.participants.any(func(participant) = participant.equal(caller))) return true;
        switch (conversation.team_id) {
          case null { return false };
          case (_) {
            return hasRole(caller, "club_admin", ?conversation.club_id, null)
              or hasRole(caller, "app_admin", null, null);
          };
        };
      };
    };
    false
  };


  func conversationLatestSequence(conversation_id : Text) : Nat64 {
    for (item in conversations.values()) {
      if (item.id == conversation_id) {
        if (item.next_sequence == 0) return 0 else return item.next_sequence - 1;
      };
    };
    0
  };

  func unreadFor(user : Principal, conversation_id : Text) : Types.Unread {
    for (item in unread.values()) {
      if (item.user.equal(user) and item.conversation_id == conversation_id) {
        return item;
      };
    };
    { conversation_id; user; count = 0; last_read_sequence = 0 }
  };

  public shared ({ caller }) func create_conversation(club_id : Text, team_id : ?Text, participants : [Principal]) : async { #Ok : Types.Conversation; #Err : Text } {
    auth(caller);
    if (not valid(club_id) or participants.size() == 0) return #Err("Invalid conversation participants");
    if (not participants.any(func(p) = p.equal(caller))) return #Err("Invalid conversation participants");
    if (participants.any(func(p) = p.equal(Principal.anonymous()))) return #Err("Invalid conversation participants");
    let conversation : Types.Conversation = {
      id = "chat-" # club_id # "-" # Nat.toText(conversations.size() + 1);
      club_id;
      team_id;
      participants;
      next_sequence = 1;
    };
    conversations := conversations.concat([conversation]);
    #Ok(conversation)
  };

  func findConversationIndex(conversation_id : Text) : ?Nat {
    var idx = 0;
    for (c in conversations.values()) {
      if (c.id == conversation_id) { return ?idx };
      idx += 1;
    };
    null
  };

  func postMessage(convIndex : Nat, sender : Principal, body : Text, idempotency_key : Text, attachment : ?Types.Attachment) : Types.Message {
    let conv = conversations[convIndex];
    let seq = conv.next_sequence;
    let msg : Types.Message = {
      conversation_id = conv.id;
      id = "msg-" # conv.id # "-" # Nat64.toText(seq);
      sender;
      body;
      sequence = seq;
      idempotency_key;
      edited_at_ms = null;
      attachment;
    };
    let updated_conv : Types.Conversation = { conv with next_sequence = seq + 1 };
    conversations := Array.tabulate<Types.Conversation>(conversations.size(), func(position) {
      if (position == convIndex) updated_conv else conversations[position]
    });
    messages := messages.concat([msg]);
    for (participant in conv.participants.values()) {
      if (not participant.equal(sender)) {
        let current_u = unreadFor(participant, conv.id);
        let updated_u : Types.Unread = { current_u with count = current_u.count + 1 };
        unread := unread.filter(func(u) = not (u.user.equal(participant) and u.conversation_id == conv.id));
        unread := unread.concat([updated_u]);
      };
    };
    msg
  };

  public shared ({ caller }) func send_message(conversation_id : Text, body : Text, idempotency_key : Text, attachment : ?Types.Attachment) : async { #Ok : Types.Message; #Err : Text } {
    auth(caller);
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    if (not valid(body) or not valid(idempotency_key)) return #Err("Invalid message");
    switch (attachment) { case (?a) { if (not validAttachment(a)) return #Err("Invalid attachment") }; case null {} };
    switch (getGroupMetadataFor(conversation_id)) {
      case (?meta) {
        if (meta.kind == "competition" and not isCompetitionAdminFor(caller, conversation_id)) {
          return #Err("Competition chat admin required");
        };
      };
      case null {};
    };
    for (m in messages.values()) {
      if (m.conversation_id == conversation_id and m.idempotency_key == idempotency_key) {
        return #Ok(m);
      };
    };
    switch (findConversationIndex(conversation_id)) {
      case null { #Err("Conversation not found") };
      case (?i) { #Ok(postMessage(i, caller, body, idempotency_key, attachment)) };
    }
  };

  // Club announcement fan-out: posts the same message to the club chat
  // (team_id null) and/or each listed team's conversation. Teams without a
  // conversation are skipped and reported, never fatal. Idempotency keys are
  // derived per conversation, so a retried broadcast is safe. Announcements
  // allow a longer body than chat messages (valid() caps at 128 chars).
  public shared ({ caller }) func broadcast_announcement(club_id : Text, team_ids : [Text], include_club_chat : Bool, body : Text, idempotency_key : Text) : async { #Ok : Types.BroadcastResult; #Err : Text } {
    auth(caller);
    if (not valid(club_id) or not valid(idempotency_key)) return #Err("Invalid announcement");
    if (body == "" or body.size() > 4000) return #Err("Invalid announcement body");
    if (team_ids.size() > 100) return #Err("Too many teams");
    if (team_ids.any(func(team) = not valid(team))) return #Err("Invalid team");
    if (not isGovernor(caller) and not hasRole(caller, "club_admin", ?club_id, null) and not hasRole(caller, "app_admin", null, null)) return #Err("Club admin required");
    let teamTargets : [?Text] = Array.map<Text, ?Text>(team_ids, func(team) = ?team);
    let targets : [?Text] = if (include_club_chat) { ([null] : [?Text]).concat(teamTargets) } else { teamTargets };
    var delivered : Nat32 = 0;
    var skipped : [Text] = [];
    for (target in targets.values()) {
      var conv_idx : ?Nat = null;
      var idx = 0;
      for (c in conversations.values()) {
        if (c.club_id == club_id and c.team_id == target) { conv_idx := ?idx };
        idx += 1;
      };
      switch (conv_idx) {
        case null {
          switch (target) {
            case (?team) { skipped := skipped.concat([team]) };
            case null {};
          };
        };
        case (?i) {
          let conv = conversations[i];
          let key = idempotency_key # "-" # conv.id;
          var already = false;
          for (m in messages.values()) {
            if (m.conversation_id == conv.id and m.idempotency_key == key) { already := true };
          };
          if (not already) {
            ignore postMessage(i, caller, body, key, null);
            delivered += 1;
          };
        };
      };
    };
    #Ok({ delivered; skipped })
  };
  public shared ({ caller }) func update_message(message_id : Text, body : Text) : async { #Ok : Types.Message; #Err : Text } {
    auth(caller);
    if (not valid(body)) return #Err("Invalid message");
    var found_idx : ?Nat = null;
    var idx = 0;
    for (message in messages.values()) {
      if (message.id == message_id) { found_idx := ?idx };
      idx += 1;
    };
    switch (found_idx) {
      case null { #Err("Message not found") };
      case (?i) {
        let current = messages[i];
        if (not current.sender.equal(caller)) return #Err("Message author required");
        var is_team_message = false;
        for (conversation in conversations.values()) {
          if (conversation.id == current.conversation_id and conversation.team_id != null) {
            is_team_message := true;
          };
        };
        if (not is_team_message) return #Err("Team message required");
        let updated : Types.Message = { current with body; edited_at_ms = ?nowMs() };
        messages := Array.tabulate<Types.Message>(messages.size(), func(position) {
          if (position == i) updated else messages[position]
        });
        #Ok(updated)
      };
    }
  };


  public shared ({ caller }) func mark_read(conversation_id : Text, message_id : Text) : async { #Ok : Types.Receipt; #Err : Text } {
    auth(caller);
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    var target_msg : ?Types.Message = null;
    for (m in messages.values()) {
      if (m.conversation_id == conversation_id and m.id == message_id) { target_msg := ?m };
    };
    switch (target_msg) {
      case null { #Err("Message not found") };
      case (?msg) {
        let receipt : Types.Receipt = { conversation_id; user = caller; message_id; read = true };
        receipts := receipts.filter(func(r) = not (r.conversation_id == conversation_id and r.user.equal(caller)));
        receipts := receipts.concat([receipt]);
        var unread_count_val : Nat64 = 0;
        for (m in messages.values()) {
          if (m.conversation_id == conversation_id and m.sequence > msg.sequence and not m.sender.equal(caller)) {
            unread_count_val += 1;
          };
        };
        let updated_u : Types.Unread = { conversation_id; user = caller; count = unread_count_val; last_read_sequence = msg.sequence };
        unread := unread.filter(func(u) = not (u.user.equal(caller) and u.conversation_id == conversation_id));
        unread := unread.concat([updated_u]);
        #Ok(receipt)
      };
    }
  };

  public query ({ caller }) func list_messages(conversation_id : Text, after : ?Nat64) : async [Types.Message] {
    if (not canReadTeamMessages(caller, conversation_id)) Runtime.trap("Conversation access forbidden");
    var filtered : [Types.Message] = [];
    for (m in messages.values()) {
      if (m.conversation_id == conversation_id) {
        let keep = switch (after) {
          case (?seq) { m.sequence > seq };
          case null { true };
        };
        if (keep and filtered.size() < 100) { filtered := filtered.concat([m]) };
      };
    };
    filtered
  };

  public query ({ caller }) func list_messages_page(conversation_id : Text, after : ?Nat64, limit : Nat16) : async { #Ok : Types.MessagePage; #Err : Text } {
    if (not canReadTeamMessages(caller, conversation_id)) return #Err("Conversation access forbidden");
    if (limit == 0 or limit > 100) return #Err("Invalid page size");
    let latest = conversationLatestSequence(conversation_id);
    switch (after) {
      case (?cursor) { if (cursor > latest) return #Err("Stale cursor") };
      case null {};
    };
    var page_messages : [Types.Message] = [];
    for (m in messages.values()) {
      if (m.conversation_id == conversation_id) {
        let keep = switch (after) { case (?seq) { m.sequence > seq }; case null { true } };
        if (keep and page_messages.size() < Nat16.toNat(limit)) { page_messages := page_messages.concat([m]) };
      };
    };
    let next_seq : ?Nat64 = if (page_messages.size() == 0) {
      null
    } else {
      let last_msg = page_messages[page_messages.size() - 1];
      if (last_msg.sequence < latest) ?last_msg.sequence else null
    };
    #Ok({ messages = page_messages; next_sequence = next_seq; latest_sequence = latest })
  };

  public query ({ caller }) func unread_count(conversation_id : Text) : async { #Ok : Types.Unread; #Err : Text } {
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    #Ok(unreadFor(caller, conversation_id))
  };

  public shared ({ caller }) func delete_message(message_id : Text) : async { #Ok : Types.Message; #Err : Text } {
    auth(caller);
    var found_idx : ?Nat = null;
    var idx = 0;
    for (m in messages.values()) {
      if (m.id == message_id) { found_idx := ?idx };
      idx += 1;
    };
    switch (found_idx) {
      case null { #Err("Message not found") };
      case (?i) {
        let msg = messages[i];
        if (not msg.sender.equal(caller) and not canModerateTeamMessage(caller, msg)) return #Err("Message deletion forbidden");
        messages := Array.tabulate<Types.Message>(messages.size() - 1, func(pos) {
          if (pos < i) messages[pos] else messages[pos + 1]
        });
        #Ok(msg)
      };
    }
  };

  public shared ({ caller }) func addBulkAccessPrincipal(principal : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (principal.equal(Principal.anonymous())) return #Err("Invalid principal");
    if (not bulkAccessPrincipals.any(func(p) = p.equal(principal))) { bulkAccessPrincipals := bulkAccessPrincipals.concat([principal]) };
    #Ok
  };

  public shared ({ caller }) func removeBulkAccessPrincipal(principal : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    bulkAccessPrincipals := bulkAccessPrincipals.filter(func(p) = not p.equal(principal));
    #Ok
  };

  public query ({ caller }) func listBulkAccessPrincipals() : async { #Ok : [Principal]; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor only");
    #Ok(bulkAccessPrincipals)
  };

  public query ({ caller }) func export_state() : async { #Ok : Types.State; #Err : Text } {
    if (not isGovernor(caller) and not hasBulkAccess(caller)) return #Err("Governor only");
    #Ok({ schema = 3; governor; roles; conversations; messages; receipts; unread; groupMetadata; clubMemberships; competitionAdmins; dmAttachmentsDisabled })
  };

  func validKind(kind : Text) : Bool {
    kind == "direct" or kind == "club" or kind == "team" or kind == "group" or kind == "broadcast" or kind == "competition"
  };

  func canManageGroupMetadata(caller : Principal, meta : Types.GroupMetadata) : Bool {
    isGovernor(caller) or hasRole(caller, "app_admin", null, null) or
    (switch (meta.club_id) { case (?club_id) { hasRole(caller, "club_admin", ?club_id, null) }; case null { false } }) or
    (switch (meta.club_id, meta.team_id) { case (?club_id, ?team_id) { hasRole(caller, "team_admin", ?club_id, ?team_id) or hasRole(caller, "coach", ?club_id, ?team_id) }; case (_, _) { false } }) or
    meta.members.any(func(m) = m.equal(caller))
  };

  // Upserts the Supabase `chat_groups` equivalent for a conversation: name,
  // kind, club/team scope, and membership list. The conversation itself must
  // already exist (created via create_conversation); this only attaches
  // display/authorization metadata to it. Callers must be a governor,
  // app_admin, the club/team admin for the target scope, or already a member
  // being asked to update their own group's metadata.
  public shared ({ caller }) func upsert_group_metadata(
    conversation_id : Text,
    name : Text,
    kind : Text,
    club_id : ?Text,
    team_id : ?Text,
    members : [Principal],
  ) : async { #Ok : Types.GroupMetadata; #Err : Text } {
    auth(caller);
    if (findConversationIndex(conversation_id) == null) return #Err("Conversation not found");
    if (not valid(conversation_id) or not valid(name) or not validKind(kind)) return #Err("Invalid group metadata");
    if (members.any(func(m) = m.equal(Principal.anonymous()))) return #Err("Invalid member");
    let existing = getGroupMetadataFor(conversation_id);
    switch (existing) {
      case (?meta) { if (not canManageGroupMetadata(caller, meta)) return #Err("Group metadata management forbidden") };
      case null {
        if (not (isGovernor(caller) or hasRole(caller, "app_admin", null, null) or members.any(func(m) = m.equal(caller)))) {
          return #Err("Group metadata management forbidden");
        };
      };
    };
    let updated : Types.GroupMetadata = { conversation_id; name; kind; club_id; team_id; members; created_at_ms = switch (existing) { case (?m) { m.created_at_ms }; case null { nowMs() } } };
    groupMetadata := groupMetadata.filter(func(m) = m.conversation_id != conversation_id);
    groupMetadata := groupMetadata.concat([updated]);
    #Ok(updated)
  };

  public query ({ caller }) func get_group_metadata(conversation_id : Text) : async { #Ok : Types.GroupMetadata; #Err : Text } {
    if (not canReadTeamMessages(caller, conversation_id) and not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    switch (getGroupMetadataFor(conversation_id)) {
      case (?meta) { #Ok(meta) };
      case null { #Err("Group metadata not found") };
    }
  };

  // Shared-club DM eligibility record. Governor/app_admin only — mirrors the
  // Supabase club_members table this substitutes for.
  public shared ({ caller }) func upsert_club_membership(user : Principal, club_id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller) and not hasRole(caller, "app_admin", null, null) and not hasRole(caller, "club_admin", ?club_id, null)) return #Err("Club admin required");
    if (user.equal(Principal.anonymous()) or not valid(club_id)) return #Err("Invalid membership");
    if (not clubMemberships.any(func(m) = m.user.equal(user) and m.club_id == club_id)) {
      clubMemberships := clubMemberships.concat([{ user; club_id }]);
    };
    #Ok
  };

  // Two users may DM each other only if they share at least one club.
  public query ({ caller }) func can_dm_user(other : Principal) : async Bool {
    if (caller.equal(Principal.anonymous()) or other.equal(Principal.anonymous())) return false;
    if (caller.equal(other)) return false;
    sharesClub(caller, other)
  };

  public shared ({ caller }) func set_dm_attachments_disabled(user : Principal, disabled : Bool) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return #Err("App admin required");
    dmAttachmentsDisabled := dmAttachmentsDisabled.filter(func(p) = not p.equal(user));
    if (disabled) { dmAttachmentsDisabled := dmAttachmentsDisabled.concat([user]) };
    #Ok
  };

  public query ({ caller }) func dm_attachments_disabled(user : Principal) : async Bool {
    dmAttachmentsDisabled.any(func(p) = p.equal(user))
  };

  public shared ({ caller }) func grant_competition_admin(conversation_id : Text, user : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return #Err("App admin required");
    if (user.equal(Principal.anonymous()) or not valid(conversation_id)) return #Err("Invalid competition admin");
    if (not competitionAdmins.any(func(a) = a.conversation_id == conversation_id and a.user.equal(user))) {
      competitionAdmins := competitionAdmins.concat([{ conversation_id; user }]);
    };
    #Ok
  };

  public query ({ caller }) func is_competition_admin(conversation_id : Text) : async Bool {
    isCompetitionAdminFor(caller, conversation_id)
  };

  // Aggregated unread counts for every conversation the caller participates
  // in, annotated with each conversation's metadata kind so the frontend can
  // bucket into {teams, clubs, groups, dms, broadcast} without a second
  // round-trip per conversation.
  public query ({ caller }) func my_unread_counts() : async [Types.UnreadSummary] {
    if (caller.equal(Principal.anonymous())) return [];
    var result : [Types.UnreadSummary] = [];
    for (conversation in conversations.values()) {
      if (conversation.participants.any(func(p) = p.equal(caller))) {
        let u = unreadFor(caller, conversation.id);
        if (u.count > 0) {
          result := result.concat([{ conversation_id = conversation.id; kind = inferConversationKind(conversation); count = u.count }]);
        };
      };
    };
    result
  };
};