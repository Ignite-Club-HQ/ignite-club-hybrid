import Array "mo:core/Array";
import Nat "mo:core/Nat";
import Nat16 "mo:core/Nat16";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Int "mo:core/Int";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Text "mo:core/Text";
import Blob "mo:core/Blob";
import Error "mo:core/Error";
import Call "mo:ic/Call";
import IC "mo:ic/Types";
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
  var groupRoles : [Types.GroupRole];
  var joinRequests : [Types.JoinRequest];
  var polls : [Types.Poll];
  var pollVotes : [Types.PollVote];
  var mutePreferences : [Types.MutePreference];
  var dmLinks : [Types.DmLink];
  var forwardRecords : [Types.ForwardRecord];
  var scheduledMessages : [Types.ScheduledMessage];
  var attachmentMetadata : [Types.AttachmentMetadata];
  var reactions : [Types.Reaction];
  var clubDmSettings : [Types.ClubDmSettings];
  var userMessagingSettings : [Types.UserMessagingSettings];
  // See Types.RecapConfig: api_key is visible to node providers hosting this
  // canister; only a scoped/limited key should ever be stored here.
  var recapConfig : ?Types.RecapConfig;

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
      created_at_ms = nowMs();
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
        if (
          meta.admin_only_posting and (meta.kind == "group" or meta.kind == "broadcast") and
          not isGroupAdmin(caller, conversation_id)
        ) {
          return #Err("Only group admins can post");
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
    #Ok({ schema = 4; governor; roles; conversations; messages; receipts; unread; groupMetadata; clubMemberships; competitionAdmins; dmAttachmentsDisabled; groupRoles; joinRequests; polls; pollVotes; mutePreferences; dmLinks; forwardRecords; scheduledMessages; attachmentMetadata; reactions; clubDmSettings; userMessagingSettings })
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
    let updated : Types.GroupMetadata = {
      conversation_id; name; kind; club_id; team_id; members;
      created_at_ms = switch (existing) { case (?m) { m.created_at_ms }; case null { nowMs() } };
      avatar = switch (existing) { case (?m) { m.avatar }; case null { null } };
      description = switch (existing) { case (?m) { m.description }; case null { null } };
      deleted = switch (existing) { case (?m) { m.deleted }; case null { false } };
      admin_only_posting = switch (existing) { case (?m) { m.admin_only_posting }; case null { false } };
    };
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

  // ===================== Group management (roles, bulk, soft-delete, join requests) =====================

  func validGroupRole(role : Text) : Bool { role == "owner" or role == "admin" or role == "member" };

  func isGroupAdmin(caller : Principal, conversation_id : Text) : Bool {
    isGovernor(caller) or hasRole(caller, "app_admin", null, null) or
    groupRoles.any(func(r) = r.conversation_id == conversation_id and r.user.equal(caller) and (r.role == "owner" or r.role == "admin"))
  };

  func isGroupDeleted(conversation_id : Text) : Bool {
    switch (getGroupMetadataFor(conversation_id)) { case (?m) { m.deleted }; case null { false } }
  };

  public shared ({ caller }) func create_group_with_roles(
    club_id : Text,
    team_id : ?Text,
    name : Text,
    kind : Text,
    role_entries : [(Principal, Text)],
  ) : async { #Ok : Types.GroupMetadata; #Err : Text } {
    auth(caller);
    if (not valid(club_id) or not valid(name) or not validKind(kind)) return #Err("Invalid group");
    if (role_entries.size() == 0) return #Err("At least one member required");
    if (role_entries.any(func((p, r)) = p.equal(Principal.anonymous()) or not validGroupRole(r))) return #Err("Invalid role entry");
    if (not role_entries.any(func((p, _r)) = p.equal(caller))) return #Err("Creator must be a member");
    let members : [Principal] = Array.map<(Principal, Text), Principal>(role_entries, func((p, _r)) = p);
    let conversation : Types.Conversation = {
      id = "chat-" # club_id # "-" # Nat.toText(conversations.size() + 1);
      club_id; team_id; participants = members; next_sequence = 1;
    };
    conversations := conversations.concat([conversation]);
    let meta : Types.GroupMetadata = {
      conversation_id = conversation.id; name; kind; club_id = ?club_id; team_id; members;
      created_at_ms = nowMs(); avatar = null; description = null; deleted = false; admin_only_posting = false;
    };
    groupMetadata := groupMetadata.concat([meta]);
    groupRoles := groupRoles.concat(Array.map<(Principal, Text), Types.GroupRole>(role_entries, func((p, r)) = { conversation_id = conversation.id; user = p; role = r }));
    #Ok(meta)
  };

  public shared ({ caller }) func update_group(conversation_id : Text, name : ?Text, avatar : ?Text, description : ?Text, admin_only_posting : ?Bool) : async { #Ok : Types.GroupMetadata; #Err : Text } {
    auth(caller);
    switch (getGroupMetadataFor(conversation_id)) {
      case null { #Err("Group metadata not found") };
      case (?meta) {
        if (meta.deleted) return #Err("Group deleted");
        if (not canManageGroupMetadata(caller, meta) and not isGroupAdmin(caller, conversation_id)) return #Err("Group management forbidden");
        switch (name) { case (?n) { if (not valid(n)) return #Err("Invalid name") }; case null {} };
        let updated : Types.GroupMetadata = {
          meta with
          name = switch (name) { case (?n) { n }; case null { meta.name } };
          avatar = switch (avatar) { case (?_) { avatar }; case null { meta.avatar } };
          description = switch (description) { case (?_) { description }; case null { meta.description } };
          admin_only_posting = switch (admin_only_posting) { case (?v) { v }; case null { meta.admin_only_posting } };
        };
        groupMetadata := groupMetadata.filter(func(m) = m.conversation_id != conversation_id);
        groupMetadata := groupMetadata.concat([updated]);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func add_group_members(conversation_id : Text, members : [Principal]) : async { #Ok : Types.GroupMetadata; #Err : Text } {
    auth(caller);
    if (members.size() == 0 or members.any(func(p) = p.equal(Principal.anonymous()))) return #Err("Invalid members");
    switch (getGroupMetadataFor(conversation_id), findConversationIndex(conversation_id)) {
      case (null, _) { #Err("Group metadata not found") };
      case (_, null) { #Err("Conversation not found") };
      case (?meta, ?ci) {
        if (meta.deleted) return #Err("Group deleted");
        if (not canManageGroupMetadata(caller, meta) and not isGroupAdmin(caller, conversation_id)) return #Err("Group management forbidden");
        var newMembers = meta.members;
        var newRoles = groupRoles;
        for (m in members.values()) {
          if (not newMembers.any(func(p) = p.equal(m))) {
            newMembers := newMembers.concat([m]);
            newRoles := newRoles.concat([{ conversation_id; user = m; role = "member" }]);
          };
        };
        let conv = conversations[ci];
        var newParticipants = conv.participants;
        for (m in members.values()) {
          if (not newParticipants.any(func(p) = p.equal(m))) { newParticipants := newParticipants.concat([m]) };
        };
        conversations := Array.tabulate<Types.Conversation>(conversations.size(), func(pos) = if (pos == ci) { { conv with participants = newParticipants } } else { conversations[pos] });
        let updated : Types.GroupMetadata = { meta with members = newMembers };
        groupMetadata := groupMetadata.filter(func(m) = m.conversation_id != conversation_id);
        groupMetadata := groupMetadata.concat([updated]);
        groupRoles := newRoles;
        #Ok(updated)
      };
    }
  };

  // Shared removal core for remove_group_member/leave_group: drops `member`
  // from the group's member list, its group-role entries, and the backing
  // conversation's participants.
  func removeGroupMemberCore(conversation_id : Text, meta : Types.GroupMetadata, ci : Nat, member : Principal) : Types.GroupMetadata {
    let updated : Types.GroupMetadata = { meta with members = meta.members.filter(func(p) = not p.equal(member)) };
    groupMetadata := groupMetadata.filter(func(m) = m.conversation_id != conversation_id);
    groupMetadata := groupMetadata.concat([updated]);
    groupRoles := groupRoles.filter(func(r) = not (r.conversation_id == conversation_id and r.user.equal(member)));
    let conv = conversations[ci];
    let newParticipants = conv.participants.filter(func(p) = not p.equal(member));
    conversations := Array.tabulate<Types.Conversation>(conversations.size(), func(pos) = if (pos == ci) { { conv with participants = newParticipants } } else { conversations[pos] });
    updated
  };

  // Same permission rule as add_group_members: group/metadata manager
  // (owner/admin role, scoped admin, governor/app_admin) only.
  public shared ({ caller }) func remove_group_member(conversation_id : Text, member : Principal) : async { #Ok : Types.GroupMetadata; #Err : Text } {
    auth(caller);
    if (member.equal(Principal.anonymous())) return #Err("Invalid member");
    switch (getGroupMetadataFor(conversation_id), findConversationIndex(conversation_id)) {
      case (null, _) { #Err("Group metadata not found") };
      case (_, null) { #Err("Conversation not found") };
      case (?meta, ?ci) {
        if (meta.deleted) return #Err("Group deleted");
        if (not canManageGroupMetadata(caller, meta) and not isGroupAdmin(caller, conversation_id)) return #Err("Group management forbidden");
        if (not meta.members.any(func(p) = p.equal(member))) return #Err("Member not found");
        #Ok(removeGroupMemberCore(conversation_id, meta, ci, member))
      };
    }
  };

  // A member removing themselves: requires current membership, no admin
  // gate (mirrors remove_group_member's effect targeted at the caller).
  public shared ({ caller }) func leave_group(conversation_id : Text) : async { #Ok : Types.GroupMetadata; #Err : Text } {
    auth(caller);
    switch (getGroupMetadataFor(conversation_id), findConversationIndex(conversation_id)) {
      case (null, _) { #Err("Group metadata not found") };
      case (_, null) { #Err("Conversation not found") };
      case (?meta, ?ci) {
        if (meta.deleted) return #Err("Group deleted");
        if (not meta.members.any(func(p) = p.equal(caller))) return #Err("Not a member");
        #Ok(removeGroupMemberCore(conversation_id, meta, ci, caller))
      };
    }
  };

  public shared ({ caller }) func soft_delete_group(conversation_id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (getGroupMetadataFor(conversation_id)) {
      case null { #Err("Group metadata not found") };
      case (?meta) {
        if (not canManageGroupMetadata(caller, meta) and not isGroupAdmin(caller, conversation_id)) return #Err("Group management forbidden");
        groupMetadata := groupMetadata.filter(func(m) = m.conversation_id != conversation_id);
        groupMetadata := groupMetadata.concat([{ meta with deleted = true }]);
        #Ok
      };
    }
  };

  public shared ({ caller }) func request_join_group(conversation_id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    if (findGroupMetadataIndex(conversation_id) == null) return #Err("Group metadata not found");
    if (isGroupDeleted(conversation_id)) return #Err("Group deleted");
    if (joinRequests.any(func(r) = r.conversation_id == conversation_id and r.user.equal(caller) and r.status == "pending")) return #Ok;
    joinRequests := joinRequests.filter(func(r) = not (r.conversation_id == conversation_id and r.user.equal(caller)));
    joinRequests := joinRequests.concat([{ conversation_id; user = caller; status = "pending"; created_at_ms = nowMs() }]);
    #Ok
  };

  public shared ({ caller }) func approve_join_request(conversation_id : Text, user : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGroupAdmin(caller, conversation_id)) return #Err("Group admin required");
    if (not joinRequests.any(func(r) = r.conversation_id == conversation_id and r.user.equal(user) and r.status == "pending")) return #Err("Join request not found");
    joinRequests := Array.map<Types.JoinRequest, Types.JoinRequest>(joinRequests, func(r) = if (r.conversation_id == conversation_id and r.user.equal(user)) { { r with status = "approved" } } else { r });
    switch (getGroupMetadataFor(conversation_id), findConversationIndex(conversation_id)) {
      case (?meta, ?ci) {
        if (not meta.members.any(func(p) = p.equal(user))) {
          let updated : Types.GroupMetadata = { meta with members = meta.members.concat([user]) };
          groupMetadata := groupMetadata.filter(func(m) = m.conversation_id != conversation_id);
          groupMetadata := groupMetadata.concat([updated]);
          groupRoles := groupRoles.concat([{ conversation_id; user; role = "member" }]);
        };
        let conv = conversations[ci];
        if (not conv.participants.any(func(p) = p.equal(user))) {
          conversations := Array.tabulate<Types.Conversation>(conversations.size(), func(pos) = if (pos == ci) { { conv with participants = conv.participants.concat([user]) } } else { conversations[pos] });
        };
      };
      case (_, _) {};
    };
    #Ok
  };

  public shared ({ caller }) func reject_join_request(conversation_id : Text, user : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGroupAdmin(caller, conversation_id)) return #Err("Group admin required");
    joinRequests := Array.map<Types.JoinRequest, Types.JoinRequest>(joinRequests, func(r) = if (r.conversation_id == conversation_id and r.user.equal(user)) { { r with status = "rejected" } } else { r });
    #Ok
  };

  public query ({ caller }) func list_join_requests(conversation_id : Text) : async { #Ok : [Types.JoinRequest]; #Err : Text } {
    if (not isGroupAdmin(caller, conversation_id)) return #Err("Group admin required");
    #Ok(joinRequests.filter(func(r) = r.conversation_id == conversation_id))
  };

  // ===================== Polls =====================

  func findPollIndex(poll_id : Text) : ?Nat {
    var idx = 0;
    for (p in polls.values()) { if (p.id == poll_id) { return ?idx }; idx += 1 };
    null
  };

  public shared ({ caller }) func create_poll(conversation_id : Text, message_id : ?Text, question : Text, options : [Text]) : async { #Ok : Types.Poll; #Err : Text } {
    auth(caller);
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    if (not valid(question) or options.size() < 2 or options.size() > 10) return #Err("Invalid poll");
    if (options.any(func(o) = not valid(o))) return #Err("Invalid poll option");
    let poll : Types.Poll = {
      id = "poll-" # conversation_id # "-" # Nat.toText(polls.size() + 1);
      conversation_id; message_id; question; options; creator = caller; closed = false; created_at_ms = nowMs();
    };
    polls := polls.concat([poll]);
    #Ok(poll)
  };

  public shared ({ caller }) func vote_poll(poll_id : Text, option_index : Nat32) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (findPollIndex(poll_id)) {
      case null { #Err("Poll not found") };
      case (?i) {
        let poll = polls[i];
        if (poll.closed) return #Err("Poll closed");
        if (not canAccessConversation(caller, poll.conversation_id)) return #Err("Conversation access forbidden");
        if (Nat32.toNat(option_index) >= poll.options.size()) return #Err("Invalid option");
        pollVotes := pollVotes.filter(func(v) = not (v.poll_id == poll_id and v.user.equal(caller)));
        pollVotes := pollVotes.concat([{ poll_id; user = caller; option_index }]);
        #Ok
      };
    }
  };

  public shared ({ caller }) func close_poll(poll_id : Text) : async { #Ok : Types.Poll; #Err : Text } {
    auth(caller);
    switch (findPollIndex(poll_id)) {
      case null { #Err("Poll not found") };
      case (?i) {
        let poll = polls[i];
        if (not poll.creator.equal(caller) and not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return #Err("Poll close forbidden");
        let updated = { poll with closed = true };
        polls := Array.tabulate<Types.Poll>(polls.size(), func(pos) = if (pos == i) updated else polls[pos]);
        #Ok(updated)
      };
    }
  };

  // Same gating as close_poll: poll creator, governor, or app_admin. Removes
  // the poll and every vote cast on it.
  public shared ({ caller }) func delete_poll(poll_id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (findPollIndex(poll_id)) {
      case null { #Err("Poll not found") };
      case (?i) {
        let poll = polls[i];
        if (not poll.creator.equal(caller) and not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return #Err("Poll delete forbidden");
        polls := polls.filter(func(p) = p.id != poll_id);
        pollVotes := pollVotes.filter(func(v) = v.poll_id != poll_id);
        #Ok
      };
    }
  };

  public query ({ caller }) func get_poll_results(poll_id : Text) : async { #Ok : Types.PollResults; #Err : Text } {
    switch (findPollIndex(poll_id)) {
      case null { #Err("Poll not found") };
      case (?i) {
        let poll = polls[i];
        if (not canAccessConversation(caller, poll.conversation_id)) return #Err("Conversation access forbidden");
        var counts = Array.repeat<Nat32>(0, poll.options.size());
        var total : Nat32 = 0;
        for (v in pollVotes.values()) {
          if (v.poll_id == poll_id) {
            let idx = Nat32.toNat(v.option_index);
            if (idx < counts.size()) {
              counts := Array.tabulate<Nat32>(counts.size(), func(pos) = if (pos == idx) counts[pos] + 1 else counts[pos]);
              total += 1;
            };
          };
        };
        #Ok({ poll; counts; total_votes = total })
      };
    }
  };

  // ===================== Mute preferences (storage only) =====================

  public shared ({ caller }) func set_mute_preference(conversation_id : Text, muted : Bool) : async { #Ok; #Err : Text } {
    auth(caller);
    mutePreferences := mutePreferences.filter(func(m) = not (m.user.equal(caller) and m.conversation_id == conversation_id));
    mutePreferences := mutePreferences.concat([{ user = caller; conversation_id; muted }]);
    #Ok
  };

  public query ({ caller }) func get_mute_preference(conversation_id : Text) : async Bool {
    if (caller.equal(Principal.anonymous())) return false;
    for (m in mutePreferences.values()) {
      if (m.user.equal(caller) and m.conversation_id == conversation_id) { return m.muted };
    };
    false
  };

  // ===================== Deterministic DM create/lookup =====================

  public shared ({ caller }) func get_or_create_dm(other : Principal) : async { #Ok : Types.Conversation; #Err : Text } {
    auth(caller);
    if (other.equal(Principal.anonymous()) or other.equal(caller)) return #Err("Invalid DM target");
    let aText = Principal.toText(caller);
    let bText = Principal.toText(other);
    let (loText, loP, hiP) = if (aText < bText) { (aText, caller, other) } else { (bText, other, caller) };
    ignore loText;
    for (link in dmLinks.values()) {
      if ((link.a.equal(loP) and link.b.equal(hiP))) {
        for (c in conversations.values()) { if (c.id == link.conversation_id) { return #Ok(c) } };
      };
    };
    let conversation : Types.Conversation = {
      id = "dm-" # Nat.toText(conversations.size() + 1);
      club_id = "dm"; team_id = null; participants = [loP, hiP]; next_sequence = 1;
    };
    conversations := conversations.concat([conversation]);
    dmLinks := dmLinks.concat([{ a = loP; b = hiP; conversation_id = conversation.id }]);
    #Ok(conversation)
  };

  // ===================== Forward message =====================

  public shared ({ caller }) func forward_message(message_id : Text, to_conversation_id : Text) : async { #Ok : Types.Message; #Err : Text } {
    auth(caller);
    var original : ?Types.Message = null;
    for (m in messages.values()) { if (m.id == message_id) { original := ?m } };
    switch (original) {
      case null { #Err("Message not found") };
      case (?orig) {
        if (not canReadTeamMessages(caller, orig.conversation_id) and not canAccessConversation(caller, orig.conversation_id)) return #Err("Source conversation access forbidden");
        if (not canAccessConversation(caller, to_conversation_id)) return #Err("Target conversation access forbidden");
        switch (findConversationIndex(to_conversation_id)) {
          case null { #Err("Target conversation not found") };
          case (?ci) {
            let key = "fwd-" # message_id # "-" # to_conversation_id;
            for (m in messages.values()) {
              if (m.conversation_id == to_conversation_id and m.idempotency_key == key) { return #Ok(m) };
            };
            let posted = postMessage(ci, caller, orig.body, key, orig.attachment);
            forwardRecords := forwardRecords.concat([{ message_id = posted.id; to_conversation_id; from_conversation_id = orig.conversation_id; from_message_id = orig.id; original_sender = orig.sender }]);
            #Ok(posted)
          };
        }
      };
    }
  };

  // ===================== Scheduled messages & attachment metadata =====================

  public shared ({ caller }) func register_scheduled_message(conversation_id : Text, body : Text, scheduled_at_ms : Nat64) : async { #Ok : Types.ScheduledMessage; #Err : Text } {
    auth(caller);
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    if (not valid(body)) return #Err("Invalid message body");
    let rec : Types.ScheduledMessage = {
      id = "sched-" # conversation_id # "-" # Nat.toText(scheduledMessages.size() + 1);
      conversation_id; sender = caller; body; scheduled_at_ms; replayed_at_ms = null; replayed_message_id = null;
    };
    scheduledMessages := scheduledMessages.concat([rec]);
    #Ok(rec)
  };

  public shared ({ caller }) func replay_scheduled_message(id : Text) : async { #Ok : Types.ScheduledMessage; #Err : Text } {
    auth(caller);
    var found_idx : ?Nat = null;
    var idx = 0;
    for (r in scheduledMessages.values()) { if (r.id == id) { found_idx := ?idx }; idx += 1 };
    switch (found_idx) {
      case null { #Err("Scheduled message not found") };
      case (?i) {
        let rec = scheduledMessages[i];
        if (rec.replayed_at_ms != null) return #Ok(rec);
        if (not rec.sender.equal(caller) and not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return #Err("Replay forbidden");
        switch (findConversationIndex(rec.conversation_id)) {
          case null { #Err("Conversation not found") };
          case (?ci) {
            let posted = postMessage(ci, rec.sender, rec.body, "sched-" # rec.id, null);
            let updated = { rec with replayed_at_ms = ?nowMs(); replayed_message_id = ?posted.id };
            scheduledMessages := Array.tabulate<Types.ScheduledMessage>(scheduledMessages.size(), func(pos) = if (pos == i) updated else scheduledMessages[pos]);
            #Ok(updated)
          };
        }
      };
    }
  };

  public shared ({ caller }) func register_attachment_metadata(conversation_id : Text, message_id : ?Text, kind : Text, ref_id : Text, url : ?Text, size_bytes : ?Nat64) : async { #Ok : Types.AttachmentMetadata; #Err : Text } {
    auth(caller);
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    if (not validAttachment({ kind; ref_id; url })) return #Err("Invalid attachment metadata");
    let rec : Types.AttachmentMetadata = {
      id = "att-" # conversation_id # "-" # Nat.toText(attachmentMetadata.size() + 1);
      conversation_id; message_id; kind; ref_id; url; size_bytes; uploader = caller; created_at_ms = nowMs();
    };
    attachmentMetadata := attachmentMetadata.concat([rec]);
    #Ok(rec)
  };

  // ===================== Reactions & chat catch-up / recap =====================

  public shared ({ caller }) func toggle_reaction(message_id : Text, emoji : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not valid(emoji)) return #Err("Invalid reaction");
    if (reactions.any(func(r) = r.message_id == message_id and r.user.equal(caller) and r.emoji == emoji)) {
      reactions := reactions.filter(func(r) = not (r.message_id == message_id and r.user.equal(caller) and r.emoji == emoji));
    } else {
      reactions := reactions.concat([{ message_id; user = caller; emoji }]);
    };
    #Ok
  };

  func reactionsSummaryFor(message_id : Text) : [Types.ReactionSummary] {
    var summary : [Types.ReactionSummary] = [];
    for (r in reactions.values()) {
      if (r.message_id == message_id) {
        var found = false;
        summary := Array.map<Types.ReactionSummary, Types.ReactionSummary>(summary, func(s) = if (s.emoji == r.emoji) { found := true; { s with count = s.count + 1 } } else { s });
        if (not found) { summary := summary.concat([{ emoji = r.emoji; count = 1 : Nat32 }]) };
      };
    };
    summary
  };

  public query ({ caller }) func messages_since(conversation_id : Text, since_ms : Nat64) : async { #Ok : [Types.MessageWithReactions]; #Err : Text } {
    if (not canReadTeamMessages(caller, conversation_id)) return #Err("Conversation access forbidden");
    var result : [Types.MessageWithReactions] = [];
    for (m in messages.values()) {
      if (m.conversation_id == conversation_id and m.created_at_ms > since_ms and result.size() < 200) {
        result := result.concat([{ message = m; reactions = reactionsSummaryFor(m.id) }]);
      };
    };
    #Ok(result)
  };

  // ===================== Per-club DM settings =====================

  public shared ({ caller }) func set_club_dm_settings(club_id : Text, dm_disabled : Bool, attachments_disabled : Bool) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller) and not hasRole(caller, "app_admin", null, null) and not hasRole(caller, "club_admin", ?club_id, null)) return #Err("Club admin required");
    if (not valid(club_id)) return #Err("Invalid club");
    clubDmSettings := clubDmSettings.filter(func(s) = s.club_id != club_id);
    clubDmSettings := clubDmSettings.concat([{ club_id; dm_disabled; attachments_disabled }]);
    #Ok
  };

  public query func get_club_dm_settings(club_id : Text) : async Types.ClubDmSettings {
    for (s in clubDmSettings.values()) { if (s.club_id == club_id) { return s } };
    { club_id; dm_disabled = false; attachments_disabled = false }
  };

  // ===================== Per-user messaging settings =====================

  public shared ({ caller }) func set_user_messaging_settings(hide_message_preview : Bool, ai_catchup_enabled : Bool) : async { #Ok; #Err : Text } {
    auth(caller);
    userMessagingSettings := userMessagingSettings.filter(func(s) = not s.user.equal(caller));
    userMessagingSettings := userMessagingSettings.concat([{ user = caller; hide_message_preview; ai_catchup_enabled }]);
    #Ok
  };

  public query ({ caller }) func get_user_messaging_settings() : async Types.UserMessagingSettings {
    for (s in userMessagingSettings.values()) { if (s.user.equal(caller)) { return s } };
    { user = caller; hide_message_preview = false; ai_catchup_enabled = false }
  };

  // ===================== Per-club unread breakdown =====================

  public query ({ caller }) func unread_count_by_club(principal : Principal) : async { #Ok : [Types.ClubUnreadSummary]; #Err : Text } {
    if (not caller.equal(principal) and not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return #Err("Access forbidden");
    var result : [Types.ClubUnreadSummary] = [];
    for (conversation in conversations.values()) {
      if (conversation.participants.any(func(p) = p.equal(principal))) {
        let u = unreadFor(principal, conversation.id);
        if (u.count > 0) {
          var found = false;
          result := Array.map<Types.ClubUnreadSummary, Types.ClubUnreadSummary>(result, func(s) = if (s.club_id == conversation.club_id) { found := true; { s with count = s.count + u.count } } else { s });
          if (not found) { result := result.concat([{ club_id = conversation.club_id; count = u.count }]) };
        };
      };
    };
    #Ok(result)
  };

  // ===================== Recent conversations rail =====================

  public query ({ caller }) func recent_conversations(principal : Principal, limit : Nat16) : async { #Ok : [Types.RecentConversation]; #Err : Text } {
    if (not caller.equal(principal) and not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return #Err("Access forbidden");
    if (limit == 0 or limit > 100) return #Err("Invalid limit");
    var entries : [Types.RecentConversation] = [];
    for (conversation in conversations.values()) {
      if (conversation.participants.any(func(p) = p.equal(principal)) and not isGroupDeleted(conversation.id)) {
        let lastSeq : Nat64 = if (conversation.next_sequence == 0) 0 else conversation.next_sequence - 1;
        entries := entries.concat([{ conversation_id = conversation.id; kind = inferConversationKind(conversation); last_message_sequence = lastSeq; last_message_at_ms = null }]);
      };
    };
    let sorted = entries.sort(func(a, b) = Nat64.compare(b.last_message_sequence, a.last_message_sequence));
    let take = if (sorted.size() < Nat16.toNat(limit)) sorted.size() else Nat16.toNat(limit);
    #Ok(Array.tabulate<Types.RecentConversation>(take, func(i) = sorted[i]))
  };

  // ===================== AI chat recap (HTTPS outcall) =====================
  // The recap is generated by an external AI endpoint configured by the
  // governor. The api_key lives in canister state, which node providers can
  // read — only ever store a scoped/limited key here.

  public shared ({ caller }) func set_recap_config(config : ?Types.RecapConfig) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    switch (config) {
      case (?c) {
        if (not Text.startsWith(c.endpoint_url, #text "https://") or c.endpoint_url.size() > 2048) return #Err("Endpoint must be a public https:// URL");
        if (c.api_key == "" or c.model == "") return #Err("Invalid recap config");
      };
      case null {};
    };
    recapConfig := config;
    #Ok
  };

  // Transform for the recap outcall: strip all response headers. In
  // non-replicated mode a transform is not needed for consensus, but this
  // also keeps the candid-encoded output small against max_response_bytes.
  public query func recapTransform({
    context : Blob;
    response : IC.HttpRequestResult;
  }) : async IC.HttpRequestResult {
    { response with headers = [] };
  };

  func truncateText(t : Text, n : Nat) : Text {
    if (t.size() <= n) return t;
    let chars = Text.toArray(t);
    Text.fromArray(Array.tabulate<Char>(n, func(i) = chars[i]))
  };

  func jsonEscape(t : Text) : Text {
    var s = Text.replace(t, #text "\\", "\\\\");
    s := Text.replace(s, #text "\"", "\\\"");
    s := Text.replace(s, #text "\n", "\\n");
    s := Text.replace(s, #text "\r", "\\r");
    s := Text.replace(s, #text "\t", "\\t");
    s
  };

  // Minimal, tolerant extraction: returns the first JSON string value of
  // `key` ("summary" or "text"), or null if not found. Not a full parser —
  // the fallback in generate_chat_recap returns the raw body instead.
  func findJsonStringValue(body : Text, key : Text) : ?Text {
    let needle = "\"" # key # "\"";
    let parts = Text.toArray(body);
    let n = Text.toArray(needle);
    let size = parts.size();
    var i = 0;
    label search while (i + n.size() < size) {
      var matched = true;
      var j = 0;
      while (j < n.size()) {
        if (parts[i + j] != n[j]) { matched := false; j := n.size() } else { j += 1 };
      };
      if (matched) {
        // Find the opening quote of the value after the colon.
        var k = i + n.size();
        while (k < size and parts[k] != '\u{22}') {
          if (parts[k] == '}' or parts[k] == ',') { return null };
          k += 1;
        };
        if (k >= size) return null;
        k += 1;
        var value = "";
        var escaped = false;
        label read while (k < size) {
          let c = parts[k];
          if (escaped) {
            value := value # (switch (c) { case ('n') { "\n" }; case ('t') { "\t" }; case ('r') { "\r" }; case (_) { Text.fromArray([c]) } });
            escaped := false;
          } else if (c == '\\') {
            escaped := true;
          } else if (c == '\u{22}') {
            return ?value;
          } else {
            value := value # Text.fromArray([c]);
          };
          k += 1;
        };
        return null;
      };
      i += 1;
    };
    null
  };

  public shared ({ caller }) func generate_chat_recap(conversation_id : Text, since_ms : Nat64) : async { #Ok : Text; #Err : Text } {
    auth(caller);
    if (not canReadTeamMessages(caller, conversation_id)) return #Err("Conversation access forbidden");
    let settings = userMessagingSettings.find(func(s) = s.user.equal(caller));
    let catchupEnabled = switch (settings) { case (?s) { s.ai_catchup_enabled }; case null { false } };
    if (not catchupEnabled and not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return #Err("AI catch-up is disabled for this member");
    let config = switch (recapConfig) {
      case null { return #Err("Recap not configured") };
      case (?c) { c };
    };

    var transcript = "";
    var count = 0;
    for (m in messages.values()) {
      if (m.conversation_id == conversation_id and m.created_at_ms > since_ms and count < 50) {
        transcript := transcript # Principal.toText(m.sender) # ": " # truncateText(m.body, 280) # "\n";
        count += 1;
      };
    };
    if (count == 0) return #Err("No new messages to recap");

    let instruction = "You are summarising a club team group chat for a member who has been away. Read the transcript and reply with a brief bullet-point catch-up: key decisions, upcoming events with dates/times, and anything that needs the reader's action. Be concise.\n\n";
    let payload = "{"
      # "\"model\":\"" # jsonEscape(config.model) # "\","
      # "\"messages\":[{\"role\":\"user\",\"content\":\"" # jsonEscape(instruction # transcript) # "\"}]"
      # "}";

    let request : IC.HttpRequestArgs = {
      url = config.endpoint_url;
      // Sized for response headers + body; a recap is short prose.
      max_response_bytes = ?(32_000 : Nat64);
      headers = [
        { name = "Content-Type"; value = "application/json" },
        { name = "Authorization"; value = "Bearer " # config.api_key },
        // Lets the endpoint dedupe retries for the same recap request.
        { name = "Idempotency-Key"; value = conversation_id # "-" # Nat64.toText(since_ms) },
      ];
      body = ?Text.encodeUtf8(payload);
      method = #post;
      transform = ?{
        function = recapTransform;
        context = Blob.fromArray([]);
      };
      // Non-replicated: this POST is a paid, non-idempotent AI request.
      // Replicated mode would fire one paid request per subnet node (~13
      // duplicate charges per recap); a single node sends it instead, at
      // the documented cost of trusting that node's response.
      is_replicated = ?false;
    };

    try {
      let response = await Call.httpRequest(request);
      if (response.status < 200 or response.status >= 300) {
        return #Err("Recap endpoint returned status " # Nat.toText(response.status));
      };
      let bodyText = switch (Text.decodeUtf8(response.body)) {
        case (?t) { t };
        case null { return #Err("Recap response was not valid UTF-8") };
      };
      switch (findJsonStringValue(bodyText, "summary")) {
        case (?summary) { #Ok(truncateText(summary, 4000)) };
        case null {
          switch (findJsonStringValue(bodyText, "text")) {
            case (?text) { #Ok(truncateText(text, 4000)) };
            // Tolerant fallback: surface the raw body so a differently
            // shaped endpoint still yields something readable.
            case null { #Ok(truncateText(bodyText, 2000)) };
          }
        };
      }
    } catch (e) {
      // Outcall timeouts and rejects surface as catchable errors — never trap.
      #Err("Recap request failed: " # Error.message(e))
    }
  };
};
