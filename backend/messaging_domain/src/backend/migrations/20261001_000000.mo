import Array "mo:core/Array";
import Principal "mo:core/Principal";
module {
  type Attachment = { kind : Text; ref_id : Text; url : ?Text };
  type RoleGrant = { user : Principal; role : Text; club_id : ?Text; team_id : ?Text };
  type Conversation = { id : Text; club_id : Text; team_id : ?Text; participants : [Principal]; next_sequence : Nat64 };
  type OldMessage = { conversation_id : Text; id : Text; sender : Principal; body : Text; sequence : Nat64; idempotency_key : Text; edited_at_ms : ?Nat64; attachment : ?Attachment };
  type Message = { conversation_id : Text; id : Text; sender : Principal; body : Text; sequence : Nat64; idempotency_key : Text; edited_at_ms : ?Nat64; attachment : ?Attachment; created_at_ms : Nat64 };
  type Receipt = { conversation_id : Text; user : Principal; message_id : Text; read : Bool };
  type Unread = { conversation_id : Text; user : Principal; count : Nat64; last_read_sequence : Nat64 };
  type OldGroupMetadata = {
    conversation_id : Text;
    name : Text;
    kind : Text;
    club_id : ?Text;
    team_id : ?Text;
    members : [Principal];
    created_at_ms : Nat64;
  };
  type GroupMetadata = {
    conversation_id : Text;
    name : Text;
    kind : Text;
    club_id : ?Text;
    team_id : ?Text;
    members : [Principal];
    created_at_ms : Nat64;
    avatar : ?Text;
    description : ?Text;
    deleted : Bool;
  };
  type ClubMembership = { user : Principal; club_id : Text };
  type CompetitionAdmin = { conversation_id : Text; user : Principal };
  type GroupRole = { conversation_id : Text; user : Principal; role : Text };
  type JoinRequest = { conversation_id : Text; user : Principal; status : Text; created_at_ms : Nat64 };
  type Poll = {
    id : Text;
    conversation_id : Text;
    message_id : ?Text;
    question : Text;
    options : [Text];
    creator : Principal;
    closed : Bool;
    created_at_ms : Nat64;
  };
  type PollVote = { poll_id : Text; user : Principal; option_index : Nat32 };
  type MutePreference = { user : Principal; conversation_id : Text; muted : Bool };
  type DmLink = { a : Principal; b : Principal; conversation_id : Text };
  type ForwardRecord = {
    message_id : Text;
    to_conversation_id : Text;
    from_conversation_id : Text;
    from_message_id : Text;
    original_sender : Principal;
  };
  type ScheduledMessage = {
    id : Text;
    conversation_id : Text;
    sender : Principal;
    body : Text;
    scheduled_at_ms : Nat64;
    replayed_at_ms : ?Nat64;
    replayed_message_id : ?Text;
  };
  type AttachmentMetadata = {
    id : Text;
    conversation_id : Text;
    message_id : ?Text;
    kind : Text;
    ref_id : Text;
    url : ?Text;
    size_bytes : ?Nat64;
    uploader : Principal;
    created_at_ms : Nat64;
  };
  type Reaction = { message_id : Text; user : Principal; emoji : Text };
  type ClubDmSettings = { club_id : Text; dm_disabled : Bool; attachments_disabled : Bool };
  type UserMessagingSettings = { user : Principal; hide_message_preview : Bool; ai_catchup_enabled : Bool };
  type OldActor = {
    var governor : Principal;
    var roles : [RoleGrant];
    var conversations : [Conversation];
    var messages : [OldMessage];
    var receipts : [Receipt];
    var unread : [Unread];
    var bulkAccessPrincipals : [Principal];
    var groupMetadata : [OldGroupMetadata];
    var clubMemberships : [ClubMembership];
    var competitionAdmins : [CompetitionAdmin];
    var dmAttachmentsDisabled : [Principal];
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
    var groupRoles : [GroupRole];
    var joinRequests : [JoinRequest];
    var polls : [Poll];
    var pollVotes : [PollVote];
    var mutePreferences : [MutePreference];
    var dmLinks : [DmLink];
    var forwardRecords : [ForwardRecord];
    var scheduledMessages : [ScheduledMessage];
    var attachmentMetadata : [AttachmentMetadata];
    var reactions : [Reaction];
    var clubDmSettings : [ClubDmSettings];
    var userMessagingSettings : [UserMessagingSettings];
  };
  // Adds group management (roles/join requests), polls, mute preferences,
  // deterministic DM links, message forwarding records, scheduled-message
  // replay markers, off-chain attachment metadata registration, reactions,
  // per-club DM settings and per-user messaging settings. Backfills
  // `Message.created_at_ms` (defaulted to 0 for pre-existing messages, since
  // the original send time wasn't recorded) and `GroupMetadata.avatar` /
  // `description` / `deleted` (defaulted to null/null/false) for metadata
  // rows created before those fields existed. All new collections start
  // empty.
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var roles = old.roles;
      var conversations = old.conversations;
      var messages = Array.map<OldMessage, Message>(old.messages, func(m : OldMessage) : Message = {
        conversation_id = m.conversation_id;
        id = m.id;
        sender = m.sender;
        body = m.body;
        sequence = m.sequence;
        idempotency_key = m.idempotency_key;
        edited_at_ms = m.edited_at_ms;
        attachment = m.attachment;
        created_at_ms = 0;
      }));
      var receipts = old.receipts;
      var unread = old.unread;
      var bulkAccessPrincipals = old.bulkAccessPrincipals;
      var groupMetadata = Array.map<OldGroupMetadata, GroupMetadata>(old.groupMetadata, func(g : OldGroupMetadata) : GroupMetadata = {
        conversation_id = g.conversation_id;
        name = g.name;
        kind = g.kind;
        club_id = g.club_id;
        team_id = g.team_id;
        members = g.members;
        created_at_ms = g.created_at_ms;
        avatar = null;
        description = null;
        deleted = false;
      }));
      var clubMemberships = old.clubMemberships;
      var competitionAdmins = old.competitionAdmins;
      var dmAttachmentsDisabled = old.dmAttachmentsDisabled;
      var groupRoles = [];
      var joinRequests = [];
      var polls = [];
      var pollVotes = [];
      var mutePreferences = [];
      var dmLinks = [];
      var forwardRecords = [];
      var scheduledMessages = [];
      var attachmentMetadata = [];
      var reactions = [];
      var clubDmSettings = [];
      var userMessagingSettings = [];
    }
  };
};
