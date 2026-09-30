import Array "mo:core/Array";
import Principal "mo:core/Principal";
module {
  type Attachment = { kind : Text; ref_id : Text; url : ?Text };
  type RoleGrant = { user : Principal; role : Text; club_id : ?Text; team_id : ?Text };
  type Conversation = { id : Text; club_id : Text; team_id : ?Text; participants : [Principal]; next_sequence : Nat64 };
  type Message = { conversation_id : Text; id : Text; sender : Principal; body : Text; sequence : Nat64; idempotency_key : Text; edited_at_ms : ?Nat64; attachment : ?Attachment };
  type Receipt = { conversation_id : Text; user : Principal; message_id : Text; read : Bool };
  type Unread = { conversation_id : Text; user : Principal; count : Nat64; last_read_sequence : Nat64 };
  type GroupMetadata = {
    conversation_id : Text;
    name : Text;
    kind : Text;
    club_id : ?Text;
    team_id : ?Text;
    members : [Principal];
    created_at_ms : Nat64;
  };
  type ClubMembership = { user : Principal; club_id : Text };
  type CompetitionAdmin = { conversation_id : Text; user : Principal };
  type OldActor = {
    var governor : Principal;
    var roles : [RoleGrant];
    var conversations : [Conversation];
    var messages : [Message];
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
    var groupMetadata : [GroupMetadata];
    var clubMemberships : [ClubMembership];
    var competitionAdmins : [CompetitionAdmin];
    var dmAttachmentsDisabled : [Principal];
  };
  // Adds group/conversation metadata (name/kind/club/team/members), shared-club
  // DM eligibility records, per-conversation competition-admin allow-lists,
  // and a global DM-attachments-disabled principal list. All start empty —
  // existing conversations keep working with metadata seeded lazily via
  // `upsert_group_metadata` (or absent, in which case callers fall back to
  // inferring kind from `team_id`/`club_id`).
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var roles = old.roles;
      var conversations = old.conversations;
      var messages = old.messages;
      var receipts = old.receipts;
      var unread = old.unread;
      var bulkAccessPrincipals = old.bulkAccessPrincipals;
      var groupMetadata = [];
      var clubMemberships = [];
      var competitionAdmins = [];
      var dmAttachmentsDisabled = [];
    }
  };
};
