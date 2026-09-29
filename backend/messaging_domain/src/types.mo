module {
  public type RoleGrant = { user : Principal; role : Text; club_id : ?Text; team_id : ?Text };
  public type Conversation = { id : Text; club_id : Text; team_id : ?Text; participants : [Principal]; next_sequence : Nat64 };
  // A single optional attachment per message, covering the poll/news/image
  // payloads the group chat composer sends today. kind names the payload
  // ("poll", "news", "image"), ref_id points at the referenced record, and
  // url carries externally-hosted media (Supabase storage today).
  public type Attachment = { kind : Text; ref_id : Text; url : ?Text };
  public type Message = { conversation_id : Text; id : Text; sender : Principal; body : Text; sequence : Nat64; idempotency_key : Text; edited_at_ms : ?Nat64; attachment : ?Attachment };
  public type Receipt = { conversation_id : Text; user : Principal; message_id : Text; read : Bool };
  public type Unread = { conversation_id : Text; user : Principal; count : Nat64; last_read_sequence : Nat64 };
  public type MessagePage = { messages : [Message]; next_sequence : ?Nat64; latest_sequence : Nat64 };
  public type BroadcastResult = { delivered : Nat32; skipped : [Text] };
  public type State = { schema : Nat32; governor : Principal; roles : [RoleGrant]; conversations : [Conversation]; messages : [Message]; receipts : [Receipt]; unread : [Unread] };
}