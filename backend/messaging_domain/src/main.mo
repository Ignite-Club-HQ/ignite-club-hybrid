import Array "mo:core/Array";
import Nat "mo:core/Nat";
import Nat16 "mo:core/Nat16";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Types "types";

persistent actor {
  var governor : Principal;
  var roles : [Types.RoleGrant];
  var conversations : [Types.Conversation];
  var messages : [Types.Message];
  var receipts : [Types.Receipt];
  var unread : [Types.Unread];

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

  func isGovernor(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and governor.equal(caller)
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

  public shared ({ caller }) func send_message(conversation_id : Text, body : Text, idempotency_key : Text) : async { #Ok : Types.Message; #Err : Text } {
    auth(caller);
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    if (not valid(body) or not valid(idempotency_key)) return #Err("Invalid message");
    for (m in messages.values()) {
      if (m.conversation_id == conversation_id and m.idempotency_key == idempotency_key) {
        return #Ok(m);
      };
    };
    var conv_idx : ?Nat = null;
    var idx = 0;
    for (c in conversations.values()) {
      if (c.id == conversation_id) { conv_idx := ?idx };
      idx += 1;
    };
    switch (conv_idx) {
      case null { #Err("Conversation not found") };
      case (?i) {
        let conv = conversations[i];
        let seq = conv.next_sequence;
        let msg : Types.Message = {
          conversation_id;
          id = "msg-" # conversation_id # "-" # Nat64.toText(seq);
          sender = caller;
          body;
          sequence = seq;
          idempotency_key;
        };
        let updated_conv : Types.Conversation = { conv with next_sequence = seq + 1 };
        conversations := Array.tabulate<Types.Conversation>(conversations.size(), func(position) {
          if (position == i) updated_conv else conversations[position]
        });
        messages := messages.concat([msg]);
        for (participant in conv.participants.values()) {
          if (not participant.equal(caller)) {
            let current_u = unreadFor(participant, conversation_id);
            let updated_u : Types.Unread = { current_u with count = current_u.count + 1 };
            unread := unread.filter(func(u) = not (u.user.equal(participant) and u.conversation_id == conversation_id));
            unread := unread.concat([updated_u]);
          };
        };
        #Ok(msg)
      };
    }
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
        let updated : Types.Message = { current with body };
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

  public query ({ caller }) func export_state() : async { #Ok : Types.State; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor only");
    #Ok({ schema = 1; governor; roles; conversations; messages; receipts; unread })
  };
};