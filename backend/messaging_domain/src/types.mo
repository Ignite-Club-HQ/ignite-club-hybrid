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
  public type Message = { conversation_id : Text; id : Text; sender : Principal; body : Text; sequence : Nat64; idempotency_key : Text; edited_at_ms : ?Nat64; attachment : ?Attachment; created_at_ms : Nat64 };
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
    avatar : ?Text;
    description : ?Text;
    deleted : Bool;
    admin_only_posting : Bool;
    // Set by soft_delete_group so the admin deleted-chats tool can show
    // when/who; cleared on restore. Null for groups deleted before these
    // fields existed.
    deleted_at_ms : ?Nat64;
    deleted_by : ?Principal;
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

  // --- Chat recap (on-ICP HTTPS outcall AI) ---
  // NOTE: api_key lives in canister stable state, which is visible to the
  // node providers hosting this canister's subnet replicas. Only ever
  // configure a scoped/limited-privilege key here, never a master key.
  public type RecapConfig = { endpoint_url : Text; api_key : Text; model : Text };

  // --- Presence & blocking ---
  // Last heartbeat per user; drives the online count (window checked at read).
  public type PresencePing = { user : Principal; last_seen_ms : Nat64; platform : ?Text };
  // Admin online-users view: one row per recently-heartbeating user.
  public type OnlineUser = { user : Principal; last_seen_ms : Nat64; platform : ?Text };
  // Link-preview card data extracted from a page's HTML meta tags.
  public type LinkPreview = { title : ?Text; description : ?Text; image : ?Text; site_name : ?Text };
  // blocker -> blocked pair; enforced on DMs in both directions.
  public type BlockedUser = { blocker : Principal; blocked : Principal; created_at_ms : Nat64 };

  // --- Typing indicators (ephemeral; TTL-filtered at read time) ---
  public type TypingPing = { user : Principal; conversation_id : Text; name : Text; last_typed_ms : Nat64 };
  public type TypingUser = { user : Principal; name : Text };

  // --- Pinned messages ---
  public type PinnedMessage = { id : Text; conversation_id : Text; message_id : Text; pinned_by : Principal; created_at_ms : Nat64 };

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
    groupRoles : [GroupRole];
    joinRequests : [JoinRequest];
    polls : [Poll];
    pollVotes : [PollVote];
    mutePreferences : [MutePreference];
    dmLinks : [DmLink];
    forwardRecords : [ForwardRecord];
    scheduledMessages : [ScheduledMessage];
    attachmentMetadata : [AttachmentMetadata];
    reactions : [Reaction];
    clubDmSettings : [ClubDmSettings];
    userMessagingSettings : [UserMessagingSettings];
    typingPings : [TypingPing];
    pinnedMessages : [PinnedMessage];
  };

  // --- Group management (roles, bulk membership, soft-delete, join requests) ---
  public type GroupRole = { conversation_id : Text; user : Principal; role : Text }; // "owner" | "admin" | "member"
  public type JoinRequest = { conversation_id : Text; user : Principal; status : Text; created_at_ms : Nat64 }; // "pending" | "approved" | "rejected"

  // --- Polls ---
  public type Poll = {
    id : Text;
    conversation_id : Text;
    message_id : ?Text;
    question : Text;
    options : [Text];
    creator : Principal;
    closed : Bool;
    created_at_ms : Nat64;
  };
  public type PollVote = { poll_id : Text; user : Principal; option_index : Nat32 };
  public type PollResults = { poll : Poll; counts : [Nat32]; total_votes : Nat32 };

  // --- Mute preferences (storage only; not enforced on-chain) ---
  public type MutePreference = { user : Principal; conversation_id : Text; muted : Bool };

  // --- Deterministic DM lookup ---
  public type DmLink = { a : Principal; b : Principal; conversation_id : Text };

  // --- Forwarded messages ---
  public type ForwardRecord = {
    message_id : Text;
    to_conversation_id : Text;
    from_conversation_id : Text;
    from_message_id : Text;
    original_sender : Principal;
  };

  // --- Scheduled message replay markers ---
  public type ScheduledMessage = {
    id : Text;
    conversation_id : Text;
    sender : Principal;
    body : Text;
    scheduled_at_ms : Nat64;
    replayed_at_ms : ?Nat64;
    replayed_message_id : ?Text;
  };

  // --- Off-chain attachment metadata registration (bytes stay off-chain) ---
  public type AttachmentMetadata = {
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

  // --- Reactions (needed for chat recap "reactions summary") ---
  public type Reaction = { message_id : Text; user : Principal; emoji : Text };
  public type ReactionSummary = { emoji : Text; count : Nat32 };
  public type MessageWithReactions = { message : Message; reactions : [ReactionSummary] };

  // --- Per-club DM settings ---
  public type ClubDmSettings = { club_id : Text; dm_disabled : Bool; attachments_disabled : Bool; allowed_roles : [Text]; force_disable_previews : Bool; ai_catch_up_enabled : Bool };

  // --- Per-user messaging settings ---
  public type UserMessagingSettings = { user : Principal; hide_message_preview : Bool; ai_catchup_enabled : Bool };

  // --- Recent conversations rail ---
  // Group summary for club/team chat-list browsing (list_groups_by_club /
  // list_groups_by_team) — the canister counterpart of the Supabase
  // `chat_groups` row read ChatGroupsList needs.
  public type GroupSummary = {
    conversation_id : Text;
    name : Text;
    kind : Text;
    club_id : ?Text;
    team_id : ?Text;
    avatar : ?Text;
    description : ?Text;
    member_count : Nat32;
    is_member : Bool;
  };

  public type RecentConversation = { conversation_id : Text; kind : Text; last_message_sequence : Nat64; last_message_at_ms : ?Nat64 };
  public type ClubUnreadSummary = { club_id : Text; count : Nat64 };

  // --- Realtime pokes (IC WebSocket) ---
  // The only application message type that crosses the WS channel. Poke-only
  // by design: carries a chat id + monotonic version, never message content;
  // clients react by refetching through the normal certified query path.
  public type WsAppMessage = { #chat_poke : { conversation_id : Text; sequence : Nat64 } };
}
