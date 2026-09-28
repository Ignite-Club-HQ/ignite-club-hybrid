import Principal "mo:core/Principal";

module {
  type Conversation = { id : Text; club_id : Text; team_id : ?Text; participants : [Principal]; next_sequence : Nat64 };
  type Message = { conversation_id : Text; id : Text; sender : Principal; body : Text; sequence : Nat64; idempotency_key : Text };
  type Receipt = { conversation_id : Text; user : Principal; message_id : Text; read : Bool };
  type Unread = { conversation_id : Text; user : Principal; count : Nat64; last_read_sequence : Nat64 };
  type RoleGrant = { user : Principal; role : Text; club_id : ?Text; team_id : ?Text };
  type OldActor = {
    var governor : Principal;
    var conversations : [Conversation];
    var messages : [Message];
    var receipts : [Receipt];
    var unread : [Unread];
  };
  type NewActor = {
    var governor : Principal;
    var roles : [RoleGrant];
    var conversations : [Conversation];
    var messages : [Message];
    var receipts : [Receipt];
    var unread : [Unread];
  };

  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var roles = [];
      var conversations = old.conversations;
      var messages = old.messages;
      var receipts = old.receipts;
      var unread = old.unread;
    }
  };
};
