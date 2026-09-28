import Principal "mo:core/Principal";
module {
  type Conversation = { id : Text; club_id : Text; team_id : ?Text; participants : [Principal]; next_sequence : Nat64 };
  type Message = { conversation_id : Text; id : Text; sender : Principal; body : Text; sequence : Nat64; idempotency_key : Text };
  type Receipt = { conversation_id : Text; user : Principal; message_id : Text; read : Bool };
  type Unread = { conversation_id : Text; user : Principal; count : Nat64; last_read_sequence : Nat64 };
  type OldActor = {};
  type NewActor = {
    var governor : Principal;
    var conversations : [Conversation];
    var messages : [Message];
    var receipts : [Receipt];
    var unread : [Unread];
  };
  public func migration(_old : OldActor) : NewActor {
    { var governor = Principal.anonymous(); var conversations = []; var messages = []; var receipts = []; var unread = [] }
  };
};