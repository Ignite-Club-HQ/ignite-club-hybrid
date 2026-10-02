import Array "mo:core/Array";
import Principal "mo:core/Principal";
module {
  type Attachment = { kind : Text; ref_id : Text; url : ?Text };
  type RoleGrant = { user : Principal; role : Text; club_id : ?Text; team_id : ?Text };
  type Conversation = { id : Text; club_id : Text; team_id : ?Text; participants : [Principal]; next_sequence : Nat64 };
  type Message = { conversation_id : Text; id : Text; sender : Principal; body : Text; sequence : Nat64; idempotency_key : Text; edited_at_ms : ?Nat64; attachment : ?Attachment; created_at_ms : Nat64 };
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
    avatar : ?Text;
    description : ?Text;
    deleted : Bool;
    admin_only_posting : Bool;
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
  type OldClubDmSettings = { club_id : Text; dm_disabled : Bool; attachments_disabled : Bool };
  type ClubDmSettings = { club_id : Text; dm_disabled : Bool; attachments_disabled : Bool; allowed_roles : [Text]; force_disable_previews : Bool; ai_catch_up_enabled : Bool };
  type UserMessagingSettings = { user : Principal; hide_message_preview : Bool; ai_catchup_enabled : Bool };
  type RecapConfig = { endpoint_url : Text; api_key : Text; model : Text };
  type PresencePing = { user : Principal; last_seen_ms : Nat64 };
  type BlockedUser = { blocker : Principal; blocked : Principal; created_at_ms : Nat64 };
  type OldActor = {
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
    var clubDmSettings : [OldClubDmSettings];
    var userMessagingSettings : [UserMessagingSettings];
    var recapConfig : ?RecapConfig;
    var presence : [PresencePing];
    var blockedUsers : [BlockedUser];
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
    var recapConfig : ?RecapConfig;
    var presence : [PresencePing];
    var blockedUsers : [BlockedUser];
  };
  // Extends ClubDmSettings with allowed_roles (DM-permission role list),
  // force_disable_previews (club-wide push-preview privacy override) and
  // ai_catch_up_enabled (club-wide AI chat recap toggle). Existing rows are
  // preserved with conservative defaults (default DM roles, previews on,
  // AI recap on) matching the UI's previous Supabase defaults.
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var roles = old.roles;
      var conversations = old.conversations;
      var messages = old.messages;
      var receipts = old.receipts;
      var unread = old.unread;
      var bulkAccessPrincipals = old.bulkAccessPrincipals;
      var groupMetadata = old.groupMetadata;
      var clubMemberships = old.clubMemberships;
      var competitionAdmins = old.competitionAdmins;
      var dmAttachmentsDisabled = old.dmAttachmentsDisabled;
      var groupRoles = old.groupRoles;
      var joinRequests = old.joinRequests;
      var polls = old.polls;
      var pollVotes = old.pollVotes;
      var mutePreferences = old.mutePreferences;
      var dmLinks = old.dmLinks;
      var forwardRecords = old.forwardRecords;
      var scheduledMessages = old.scheduledMessages;
      var attachmentMetadata = old.attachmentMetadata;
      var reactions = old.reactions;
      var clubDmSettings = old.clubDmSettings.map(func(s : OldClubDmSettings) : ClubDmSettings = {
        club_id = s.club_id;
        dm_disabled = s.dm_disabled;
        attachments_disabled = s.attachments_disabled;
        allowed_roles = ["app_admin", "club_admin", "team_admin"];
        force_disable_previews = false;
        ai_catch_up_enabled = true;
      });
      var userMessagingSettings = old.userMessagingSettings;
      var recapConfig = old.recapConfig;
      var presence = old.presence;
      var blockedUsers = old.blockedUsers;
    }
  };
};
