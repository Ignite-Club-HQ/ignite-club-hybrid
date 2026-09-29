import Array "mo:core/Array";
import Principal "mo:core/Principal";
module {
  type RoleGrant = { user : Principal; role : Text; club_id : ?Text; team_id : ?Text };
  type Conversation = { id : Text; club_id : Text; team_id : ?Text; participants : [Principal]; next_sequence : Nat64 };
  type OldMessage = { conversation_id : Text; id : Text; sender : Principal; body : Text; sequence : Nat64; idempotency_key : Text };
  type Attachment = { kind : Text; ref_id : Text; url : ?Text };
  type Message = { conversation_id : Text; id : Text; sender : Principal; body : Text; sequence : Nat64; idempotency_key : Text; edited_at_ms : ?Nat64; attachment : ?Attachment };
  type Receipt = { conversation_id : Text; user : Principal; message_id : Text; read : Bool };
  type Unread = { conversation_id : Text; user : Principal; count : Nat64; last_read_sequence : Nat64 };
  type OldActor = {
    var governor : Principal;
    var roles : [RoleGrant];
    var conversations : [Conversation];
    var messages : [OldMessage];
    var receipts : [Receipt];
    var unread : [Unread];
    var bulkAccessPrincipals : [Principal];
  };
  type NewActor = {
    var governor : Principal;
    var roles : [RoleGrant];
    var conversations : [Conversation];
    var messages : [Message];
    var receipts : [Receipt];
    var unread : [Unread];
    var bulkAccessPrincipals : [Principal];
  };
  // Adds edit timestamps and attachments. Existing messages gain null
  // edited_at_ms and null attachment — the frontend already treats both as
  // optional, matching the provisional Supabase mapping.
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var roles = old.roles;
      var conversations = old.conversations;
      var messages = Array.map<OldMessage, Message>(old.messages, func(m) {
        { conversation_id = m.conversation_id; id = m.id; sender = m.sender; body = m.body;
          sequence = m.sequence; idempotency_key = m.idempotency_key; edited_at_ms = null; attachment = null }
      });
      var receipts = old.receipts;
      var unread = old.unread;
      var bulkAccessPrincipals = old.bulkAccessPrincipals;
    }
  };
};