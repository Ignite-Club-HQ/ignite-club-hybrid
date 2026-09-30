import Array "mo:core/Array";
import Principal "mo:core/Principal";
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

  // Group/conversation metadata that was previously dropped on the ICP
  // branch: the Supabase `chat_groups` row equivalent. `kind` is one of
  // "direct" | "club" | "team" | "group" | "broadcast" | "competition".
  public type GroupMetadata = {
    conversation_id : Text;
    name : Text;
    kind : Text;
    club_id : ?Text;
    team_id : ?Text;
    members : [Principal];
    created_at_ms : Nat64;
  };

  // Shared-club membership record backing `can_dm_user`: two users may DM
  // each other only if they share at least one club membership record.
  public type ClubMembership = { user : Principal; club_id : Text };

  // Per-conversation admin allow-list enforced server-side for
  // competition-kind conversations: only listed admins (or governor /
  // app_admin) may post.
  public type CompetitionAdmin = { conversation_id : Text; user : Principal };

  // Per-(user, conversation) unread summary surfaced through
  // `my_unread_counts`, annotated with the conversation's metadata kind so
  // the frontend can bucket into its {teams, clubs, groups, dms} shape
  // without a second round-trip.
  public type UnreadSummary = { conversation_id : Text; kind : Text; count : Nat64 };

  public type State = {
    schema : Nat32;
    governor : Principal;
    roles : [RoleGrant];
    conversations : [Conversation];
    messages : [Message];
    receipts : [Receipt];
    unread : [Unread];
    groupMetadata : [GroupMetadata];
    clubMemberships : [ClubMembership];
    competitionAdmins : [CompetitionAdmin];
    dmAttachmentsDisabled : [Principal];
  };
}
