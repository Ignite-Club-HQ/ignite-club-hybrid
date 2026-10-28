import PrivateNameWriterWindow "../../shared/PrivateNameWriterWindow";
import PrivateNameWriterEndpoints "../../shared/PrivateNameWriterEndpoints";
import AccountAdmission "../../shared/AccountAdmission";
import OpeningConfiguration "../../shared/OpeningConfiguration";
import RemovalReceiver "../../shared/RemovalReceiver";
import Map "mo:core/Map";
import MediaEvidence "../../shared/MediaEvidence";
import PrimMem "mo:⛔";
import Cycles "mo:core/Cycles";
import Array "mo:core/Array";
import Nat "mo:core/Nat";
import Nat16 "mo:core/Nat16";
import Nat32 "mo:core/Nat32";
import Option "mo:core/Option";
import Nat64 "mo:core/Nat64";
import Int "mo:core/Int";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Text "mo:core/Text";
import Blob "mo:core/Blob";
import Char "mo:core/Char";
import Error "mo:core/Error";
import Call "mo:ic/Call";
import IC "mo:ic/Types";
import IcWebSocketCdk "mo:ic-websocket-cdk";
import IcWebSocketCdkState "mo:ic-websocket-cdk/State";
import IcWebSocketCdkTypes "mo:ic-websocket-cdk/Types";
import Types "types";
import Timer "mo:core/Timer";
import PhotoReminderPolicy "photoReminderPolicy";
import DefaultChatPolicy "defaultChatPolicy";
import PrivateDirectNames "privateDirectNames";
import BroadcastReadPolicy "broadcastReadPolicy";
import PrivateProfileAudience "../../shared/PrivateProfileAudience";

persistent actor class Main(governorInit : Principal) = this {
  // Opt-in local rehearsal only; production deploy scripts must never set these.
  transient let accountAdmissionEnabled = Runtime.envVar<system>("IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL") == ?"1";
  transient let accountAdmissionAuthority = switch (Runtime.envVar<system>("IGNITE_ACCOUNT_SERVICE_IDENTITY")) {
    case (?id) ?Principal.fromText(id); case null null
  };
  var removal_intents : Map.Map<Text, RemovalReceiver.Request>;
  var removal_subjects : Map.Map<Principal, Text>;
  var removal_active : Map.Map<Principal, Nat>;
  transient let removalReceiver = RemovalReceiver.Gate(accountAdmissionEnabled, accountAdmissionAuthority, removal_intents, removal_subjects, removal_active);
  transient let accountAdmission = AccountAdmission.Gate(accountAdmissionEnabled, accountAdmissionAuthority);
  // Separate stop-the-world rehearsal only; never enabled by deploy scripts.
  var private_name_writer_intents : Map.Map<Text, PrivateNameWriterWindow.Intent>;
  transient let privateNameWriterGate = PrivateNameWriterWindow.Gate(Runtime.envVar<system>("IGNITE_PRIVATE_NAME_WRITER_REHEARSAL") == ?"1", accountAdmissionAuthority, private_name_writer_intents, 4096);
  include PrivateNameWriterEndpoints(privateNameWriterGate, Principal.fromActor(this));

  func admitAccount(subject : Principal) : async () {
    if (removalReceiver.denied(subject)) throw Error.reject("Account removal fenced");
    let eligible = await accountAdmission.eligible(subject);
    if (removalReceiver.denied(subject) or not eligible) throw Error.reject("Account admission denied or unavailable");
  };
  func denyLegacyAccountQuery() {
    if (accountAdmissionEnabled) Runtime.trap("Use protected consensus account read");
  };

  /// Public: remaining cycles (shown in admin settings).
  public query func cycles_balance() : async Nat { Cycles.balance() };
  public shared ({ caller }) func read_group_opening_configuration() : async [(Text, Text)] {
    if (not isGovernor(caller)) Runtime.trap("Governor required");
    [("club_domain", OpeningConfiguration.optional(clubDomainCanister)),
     ("notification_queue", OpeningConfiguration.optional(notificationQueueCanister)),
     ("competition_domain", OpeningConfiguration.optional(competitionDomainCanister))]
  };
  // Live memory reading for the admin health page (public, like cycles_balance).
  public query func memory_stats() : async { heap_bytes : Nat; memory_bytes : Nat; stable_bytes : Nat } {
    {
      heap_bytes = PrimMem.rts_heap_size();
      memory_bytes = PrimMem.rts_memory_size();
      stable_bytes = PrimMem.nat64ToNat(PrimMem.stableMemorySize()) * 65536;
    }
  };

  /// Public: aggregate record counts (shown in admin settings). Counts only —
  /// no record contents, so no PII is exposed.
  public query func usage_stats() : async { conversations : Nat; messages : Nat; scheduled_messages : Nat } {
    { conversations = conversations.size(); messages = messages.size(); scheduled_messages = scheduledMessages.size() };
  };

  var governor : Principal;
  var mediaEvidenceRevision : Nat;
  var transferFences : [Text];

  if (governor.equal(Principal.anonymous()) and not governorInit.equal(Principal.anonymous())) {
    governor := governorInit;
  };
  var roles : [Types.RoleGrant];
  var conversations : [Types.Conversation];
  var messages : [Types.Message];
  var receipts : [Types.Receipt];
  var unread : [Types.Unread];
  var bulkAccessPrincipals : [Principal];
  var groupMetadata : [Types.GroupMetadata];
  var defaultClubChats : Map.Map<Text, Text>;
  var clubMemberships : [Types.ClubMembership];
  var competitionAdmins : [Types.CompetitionAdmin];
  var dmAttachmentsDisabled : [Principal];
  var groupRoles : [Types.GroupRole];
  var joinRequests : [Types.JoinRequest];
  var polls : [Types.Poll];
  var pollVotes : [Types.PollVote];
  var mutePreferences : [Types.MutePreference];
  var dmLinks : [Types.DmLink];
  var forwardRecords : [Types.ForwardRecord];
  var scheduledMessages : [Types.ScheduledMessage];
  var attachmentMetadata : [Types.AttachmentMetadata];
  var reactions : [Types.Reaction];
  var clubDmSettings : [Types.ClubDmSettings];
  var userMessagingSettings : [Types.UserMessagingSettings];
  // See Types.RecapConfig: api_key is visible to node providers hosting this
  // canister; only a scoped/limited key should ever be stored here.
  var recapConfig : ?Types.RecapConfig;
  var presence : [Types.PresencePing];
  var blockedUsers : [Types.BlockedUser];
  var typingPings : [Types.TypingPing];
  var pinnedMessages : [Types.PinnedMessage];
  var contentReports : [Types.ContentReport];
  var groupJoinPolicies : [{ conversation_id : Text; join_policy : Text; category : ?Text }];
  // Cooldown log for run_chat_photo_gallery_reminders (admin "run now").
  var chatPhotoReminderLog : [Types.ChatPhotoReminderLog];
  var chatPhotoReminderSettings : PhotoReminderPolicy.Settings;
  transient var photoReminderSweepRunning = false;
  // Governor-set notification_queue canister id for the chat notify fan-out
  // hook. Fail-closed while unset: messages send fine, no chat notifications
  // are enqueued. See docs/icp-chat-notify-fanout-spec.md.
  var notificationQueueCanister : ?Principal;
  // Governor-set club_domain canister id for the permanent-delete fan-out.
  // Fail-closed while unset: delete_club_data/delete_team_data reject every
  // caller until the deploy script wires this.
  var clubDomainCanister : ?Principal;
  // Governor-set competition_domain canister id for the competition-admin inbox,
  // where the member thread participants are derived from the competition's
  // admin-role list rather than browser-supplied input.
  var competitionDomainCanister : ?Principal;
  var privateAdminThreads : [{ conversation : Text; competition : Text; member : Principal }];
  var vaultDomainCanister : ?Principal;

  // Global broadcast conversation id. Mirrors the Supabase broadcast_messages
  // feed: one platform-wide stream that every signed-in member can read, with
  // posting restricted to platform admins. The frontend reads and posts by
  // this fixed id, like it does for team/club chats.
  transient let BROADCAST_CONVERSATION_ID = "broadcast";

  // Club-admin room id is derived from the club id, so the frontend can read
  // and send by an id it already knows.
  func clubAdminConversationId(club_id : Text) : Text { "club-admin-" # club_id };

  // Competition-admin room id is derived from the competition id and the
  // participant principal, mirroring the club-admin thread pattern.
  func competitionAdminConversationId(competition_id : Text) : Text { "competition-admin-" # competition_id };
  func competitionAdminThreadId(competition_id : Text, member : Principal) : Text {
    competitionAdminConversationId(competition_id) # "-" # Principal.toText(member)
  };

  // Typed view of the club_domain queries this canister needs. Fail-closed
  // while the club_domain canister id is unset (set_club_domain_canister).
  type ClubDomainRef = actor {
    is_app_admin : shared query (Principal) -> async Bool;
    read_account_is_app_admin : shared (Principal) -> async Bool;
    list_club_admins : shared query (Text) -> async [Principal];
    is_user_on_any_team : shared query ([Text], Principal) -> async Bool;
  };

  type CompetitionDomainRef = actor {
    read_private_admin_thread_participants : shared (Principal, Text) -> async { #Ok : [Principal]; #Err : Text };
    list_competition_roles : shared (Text) -> async { #Ok : [{ user : Principal; role : Text; competition_id : Text; team_id : ?Text }]; #Err : Text };
    list_entries : shared query (Text) -> async { #Ok : [{ club_id : Text; competition_id : Text; division_id : ?Text; status : Text; team_id : Text }]; #Err : Text };
    is_competition_admin : shared query (Text) -> async Bool;
  };

  func clubDomainRef() : async ?ClubDomainRef {
    switch (clubDomainCanister) {
      case null { null };
      case (?cd) {
        let ref : ClubDomainRef = actor (Principal.toText(cd));
        ?ref
      };
    };
  };

  func competitionDomainRef() : async ?CompetitionDomainRef {
    switch (competitionDomainCanister) {
      case null { null };
      case (?cd) {
        let ref : CompetitionDomainRef = actor (Principal.toText(cd));
        ?ref
      };
    };
  };

  // ===================== On-chain LLM canister (chat recap) =====================
  // DFINITY's free, key-free LLM canister on mainnet. Inference runs on ICP
  // nodes — no HTTPS outcall, no API key. See
  // https://docs.internetcomputer.org/guides/backends/ai-inference/.
  // The wire shapes below mirror the `mo:llm` library's chat.mo exactly
  // (same variant tags / field names), so they interop with the real
  // canister without taking the mops dependency.
  transient let LLM_CANISTER_ID = "w36hm-eqaaa-aaaal-qr76a-cai";
  transient let LLM_MODEL = "llama3.1:8b";

  type LlmChatMessage = {
    #user : { content : Text };
    #system_ : { content : Text };
    #assistant : { content : ?Text; tool_calls : [LlmToolCall] };
    #tool : { content : Text; tool_call_id : Text };
  };
  type LlmToolCallArgument = { name : Text; value : Text };
  type LlmToolCall = { id : Text; function : { name : Text; arguments : [LlmToolCallArgument] } };
  type LlmRequest = { model : Text; messages : [LlmChatMessage]; tools : ?[{ #function : { name : Text; description : ?Text; parameters : ?{ type_ : Text; properties : ?[{ type_ : Text; name : Text; description : ?Text; enum_ : ?[Text] }]; required : ?[Text] } } }] };
  type LlmResponse = { message : { content : ?Text; tool_calls : [LlmToolCall] } };
  type LlmCanisterRef = actor { v1_chat : (LlmRequest) -> async LlmResponse };

  func llmCanister() : LlmCanisterRef { actor (LLM_CANISTER_ID) : LlmCanisterRef };

  // Per-caller recap rate limit (1 per 20s). Transient: abuse protection only,
  // resetting on upgrade is fine and avoids needing a migration for it.
  transient var lastRecapAtByCaller : [(Principal, Nat64)] = [];
  transient let RECAP_RATE_LIMIT_MS : Nat64 = 20_000;

  func checkAndMarkRecapRateLimit(caller : Principal) : Bool {
    let now = nowMs();
    switch (lastRecapAtByCaller.find(func((p, _) : (Principal, Nat64)) : Bool = p.equal(caller))) {
      case (?(_, last)) {
        if (now < last + RECAP_RATE_LIMIT_MS) return false;
        lastRecapAtByCaller := lastRecapAtByCaller.map<(Principal, Nat64), (Principal, Nat64)>(func(entry) = if (entry.0.equal(caller)) (entry.0, now) else entry);
      };
      case null {
        lastRecapAtByCaller := lastRecapAtByCaller.concat([(caller, now)]);
      };
    };
    true
  };

  // Shared recap instruction: concise bullet recap, action items, and open
  // questions — never invent facts not present in the transcript.
  transient let RECAP_SYSTEM_PROMPT = "You are summarising a club team group chat for a member who has been away. Read the transcript and reply ONLY with concise markdown bullet points covering: (1) a short recap of what happened, (2) any action items (who needs to do what), (3) any open questions. Use only information present in the transcript — never invent names, dates, or facts that are not there. If a section has nothing to report, omit it.";

  func runRecapCompletion(transcript : Text) : async { #Ok : Text; #Err : Text } {
    if (transcript == "") return #Err("No new messages to recap");
    let request : LlmRequest = {
      model = LLM_MODEL;
      messages = [
        #system_({ content = RECAP_SYSTEM_PROMPT }),
        #user({ content = transcript }),
      ];
      tools = null;
    };
    try {
      let response = await (with timeout = 300) llmCanister().v1_chat(request);
      switch (response.message.content) {
        case (?text) { if (text == "") #Err("Recap model returned an empty response") else #Ok(truncateText(text, 4000)) };
        case null { #Err("Recap model returned no content") };
      }
    } catch (e) {
      // Outcall-style failures (traps, cross-subnet timeouts) surface as
      // catchable errors — never trap the caller's request.
      #Err("Recap request failed: " # Error.message(e))
    }
  };

  // Platform -> minimum required version/build, set by the governor. Read by
  // the native force-update prompt (NativeAppUpdatePrompt parity with the
  // public-minimum-app-version edge function).
  var minimumAppVersions : [(Text, Text)];

  // Realtime poke channel (IC WebSocket). Session state only — transient by
  // design: a canister upgrade drops registrations and connected gateways /
  // clients simply reconnect. No message content ever crosses this channel,
  // only {conversation_id, sequence} pokes (see Types.WsAppMessage).
  transient let wsParams = IcWebSocketCdkTypes.WsInitParams(null, null);
  transient let wsState = IcWebSocketCdkState.IcWebSocketState(wsParams);
  transient let wsHandlers = IcWebSocketCdkTypes.WsHandlers(null, null, null);
  transient let ws = IcWebSocketCdk.IcWebSocket(wsState, wsParams, wsHandlers);
  ws.init<system>();

  public shared ({ caller }) func transfer_governorship(new_governor : Principal) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    auth(caller);
    if (not isGovernor(caller)) return #Err("Only governor can transfer governorship");
    if (new_governor.equal(Principal.anonymous())) return #Err("New governor cannot be anonymous");
    governor := new_governor;
    #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  func auth(caller : Principal) {
    if (caller.equal(Principal.anonymous())) Runtime.trap("Authenticated caller required");
  };

  func valid(value : Text) : Bool { value != "" and value.size() <= 128 };

  // Message bodies: same 4000-char cap as announcements (ids stay at 128).
  func validBody(value : Text) : Bool { value != "" and value.size() <= 4000 };

  func nowMs() : Nat64 { Nat.toNat64(Int.abs(Time.now()) / 1_000_000) };

  func validAttachment(attachment : Types.Attachment) : Bool {
    valid(attachment.kind) and valid(attachment.ref_id) and
    (switch (attachment.url) { case null { true }; case (?url) { url.size() <= 2048 } })
  };


  // ---- Club transfer fence + snapshot (governor-only operator tooling) ----
  // Hard checks on the main write paths; the ingress inspect gate is advisory.
  // The transfer runner re-digests before cutover to catch anything else.
  func isFenced(club : Text) : Bool = transferFences.any(func(c) = c == club);
  func convFenced(id : Text) : Bool = transferFences.size() > 0 and conversations.any(func(c) = c.id == id and isFenced(c.club_id));
  func msgFenced(id : Text) : Bool = transferFences.size() > 0 and messages.any(func(m) = m.id == id and convFenced(m.conversation_id));
  func teamFenced(id : Text) : Bool = transferFences.size() > 0 and conversations.any(func(c) = c.team_id == ?id and isFenced(c.club_id));
  func blobContainsText(hay : Blob, needle : Text) : Bool {
    let h = Blob.toArray(hay); let n = Blob.toArray(needle.encodeUtf8());
    if (n.size() == 0 or n.size() > h.size()) return false;
    var i = 0;
    while (i + n.size() <= h.size()) { var j = 0; while (j < n.size() and h[i + j] == n[j]) j += 1; if (j == n.size()) return true; i += 1 };
    false
  };
  system func inspect({ caller : Principal; arg : Blob }) : Bool {
    if (transferFences.size() == 0 or isGovernor(caller)) return true;
    not transferFences.any(func(c) = blobContainsText(arg, c))
  };
  public shared ({ caller }) func set_transfer_fence(club : Text, fenced : Bool) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not isGovernor(caller)) return #Err("Governor required");
    mediaEvidenceRevision += 1;
    transferFences := transferFences.filter(func(c) = c != club);
    mediaEvidenceRevision += 1;
    if (fenced) transferFences := transferFences.concat([club]);
    #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  // Polls and their votes travel on the first page (with conversations);
  // later pages carry messages only. Optional so pre-poll pages decode null.
  type ChatPage = { conversations : [Types.Conversation]; messages : [Types.Message]; polls : ?[Types.Poll]; poll_votes : ?[Types.PollVote]; next : ?Nat };
  // Paged: conversations are returned on the first page; messages in order.
  public query ({ caller }) func export_club_snapshot_page(club : Text, offset : Nat, limit : Nat) : async { #Ok : Blob; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before export");
    let convs = conversations.filter(func(c) = c.club_id == club);
    let msgs = messages.filter(func(m) = convs.any(func(c) = c.id == m.conversation_id));
    let clubPolls = polls.filter(func(p) = convs.any(func(c) = c.id == p.conversation_id));
    let cap = Nat.min(limit, 500); let end = Nat.min(offset + cap, msgs.size());
    let page : ChatPage = { conversations = if (offset == 0) convs else []; messages = if (offset >= msgs.size()) [] else msgs.sliceToArray(offset, end);
      polls = if (offset == 0) ?clubPolls else null;
      poll_votes = if (offset == 0) ?pollVotes.filter(func(v) = clubPolls.any(func(p) = p.id == v.poll_id)) else null;
      next = if (end < msgs.size()) ?end else null };
    #Ok(to_candid (page))
  };
  public shared ({ caller }) func import_club_snapshot_page(club : Text, page_blob : Blob) : async { #Ok : Nat; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not isGovernor(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before import");
    let decoded : ?ChatPage = from_candid (page_blob);
    let page = switch (decoded) { case (?x) x; case null return #Err("Invalid snapshot page") };
    if (page.conversations.any(func(c) = c.club_id != club)) return #Err("Snapshot contains foreign records");
    if (page.conversations.any(func(c) = conversations.any(func(x) = x.id == c.id and x.club_id != club))) return #Err("Snapshot id collides with another club");
    if (page.conversations.any(func(c) = c.participants.any(func(p) = removalReceiver.denied(p))) or
        page.messages.any(func(m) = removalReceiver.denied(m.sender))) return #Err("Snapshot contains removed identities");
    let staged = conversations.filter(func(c) = not page.conversations.any(func(y) = y.id == c.id)).concat(page.conversations);
    let known = func(id : Text) : Bool = staged.any(func(c) = c.id == id and c.club_id == club);
    if (page.messages.any(func(m) = not known(m.conversation_id))) return #Err("Message for unknown conversation");
    let incomingPolls = page.polls ?? [];
    let incomingVotes = page.poll_votes ?? [];
    if (incomingPolls.any(func(p) = not known(p.conversation_id))) return #Err("Poll for unknown conversation");
    if (incomingPolls.any(func(p) = removalReceiver.denied(p.creator)) or incomingVotes.any(func(v) = removalReceiver.denied(v.user))) return #Err("Snapshot contains removed identities");
    // Votes are authoritative per poll on the same page: every vote must
    // reference a poll carried here, within its option range, one per voter.
    if (incomingVotes.any(func(v) = not incomingPolls.any(func(p) = p.id == v.poll_id and Nat32.toNat(v.option_index) < p.options.size()))) return #Err("Vote for unknown poll or option");
    var seenVotes : [Text] = [];
    for (v in incomingVotes.values()) {
      let key = v.poll_id # "/" # Principal.toText(v.user);
      if (seenVotes.any(func(k) = k == key)) return #Err("Duplicate poll vote");
      seenVotes := seenVotes.concat([key]);
    };
    if (incomingPolls.any(func(p) = polls.any(func(x) = x.id == p.id and not known(x.conversation_id)))) return #Err("Poll id collides with another club");
    mediaEvidenceRevision += 1;
    conversations := staged;
    // Idempotent per message id: re-importing a page never duplicates.
    mediaEvidenceRevision += 1;
    messages := messages.filter(func(m) = not page.messages.any(func(y) = y.id == m.id)).concat(page.messages);
    polls := polls.filter(func(p) = not incomingPolls.any(func(y) = y.id == p.id)).concat(incomingPolls);
    pollVotes := pollVotes.filter(func(v) = not incomingPolls.any(func(p) = p.id == v.poll_id)).concat(incomingVotes);
    #Ok(page.messages.size())
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func purge_club_snapshot(club : Text) : async { #Ok : Nat; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not isGovernor(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before purge");
    let convs = conversations.filter(func(c) = c.club_id == club);
    let before = messages.size();
    mediaEvidenceRevision += 1;
    messages := messages.filter(func(m) = not convs.any(func(c) = c.id == m.conversation_id));
    mediaEvidenceRevision += 1;
    conversations := conversations.filter(func(c) = c.club_id != club);
    #Ok(before - messages.size())
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  func isGovernor(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and governor.equal(caller)
  };

  func hasBulkAccess(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and bulkAccessPrincipals.any(func(p) = p.equal(caller))
  };
  public shared ({ caller }) func grant_role(principal : Principal, role : Text, club_id : ?Text, team_id : ?Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (principal.equal(Principal.anonymous()) or not validRoleAssignment(role, club_id, team_id)) return #Err("Invalid role assignment");
    if (not roles.any(func(grant) = grant.user.equal(principal) and grant.role == role and grant.club_id == club_id and grant.team_id == team_id)) {
      roles := roles.concat([{ user = principal; role; club_id; team_id }]);
    };
    #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
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

  func findGroupMetadataIndex(conversation_id : Text) : ?Nat {
    var idx = 0;
    for (m in groupMetadata.values()) {
      if (m.conversation_id == conversation_id) { return ?idx };
      idx += 1;
    };
    null
  };

  func getGroupMetadataFor(conversation_id : Text) : ?Types.GroupMetadata {
    switch (findGroupMetadataIndex(conversation_id)) {
      case null { null };
      case (?i) { ?groupMetadata[i] };
    }
  };

  func isCompetitionAdminFor(caller : Principal, conversation_id : Text) : Bool {
    isGovernor(caller) or hasRole(caller, "app_admin", null, null) or
    competitionAdmins.any(func(a) = a.conversation_id == conversation_id and a.user.equal(caller))
  };

  func sharesClub(a : Principal, b : Principal) : Bool {
    let clubsOfA = clubMemberships.filter(func(m) = m.user.equal(a));
    clubsOfA.any(func(ma) = clubMemberships.any(func(mb) = mb.user.equal(b) and mb.club_id == ma.club_id))
  };

  // True when a has blocked b or b has blocked a.
  func isBlockedPair(a : Principal, b : Principal) : Bool {
    blockedUsers.any(func(entry) =
      (entry.blocker.equal(a) and entry.blocked.equal(b)) or
      (entry.blocker.equal(b) and entry.blocked.equal(a))
    )
  };

  func inferConversationKind(conversation : Types.Conversation) : Text {
    switch (getGroupMetadataFor(conversation.id)) {
      case (?meta) { meta.kind };
      case null {
        switch (conversation.team_id) {
          case (?_) { "team" };
          case null { if (conversation.participants.size() <= 2) "direct" else "group" };
        }
      };
    }
  };

  func canAccessConversation(caller : Principal, conversation_id : Text) : Bool {
    // The platform broadcast feed is open-read for every signed-in member
    // (mirrors the Supabase broadcast_messages read policy); posting to it is
    // gated separately, in send_message.
    if (conversation_id == BROADCAST_CONVERSATION_ID and not caller.equal(Principal.anonymous())) return true;
    for (item in conversations.values()) {
      if (item.id == conversation_id) {
        return item.participants.any(func(p) = p.equal(caller));
      };
    };
    false
  };

  func canReadTeamMessages(caller : Principal, conversation_id : Text) : Bool {
    if (caller.equal(Principal.anonymous())) return false;
    // Platform broadcast feed: readable by every signed-in member.
    if (conversation_id == BROADCAST_CONVERSATION_ID) return true;

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


  // Stored chat participants locate access; current club authority must also admit
  // the original human. Real DMs and competition audiences are separate scopes.
  func requiresClubMembership(c : Types.Conversation) : Bool {
    if (c.club_id == "dm" or c.id == BROADCAST_CONVERSATION_ID) return false;
    switch (getGroupMetadataFor(c.id)) {
      case (?m) { m.kind != "competition" and m.kind != "competition_admin" };
      case null { true };
    }
  };

  func requireChatClubMember(subject : Principal, club : Text) : async* () {
    if (isGovernor(subject)) return;
    auth(subject);
    let configured = clubDomainCanister;
    let ?cd = configured else throw Error.reject("Club chat authority unavailable");
    let authority : actor { read_has_club_membership : shared (Principal, Text) -> async Bool } = actor(cd.toText());
    let member = await (with timeout = 10) authority.read_has_club_membership(subject, club);
    if (removalReceiver.denied(subject) or configured != clubDomainCanister or isFenced(club)) throw Error.reject("Club chat authorization changed");
    if (not member) throw Error.reject("Club chat access forbidden");
  };

  func requireChatAccess(subject : Principal, conversation_id : Text) : async* () {
    if (removalReceiver.denied(subject)) throw Error.reject("Account removal fenced");
    let captured = conversations.find(func(c) = c.id == conversation_id);
    switch (captured) {
      case null {};
      case (?c) {
        if (requiresClubMembership(c)) {
          await* requireChatClubMember(subject, c.club_id);
          let fresh = conversations.find(func(item) = item.id == conversation_id);
          switch (fresh) {
            case (?current) {
              if (current.club_id != c.club_id or current.team_id != c.team_id or not requiresClubMembership(current))
                throw Error.reject("Conversation authorization changed");
            };
            case null { throw Error.reject("Conversation no longer exists") };
          };
        };
      };
    };
  };

  func requireMessageChatAccess(subject : Principal, message_id : Text) : async* () {
    switch (messages.find(func(m) = m.id == message_id)) {
      case (?m) { await* requireChatAccess(subject, m.conversation_id) };
      case null {};
    };
  };

  func requirePollChatAccess(subject : Principal, poll_id : Text) : async* () {
    switch (polls.find(func(p) = p.id == poll_id)) {
      case (?p) { await* requireChatAccess(subject, p.conversation_id) };
      case null {};
    };
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
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (club_id != "dm") { await* requireChatClubMember(caller, club_id) };
    if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
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
    mediaEvidenceRevision += 1;
    conversations := conversations.concat([conversation]);
    #Ok(conversation)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Find-or-create the canonical club/team chat conversation. The id is
  // deterministic — team id for team chats, club id for the club chat — so
  // the frontend can poll and send by the id it already knows. Only the
  // governor or the configured club_domain canister may provision these:
  // club_domain verifies membership against its authoritative role store
  // before fanning out, so an end user can never self-join a chat here.
  // Existing conversations merge any missing participants (new members).
  public shared ({ caller }) func ensure_conversation(club_id : Text, team_id : ?Text, participants : [Principal]) : async { #Ok : Types.Conversation; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isGovernor(caller)) {
      switch (clubDomainCanister) {
        case (?cd) { if (not caller.equal(cd)) return #Err("Club domain only") };
        case null { return #Err("Club domain not configured") };
      };
    };
    if (not valid(club_id) or participants.size() == 0) return #Err("Invalid conversation participants");
    if (participants.any(func(p) = p.equal(Principal.anonymous()))) return #Err("Invalid conversation participants");
    let conversationId = switch (team_id) {
      case (?t) { if (not valid(t)) return #Err("Invalid conversation participants"); t };
      case null { club_id };
    };
    switch (findConversationIndex(conversationId)) {
      case (?i) {
        let conv = conversations[i];
        var merged = conv.participants;
        for (p in participants.values()) {
          if (not merged.any(func(existing) = existing.equal(p))) {
            merged := merged.concat([p]);
          };
        };
        let updated : Types.Conversation = { conv with participants = merged };
        mediaEvidenceRevision += 1;
        conversations := Array.tabulate<Types.Conversation>(conversations.size(), func(pos) = if (pos == i) { updated } else { conversations[pos] });
        #Ok(updated)
      };
      case null {
        let conversation : Types.Conversation = { id = conversationId; club_id; team_id; participants; next_sequence = 1 };
        mediaEvidenceRevision += 1;
        conversations := conversations.concat([conversation]);
        #Ok(conversation)
      };
    }
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== Platform broadcast feed & club-admin rooms =====================

  // Find-or-create the global broadcast conversation. Any signed-in member may
  // call it: it provisions nothing privileged and grants no membership — reads
  // are open to every authenticated caller (canAccessConversation), and posting
  // is gated in send_message against club_domain's app_admin grant.
  public shared ({ caller }) func ensure_broadcast_conversation() : async { #Ok : Types.Conversation; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (findConversationIndex(BROADCAST_CONVERSATION_ID)) {
      case (?i) { #Ok(conversations[i]) };
      case null {
        let conversation : Types.Conversation = {
          id = BROADCAST_CONVERSATION_ID;
          club_id = "broadcast";
          team_id = null;
          participants = [];
          next_sequence = 1;
        };
        mediaEvidenceRevision += 1;
        conversations := conversations.concat([conversation]);
        let meta : Types.GroupMetadata = {
          conversation_id = BROADCAST_CONVERSATION_ID;
          name = "Broadcast";
          kind = "broadcast";
          club_id = null;
          team_id = null;
          members = [];
          created_at_ms = nowMs();
          avatar = null;
          description = null;
          deleted = false;
          // Posting is enforced against club_domain's app_admin grant in
          // send_message, not through this canister's own group-admin store.
          admin_only_posting = false;
          deleted_at_ms = null;
          deleted_by = null;
        };
        groupMetadata := groupMetadata.concat([meta]);
        #Ok(conversation)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== Club-admin threads =====================
  // Mirrors Supabase club_admin_conversations: one thread per club member,
  // answered by that club's admins. The thread id is derived from the club and
  // the member, so both sides address it without a lookup, and membership is
  // re-read from club_domain on every open: a newly promoted admin joins the
  // thread, a removed admin leaves it.

  func clubAdminThreadId(club_id : Text, member : Principal) : Text {
    clubAdminConversationId(club_id) # "-" # Principal.toText(member)
  };

  // Find-or-create (and re-sync) one member's thread with their club's admins.
  // The caller must be that member or one of the club's admins, so nobody can
  // open a thread they belong to.
  public shared ({ caller }) func ensure_club_admin_thread(club_id : Text, member : Principal) : async { #Ok : Types.Conversation; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatClubMember(caller, club_id);
    if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not valid(club_id)) return #Err("Invalid club");
    let clubDomain = await clubDomainRef();
    switch (clubDomain) {
      case null { return #Err("club_domain canister not configured") };
      case (?cd) {
        let configured = clubDomainCanister;
        let admins = await cd.list_club_admins(club_id);
        await admitAccount(caller);
        if (configured != clubDomainCanister or isFenced(club_id)) throw Error.reject("Club authorization changed");
        let isMember = caller.equal(member);
        let isAdmin = admins.any(func(p) = p.equal(caller));
        if (not isMember and not isAdmin and not isGovernor(caller)) return #Err("Not permitted");
        // The member is always participants[0] — the admin inbox reads the
        // thread owner from there, so keep that order stable.
        let participants = Array.tabulate<Principal>(admins.size() + 1, func(i) { if (i == 0) { member } else { admins[i - 1] } });
        let conversationId = clubAdminThreadId(club_id, member);
        switch (findConversationIndex(conversationId)) {
          case (?i) {
            let updated : Types.Conversation = { conversations[i] with participants };
            mediaEvidenceRevision += 1;
            conversations := Array.tabulate<Types.Conversation>(conversations.size(), func(pos) = if (pos == i) { updated } else { conversations[pos] });
            #Ok(updated)
          };
          case null {
            let conversation : Types.Conversation = {
              id = conversationId;
              club_id;
              team_id = null;
              participants;
              next_sequence = 1;
            };
            mediaEvidenceRevision += 1;
            conversations := conversations.concat([conversation]);
            let meta : Types.GroupMetadata = {
              conversation_id = conversationId;
              name = "Club admins";
              kind = "club_admin";
              club_id = ?club_id;
              team_id = null;
              members = participants;
              created_at_ms = nowMs();
              avatar = null;
              description = null;
              deleted = false;
              admin_only_posting = false;
              deleted_at_ms = null;
              deleted_by = null;
            };
            groupMetadata := groupMetadata.concat([meta]);
            #Ok(conversation)
          };
        };
      };
    };
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // The club's admin inbox: every member thread in the club, each paired with
  // its owner (participants[0], the invariant ensure_club_admin_thread keeps).
  // Only that club's admins (or the governor) get the list; everyone else
  // receives an empty one.
  public shared ({ caller }) func list_club_admin_threads(club_id : Text) : async [{ id : Text; member : Principal }] {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    await admitAccount(caller);
    auth(caller);
    if (not valid(club_id)) return [];
    let clubDomain = await clubDomainRef();
    switch (clubDomain) {
      case null { [] };
      case (?cd) {
        let configured = clubDomainCanister;
        let admins = await cd.list_club_admins(club_id);
        await admitAccount(caller);
        if (configured != clubDomainCanister or isFenced(club_id)) Runtime.trap("Club authorization changed");
        if (not admins.any(func(p) = p.equal(caller)) and not isGovernor(caller)) return [];
        let prefix = clubAdminConversationId(club_id) # "-";
        var out : [{ id : Text; member : Principal }] = [];
        for (c in conversations.values()) {
          if (Text.startsWith(c.id, #text prefix) and c.participants.size() > 0) {
            out := out.concat([{ id = c.id; member = c.participants[0] }]);
          };
        };
        out
      };
    };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // A competition member's inbox to the competition admins. Only the member
  // themselves, the current admin set for the competition, or the governor can
  // create/list these threads; the admin set is re-read from competition_domain
  // on every open so role changes take effect without browser-supplied lists.
  public shared ({ caller }) func ensure_competition_admin_thread(competition_id : Text, member : Principal) : async { #Ok : Types.Conversation; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not valid(competition_id) or member.equal(Principal.anonymous())) return #Err("Invalid competition");
    if (not caller.equal(member)) return #Err("Only the thread member can open their conversation");
    let competitionDomain = await competitionDomainRef();
    switch (competitionDomain) {
      case null { return #Err("competition_domain canister not configured") };
      case (?cd) {
        let rehearsal = Runtime.envVar<system>("IGNITE_PRIVATE_PROFILE_READS_REHEARSAL") == ?"1";
        let verifiedAdmins = if (rehearsal) switch (await cd.read_private_admin_thread_participants(caller, competition_id)) { case (#Ok(r)) r; case (#Err(e)) return #Err(e) } else [];
        let roles = if (rehearsal) [] else switch (await cd.list_competition_roles(competition_id)) { case (#Ok(r)) r; case (#Err(e)) return #Err(e) };
        let adminPrincipals = roles
          .filter(func(grant) = grant.role == "competition_admin" or grant.role == "admin" or grant.role == "owner")
          .map(func(grant) = grant.user).concat(verifiedAdmins);
        let isAdmin = adminPrincipals.any(func(p) = p.equal(caller));
        var isMember = rehearsal or roles.any(func(grant) = grant.user.equal(caller));
        if (not isMember and not isAdmin and not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) {
          let clubDomain = await clubDomainRef();
          let club = switch (clubDomain) {
            case null { return #Err("club_domain canister not configured") };
            case (?value) value;
          };
          let entries = switch (await cd.list_entries(competition_id)) {
            case (#Err(message)) { return #Err(message) };
            case (#Ok(value)) value;
          };
          if (entries.size() > 500) return #Err("Competition has too many entries to verify membership");
          let teamIds = entries
            .filter(func(entry) = entry.status == "accepted" or entry.status == "registered")
            .map(func(entry) = entry.team_id);
          isMember := try {
            await club.is_user_on_any_team(teamIds, caller)
          } catch (_) {
            false
          };
        };
        if (not isMember and not isAdmin and not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return #Err("Competition membership required");
    if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced");
        var participants : [Principal] = [member];
        for (p in adminPrincipals.values()) {
          if (not participants.any(func(exist) = exist.equal(p))) {
            participants := participants.concat([p]);
          };
        };
        let conversationId = competitionAdminThreadId(competition_id, member);
        // Authoritative mapping is created only by the existing admitted
        // thread-opening operation, never parsed from a browser chat ID.
        switch (privateAdminThreads.find(func t = t.conversation == conversationId)) {
          case (?t) { if (t.competition != competition_id or t.member != member) return #Err("Admin thread binding mismatch") };
          case null { privateAdminThreads := privateAdminThreads.concat([{ conversation = conversationId; competition = competition_id; member }]) };
        };
        switch (findConversationIndex(conversationId)) {
          case (?i) {
            let updated : Types.Conversation = { conversations[i] with participants };
            mediaEvidenceRevision += 1;
            conversations := Array.tabulate<Types.Conversation>(conversations.size(), func(pos) = if (pos == i) { updated } else { conversations[pos] });
            #Ok(updated)
          };
          case null {
            let conversation : Types.Conversation = {
              id = conversationId;
              club_id = "competition-" # competition_id;
              team_id = null;
              participants;
              next_sequence = 1;
            };
            mediaEvidenceRevision += 1;
            conversations := conversations.concat([conversation]);
            let meta : Types.GroupMetadata = {
              conversation_id = conversationId;
              name = "Competition admins";
              kind = "competition_admin";
              club_id = null;
              team_id = null;
              members = participants;
              created_at_ms = nowMs();
              avatar = null;
              description = null;
              deleted = false;
              admin_only_posting = false;
              deleted_at_ms = null;
              deleted_by = null;
            };
            groupMetadata := groupMetadata.concat([meta]);
            #Ok(conversation)
          };
        };
      };
    };
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func list_competition_admin_threads(competition_id : Text) : async [{ id : Text; member : Principal }] {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    await admitAccount(caller);
    auth(caller);
    if (not valid(competition_id)) return [];
    let competitionDomain = await competitionDomainRef();
    switch (competitionDomain) {
      case null { [] };
      case (?cd) {
        let rehearsal = Runtime.envVar<system>("IGNITE_PRIVATE_PROFILE_READS_REHEARSAL") == ?"1";
        let verifiedAdmins = if (rehearsal) switch (await cd.read_private_admin_thread_participants(caller, competition_id)) { case (#Ok(r)) r; case (#Err(_)) return [] } else [];
        let roles = if (rehearsal) [] else switch (await cd.list_competition_roles(competition_id)) { case (#Ok(r)) r; case (#Err(_)) return [] };
        let adminPrincipals = roles
          .filter(func(grant) = grant.role == "competition_admin" or grant.role == "admin" or grant.role == "owner")
          .map(func(grant) = grant.user).concat(verifiedAdmins);
        if (not adminPrincipals.any(func(p) = p.equal(caller)) and not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return [];
    if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced");
        let prefix = competitionAdminConversationId(competition_id) # "-";
        var out : [{ id : Text; member : Principal }] = [];
        for (c in conversations.values()) {
          if (Text.startsWith(c.id, #text prefix) and c.participants.size() > 0) {
            out := out.concat([{ id = c.id; member = c.participants[0] }]);
          };
        };
        out
      };
    };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  func findConversationIndex(conversation_id : Text) : ?Nat {
    var idx = 0;
    for (c in conversations.values()) {
      if (c.id == conversation_id) { return ?idx };
      idx += 1;
    };
    null
  };

  func postMessage(convIndex : Nat, sender : Principal, body : Text, idempotency_key : Text, attachment : ?Types.Attachment, reply_to_id : ?Text) : Types.Message {
    if (removalReceiver.denied(sender)) Runtime.trap("Account removal fenced");
    let conv = conversations[convIndex];
    let seq = conv.next_sequence;
    let msg : Types.Message = {
      conversation_id = conv.id;
      id = "msg-" # conv.id # "-" # Nat64.toText(seq);
      sender;
      body;
      sequence = seq;
      idempotency_key;
      edited_at_ms = null;
      attachment;
      created_at_ms = nowMs();
      reply_to_id;
    };
    let updated_conv : Types.Conversation = { conv with next_sequence = seq + 1 };
    mediaEvidenceRevision += 1;
    conversations := Array.tabulate<Types.Conversation>(conversations.size(), func(position) {
      if (position == convIndex) updated_conv else conversations[position]
    });
    mediaEvidenceRevision += 1;
    messages := messages.concat([msg]);
    for (participant in conv.participants.values()) {
      if (not participant.equal(sender)) {
        let current_u = unreadFor(participant, conv.id);
        let updated_u : Types.Unread = { current_u with count = current_u.count + 1 };
        unread := unread.filter(func(u) = not (u.user.equal(participant) and u.conversation_id == conv.id));
        unread := unread.concat([updated_u]);
      };
    };
    msg
  };

  // ===================== Chat notification fan-out =====================
  // After a message is persisted, expand the recipient set canister-side
  // (conversation/group membership minus sender, minus blocked pairs) and
  // push it to notification_queue together with the mute list — the browser
  // has no legitimate access to other members' mute state, so the expansion
  // must happen here. Fire-and-forget: the send response never waits on the
  // notify leg and a failure is swallowed; notification_queue dedupes by
  // message_id, so a retry or duplicate hook call is safe.

  public shared ({ caller }) func set_notification_queue_canister(id : Principal) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (id.equal(Principal.anonymous())) return #Err("Invalid canister id");
    notificationQueueCanister := ?id;
    #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ---- club_domain permanent-delete fan-out ----
  public shared ({ caller }) func set_club_domain_canister(id : Principal) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (id.equal(Principal.anonymous())) return #Err("Invalid canister id");
    clubDomainCanister := ?id;
    #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func set_competition_domain_canister(id : Principal) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (id.equal(Principal.anonymous())) return #Err("Invalid canister id");
    competitionDomainCanister := ?id;
    #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Removes every conversation in scope plus all conversation-keyed state
  // (messages, receipts, polls, attachments, reactions, pins, joins, mutes,
  // scheduled sends, forwards, group roles/metadata). `club` additionally
  // clears club-keyed state (memberships, DM settings). Returns the number
  // of conversations removed. Per-user state (blocks, presence, personal
  // settings) and global config are deliberately kept.
  func purgeConversations(isDoomed : (Types.Conversation) -> Bool, club : ?Text) : Nat32 {
    let doomedIds = conversations.filter(isDoomed).map(func(c) = c.id);
    func inDoomed(conversationId : Text) : Bool { doomedIds.any(func(d) = d == conversationId) };
    func inClub(value : Text) : Bool { switch (club) { case (?c) { value == c }; case null { false } } };
    let doomedMessageIds = messages.filter(func(m) = inDoomed(m.conversation_id)).map(func(m) = m.id);
    func isDoomedMessage(messageId : Text) : Bool { doomedMessageIds.any(func(d) = d == messageId) };
    let doomedPollIds = polls.filter(func(p) = inDoomed(p.conversation_id)).map(func(p) = p.id);
    func isDoomedPoll(pollId : Text) : Bool { doomedPollIds.any(func(d) = d == pollId) };
    mediaEvidenceRevision += 1;
    conversations := conversations.filter(func(c) = not inDoomed(c.id));
    privateAdminThreads := privateAdminThreads.filter(func t = not inDoomed(t.conversation));
    mediaEvidenceRevision += 1;
    messages := messages.filter(func(m) = not inDoomed(m.conversation_id));
    receipts := receipts.filter(func(r) = not inDoomed(r.conversation_id));
    unread := unread.filter(func(u) = not inDoomed(u.conversation_id));
    groupMetadata := groupMetadata.filter(func(g) = not inDoomed(g.conversation_id) and (switch (g.club_id) { case (?c) { not inClub(c) }; case null { true } }));
    clubMemberships := clubMemberships.filter(func(m) = not inClub(m.club_id));
    competitionAdmins := competitionAdmins.filter(func(a) = not inDoomed(a.conversation_id));
    groupRoles := groupRoles.filter(func(r) = not inDoomed(r.conversation_id));
    joinRequests := joinRequests.filter(func(r) = not inDoomed(r.conversation_id));
    polls := polls.filter(func(p) = not inDoomed(p.conversation_id));
    pollVotes := pollVotes.filter(func(v) = not isDoomedPoll(v.poll_id));
    mutePreferences := mutePreferences.filter(func(m) = not inDoomed(m.conversation_id));
    dmLinks := dmLinks.filter(func(l) = not inDoomed(l.conversation_id));
    forwardRecords := forwardRecords.filter(func(f) = not inDoomed(f.to_conversation_id) and not inDoomed(f.from_conversation_id));
    mediaEvidenceRevision += 1;
    scheduledMessages := scheduledMessages.filter(func(s) = not inDoomed(s.conversation_id));
    mediaEvidenceRevision += 1;
    attachmentMetadata := attachmentMetadata.filter(func(a) = not inDoomed(a.conversation_id));
    reactions := reactions.filter(func(r) = not isDoomedMessage(r.message_id));
    clubDmSettings := clubDmSettings.filter(func(s) = not inClub(s.club_id));
    typingPings := typingPings.filter(func(t) = not inDoomed(t.conversation_id));
    pinnedMessages := pinnedMessages.filter(func(p) = not inDoomed(p.conversation_id));
    Nat.toNat32(doomedIds.size())
  };

  // Called by club_domain when a club is permanently deleted (manually or
  // by the 30-day auto-purge). Only the configured club_domain canister may
  // call; fail-closed while unset.
  public shared ({ caller }) func delete_club_data(club_id : Text) : async { #Ok : Nat32; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    switch (clubDomainCanister) {
      case null { return #Err("club_domain canister not configured") };
      case (?c) { if (not c.equal(caller)) return #Err("club_domain only") };
    };
    #Ok(purgeConversations(func(c) = c.club_id == club_id, ?club_id))
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Called by club_domain when a single team is permanently deleted.
  public shared ({ caller }) func delete_team_data(team_id : Text) : async { #Ok : Nat32; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    switch (clubDomainCanister) {
      case null { return #Err("club_domain canister not configured") };
      case (?c) { if (not c.equal(caller)) return #Err("club_domain only") };
    };
    #Ok(purgeConversations(func(c) = c.team_id == ?team_id, null))
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== Chat photo gallery reminder sweep =====================
  // On-chain counterpart of the Supabase chat-photo-gallery-reminders edge
  // function / AdminChatPhotoRemindersPage "Run now" button. Scans team chat
  // messages with an image/photo attachment whose age falls in
  // [window_end_hours, window_start_hours] ago, skips an (team, author) pair
  // still inside its cooldown, and nudges the uploader through
  // notification_queue.fan_out. App-admin gated (governor or club_domain's
  // app_admin grant), matching this canister's existing admin pattern (see
  // isGovernor / clubDomainRef / is_app_admin above).
  func isPhotoAttachment(attachment : ?Types.Attachment) : Bool {
    switch (attachment) {
      case (?a) { a.kind == "image" or a.kind == "photo" };
      case null { false };
    }
  };

  func lastRemindedMs(team_id : Text, author : Principal) : ?Nat64 {
    for (entry in chatPhotoReminderLog.values()) {
      if (entry.team_id == team_id and entry.author.equal(author)) { return ?entry.last_reminded_ms };
    };
    null
  };

  func recordReminded(team_id : Text, author : Principal, now_ms : Nat64) {
    var found = false;
    chatPhotoReminderLog := chatPhotoReminderLog.map(func(entry : Types.ChatPhotoReminderLog) : Types.ChatPhotoReminderLog {
      if (entry.team_id == team_id and entry.author.equal(author)) { found := true; { entry with last_reminded_ms = now_ms } } else { entry }
    });
    if (not found) {
      chatPhotoReminderLog := chatPhotoReminderLog.concat([{ team_id; author; last_reminded_ms = now_ms }]);
    };
  };

  public shared ({ caller }) func run_chat_photo_gallery_reminders(
    now_ms : Nat64,
    window_start_hours : Nat32,
    window_end_hours : Nat32,
    cooldown_days : Nat32,
  ) : async Types.ChatPhotoReminderResult {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isGovernor(caller)) {
      let clubDomain = await clubDomainRef();
      switch (clubDomain) {
        case null { return #Err("club_domain canister not configured") };
        case (?cd) { if (not (if (accountAdmissionEnabled) await cd.read_account_is_app_admin(caller) else await cd.is_app_admin(caller))) { return #Err("App admin required") } };
      };
    };
    if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced");
    let settings : PhotoReminderPolicy.Settings = { enabled = true; window_start_hours; window_end_hours; cooldown_days };
    if (not PhotoReminderPolicy.valid(settings)) return #Err("Invalid reminder window or cooldown");
    // Browser clocks cannot advance the persistent cooldown or manufacture eligibility.
    ignore now_ms;
    await sweepChatPhotoReminders(nowMs(), settings)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func set_chat_photo_reminder_settings(settings : PhotoReminderPolicy.Settings) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isGovernor(caller)) {
      switch (await clubDomainRef()) {
        case null { return #Err("club_domain canister not configured") };
        case (?cd) {
          let allowed = try { if (accountAdmissionEnabled) await cd.read_account_is_app_admin(caller) else await cd.is_app_admin(caller) } catch (_) { false };
          if (not allowed) return #Err("App admin required");
        };
      };
    };
    if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced");
    if (not PhotoReminderPolicy.valid(settings)) return #Err("Invalid reminder window or cooldown");
    chatPhotoReminderSettings := settings;
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func get_chat_photo_reminder_settings() : async { #Ok : PhotoReminderPolicy.Settings; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isGovernor(caller)) {
      switch (await clubDomainRef()) {
        case null { return #Err("club_domain canister not configured") };
        case (?cd) {
          let allowed = try { if (accountAdmissionEnabled) await cd.read_account_is_app_admin(caller) else await cd.is_app_admin(caller) } catch (_) { false };
          if (not allowed) return #Err("App admin required");
        };
      };
    };
    if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced");
    #Ok(chatPhotoReminderSettings)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  func sweepChatPhotoReminders(now_ms : Nat64, settings : PhotoReminderPolicy.Settings) : async Types.ChatPhotoReminderResult {
    if (photoReminderSweepRunning) return #Err("Reminder sweep already running");
    if (not settings.enabled) return #Ok({ scanned = 0; posted = 0; skipped = 0 });
    photoReminderSweepRunning := true;
    try {
    let window_start_hours = settings.window_start_hours;
    let window_end_hours = settings.window_end_hours;
    let cooldown_days = settings.cooldown_days;
    let startDeltaMs = Nat64.fromNat(Nat32.toNat(window_start_hours)) * 3_600_000;
    let endDeltaMs = Nat64.fromNat(Nat32.toNat(window_end_hours)) * 3_600_000;
    let newestEligibleMs : Nat64 = if (now_ms > startDeltaMs) { now_ms - startDeltaMs } else { 0 };
    let oldestEligibleMs : Nat64 = if (now_ms > endDeltaMs) { now_ms - endDeltaMs } else { 0 };
    let cooldownMs = Nat64.fromNat(Nat32.toNat(cooldown_days)) * 86_400_000;
    var scanned : Nat32 = 0;
    var posted : Nat32 = 0;
    var skipped : Nat32 = 0;
    let queueRef : ?(actor { fan_out : shared ([Text], Text, Text, Text, Text, ?Text) -> async { #Ok : Nat16; #Err : Text } }) = switch (notificationQueueCanister) {
      case (?nq) { ?(actor (Principal.toText(nq))) };
      case null { null };
    };
    for (msg in messages.values()) {
      if (isPhotoAttachment(msg.attachment) and msg.created_at_ms >= oldestEligibleMs and msg.created_at_ms <= newestEligibleMs and removalReceiver.enter(msg.sender)) {
        try {
        var teamId : ?Text = null;
        var clubId : ?Text = null;
        for (c in conversations.values()) {
          if (c.id == msg.conversation_id) { teamId := c.team_id; clubId := ?c.club_id };
        };
        switch (teamId) {
          case null {}; // only team chats are in scope
          case (?team) {
            scanned += 1;
            let onCooldown = switch (lastRemindedMs(team, msg.sender)) {
              case (?last) { now_ms < last + cooldownMs };
              case null { false };
            };
            if (onCooldown) {
              skipped += 1;
            } else {
              switch (queueRef, clubId) {
                case (?queue, ?club) {
                  try {
                    let result = await queue.fan_out(
                      [Principal.toText(msg.sender)],
                      club,
                      "media_chat_photo_reminder",
                      "You shared a photo in team chat — add it to the team gallery so everyone can see it.",
                      "chat-photo-reminder-" # msg.id,
                      ?team,
                    );
                    switch (result) {
                      case (#Ok(count)) {
                        posted += Nat32.fromNat(Nat16.toNat(count));
                        if (count > 0 and not removalReceiver.denied(msg.sender)) recordReminded(team, msg.sender, now_ms) else skipped += 1;
                      };
                      case (#Err(_)) { skipped += 1 };
                    };
                  } catch (_) { skipped += 1 };
                };
                case (_, _) { skipped += 1 };
              };
            };
          };
        };
        } finally { removalReceiver.leave(msg.sender) };
      };
    };
    #Ok({ scanned; posted; skipped });
    } finally { photoReminderSweepRunning := false };
  };

  transient let _photoReminderTimer = Timer.recurringTimer<system>(#seconds(3600), func() : async () {
    if (chatPhotoReminderSettings.enabled and Runtime.envVar<system>("IGNITE_PRIVATE_NAME_WRITER_REHEARSAL") != ?"1") {
      ignore await sweepChatPhotoReminders(nowMs(), chatPhotoReminderSettings);
    };
  });

  func chatNotifyPreview(body : Text, attachment : ?Types.Attachment) : Text {
    if (body == "") {
      switch (attachment) {
        case (?a) { if (a.kind == "image" or a.kind == "photo") { "Photo" } else { "File" } };
        case null { "" };
      }
    } else {
      var preview = "";
      var count = 0;
      label chars for (c in body.chars()) {
        if (count >= 140) { break chars };
        preview := preview # Char.toText(c);
        count += 1;
      };
      preview
    }
  };

  func fanOutChatNotify(msg : Types.Message) : async () {
    if (not removalReceiver.enter(msg.sender)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    switch (notificationQueueCanister) {
      case null {};
      case (?nq) {
        var conv : ?Types.Conversation = null;
        for (c in conversations.values()) { if (c.id == msg.conversation_id) { conv := ?c } };
        switch (conv) {
          case null {};
          case (?conversation) {
            let members = switch (getGroupMetadataFor(conversation.id)) {
              case (?meta) { if (meta.members.size() > 0) { meta.members } else { conversation.participants } };
              case null { conversation.participants };
            };
            var recipients : [Text] = [];
            var muted : [Text] = [];
            for (p in members.values()) {
              // notification_queue caps batches at 500 recipients.
              if (recipients.size() < 500 and not p.equal(msg.sender) and not isBlockedPair(msg.sender, p)) {
                let recipient = Principal.toText(p);
                recipients := recipients.concat([recipient]);
                if (mutePreferences.any(func(m) = m.user.equal(p) and m.conversation_id == conversation.id and m.muted)) {
                  muted := muted.concat([recipient]);
                };
              };
            };
            let queue : actor {
              record_chat_notify_batch : shared (Text, Text, Text, Text, [Text], [Text]) -> async { #Ok : Nat16; #Err : Text };
            } = actor (Principal.toText(nq));
            try {
              ignore await queue.record_chat_notify_batch(msg.id, conversation.id, Principal.toText(msg.sender), chatNotifyPreview(msg.body, msg.attachment), recipients, muted);
            } catch (_) {};
          };
        };
      };
    };
  
    } finally { removalReceiver.leave(msg.sender) };
  };

  // Realtime poke fan-out: hands each chat member (including the sender —
  // their other devices need it too) a tiny {conversation_id, sequence} poke
  // via the WS channel. Never carries message content; clients refetch
  // through the normal certified query path. Fire-and-forget and fully
  // fail-open: with no gateway connected every send is a no-op and chat
  // works exactly as before (adaptive polling).
  func fanOutWsPoke(conversation_id : Text, sequence : Nat64) : async () {
    var conv : ?Types.Conversation = null;
    for (c in conversations.values()) { if (c.id == conversation_id) { conv := ?c } };
    switch (conv) {
      case null {};
      case (?conversation) {
        let members = switch (getGroupMetadataFor(conversation.id)) {
          case (?meta) { if (meta.members.size() > 0) { meta.members } else { conversation.participants } };
          case null { conversation.participants };
        };
        let bytes = to_candid (#chat_poke({ conversation_id; sequence }) : Types.WsAppMessage);
        var sent = 0;
        label send for (p in members.values()) {
          // Same 500-recipient cap as the notification fan-out.
          if (sent >= 500) { break send };
          sent += 1;
          try { ignore await ws.send(p, bytes) } catch (_) {};
        };
      };
    };
  };

  func fanOutWsPokeForMessage(msg : Types.Message) : async () {
    if (not removalReceiver.enter(msg.sender)) return;
    try { await fanOutWsPoke(msg.conversation_id, msg.sequence) }
    finally { removalReceiver.leave(msg.sender) };
  };

  // Reactions mutate `reactions` without bumping the conversation sequence,
  // so they poke with the current sequence as the version marker.
  func fanOutWsReactionPoke(message_id : Text) : async () {
    for (m in messages.values()) {
      if (m.id == message_id) {
        await fanOutWsPoke(m.conversation_id, m.sequence);
        return;
      };
    };
  };

  public shared ({ caller }) func send_message(conversation_id : Text, body : Text, idempotency_key : Text, attachment : ?Types.Attachment, reply_to_id : ?Text) : async { #Ok : Types.Message; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (conversations.find(func(c) = c.id == conversation_id)) { case (?c) { if (isFenced(c.club_id)) return #Err("Club is temporarily locked for a transfer"); }; case null {} };
    await* sendAs(caller, conversation_id, body, idempotency_key, attachment, reply_to_id)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Scheduled-message delivery: notification_queue's timer posts a due
  // scheduled message as its author. Only the configured notification_queue
  // canister may call this; the author still goes through every send_message
  // check (membership, blocks, admin-only posting, broadcast admin), so a
  // scheduled message can never post where its author could not post live.
  public shared ({ caller }) func deliver_scheduled_message(sender : Principal, conversation_id : Text, body : Text, idempotency_key : Text, attachment : ?Types.Attachment, reply_to_id : ?Text) : async { #Ok : Types.Message; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    let trusted = switch (notificationQueueCanister) { case (?nq) { nq.equal(caller) }; case null { false } };
    if (not trusted) return #Err("Only notification_queue may deliver scheduled messages");
    if (sender.equal(Principal.anonymous())) return #Err("Invalid sender");
    await* sendAs(sender, conversation_id, body, idempotency_key, attachment, reply_to_id)
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  func sendAs(caller : Principal, conversation_id : Text, body : Text, idempotency_key : Text, attachment : ?Types.Attachment, reply_to_id : ?Text) : async* { #Ok : Types.Message; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    await* requireChatAccess(caller, conversation_id);
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    // The broadcast conversation is open-read, so the check above passes for
    // every signed-in member; only platform admins (club_domain's app_admin
    // grant) may post to it.
    if (conversation_id == BROADCAST_CONVERSATION_ID and not isGovernor(caller)) {
      let clubDomain = await clubDomainRef();
      switch (clubDomain) {
        case null { return #Err("club_domain canister not configured") };
        case (?cd) {
          let admin = if (accountAdmissionEnabled) await cd.read_account_is_app_admin(caller) else await cd.is_app_admin(caller);
          if (not admin) return #Err("App admin required");
        };
      };
    };


    await admitAccount(caller);
    if (not canAccessConversation(caller, conversation_id) or convFenced(conversation_id)) return #Err("Conversation authorization changed");
    await* requireChatAccess(caller, conversation_id);
    if (not canAccessConversation(caller, conversation_id) or convFenced(conversation_id)) return #Err("Conversation authorization changed");
    // DM blocking: refuse to post when either party has blocked the other.
    for (c in conversations.values()) {
      if (c.id == conversation_id and c.club_id == "dm") {
        for (p in c.participants.values()) {
          if (not p.equal(caller) and isBlockedPair(caller, p)) return #Err("Direct message blocked");
        };
      };
    };
    if (not validBody(body) or not valid(idempotency_key)) return #Err("Invalid message");
    switch (attachment) { case (?a) { if (not validAttachment(a)) return #Err("Invalid attachment") }; case null {} };
    switch (getGroupMetadataFor(conversation_id)) {
      case (?meta) {
        if (meta.kind == "competition" and not isCompetitionAdminFor(caller, conversation_id)) {
          return #Err("Competition chat admin required");
        };
        if (
          meta.admin_only_posting and (meta.kind == "group" or meta.kind == "broadcast") and
          not isGroupAdmin(caller, conversation_id)
        ) {
          return #Err("Only group admins can post");
        };
      };
      case null {};
    };
    for (m in messages.values()) {
      if (m.conversation_id == conversation_id and m.idempotency_key == idempotency_key) {
        return #Ok(m);
      };
    };
    switch (reply_to_id) {
      case (?rid) {
        var found = false;
        for (m in messages.values()) {
          if (m.conversation_id == conversation_id and m.id == rid) { found := true };
        };
        if (not found) return #Err("Reply target not found");
      };
      case null {};
    };
    switch (findConversationIndex(conversation_id)) {
      case null { #Err("Conversation not found") };
      case (?i) {
        let posted = postMessage(i, caller, body, idempotency_key, attachment, reply_to_id);
        ignore fanOutChatNotify(posted);
        ignore fanOutWsPokeForMessage(posted);
        #Ok(posted)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // Club announcement fan-out: posts the same message to the club chat
  // (team_id null) and/or each listed team's conversation. Teams without a
  // conversation are skipped and reported, never fatal. Idempotency keys are
  // derived per conversation, so a retried broadcast is safe. Announcements
  // allow a longer body than chat messages (valid() caps at 128 chars).
  public shared ({ caller }) func broadcast_announcement(club_id : Text, team_ids : [Text], include_club_chat : Bool, body : Text, idempotency_key : Text) : async { #Ok : Types.BroadcastResult; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatClubMember(caller, club_id);
    if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not valid(club_id) or not valid(idempotency_key)) return #Err("Invalid announcement");
    if (body == "" or body.size() > 4000) return #Err("Invalid announcement body");
    if (team_ids.size() > 100) return #Err("Too many teams");
    if (team_ids.any(func(team) = not valid(team))) return #Err("Invalid team");
    if (not isGovernor(caller) and not hasRole(caller, "club_admin", ?club_id, null) and not hasRole(caller, "app_admin", null, null)) return #Err("Club admin required");
    let teamTargets : [?Text] = Array.map<Text, ?Text>(team_ids, func(team) = ?team);
    let targets : [?Text] = if (include_club_chat) { ([null] : [?Text]).concat(teamTargets) } else { teamTargets };
    var delivered : Nat32 = 0;
    var skipped : [Text] = [];
    for (target in targets.values()) {
      var conv_idx : ?Nat = null;
      var idx = 0;
      for (c in conversations.values()) {
        if (c.club_id == club_id and c.team_id == target) { conv_idx := ?idx };
        idx += 1;
      };
      switch (conv_idx) {
        case null {
          switch (target) {
            case (?team) { skipped := skipped.concat([team]) };
            case null {};
          };
        };
        case (?i) {
          let conv = conversations[i];
          let key = idempotency_key # "-" # conv.id;
          var already = false;
          for (m in messages.values()) {
            if (m.conversation_id == conv.id and m.idempotency_key == key) { already := true };
          };
          if (not already) {
            let posted = postMessage(i, caller, body, key, null, null);
            ignore fanOutChatNotify(posted);
            ignore fanOutWsPokeForMessage(posted);
            delivered += 1;
          };
        };
      };
    };
    #Ok({ delivered; skipped })
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  public shared ({ caller }) func update_message(message_id : Text, body : Text) : async { #Ok : Types.Message; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireMessageChatAccess(caller, message_id);
    if (msgFenced(message_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not validBody(body)) return #Err("Invalid message");
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
        let updated : Types.Message = { current with body; edited_at_ms = ?nowMs() };
        mediaEvidenceRevision += 1;
        messages := Array.tabulate<Types.Message>(messages.size(), func(position) {
          if (position == i) updated else messages[position]
        });
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };


  public shared ({ caller }) func mark_read(conversation_id : Text, message_id : Text) : async { #Ok : Types.Receipt; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
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
        mediaEvidenceRevision += 1;
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
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func list_messages(conversation_id : Text, after : ?Nat64) : async [Types.Message] {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await* requireChatAccess(caller, conversation_id);
    if (not canReadTeamMessages(caller, conversation_id)) throw Error.reject("Conversation access forbidden");
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
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func list_messages_page(conversation_id : Text, after : ?Nat64, limit : Nat16) : async { #Ok : Types.MessagePage; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await* requireChatAccess(caller, conversation_id);
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
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Newest-first page read. `before = null` returns the newest `limit`
  // messages; `before = ?seq` returns the `limit` messages just older than
  // that sequence. `next_sequence` carries the backward cursor — pass it back
  // as `before` to load the next-older page, null means nothing older remains.
  // (list_messages_page pages forward from the OLDEST message, which is not
  // what a chat screen wants when it first opens.)
  public shared ({ caller }) func list_latest_messages_page(conversation_id : Text, before : ?Nat64, limit : Nat16) : async { #Ok : Types.MessagePage; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await* requireChatAccess(caller, conversation_id);
    if (not canReadTeamMessages(caller, conversation_id)) return #Err("Conversation access forbidden");
    if (limit == 0 or limit > 100) return #Err("Invalid page size");
    let latest = conversationLatestSequence(conversation_id);
    switch (before) {
      case (?cursor) { if (cursor > latest) return #Err("Stale cursor") };
      case null {};
    };
    let cap : Nat64 = switch (before) { case (?cursor) { cursor }; case null { latest + 1 } };
    // Messages are appended in send order, so sequence ascends within a
    // conversation: count the matching rows, then drop the surplus oldest.
    var matching : Nat = 0;
    for (m in messages.values()) {
      if (m.conversation_id == conversation_id and m.sequence < cap) { matching += 1 };
    };
    let limit_n = Nat16.toNat(limit);
    let skip = if (matching > limit_n) { matching - limit_n } else { 0 };
    var page_messages : [Types.Message] = [];
    var seen : Nat = 0;
    var oldest_in_page : Nat64 = 0;
    var oldest_set = false;
    for (m in messages.values()) {
      if (m.conversation_id == conversation_id and m.sequence < cap) {
        if (seen >= skip) {
          page_messages := page_messages.concat([m]);
          if (not oldest_set or m.sequence < oldest_in_page) {
            oldest_in_page := m.sequence;
            oldest_set := true;
          };
        };
        seen += 1;
      };
    };
    let next_seq : ?Nat64 = if (skip > 0 and oldest_set) ?oldest_in_page else null;
    #Ok({ messages = page_messages; next_sequence = next_seq; latest_sequence = latest })
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };


  // Case-insensitive substring search over a conversation's message bodies,
  // newest matches first. Mirrors the Supabase chat-history search used by
  // chatHistorySearchFetcher.ts so ICP-routed threads get the same feature.
  public shared ({ caller }) func search_messages(conversation_id : Text, needle : Text, limit : Nat16) : async { #Ok : [Types.Message]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await* requireChatAccess(caller, conversation_id);
    if (not canReadTeamMessages(caller, conversation_id)) return #Err("Conversation access forbidden");
    if (limit == 0 or limit > 100) return #Err("Invalid page size");
    let lower_needle = Text.toLower(needle);
    var matches : [Types.Message] = [];
    var i = messages.size();
    while (i > 0 and matches.size() < Nat16.toNat(limit)) {
      i -= 1;
      let m = messages[i];
      if (m.conversation_id == conversation_id and Text.contains(Text.toLower(m.body), #text lower_needle)) {
        matches := matches.concat([m]);
      };
    };
    #Ok(matches)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Full reaction rows (user + emoji) for a conversation so clients can
  // render "who reacted" and restore reactions on refetch. list_messages_page
  // intentionally stays lightweight; reactions are fetched alongside it.
  public shared ({ caller }) func list_reactions(conversation_id : Text) : async { #Ok : [Types.Reaction]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await* requireChatAccess(caller, conversation_id);
    if (not canReadTeamMessages(caller, conversation_id)) return #Err("Conversation access forbidden");
    var result : [Types.Reaction] = [];
    for (m in messages.values()) {
      if (m.conversation_id == conversation_id) {
        for (r in reactions.values()) {
          if (r.message_id == m.id) { result := result.concat([r]) };
        };
      };
    };
    #Ok(result)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // One round trip for a chat screen opening: the newest message page, the
  // reactions on those messages, the conversation's pins, and the results of
  // polls referenced by the page's messages. Pins are null when the caller
  // may read messages but not pins (anonymous / no conversation access);
  // clients then fall back to list_pinned_messages. Polls ride along because
  // each poll card would otherwise need its own update call (plus its own
  // membership check) just to render.
  public shared ({ caller }) func open_conversation(conversation_id : Text, limit : Nat16) : async {
    #Ok : { page : Types.MessagePage; reactions : [Types.Reaction]; pins : ?[Types.PinnedMessage]; polls : [Types.PollResults] };
    #Err : Text;
  } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await* requireChatAccess(caller, conversation_id);
    if (not canReadTeamMessages(caller, conversation_id)) return #Err("Conversation access forbidden");
    if (limit == 0 or limit > 100) return #Err("Invalid page size");
    let latest = conversationLatestSequence(conversation_id);
    var matching : Nat = 0;
    for (m in messages.values()) {
      if (m.conversation_id == conversation_id) { matching += 1 };
    };
    let limit_n = Nat16.toNat(limit);
    let skip = if (matching > limit_n) { matching - limit_n } else { 0 };
    var page_messages : [Types.Message] = [];
    var seen : Nat = 0;
    var oldest_in_page : Nat64 = 0;
    var oldest_set = false;
    for (m in messages.values()) {
      if (m.conversation_id == conversation_id) {
        if (seen >= skip) {
          page_messages := page_messages.concat([m]);
          if (not oldest_set or m.sequence < oldest_in_page) {
            oldest_in_page := m.sequence;
            oldest_set := true;
          };
        };
        seen += 1;
      };
    };
    var page_reactions : [Types.Reaction] = [];
    for (r in reactions.values()) {
      if (page_messages.find(func(m : Types.Message) : Bool { m.id == r.message_id }) != null) {
        page_reactions := page_reactions.concat([r]);
      };
    };
    let pins : ?[Types.PinnedMessage] = if (caller.equal(Principal.anonymous()) or not canAccessConversation(caller, conversation_id)) {
      null
    } else {
      ?pinnedMessages.filter(func(p) = p.conversation_id == conversation_id)
    };
    // Polls referenced by this page's messages, bounded to 6. The single
    // conversation access check above covers them (polls inherit their
    // conversation's visibility), so cards render without extra round trips.
    let page_polls = conversationPagePolls(conversation_id, page_messages);
    let next_seq : ?Nat64 = if (skip > 0 and oldest_set) ?oldest_in_page else null;
    #Ok({
      page = { messages = page_messages; next_sequence = next_seq; latest_sequence = latest };
      reactions = page_reactions;
      pins;
      polls = page_polls;
    })
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Call only after the opening endpoint's account/conversation checks.
  // Both wire twins use the same bounded selection and vote aggregation.
  func conversationPagePolls(conversation_id : Text, page_messages : [Types.Message]) : [Types.PollResults] {
    var page_polls : [Types.PollResults] = [];
    label pollScan for (p in polls.values()) {
      if (page_polls.size() >= 6) break pollScan;
      if (p.conversation_id != conversation_id) continue pollScan;
      let token = "[poll:" # p.id # "]";
      let referenced = page_messages.find(func(m : Types.Message) : Bool { Text.contains(m.body, #text token) }) != null;
      if (referenced) { page_polls := page_polls.concat([pollResultsFor(p)]) };
    };
    page_polls
  };

  public shared ({ caller }) func unread_count(conversation_id : Text) : async { #Ok : Types.Unread; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await* requireChatAccess(caller, conversation_id);
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    #Ok(unreadFor(caller, conversation_id))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func delete_message(message_id : Text) : async { #Ok : Types.Message; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireMessageChatAccess(caller, message_id);
    if (msgFenced(message_id)) return #Err("Club is temporarily locked for a transfer");
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
        mediaEvidenceRevision += 1;
        messages := Array.tabulate<Types.Message>(messages.size() - 1, func(pos) {
          if (pos < i) messages[pos] else messages[pos + 1]
        });
        #Ok(msg)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func addBulkAccessPrincipal(principal : Principal) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (principal.equal(Principal.anonymous())) return #Err("Invalid principal");
    if (not bulkAccessPrincipals.any(func(p) = p.equal(principal))) { bulkAccessPrincipals := bulkAccessPrincipals.concat([principal]) };
    #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func removeBulkAccessPrincipal(principal : Principal) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    bulkAccessPrincipals := bulkAccessPrincipals.filter(func(p) = not p.equal(principal));
    #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public query ({ caller }) func listBulkAccessPrincipals() : async { #Ok : [Principal]; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor only");
    #Ok(bulkAccessPrincipals)
  };

  // Permanently removes the caller's own personal chat records during
  // account erasure: every message they sent (including in direct chats),
  // their read receipts, unread counters, mute preferences and poll votes,
  // and their membership in conversations. Conversations themselves are
  // retained for the remaining participants.
  public shared ({ caller }) func purge_my_data() : async { #Ok : Nat32; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    auth(caller);
    var removed : Nat = 0;
    let keepMessages = messages.filter(func(m) = not m.sender.equal(caller));
    mediaEvidenceRevision += 1;
    removed += messages.size() - keepMessages.size(); messages := keepMessages;
    let keepReceipts = receipts.filter(func(r) = not r.user.equal(caller));
    removed += receipts.size() - keepReceipts.size(); receipts := keepReceipts;
    let keepUnread = unread.filter(func(u) = not u.user.equal(caller));
    removed += unread.size() - keepUnread.size(); unread := keepUnread;
    let keepMutes = mutePreferences.filter(func(p) = not p.user.equal(caller));
    removed += mutePreferences.size() - keepMutes.size(); mutePreferences := keepMutes;
    let keepVotes = pollVotes.filter(func(v) = not v.user.equal(caller));
    removed += pollVotes.size() - keepVotes.size(); pollVotes := keepVotes;
    let keepConversations = conversations.filter(func(c) = c.participants.size() > 0 and (c.participants.size() > 1 or not c.participants[0].equal(caller)));
    removed += conversations.size() - keepConversations.size();
    mediaEvidenceRevision += 1;
    conversations := keepConversations.map(func(c) = { c with participants = c.participants.filter(func(p) = not p.equal(caller)) });
    let keepLinks = dmLinks.filter(func(l) = not l.a.equal(caller) and not l.b.equal(caller));
    removed += dmLinks.size() - keepLinks.size(); dmLinks := keepLinks;
    #Ok(Nat32.fromNat(removed))
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public query ({ caller }) func export_state() : async { #Ok : Types.State; #Err : Text } {
    denyLegacyAccountQuery();
    if (not isGovernor(caller) and not hasBulkAccess(caller)) return #Err("Governor only");
    #Ok({ schema = 4; governor; roles; conversations; messages; receipts; unread; groupMetadata; clubMemberships; competitionAdmins; dmAttachmentsDisabled; groupRoles; joinRequests; polls; pollVotes; mutePreferences; dmLinks; forwardRecords; scheduledMessages; attachmentMetadata; reactions; clubDmSettings; userMessagingSettings; typingPings; pinnedMessages; contentReports })
  };

  func validKind(kind : Text) : Bool {
    kind == "direct" or kind == "club" or kind == "team" or kind == "group" or kind == "broadcast" or kind == "competition" or kind == "club_admin"
  };

  func canManageGroupMetadata(caller : Principal, meta : Types.GroupMetadata) : Bool {
    isGovernor(caller) or hasRole(caller, "app_admin", null, null) or
    (switch (meta.club_id) { case (?club_id) { hasRole(caller, "club_admin", ?club_id, null) }; case null { false } }) or
    (switch (meta.club_id, meta.team_id) { case (?club_id, ?team_id) { hasRole(caller, "team_admin", ?club_id, ?team_id) or hasRole(caller, "coach", ?club_id, ?team_id) }; case (_, _) { false } }) or
    meta.members.any(func(m) = m.equal(caller))
  };

  // Upserts the Supabase `chat_groups` equivalent for a conversation: name,
  // kind, club/team scope, and membership list. The conversation itself must
  // already exist (created via create_conversation); this only attaches
  // display/authorization metadata to it. Callers must be a governor,
  // app_admin, the club/team admin for the target scope, or already a member
  // being asked to update their own group's metadata.
  public shared ({ caller }) func upsert_group_metadata(
    conversation_id : Text,
    name : Text,
    kind : Text,
    club_id : ?Text,
    team_id : ?Text,
    members : [Principal],
  ) : async { #Ok : Types.GroupMetadata; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (findConversationIndex(conversation_id) == null) return #Err("Conversation not found");
    if (not valid(conversation_id) or not valid(name) or not validKind(kind)) return #Err("Invalid group metadata");
    if (members.any(func(m) = m.equal(Principal.anonymous()))) return #Err("Invalid member");
    let existing = getGroupMetadataFor(conversation_id);
    let stored = conversations.find(func(c) = c.id == conversation_id);
    if (not isGovernor(caller)) {
      switch (stored) {
        case (?c) {
          if (club_id != ?c.club_id or team_id != c.team_id) return #Err("Conversation scope is immutable");
          if (requiresClubMembership(c) and (kind == "competition" or kind == "competition_admin")) return #Err("Conversation scope is immutable");
        }; case null {};
      };
    };
    switch (existing) {
      case (?meta) { if (not canManageGroupMetadata(caller, meta)) return #Err("Group metadata management forbidden") };
      case null {
        if (not (isGovernor(caller) or hasRole(caller, "app_admin", null, null) or members.any(func(m) = m.equal(caller)))) {
          return #Err("Group metadata management forbidden");
        };
      };
    };
    let updated : Types.GroupMetadata = {
      conversation_id; name; kind; club_id; team_id; members;
      created_at_ms = switch (existing) { case (?m) { m.created_at_ms }; case null { nowMs() } };
      avatar = switch (existing) { case (?m) { m.avatar }; case null { null } };
      description = switch (existing) { case (?m) { m.description }; case null { null } };
      deleted = switch (existing) { case (?m) { m.deleted }; case null { false } };
      admin_only_posting = switch (existing) { case (?m) { m.admin_only_posting }; case null { false } };
      deleted_at_ms = switch (existing) { case (?m) { m.deleted_at_ms }; case null { null } };
      deleted_by = switch (existing) { case (?m) { m.deleted_by }; case null { null } };
    };
    groupMetadata := groupMetadata.filter(func(m) = m.conversation_id != conversation_id);
    groupMetadata := groupMetadata.concat([updated]);
    #Ok(updated)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func get_group_metadata(conversation_id : Text) : async { #Ok : Types.GroupMetadata; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await* requireChatAccess(caller, conversation_id);
    if (not canReadTeamMessages(caller, conversation_id) and not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    switch (getGroupMetadataFor(conversation_id)) {
      case (?meta) { #Ok(meta) };
      case null { #Err("Group metadata not found") };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Shared-club DM eligibility record. Governor/app_admin only — mirrors the
  // Supabase club_members table this substitutes for.
  public shared ({ caller }) func upsert_club_membership(user : Principal, club_id : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isGovernor(caller) and not hasRole(caller, "app_admin", null, null) and not hasRole(caller, "club_admin", ?club_id, null)) return #Err("Club admin required");
    if (user.equal(Principal.anonymous()) or not valid(club_id)) return #Err("Invalid membership");
    if (not clubMemberships.any(func(m) = m.user.equal(user) and m.club_id == club_id)) {
      clubMemberships := clubMemberships.concat([{ user; club_id }]);
    };
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Two users may DM each other only if they share at least one club.
  public query ({ caller }) func can_dm_user(other : Principal) : async Bool {
    denyLegacyAccountQuery();
    if (caller.equal(Principal.anonymous()) or other.equal(Principal.anonymous())) return false;
    if (caller.equal(other)) return false;
    if (isBlockedPair(caller, other)) return false;
    sharesClub(caller, other)
  };

  public shared ({ caller }) func set_dm_attachments_disabled(user : Principal, disabled : Bool) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return #Err("App admin required");
    dmAttachmentsDisabled := dmAttachmentsDisabled.filter(func(p) = not p.equal(user));
    if (disabled) { dmAttachmentsDisabled := dmAttachmentsDisabled.concat([user]) };
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public query ({ caller }) func dm_attachments_disabled(user : Principal) : async Bool {
    denyLegacyAccountQuery();
    dmAttachmentsDisabled.any(func(p) = p.equal(user))
  };

  public shared ({ caller }) func grant_competition_admin(conversation_id : Text, user : Principal) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return #Err("App admin required");
    if (user.equal(Principal.anonymous()) or not valid(conversation_id)) return #Err("Invalid competition admin");
    if (not competitionAdmins.any(func(a) = a.conversation_id == conversation_id and a.user.equal(user))) {
      competitionAdmins := competitionAdmins.concat([{ conversation_id; user }]);
    };
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func is_competition_admin(conversation_id : Text) : async Bool {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    isCompetitionAdminFor(caller, conversation_id)
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Group listing for club/team chat tabs — the canister counterpart of the
  // Supabase `chat_groups` table select used by ChatGroupsList. Scoped to
  // callers with some standing on the club/team (governor/app_admin, a role
  // grant for that club/team, an explicit club membership record, or
  // existing membership in one of the matching groups) so browsing a club's
  // group list cannot be used to probe membership of clubs/teams the caller
  // has no relationship with.
  func canBrowseClubGroups(caller : Principal, club_id : Text) : Bool {
    if (caller.equal(Principal.anonymous())) return false;
    if (isGovernor(caller) or hasRole(caller, "app_admin", null, null) or hasRole(caller, "club_admin", ?club_id, null)) return true;
    if (clubMemberships.any(func(m) = m.user.equal(caller) and m.club_id == club_id)) return true;
    groupMetadata.any(func(m) = m.club_id == ?club_id and m.members.any(func(p) = p.equal(caller)))
  };

  func canBrowseTeamGroups(caller : Principal, club_id : Text, team_id : Text) : Bool {
    if (caller.equal(Principal.anonymous())) return false;
    if (isGovernor(caller) or hasRole(caller, "app_admin", null, null) or hasRole(caller, "club_admin", ?club_id, null) or hasRole(caller, "team_admin", ?club_id, ?team_id) or hasRole(caller, "coach", ?club_id, ?team_id)) return true;
    groupMetadata.any(func(m) = m.team_id == ?team_id and m.members.any(func(p) = p.equal(caller)))
  };

  func toGroupSummary(caller : Principal, meta : Types.GroupMetadata) : Types.GroupSummary {
    {
      conversation_id = meta.conversation_id;
      name = meta.name;
      kind = meta.kind;
      club_id = meta.club_id;
      team_id = meta.team_id;
      avatar = meta.avatar;
      description = meta.description;
      member_count = Nat32.fromNat(meta.members.size());
      is_member = meta.members.any(func(p) = p.equal(caller));
    }
  };

  // A league tag locates an existing private group; it never grants membership.
  public shared ({ caller }) func get_mini_league_chat(club_id : Text, league_id : Text) : async { #Ok : ?Types.GroupSummary; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await* requireChatClubMember(caller, club_id);
    if (caller.equal(Principal.anonymous())) return #Err("Forbidden");
    let matches = groupMetadata.filter(func(m) = not m.deleted and m.club_id == ?club_id and m.kind == "mini_league:" # league_id and m.members.any(func(p) = p.equal(caller)));
    if (matches.size() > 1) return #Err("Conflicting league chats");
    #Ok(if (matches.size() == 0) null else ?toGroupSummary(caller, matches[0]))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  // Club administrators select the private audience, just as for ordinary group creation.
  // Find-or-create is atomic and safe to resume; no cross-canister await.
  public shared ({ caller }) func ensure_mini_league_chat(club_id : Text, league_id : Text, name : Text, members : [Principal]) : async { #Ok : Types.GroupSummary; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatClubMember(caller, club_id);
    auth(caller);
    if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    if (not isGovernor(caller) and not hasRole(caller, "club_admin", ?club_id, null)) return #Err("Club admin required");
    if (not valid(club_id) or not valid(league_id) or not valid(name)) return #Err("Invalid league chat");
    let found = groupMetadata.filter(func(m) = not m.deleted and m.club_id == ?club_id and m.kind == "mini_league:" # league_id);
    if (found.size() > 1) return #Err("Conflicting league chats");
    if (found.size() == 1) { if (not found[0].members.any(func(p) = p.equal(caller))) return #Err("Chat membership required"); return #Ok(toGroupSummary(caller, found[0])) };
    if (members.size() == 0 or members.size() > GROUP_MEMBER_LIMIT or members.any(func(p) = p.equal(Principal.anonymous())) or not members.any(func(p) = p.equal(caller))) return #Err("Invalid chat audience");
    let conversation : Types.Conversation = { id = "chat-" # club_id # "-" # Nat.toText(conversations.size() + 1); club_id; team_id = null; participants = members; next_sequence = 1 };
    let meta : Types.GroupMetadata = { conversation_id = conversation.id; name; kind = "mini_league:" # league_id; club_id = ?club_id; team_id = null; members; created_at_ms = nowMs(); avatar = null; description = null; deleted = false; admin_only_posting = false; deleted_at_ms = null; deleted_by = null };
    mediaEvidenceRevision += 1;
    conversations := conversations.concat([conversation]);
    groupMetadata := groupMetadata.concat([meta]);
    groupRoles := groupRoles.concat(members.map(func(p) : Types.GroupRole = { conversation_id = conversation.id; user = p; role = if (p.equal(caller)) "admin" else "member" }));
    #Ok(toGroupSummary(caller, meta))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func list_groups_by_club(club_id : Text) : async { #Ok : [Types.GroupSummary]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await* requireChatClubMember(caller, club_id);
    if (not valid(club_id)) return #Err("Invalid club id");
    if (not canBrowseClubGroups(caller, club_id)) return #Err("Club access forbidden");
    let matches = groupMetadata.filter(func(m) = m.club_id == ?club_id and m.team_id == null and not m.deleted);
    #Ok(Array.map<Types.GroupMetadata, Types.GroupSummary>(matches, func(m) = toGroupSummary(caller, m)))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func list_groups_by_team(team_id : Text) : async { #Ok : [Types.GroupSummary]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    if (not valid(team_id)) return #Err("Invalid team id");
    var club_of_team = "";
    for (m in groupMetadata.values()) { if (m.team_id == ?team_id) { club_of_team := Option.get(m.club_id, "") } };
    await* requireChatClubMember(caller, club_of_team);
    if (not canBrowseTeamGroups(caller, club_of_team, team_id)) return #Err("Team access forbidden");
    let matches = groupMetadata.filter(func(m) = m.team_id == ?team_id and not m.deleted);
    #Ok(Array.map<Types.GroupMetadata, Types.GroupSummary>(matches, func(m) = toGroupSummary(caller, m)))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Read receipts for a conversation page: `receipts` already stores each
  // member's read frontier (conversation_id, user, message_id, read) —
  // updated by mark_read — so no new stable state is needed, only a
  // conversation-scoped read path. Privacy-scoped to conversation members
  // (participants or group members) so a caller only sees who has read
  // messages in conversations they belong to.
  public shared ({ caller }) func list_read_receipts(conversation_id : Text) : async { #Ok : [Types.Receipt]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await* requireChatAccess(caller, conversation_id);
    if (not canAccessConversation(caller, conversation_id) and not canReadTeamMessages(caller, conversation_id)) return #Err("Conversation access forbidden");
    #Ok(receipts.filter(func(r) = r.conversation_id == conversation_id))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Aggregated unread counts for every conversation the caller participates
  // in, annotated with each conversation's metadata kind so the frontend can
  // bucket into {teams, clubs, groups, dms, broadcast} without a second
  // round-trip per conversation.
  public shared ({ caller }) func my_unread_counts() : async [Types.UnreadSummary] {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    if (caller.equal(Principal.anonymous())) return [];
    var result : [Types.UnreadSummary] = [];
    for (conversation in conversations.values()) {
      let visible = try { await* requireChatAccess(caller, conversation.id); true } catch (_) { false };
      if (visible and conversation.participants.any(func(p) = p.equal(caller))) {
        let u = unreadFor(caller, conversation.id);
        if (u.count > 0) {
          result := result.concat([{ conversation_id = conversation.id; kind = inferConversationKind(conversation); count = u.count }]);
        };
      };
    };
    result
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== Group management (roles, bulk, soft-delete, join requests) =====================

  func validGroupRole(role : Text) : Bool { role == "owner" or role == "admin" or role == "member" };

  func isGroupAdmin(caller : Principal, conversation_id : Text) : Bool {
    isGovernor(caller) or hasRole(caller, "app_admin", null, null) or
    groupRoles.any(func(r) = r.conversation_id == conversation_id and r.user.equal(caller) and (r.role == "owner" or r.role == "admin"))
  };

  func isGroupDeleted(conversation_id : Text) : Bool {
    switch (getGroupMetadataFor(conversation_id)) { case (?m) { m.deleted }; case null { false } }
  };

  // Member-list cap shared by group creation and add_group_members: keeps a
  // single conversation's fan-out/participant arrays bounded under
  // user-driven growth (matches the 500-recipient cap used by the chat
  // notify / WS poke fan-outs).
  transient let GROUP_MEMBER_LIMIT = 500;

  // Explicit standard-chat identity. Ordinary create_group_with_roles remains
  // create-only: custom chats may share names and retain separate histories.
  // Authorize externally first, then reload/claim/create with NO await between
  // the lookup and commit. Concurrent devices therefore receive the same ID.
  public shared ({ caller }) func ensure_default_club_chat(
    club_id : Text, standard_key : Text, existing_id : ?Text,
    role_entries : [(Principal, Text)],
  ) : async { #Ok : Types.GroupMetadata; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
      await admitAccount(caller);
      await* requireChatClubMember(caller, club_id);
      auth(caller);
      if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
      let ?standardName = DefaultChatPolicy.name(standard_key) else return #Err("Unknown standard chat");
      if (not valid(club_id)) return #Err("Invalid club id");
      if (role_entries.size() == 0 or role_entries.size() > GROUP_MEMBER_LIMIT) return #Err("Invalid chat audience");
      if (role_entries.any(func((p, r)) = p.equal(Principal.anonymous()) or not validGroupRole(r))) return #Err("Invalid role entry");
      if (not role_entries.any(func((p, _)) = p.equal(caller))) return #Err("Creator must be a member");
      let identity = DefaultChatPolicy.identity(club_id, standard_key);
      // A saved binding is authoritative even if a stale device proposes a
      // different legacy copy. Return only to existing members/managers; never
      // add the caller or apply caller-supplied owner roles on a reuse.
      switch (defaultClubChats.get(identity)) {
        case (?id) {
          switch (getGroupMetadataFor(id)) {
            case (?meta) {
              if (meta.club_id != ?club_id or meta.team_id != null) return #Err("Standard chat scope changed");
              if (meta.deleted) return #Err("Standard chat deleted; administrator restore required");
              if (not canManageGroupMetadata(caller, meta) and not isGroupAdmin(caller, id)) return #Err("Group management forbidden");
              return #Ok(meta);
            };
            case null { return #Err("Standard chat missing; administrator review required") };
          };
        };
        case null {};
      };
      // Adopt an explicitly selected existing chat only with its existing
      // management permission. No name-only scan, no membership/history edit.
      switch (existing_id) {
        case (?id) {
          let ?meta = getGroupMetadataFor(id) else return #Err("Existing chat not found");
          if (meta.club_id != ?club_id or meta.team_id != null or meta.kind != "group" or meta.name != standardName or meta.deleted) return #Err("Existing chat is not an active standard candidate");
          if (not canManageGroupMetadata(caller, meta) and not isGroupAdmin(caller, id)) return #Err("Group management forbidden");
          defaultClubChats.add(identity, id);
          return #Ok(meta);
        };
        case null {};
      };
      let members = role_entries.map(func((p, _)) = p);
      // Reuse the existing creator authorization/audience contract. The new
      // operation changes uniqueness, not who may create or invite members.
      let conversation : Types.Conversation = {
        id = identity; club_id; team_id = null; participants = members; next_sequence = 1;
      };
      if (conversations.any(func(c) = c.id == identity)) return #Err("Standard chat identity conflict");
      let meta : Types.GroupMetadata = {
        conversation_id = identity; name = standardName; kind = "group";
        club_id = ?club_id; team_id = null; members; created_at_ms = nowMs();
        avatar = null; description = null; deleted = false; admin_only_posting = false;
        deleted_at_ms = null; deleted_by = null;
      };
      mediaEvidenceRevision += 1;
      conversations := conversations.concat([conversation]);
      groupMetadata := groupMetadata.concat([meta]);
      groupRoles := groupRoles.concat(role_entries.map(func((p, r)) = { conversation_id = identity; user = p; role = r }));
      defaultClubChats.add(identity, identity);
      #Ok(meta)
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func create_group_with_roles(
    club_id : Text,
    team_id : ?Text,
    name : Text,
    kind : Text,
    role_entries : [(Principal, Text)],
  ) : async { #Ok : Types.GroupMetadata; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (kind != "competition") { await* requireChatClubMember(caller, club_id) };
    if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not valid(club_id) or not valid(name) or not validKind(kind)) return #Err("Invalid group");
    if (role_entries.size() == 0) return #Err("At least one member required");
    if (role_entries.size() > GROUP_MEMBER_LIMIT) return #Err("Too many members: limit " # Nat.toText(GROUP_MEMBER_LIMIT));
    if (role_entries.any(func((p, r)) = p.equal(Principal.anonymous()) or not validGroupRole(r))) return #Err("Invalid role entry");
    if (not role_entries.any(func((p, _r)) = p.equal(caller))) return #Err("Creator must be a member");
    let members : [Principal] = Array.map<(Principal, Text), Principal>(role_entries, func((p, _r)) = p);
    let conversation : Types.Conversation = {
      id = "chat-" # club_id # "-" # Nat.toText(conversations.size() + 1);
      club_id; team_id; participants = members; next_sequence = 1;
    };
    mediaEvidenceRevision += 1;
    conversations := conversations.concat([conversation]);
    let meta : Types.GroupMetadata = {
      conversation_id = conversation.id; name; kind; club_id = ?club_id; team_id; members;
      created_at_ms = nowMs(); avatar = null; description = null; deleted = false; admin_only_posting = false;
      deleted_at_ms = null; deleted_by = null;
    };
    groupMetadata := groupMetadata.concat([meta]);
    groupRoles := groupRoles.concat(Array.map<(Principal, Text), Types.GroupRole>(role_entries, func((p, r)) = { conversation_id = conversation.id; user = p; role = r }));
    #Ok(meta)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func update_group(conversation_id : Text, name : ?Text, avatar : ?Text, description : ?Text, admin_only_posting : ?Bool) : async { #Ok : Types.GroupMetadata; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (getGroupMetadataFor(conversation_id)) {
      case null { #Err("Group metadata not found") };
      case (?meta) {
        if (meta.deleted) return #Err("Group deleted");
        if (not canManageGroupMetadata(caller, meta) and not isGroupAdmin(caller, conversation_id)) return #Err("Group management forbidden");
        switch (name) { case (?n) { if (not valid(n)) return #Err("Invalid name") }; case null {} };
        let updated : Types.GroupMetadata = {
          meta with
          name = switch (name) { case (?n) { n }; case null { meta.name } };
          avatar = switch (avatar) { case (?_) { avatar }; case null { meta.avatar } };
          description = switch (description) { case (?_) { description }; case null { meta.description } };
          admin_only_posting = switch (admin_only_posting) { case (?v) { v }; case null { meta.admin_only_posting } };
        };
        groupMetadata := groupMetadata.filter(func(m) = m.conversation_id != conversation_id);
        groupMetadata := groupMetadata.concat([updated]);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func add_group_members(conversation_id : Text, members : [Principal]) : async { #Ok : Types.GroupMetadata; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (members.size() == 0 or members.any(func(p) = p.equal(Principal.anonymous()))) return #Err("Invalid members");
    switch (getGroupMetadataFor(conversation_id), findConversationIndex(conversation_id)) {
      case (null, _) { #Err("Group metadata not found") };
      case (_, null) { #Err("Conversation not found") };
      case (?meta, ?ci) {
        if (meta.deleted) return #Err("Group deleted");
        if (not canManageGroupMetadata(caller, meta) and not isGroupAdmin(caller, conversation_id)) return #Err("Group management forbidden");
        if (meta.members.size() + members.size() > GROUP_MEMBER_LIMIT) return #Err("Too many members: limit " # Nat.toText(GROUP_MEMBER_LIMIT));
        var newMembers = meta.members;
        var newRoles = groupRoles;
        for (m in members.values()) {
          if (not newMembers.any(func(p) = p.equal(m))) {
            newMembers := newMembers.concat([m]);
            newRoles := newRoles.concat([{ conversation_id; user = m; role = "member" }]);
          };
        };
        let conv = conversations[ci];
        var newParticipants = conv.participants;
        for (m in members.values()) {
          if (not newParticipants.any(func(p) = p.equal(m))) { newParticipants := newParticipants.concat([m]) };
        };
        mediaEvidenceRevision += 1;
        conversations := Array.tabulate<Types.Conversation>(conversations.size(), func(pos) = if (pos == ci) { { conv with participants = newParticipants } } else { conversations[pos] });
        let updated : Types.GroupMetadata = { meta with members = newMembers };
        groupMetadata := groupMetadata.filter(func(m) = m.conversation_id != conversation_id);
        groupMetadata := groupMetadata.concat([updated]);
        groupRoles := newRoles;
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Shared removal core for remove_group_member/leave_group: drops `member`
  // from the group's member list, its group-role entries, and the backing
  // conversation's participants.
  func removeGroupMemberCore(conversation_id : Text, meta : Types.GroupMetadata, ci : Nat, member : Principal) : Types.GroupMetadata {
    let updated : Types.GroupMetadata = { meta with members = meta.members.filter(func(p) = not p.equal(member)) };
    groupMetadata := groupMetadata.filter(func(m) = m.conversation_id != conversation_id);
    groupMetadata := groupMetadata.concat([updated]);
    groupRoles := groupRoles.filter(func(r) = not (r.conversation_id == conversation_id and r.user.equal(member)));
    let conv = conversations[ci];
    let newParticipants = conv.participants.filter(func(p) = not p.equal(member));
    mediaEvidenceRevision += 1;
    conversations := Array.tabulate<Types.Conversation>(conversations.size(), func(pos) = if (pos == ci) { { conv with participants = newParticipants } } else { conversations[pos] });
    updated
  };

  // Same permission rule as add_group_members: group/metadata manager
  // (owner/admin role, scoped admin, governor/app_admin) only.
  public shared ({ caller }) func remove_group_member(conversation_id : Text, member : Principal) : async { #Ok : Types.GroupMetadata; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (member.equal(Principal.anonymous())) return #Err("Invalid member");
    switch (getGroupMetadataFor(conversation_id), findConversationIndex(conversation_id)) {
      case (null, _) { #Err("Group metadata not found") };
      case (_, null) { #Err("Conversation not found") };
      case (?meta, ?ci) {
        if (meta.deleted) return #Err("Group deleted");
        if (not canManageGroupMetadata(caller, meta) and not isGroupAdmin(caller, conversation_id)) return #Err("Group management forbidden");
        if (not meta.members.any(func(p) = p.equal(member))) return #Err("Member not found");
        #Ok(removeGroupMemberCore(conversation_id, meta, ci, member))
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // A member removing themselves: requires current membership, no admin
  // gate (mirrors remove_group_member's effect targeted at the caller).
  public shared ({ caller }) func leave_group(conversation_id : Text) : async { #Ok : Types.GroupMetadata; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (getGroupMetadataFor(conversation_id), findConversationIndex(conversation_id)) {
      case (null, _) { #Err("Group metadata not found") };
      case (_, null) { #Err("Conversation not found") };
      case (?meta, ?ci) {
        if (meta.deleted) return #Err("Group deleted");
        if (not meta.members.any(func(p) = p.equal(caller))) return #Err("Not a member");
        #Ok(removeGroupMemberCore(conversation_id, meta, ci, caller))
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func soft_delete_group(conversation_id : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (getGroupMetadataFor(conversation_id)) {
      case null { #Err("Group metadata not found") };
      case (?meta) {
        if (not canManageGroupMetadata(caller, meta) and not isGroupAdmin(caller, conversation_id)) return #Err("Group management forbidden");
        groupMetadata := groupMetadata.filter(func(m) = m.conversation_id != conversation_id);
        groupMetadata := groupMetadata.concat([{ meta with deleted = true; deleted_at_ms = ?nowMs(); deleted_by = ?caller }]);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Admin restore/purge for the Deleted Chats tool. App admins act on any
  // group; club admins only on groups of their own club.
  func canAdminRestore(caller : Principal, meta : Types.GroupMetadata) : Bool {
    isGovernor(caller) or hasRole(caller, "app_admin", null, null) or
    (switch (meta.club_id) { case (?c) { hasRole(caller, "club_admin", ?c, null) }; case null { false } })
  };

  public query ({ caller }) func list_deleted_groups() : async { #Ok : [Types.GroupMetadata]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    if (isGovernor(caller) or hasRole(caller, "app_admin", null, null)) {
      return #Ok(groupMetadata.filter(func(m) = m.deleted));
    };
    if (hasRole(caller, "club_admin", null, null)) {
      return #Ok(groupMetadata.filter(func(m) = m.deleted and (switch (m.club_id) { case (?c) { hasRole(caller, "club_admin", ?c, null) }; case null { false } })));
    };
    #Err("Admin access required")
  };

  public shared ({ caller }) func restore_group(conversation_id : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (getGroupMetadataFor(conversation_id)) {
      case null { #Err("Group metadata not found") };
      case (?meta) {
        if (not meta.deleted) return #Err("Group is not deleted");
        if (not canAdminRestore(caller, meta)) return #Err("Admin access required");
        groupMetadata := groupMetadata.filter(func(m) = m.conversation_id != conversation_id);
        groupMetadata := groupMetadata.concat([{ meta with deleted = false; deleted_at_ms = null; deleted_by = null }]);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func purge_group(conversation_id : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    auth(caller);
    if (not (isGovernor(caller) or hasRole(caller, "app_admin", null, null))) return #Err("App admin required");
    switch (getGroupMetadataFor(conversation_id)) {
      case null { #Err("Group metadata not found") };
      case (?meta) {
        if (not meta.deleted) return #Err("Group is not deleted");
        let messageIds = messages.filter(func(m) = m.conversation_id == conversation_id).map(func(m) = m.id);
        let pollIds = polls.filter(func(p) = p.conversation_id == conversation_id).map(func(p) = p.id);
        groupMetadata := groupMetadata.filter(func(m) = m.conversation_id != conversation_id);
        mediaEvidenceRevision += 1;
        conversations := conversations.filter(func(c) = c.id != conversation_id);
        privateAdminThreads := privateAdminThreads.filter(func t = t.conversation != conversation_id);
        mediaEvidenceRevision += 1;
        messages := messages.filter(func(m) = m.conversation_id != conversation_id);
        receipts := receipts.filter(func(r) = r.conversation_id != conversation_id);
        unread := unread.filter(func(u) = u.conversation_id != conversation_id);
        groupRoles := groupRoles.filter(func(r) = r.conversation_id != conversation_id);
        joinRequests := joinRequests.filter(func(r) = r.conversation_id != conversation_id);
        polls := polls.filter(func(p) = p.conversation_id != conversation_id);
        pollVotes := pollVotes.filter(func(v) = not pollIds.any(func(id) = v.poll_id == id));
        mutePreferences := mutePreferences.filter(func(p) = p.conversation_id != conversation_id);
        dmLinks := dmLinks.filter(func(l) = l.conversation_id != conversation_id);
        forwardRecords := forwardRecords.filter(func(f) = f.to_conversation_id != conversation_id and f.from_conversation_id != conversation_id);
        mediaEvidenceRevision += 1;
        scheduledMessages := scheduledMessages.filter(func(s) = s.conversation_id != conversation_id);
        mediaEvidenceRevision += 1;
        attachmentMetadata := attachmentMetadata.filter(func(a) = a.conversation_id != conversation_id);
        reactions := reactions.filter(func(r) = not messageIds.any(func(id) = r.message_id == id));
        typingPings := typingPings.filter(func(t) = t.conversation_id != conversation_id);
        pinnedMessages := pinnedMessages.filter(func(p) = p.conversation_id != conversation_id);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Admin listing of the DM-attachment restriction lists. The per-user set
  // stores principals directly; the per-club list returns full club settings.
  public query ({ caller }) func list_dm_attachments_disabled() : async { #Ok : [Principal]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    if (not (isGovernor(caller) or hasRole(caller, "app_admin", null, null))) return #Err("App admin required");
    #Ok(dmAttachmentsDisabled)
  };

  public query ({ caller }) func list_club_dm_settings() : async { #Ok : [Types.ClubDmSettings]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    if (not (isGovernor(caller) or hasRole(caller, "app_admin", null, null))) return #Err("App admin required");
    #Ok(clubDmSettings)
  };

  public shared ({ caller }) func request_join_group(conversation_id : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (findGroupMetadataIndex(conversation_id) == null) return #Err("Group metadata not found");
    if (isGroupDeleted(conversation_id)) return #Err("Group deleted");
    if (joinRequests.any(func(r) = r.conversation_id == conversation_id and r.user.equal(caller) and r.status == "pending")) return #Ok;
    joinRequests := joinRequests.filter(func(r) = not (r.conversation_id == conversation_id and r.user.equal(caller)));
    joinRequests := joinRequests.concat([{ conversation_id; user = caller; status = "pending"; created_at_ms = nowMs() }]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func approve_join_request(conversation_id : Text, user : Principal) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isGroupAdmin(caller, conversation_id)) return #Err("Group admin required");
    if (not joinRequests.any(func(r) = r.conversation_id == conversation_id and r.user.equal(user) and r.status == "pending")) return #Err("Join request not found");
    joinRequests := Array.map<Types.JoinRequest, Types.JoinRequest>(joinRequests, func(r) = if (r.conversation_id == conversation_id and r.user.equal(user)) { { r with status = "approved" } } else { r });
    switch (getGroupMetadataFor(conversation_id), findConversationIndex(conversation_id)) {
      case (?meta, ?ci) {
        if (not meta.members.any(func(p) = p.equal(user))) {
          let updated : Types.GroupMetadata = { meta with members = meta.members.concat([user]) };
          groupMetadata := groupMetadata.filter(func(m) = m.conversation_id != conversation_id);
          groupMetadata := groupMetadata.concat([updated]);
          groupRoles := groupRoles.concat([{ conversation_id; user; role = "member" }]);
        };
        let conv = conversations[ci];
        if (not conv.participants.any(func(p) = p.equal(user))) {
          mediaEvidenceRevision += 1;
          conversations := Array.tabulate<Types.Conversation>(conversations.size(), func(pos) = if (pos == ci) { { conv with participants = conv.participants.concat([user]) } } else { conversations[pos] });
        };
      };
      case (_, _) {};
    };
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== Open-group discovery =====================
  func joinPolicyOf(conversation_id : Text) : { join_policy : Text; category : ?Text } {
    switch (groupJoinPolicies.find(func(p) = p.conversation_id == conversation_id)) {
      case (?p) { { join_policy = p.join_policy; category = p.category } };
      case null { { join_policy = "invite_only"; category = null } };
    }
  };

  func canManageGroupPolicy(caller : Principal, conversation_id : Text) : Bool {
    if (isGroupAdmin(caller, conversation_id)) return true;
    switch (getGroupMetadataFor(conversation_id)) {
      case (?m) { switch (m.club_id) { case (?c) { hasRole(caller, "club_admin", ?c, null) }; case null { false } } };
      case null { false };
    }
  };

  public shared ({ caller }) func set_group_join_policy(conversation_id : Text, join_policy : Text, category : ?Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (join_policy != "invite_only" and join_policy != "request_to_join" and join_policy != "open_to_club") return #Err("Invalid join policy");
    switch (category) { case (?c) { if (not valid(c)) return #Err("Invalid category") }; case null {} };
    if (findGroupMetadataIndex(conversation_id) == null) return #Err("Group metadata not found");
    if (not canManageGroupPolicy(caller, conversation_id)) return #Err("Group admin required");
    groupJoinPolicies := groupJoinPolicies.filter(func(p) = p.conversation_id != conversation_id);
    groupJoinPolicies := groupJoinPolicies.concat([{ conversation_id; join_policy; category }]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func get_group_join_policy(conversation_id : Text) : async { join_policy : Text; category : ?Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await* requireChatAccess(caller, conversation_id);
    joinPolicyOf(conversation_id)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Club-level groups (no team) a club member may discover: open_to_club or
  // request_to_join, not deleted.
  public shared ({ caller }) func list_open_groups(club_id : Text) : async { #Ok : [{ summary : Types.GroupSummary; join_policy : Text; category : ?Text; requested : Bool }]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await* requireChatClubMember(caller, club_id);
    if (not valid(club_id)) return #Err("Invalid club id");
    if (not canBrowseClubGroups(caller, club_id)) return #Err("Club access forbidden");
    var out : [{ summary : Types.GroupSummary; join_policy : Text; category : ?Text; requested : Bool }] = [];
    for (m in groupMetadata.values()) {
      if (m.club_id == ?club_id and m.team_id == null and not m.deleted) {
        let p = joinPolicyOf(m.conversation_id);
        if (p.join_policy != "invite_only") {
          let requested = joinRequests.any(func(r) = r.conversation_id == m.conversation_id and r.user.equal(caller) and r.status == "pending");
          out := out.concat([{ summary = toGroupSummary(caller, m); join_policy = p.join_policy; category = p.category; requested }]);
        };
      };
    };
    #Ok(out)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func join_open_group(conversation_id : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (joinPolicyOf(conversation_id).join_policy != "open_to_club") return #Err("Group is not open");
    switch (getGroupMetadataFor(conversation_id), findConversationIndex(conversation_id)) {
      case (?meta, ?ci) {
        if (meta.deleted) return #Err("Group deleted");
        let club = switch (meta.club_id) { case (?c) c; case null { return #Err("Not a club group") } };
        if (not canBrowseClubGroups(caller, club)) return #Err("Club access forbidden");
        if (not meta.members.any(func(p) = p.equal(caller))) {
          if (meta.members.size() >= GROUP_MEMBER_LIMIT) return #Err("Group is full");
          let updated : Types.GroupMetadata = { meta with members = meta.members.concat([caller]) };
          groupMetadata := groupMetadata.filter(func(m) = m.conversation_id != conversation_id);
          groupMetadata := groupMetadata.concat([updated]);
          groupRoles := groupRoles.concat([{ conversation_id; user = caller; role = "member" }]);
        };
        let conv = conversations[ci];
        if (not conv.participants.any(func(p) = p.equal(caller))) {
          mediaEvidenceRevision += 1;
          conversations := Array.tabulate<Types.Conversation>(conversations.size(), func(pos) = if (pos == ci) { { conv with participants = conv.participants.concat([caller]) } } else { conversations[pos] });
        };
        #Ok
      };
      case (_, _) { #Err("Group not found") };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func reject_join_request(conversation_id : Text, user : Principal) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isGroupAdmin(caller, conversation_id)) return #Err("Group admin required");
    joinRequests := Array.map<Types.JoinRequest, Types.JoinRequest>(joinRequests, func(r) = if (r.conversation_id == conversation_id and r.user.equal(user)) { { r with status = "rejected" } } else { r });
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func list_join_requests(conversation_id : Text) : async { #Ok : [Types.JoinRequest]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await* requireChatAccess(caller, conversation_id);
    if (not isGroupAdmin(caller, conversation_id)) return #Err("Group admin required");
    #Ok(joinRequests.filter(func(r) = r.conversation_id == conversation_id))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== Polls =====================

  func findPollIndex(poll_id : Text) : ?Nat {
    var idx = 0;
    for (p in polls.values()) { if (p.id == poll_id) { return ?idx }; idx += 1 };
    null
  };

  public shared ({ caller }) func create_poll(conversation_id : Text, message_id : ?Text, question : Text, options : [Text]) : async { #Ok : Types.Poll; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    if (not valid(question) or options.size() < 2 or options.size() > 10) return #Err("Invalid poll");
    if (options.any(func(o) = not valid(o))) return #Err("Invalid poll option");
    let poll : Types.Poll = {
      id = "poll-" # conversation_id # "-" # Nat.toText(polls.size() + 1);
      conversation_id; message_id; question; options; creator = caller; closed = false; created_at_ms = nowMs();
    };
    polls := polls.concat([poll]);
    #Ok(poll)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func vote_poll(poll_id : Text, option_index : Nat32) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requirePollChatAccess(caller, poll_id);
    auth(caller);
    switch (findPollIndex(poll_id)) {
      case null { #Err("Poll not found") };
      case (?i) {
        let poll = polls[i];
        if (poll.closed) return #Err("Poll closed");
        if (not canAccessConversation(caller, poll.conversation_id)) return #Err("Conversation access forbidden");
        if (Nat32.toNat(option_index) >= poll.options.size()) return #Err("Invalid option");
        pollVotes := pollVotes.filter(func(v) = not (v.poll_id == poll_id and v.user.equal(caller)));
        pollVotes := pollVotes.concat([{ poll_id; user = caller; option_index }]);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func close_poll(poll_id : Text) : async { #Ok : Types.Poll; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requirePollChatAccess(caller, poll_id);
    auth(caller);
    switch (findPollIndex(poll_id)) {
      case null { #Err("Poll not found") };
      case (?i) {
        let poll = polls[i];
        if (not poll.creator.equal(caller) and not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return #Err("Poll close forbidden");
        let updated = { poll with closed = true };
        polls := Array.tabulate<Types.Poll>(polls.size(), func(pos) = if (pos == i) updated else polls[pos]);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Same gating as close_poll: poll creator, governor, or app_admin. Removes
  // the poll and every vote cast on it.
  public shared ({ caller }) func delete_poll(poll_id : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requirePollChatAccess(caller, poll_id);
    auth(caller);
    switch (findPollIndex(poll_id)) {
      case null { #Err("Poll not found") };
      case (?i) {
        let poll = polls[i];
        if (not poll.creator.equal(caller) and not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return #Err("Poll delete forbidden");
        polls := polls.filter(func(p) = p.id != poll_id);
        pollVotes := pollVotes.filter(func(v) = v.poll_id != poll_id);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Counts and votes for one poll. Shared by get_poll_results and the
  // open_conversation bundle so both return identical results.
  func pollResultsFor(poll : Types.Poll) : Types.PollResults {
    var counts = Array.repeat<Nat32>(0, poll.options.size());
    var total : Nat32 = 0;
    for (v in pollVotes.values()) {
      if (v.poll_id == poll.id) {
        let idx = Nat32.toNat(v.option_index);
        if (idx < counts.size()) {
          counts := Array.tabulate<Nat32>(counts.size(), func(pos) = if (pos == idx) counts[pos] + 1 else counts[pos]);
          total += 1;
        };
      };
    };
    { poll; counts; total_votes = total; votes = ?pollVotes.filter(func(v) = v.poll_id == poll.id and Nat32.toNat(v.option_index) < poll.options.size()) }
  };

  public shared ({ caller }) func get_poll_results(poll_id : Text) : async { #Ok : Types.PollResults; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    await* requirePollChatAccess(caller, poll_id);
    denyLegacyAccountQuery();
    switch (findPollIndex(poll_id)) {
      case null { #Err("Poll not found") };
      case (?i) {
        let poll = polls[i];
        if (not canAccessConversation(caller, poll.conversation_id)) return #Err("Conversation access forbidden");
        #Ok(pollResultsFor(poll))
      };
    }
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== Mute preferences (storage only) =====================

  public shared ({ caller }) func set_mute_preference(conversation_id : Text, muted : Bool) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    mutePreferences := mutePreferences.filter(func(m) = not (m.user.equal(caller) and m.conversation_id == conversation_id));
    mutePreferences := mutePreferences.concat([{ user = caller; conversation_id; muted }]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ---- Batched reads (same visibility as the single-id queries; capped) ----
  public query ({ caller }) func get_mute_preferences(conversation_ids : [Text]) : async { #Ok : [(Text, Bool)]; #Err : Text } {
    denyLegacyAccountQuery();
    if (conversation_ids.size() > 300) return #Err("Too many ids");
    if (caller.equal(Principal.anonymous())) return #Ok(Array.map<Text, (Text, Bool)>(conversation_ids, func(id) = (id, false)));
    #Ok(Array.map<Text, (Text, Bool)>(conversation_ids, func(id) {
      var muted = false;
      for (m in mutePreferences.values()) {
        if (m.user.equal(caller) and m.conversation_id == id) { muted := m.muted };
      };
      (id, muted)
    }))
  };

  public shared ({ caller }) func get_group_metadata_multi(conversation_ids : [Text]) : async { #Ok : [Types.GroupMetadata]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    if (conversation_ids.size() > 300) return #Err("Too many ids");
    var out : [Types.GroupMetadata] = [];
    for (id in conversation_ids.values()) {
      await* requireChatAccess(caller, id);
      if (canReadTeamMessages(caller, id) or canAccessConversation(caller, id)) {
        switch (getGroupMetadataFor(id)) { case (?meta) { out := out.concat([meta]) }; case null {} };
      };
    };
    #Ok(out)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func list_groups_by_clubs(club_ids : [Text]) : async { #Ok : [Types.GroupSummary]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    if (club_ids.size() > 200) return #Err("Too many ids");
    for (club in club_ids.values()) { await* requireChatClubMember(caller, club) };
    let allowed = club_ids.filter(func(c) = valid(c) and canBrowseClubGroups(caller, c));
    let matches = groupMetadata.filter(func(m) =
      m.team_id == null and not m.deleted and (switch (m.club_id) { case (?c) allowed.any(func(a) = a == c); case null false })
    );
    #Ok(Array.map<Types.GroupMetadata, Types.GroupSummary>(matches, func(m) = toGroupSummary(caller, m)))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func get_mute_preference(conversation_id : Text) : async Bool {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await* requireChatAccess(caller, conversation_id);
    if (caller.equal(Principal.anonymous())) return false;
    for (m in mutePreferences.values()) {
      if (m.user.equal(caller) and m.conversation_id == conversation_id) { return m.muted };
    };
    false
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== Deterministic DM create/lookup =====================

  public shared ({ caller }) func get_or_create_dm(other : Principal) : async { #Ok : Types.Conversation; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (other.equal(Principal.anonymous()) or other.equal(caller)) return #Err("Invalid DM target");
    if (isBlockedPair(caller, other)) return #Err("Direct message blocked");
    let aText = Principal.toText(caller);
    let bText = Principal.toText(other);
    let (loText, loP, hiP) = if (aText < bText) { (aText, caller, other) } else { (bText, other, caller) };
    ignore loText;
    for (link in dmLinks.values()) {
      if ((link.a.equal(loP) and link.b.equal(hiP))) {
        for (c in conversations.values()) { if (c.id == link.conversation_id) { return #Ok(c) } };
      };
    };
    let conversation : Types.Conversation = {
      id = "dm-" # Nat.toText(conversations.size() + 1);
      club_id = "dm"; team_id = null; participants = [loP, hiP]; next_sequence = 1;
    };
    mediaEvidenceRevision += 1;
    conversations := conversations.concat([conversation]);
    dmLinks := dmLinks.concat([{ a = loP; b = hiP; conversation_id = conversation.id }]);
    #Ok(conversation)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== Forward message =====================

  public shared ({ caller }) func forward_message(message_id : Text, to_conversation_id : Text) : async { #Ok : Types.Message; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireMessageChatAccess(caller, message_id);
    if (msgFenced(message_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    await* requireChatAccess(caller, to_conversation_id);
    var original : ?Types.Message = null;
    for (m in messages.values()) { if (m.id == message_id) { original := ?m } };
    switch (original) {
      case null { #Err("Message not found") };
      case (?orig) {
        if (not canReadTeamMessages(caller, orig.conversation_id) and not canAccessConversation(caller, orig.conversation_id)) return #Err("Source conversation access forbidden");
        if (not canAccessConversation(caller, to_conversation_id)) return #Err("Target conversation access forbidden");
        switch (findConversationIndex(to_conversation_id)) {
          case null { #Err("Target conversation not found") };
          case (?ci) {
            let key = "fwd-" # message_id # "-" # to_conversation_id;
            for (m in messages.values()) {
              if (m.conversation_id == to_conversation_id and m.idempotency_key == key) { return #Ok(m) };
            };
            await* requireMessageChatAccess(caller, message_id);
            if (not canReadTeamMessages(caller, orig.conversation_id)) return #Err("Source conversation access forbidden");
            let posted = switch (await* sendAs(caller, to_conversation_id, orig.body, key, orig.attachment, null)) {
              case (#Err(e)) return #Err(e); case (#Ok(m)) m;
            };
            forwardRecords := forwardRecords.concat([{ message_id = posted.id; to_conversation_id; from_conversation_id = orig.conversation_id; from_message_id = orig.id; original_sender = orig.sender }]);
            #Ok(posted)
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== Scheduled messages & attachment metadata =====================

  transient let SCHEDULED_MESSAGE_LIMIT_PER_CONVERSATION = 200;

  public shared ({ caller }) func register_scheduled_message(conversation_id : Text, body : Text, scheduled_at_ms : Nat64) : async { #Ok : Types.ScheduledMessage; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    if (not validBody(body)) return #Err("Invalid message body");
    if (scheduledMessages.filter(func(r) = r.conversation_id == conversation_id).size() >= SCHEDULED_MESSAGE_LIMIT_PER_CONVERSATION) {
      return #Err("Scheduled message limit reached: at most " # Nat.toText(SCHEDULED_MESSAGE_LIMIT_PER_CONVERSATION) # " per conversation");
    };
    let rec : Types.ScheduledMessage = {
      id = "sched-" # conversation_id # "-" # Nat.toText(scheduledMessages.size() + 1);
      conversation_id; sender = caller; body; scheduled_at_ms; replayed_at_ms = null; replayed_message_id = null;
    };
    mediaEvidenceRevision += 1;
    scheduledMessages := scheduledMessages.concat([rec]);
    #Ok(rec)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func replay_scheduled_message(id : Text) : async { #Ok : Types.ScheduledMessage; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (msgFenced(id) or convFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    var found_idx : ?Nat = null;
    var idx = 0;
    for (r in scheduledMessages.values()) { if (r.id == id) { found_idx := ?idx }; idx += 1 };
    switch (found_idx) {
      case null { #Err("Scheduled message not found") };
      case (?i) {
        let captured = scheduledMessages[i];
        await admitAccount(captured.sender);
        let freshIndex = switch (scheduledMessages.findIndex(func(r) = r.id == id)) { case null return #Err("Scheduled message not found"); case (?n) n };
        let rec = scheduledMessages[freshIndex];
        if (rec != captured) return #Err("Scheduled message changed");
        await* requireChatAccess(rec.sender, rec.conversation_id);
        if (not canAccessConversation(rec.sender, rec.conversation_id)) return #Err("Conversation access forbidden");
        if (rec.replayed_at_ms != null) return #Ok(rec);
        if (not rec.sender.equal(caller) and not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return #Err("Replay forbidden");
        switch (findConversationIndex(rec.conversation_id)) {
          case null { #Err("Conversation not found") };
          case (?ci) {
            let posted = switch (await* sendAs(rec.sender, rec.conversation_id, rec.body, "sched-" # rec.id, null, null)) {
              case (#Err(e)) return #Err(e); case (#Ok(m)) m;
            };
            let updated = { rec with replayed_at_ms = ?nowMs(); replayed_message_id = ?posted.id };
            mediaEvidenceRevision += 1;
            scheduledMessages := Array.tabulate<Types.ScheduledMessage>(scheduledMessages.size(), func(pos) = if (scheduledMessages[pos].id == id) updated else scheduledMessages[pos]);
            #Ok(updated)
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  transient let ATTACHMENT_METADATA_LIMIT_PER_CONVERSATION = 1000;

  public shared ({ caller }) func register_attachment_metadata(conversation_id : Text, message_id : ?Text, kind : Text, ref_id : Text, url : ?Text, size_bytes : ?Nat64) : async { #Ok : Types.AttachmentMetadata; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    if (not validAttachment({ kind; ref_id; url })) return #Err("Invalid attachment metadata");
    if (attachmentMetadata.filter(func(a) = a.conversation_id == conversation_id).size() >= ATTACHMENT_METADATA_LIMIT_PER_CONVERSATION) {
      return #Err("Attachment limit reached: at most " # Nat.toText(ATTACHMENT_METADATA_LIMIT_PER_CONVERSATION) # " per conversation");
    };
    let rec : Types.AttachmentMetadata = {
      id = "att-" # conversation_id # "-" # Nat.toText(attachmentMetadata.size() + 1);
      conversation_id; message_id; kind; ref_id; url; size_bytes; uploader = caller; created_at_ms = nowMs();
    };
    mediaEvidenceRevision += 1;
    attachmentMetadata := attachmentMetadata.concat([rec]);
    #Ok(rec)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== Reactions & chat catch-up / recap =====================

  public shared ({ caller }) func toggle_reaction(message_id : Text, emoji : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireMessageChatAccess(caller, message_id);
    if (msgFenced(message_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not valid(emoji)) return #Err("Invalid reaction");
    switch (messages.find(func(m) = m.id == message_id)) {
      case null return #Err("Message not found");
      case (?m) {
        if (not canReadTeamMessages(caller, m.conversation_id) and not canAccessConversation(caller, m.conversation_id)) return #Err("Conversation access forbidden");
      };
    };
    if (reactions.any(func(r) = r.message_id == message_id and r.user.equal(caller) and r.emoji == emoji)) {
      reactions := reactions.filter(func(r) = not (r.message_id == message_id and r.user.equal(caller) and r.emoji == emoji));
    } else {
      reactions := reactions.concat([{ message_id; user = caller; emoji }]);
    };
    mediaEvidenceRevision += 1;
    ignore fanOutWsReactionPoke(message_id);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== Realtime pokes (IC WebSocket) =====================
  // The four standard gateway-facing methods the IC WebSocket gateway
  // requires. All state and authorization live in the SDK; the app layer
  // only ever sends poke messages (Types.WsAppMessage).

  public shared ({ caller }) func ws_open(args : IcWebSocketCdk.CanisterWsOpenArguments) : async IcWebSocketCdk.CanisterWsOpenResult {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    await ws.ws_open(caller, args);
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func ws_close(args : IcWebSocketCdk.CanisterWsCloseArguments) : async IcWebSocketCdk.CanisterWsCloseResult {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    await ws.ws_close(caller, args);
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func ws_message(args : IcWebSocketCdk.CanisterWsMessageArguments, msg_type : ?Types.WsAppMessage) : async IcWebSocketCdk.CanisterWsMessageResult {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    await ws.ws_message(caller, args, msg_type);
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  /// Location-only lookup for group routing: which club owns this chat, if
  /// it lives in this canister. Participants only; null when not held here.
  public shared ({ caller }) func read_conversation_club(conversation_id : Text) : async { #Ok : ?Text; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await* requireChatAccess(caller, conversation_id);
    if (Principal.isAnonymous(caller)) return #Err("Sign in required");
    switch (findConversationIndex(conversation_id)) {
      case null { #Ok(null) };
      case (?i) { if (not canAccessConversation(caller, conversation_id)) #Err("Forbidden") else #Ok(?conversations[i].club_id) };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared query ({ caller }) func ws_get_messages(args : IcWebSocketCdk.CanisterWsGetMessagesArguments) : async IcWebSocketCdk.CanisterWsGetMessagesResult {
    ws.ws_get_messages(caller, args);
  };

  func reactionsSummaryFor(message_id : Text) : [Types.ReactionSummary] {
    var summary : [Types.ReactionSummary] = [];
    for (r in reactions.values()) {
      if (r.message_id == message_id) {
        var found = false;
        summary := Array.map<Types.ReactionSummary, Types.ReactionSummary>(summary, func(s) = if (s.emoji == r.emoji) { found := true; { s with count = s.count + 1 } } else { s });
        if (not found) { summary := summary.concat([{ emoji = r.emoji; count = 1 : Nat32 }]) };
      };
    };
    summary
  };

  public shared ({ caller }) func messages_since(conversation_id : Text, since_ms : Nat64) : async { #Ok : [Types.MessageWithReactions]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await* requireChatAccess(caller, conversation_id);
    if (not canReadTeamMessages(caller, conversation_id)) return #Err("Conversation access forbidden");
    var result : [Types.MessageWithReactions] = [];
    for (m in messages.values()) {
      if (m.conversation_id == conversation_id and m.created_at_ms > since_ms and result.size() < 200) {
        result := result.concat([{ message = m; reactions = reactionsSummaryFor(m.id) }]);
      };
    };
    #Ok(result)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== Per-club DM settings =====================

  func defaultClubDmSettings(club_id : Text) : Types.ClubDmSettings {
    { club_id; dm_disabled = false; attachments_disabled = false; allowed_roles = ["app_admin", "club_admin", "team_admin"]; force_disable_previews = false; ai_catch_up_enabled = true }
  };

  func requireClubAdmin(caller : Principal, club_id : Text) : ?Text {
    if (not isGovernor(caller) and not hasRole(caller, "app_admin", null, null) and not hasRole(caller, "club_admin", ?club_id, null)) return ?"Club admin required";
    if (not valid(club_id)) return ?"Invalid club";
    null
  };

  // Local roles are only governor-granted; club admins live on club_domain.
  // Fall back to the authoritative club_domain admin list (fail-closed if unset).
  func requireClubAdminLive(caller : Principal, club_id : Text) : async ?Text {
    if (removalReceiver.denied(caller)) return ?"Account removal fenced";
    switch (requireClubAdmin(caller, club_id)) {
      case null { return null };
      case (?e) {
        if (not valid(club_id)) return ?e;
        switch (await clubDomainRef()) {
          case null { ?e };
          case (?cd) {
            let admins = try { await cd.list_club_admins(club_id) } catch (_) { [] };
            if (removalReceiver.denied(caller)) return ?"Account removal fenced";
            if (admins.any(func(p : Principal) : Bool = p.equal(caller))) null else {
              let appAdmin = try { if (accountAdmissionEnabled) await cd.read_account_is_app_admin(caller) else await cd.is_app_admin(caller) } catch (_) { false };
              if (removalReceiver.denied(caller)) return ?"Account removal fenced";
              if (appAdmin) null else ?e
            }
          };
        }
      };
    }
  };

  public shared ({ caller }) func set_club_dm_settings(club_id : Text, dm_disabled : Bool, attachments_disabled : Bool) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    let configured = clubDomainCanister;
    switch (await requireClubAdminLive(caller, club_id)) { case (?e) return #Err(e); case null {} };
    await admitAccount(caller);
    if (configured != clubDomainCanister or isFenced(club_id)) return #Err("Club authorization changed");
    let existing = defaultClubDmSettings(club_id);
    let current = switch (clubDmSettings.find(func(s) = s.club_id == club_id)) { case (?s) s; case null existing };
    clubDmSettings := clubDmSettings.filter(func(s) = s.club_id != club_id);
    clubDmSettings := clubDmSettings.concat([{ current with club_id; dm_disabled; attachments_disabled }]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func set_club_dm_allowed_roles(club_id : Text, allowed_roles : [Text]) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    let configured = clubDomainCanister;
    switch (await requireClubAdminLive(caller, club_id)) { case (?e) return #Err(e); case null {} };
    await admitAccount(caller);
    if (configured != clubDomainCanister or isFenced(club_id)) return #Err("Club authorization changed");
    let current = switch (clubDmSettings.find(func(s) = s.club_id == club_id)) { case (?s) s; case null defaultClubDmSettings(club_id) };
    clubDmSettings := clubDmSettings.filter(func(s) = s.club_id != club_id);
    clubDmSettings := clubDmSettings.concat([{ current with club_id; allowed_roles }]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func set_club_message_privacy(club_id : Text, force_disable_previews : Bool) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    let configured = clubDomainCanister;
    switch (await requireClubAdminLive(caller, club_id)) { case (?e) return #Err(e); case null {} };
    await admitAccount(caller);
    if (configured != clubDomainCanister or isFenced(club_id)) return #Err("Club authorization changed");
    let current = switch (clubDmSettings.find(func(s) = s.club_id == club_id)) { case (?s) s; case null defaultClubDmSettings(club_id) };
    clubDmSettings := clubDmSettings.filter(func(s) = s.club_id != club_id);
    clubDmSettings := clubDmSettings.concat([{ current with club_id; force_disable_previews }]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func set_club_ai_catch_up(club_id : Text, ai_catch_up_enabled : Bool) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    let configured = clubDomainCanister;
    switch (await requireClubAdminLive(caller, club_id)) { case (?e) return #Err(e); case null {} };
    await admitAccount(caller);
    if (configured != clubDomainCanister or isFenced(club_id)) return #Err("Club authorization changed");
    let current = switch (clubDmSettings.find(func(s) = s.club_id == club_id)) { case (?s) s; case null defaultClubDmSettings(club_id) };
    clubDmSettings := clubDmSettings.filter(func(s) = s.club_id != club_id);
    clubDmSettings := clubDmSettings.concat([{ current with club_id; ai_catch_up_enabled }]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func enable_ai_catch_up_for_all_members(club_id : Text) : async { #Ok : Nat32; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    let configured = clubDomainCanister;
    switch (await requireClubAdminLive(caller, club_id)) { case (?e) return #Err(e); case null {} };
    await admitAccount(caller);
    if (configured != clubDomainCanister or isFenced(club_id)) return #Err("Club authorization changed");
    var count : Nat32 = 0;
    for (m in clubMemberships.values()) {
      if (m.club_id == club_id) {
        let already = userMessagingSettings.find(func(s) = s.user.equal(m.user));
        switch (already) {
          case (?s) {
            if (not s.ai_catchup_enabled) {
              userMessagingSettings := userMessagingSettings.filter(func(x) = not x.user.equal(m.user));
              userMessagingSettings := userMessagingSettings.concat([{ s with ai_catchup_enabled = true }]);
              count += 1;
            };
          };
          case null {
            userMessagingSettings := userMessagingSettings.concat([{ user = m.user; hide_message_preview = false; ai_catchup_enabled = true }]);
            count += 1;
          };
        };
      };
    };
    #Ok(count)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public query func get_club_dm_settings(club_id : Text) : async Types.ClubDmSettings {
    for (s in clubDmSettings.values()) { if (s.club_id == club_id) { return s } };
    defaultClubDmSettings(club_id)
  };

  // ===================== Per-user messaging settings =====================

  public shared ({ caller }) func set_user_messaging_settings(hide_message_preview : Bool, ai_catchup_enabled : Bool) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    userMessagingSettings := userMessagingSettings.filter(func(s) = not s.user.equal(caller));
    userMessagingSettings := userMessagingSettings.concat([{ user = caller; hide_message_preview; ai_catchup_enabled }]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public query ({ caller }) func get_user_messaging_settings() : async Types.UserMessagingSettings {
    denyLegacyAccountQuery();
    for (s in userMessagingSettings.values()) { if (s.user.equal(caller)) { return s } };
    { user = caller; hide_message_preview = false; ai_catchup_enabled = false }
  };

  // ===================== Per-club unread breakdown =====================

  public shared ({ caller }) func unread_count_by_club(principal : Principal) : async { #Ok : [Types.ClubUnreadSummary]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    if (not caller.equal(principal) and not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return #Err("Access forbidden");
    var result : [Types.ClubUnreadSummary] = [];
    for (conversation in conversations.values()) {
      let visible = try { await* requireChatAccess(principal, conversation.id); true } catch (_) { false };
      if (visible and conversation.participants.any(func(p) = p.equal(principal))) {
        let u = unreadFor(principal, conversation.id);
        if (u.count > 0) {
          var found = false;
          result := Array.map<Types.ClubUnreadSummary, Types.ClubUnreadSummary>(result, func(s) = if (s.club_id == conversation.club_id) { found := true; { s with count = s.count + u.count } } else { s });
          if (not found) { result := result.concat([{ club_id = conversation.club_id; count = u.count }]) };
        };
      };
    };
    #Ok(result)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== Recent conversations rail =====================

  public shared ({ caller }) func recent_conversations(principal : Principal, limit : Nat16) : async { #Ok : [Types.RecentConversation]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    if (not caller.equal(principal) and not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return #Err("Access forbidden");
    if (limit == 0 or limit > 100) return #Err("Invalid limit");
    var entries : [Types.RecentConversation] = [];
    for (conversation in conversations.values()) {
      let visible = try { await* requireChatAccess(principal, conversation.id); true } catch (_) { false };
      if (visible and conversation.participants.any(func(p) = p.equal(principal)) and not isGroupDeleted(conversation.id)) {
        let lastSeq : Nat64 = if (conversation.next_sequence == 0) 0 else conversation.next_sequence - 1;
        entries := entries.concat([{ conversation_id = conversation.id; kind = inferConversationKind(conversation); last_message_sequence = lastSeq; last_message_at_ms = null }]);
      };
    };
    let sorted = entries.sort(func(a, b) = Nat64.compare(b.last_message_sequence, a.last_message_sequence));
    let take = if (sorted.size() < Nat16.toNat(limit)) sorted.size() else Nat16.toNat(limit);
    #Ok(Array.tabulate<Types.RecentConversation>(take, func(i) = sorted[i]))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== AI chat recap (HTTPS outcall) =====================
  // The recap is generated by an external AI endpoint configured by the
  // governor. The api_key lives in canister state, which node providers can
  // read — only ever store a scoped/limited key here.

  public shared ({ caller }) func set_recap_config(config : ?Types.RecapConfig) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    switch (config) {
      case (?c) {
        if (not Text.startsWith(c.endpoint_url, #text "https://") or c.endpoint_url.size() > 2048) return #Err("Endpoint must be a public https:// URL");
        if (c.api_key == "" or c.model == "") return #Err("Invalid recap config");
      };
      case null {};
    };
    recapConfig := config;
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Transform for the recap outcall: strip all response headers. In
  // non-replicated mode a transform is not needed for consensus, but this
  // also keeps the candid-encoded output small against max_response_bytes.
  public query func recapTransform({
    context : Blob;
    response : IC.HttpRequestResult;
  }) : async IC.HttpRequestResult {
    { response with headers = [] };
  };

  func truncateText(t : Text, n : Nat) : Text {
    if (t.size() <= n) return t;
    let chars = Text.toArray(t);
    Text.fromArray(Array.tabulate<Char>(n, func(i) = chars[i]))
  };

  func jsonEscape(t : Text) : Text {
    var s = Text.replace(t, #text "\\", "\\\\");
    s := Text.replace(s, #text "\"", "\\\"");
    s := Text.replace(s, #text "\n", "\\n");
    s := Text.replace(s, #text "\r", "\\r");
    s := Text.replace(s, #text "\t", "\\t");
    s
  };

  // Minimal, tolerant extraction: returns the first JSON string value of
  // `key` ("summary" or "text"), or null if not found. Not a full parser —
  // the fallback in generate_chat_recap returns the raw body instead.
  func findJsonStringValue(body : Text, key : Text) : ?Text {
    let needle = "\"" # key # "\"";
    let parts = Text.toArray(body);
    let n = Text.toArray(needle);
    let size = parts.size();
    var i = 0;
    label search while (i + n.size() < size) {
      var matched = true;
      var j = 0;
      while (j < n.size()) {
        if (parts[i + j] != n[j]) { matched := false; j := n.size() } else { j += 1 };
      };
      if (matched) {
        // Find the opening quote of the value after the colon.
        var k = i + n.size();
        while (k < size and parts[k] != '\u{22}') {
          if (parts[k] == '}' or parts[k] == ',') { return null };
          k += 1;
        };
        if (k >= size) return null;
        k += 1;
        var value = "";
        var escaped = false;
        label read while (k < size) {
          let c = parts[k];
          if (escaped) {
            value := value # (switch (c) { case ('n') { "\n" }; case ('t') { "\t" }; case ('r') { "\r" }; case (_) { Text.fromArray([c]) } });
            escaped := false;
          } else if (c == '\\') {
            escaped := true;
          } else if (c == '\u{22}') {
            return ?value;
          } else {
            value := value # Text.fromArray([c]);
          };
          k += 1;
        };
        return null;
      };
      i += 1;
    };
    null
  };

  // Builds the transcript text for a conversation: newest messages first up
  // to ~80 messages / ~6000 chars, then reversed to chronological order for
  // the prompt (recency cap keeps the LLM call small and fast).
  func buildRecapTranscript(conversation_id : Text, since_ms : Nat64) : Text {
    let MAX_MESSAGES = 80;
    let MAX_CHARS = 6000;
    var picked : [Types.Message] = [];
    for (m in messages.values()) {
      if (m.conversation_id == conversation_id and m.created_at_ms > since_ms) {
        picked := picked.concat([m]);
      };
    };
    // Newest first, capped, then reversed back to chronological order.
    let sorted = picked.sort(func(a, b) = Nat64.compare(b.created_at_ms, a.created_at_ms));
    let cap = if (sorted.size() < MAX_MESSAGES) sorted.size() else MAX_MESSAGES;
    let newest = Array.tabulate<Types.Message>(cap, func(i) = sorted[i]);
    let chronological = Array.tabulate<Types.Message>(cap, func(i) = newest[cap - 1 - i]);
    var transcript = "";
    for (m in chronological.values()) {
      let line = Principal.toText(m.sender) # ": " # truncateText(m.body, 400) # "\n";
      if (transcript.size() + line.size() <= MAX_CHARS) {
        transcript := transcript # line;
      };
    };
    transcript
  };

  // Caller must be a member of the conversation (reuses the same read-access
  // check as the rest of the messaging surface) and have AI catch-up enabled.
  func authorizeRecapCaller(caller : Principal, conversation_id : Text) : ?Text {
    if (not canReadTeamMessages(caller, conversation_id)) return ?"Conversation access forbidden";
    let settings = userMessagingSettings.find(func(s) = s.user.equal(caller));
    let catchupEnabled = switch (settings) { case (?s) { s.ai_catchup_enabled }; case null { false } };
    if (not catchupEnabled and not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return ?"AI catch-up is disabled for this member";
    null
  };

  // Generates a chat recap for `scope_id` (a conversation id) from messages
  // stored on this canister since `since_ms` (defaults to 7 days back when
  // omitted). Uses DFINITY's free on-chain LLM canister — no HTTPS outcall,
  // no API key, no third-party data sharing.
  public shared ({ caller }) func generate_chat_recap(scope_id : Text, since_ms : ?Nat64) : async { #Ok : Text; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, scope_id);
    auth(caller);
    switch (authorizeRecapCaller(caller, scope_id)) {
      case (?err) { return #Err(err) };
      case null {};
    };
    if (not checkAndMarkRecapRateLimit(caller)) return #Err("Please wait a moment before requesting another recap");
    let SEVEN_DAYS_MS : Nat64 = 7 * 24 * 3600 * 1000;
    let effectiveSince = switch (since_ms) {
      case (?s) { s };
      case null { let now : Nat64 = nowMs(); if (now > SEVEN_DAYS_MS) (now - SEVEN_DAYS_MS) else (0 : Nat64) };
    };
    let transcript = buildRecapTranscript(scope_id, effectiveSince);
    if (transcript == "") return #Err("No new messages to recap");
    let result = await runRecapCompletion(transcript);
    await admitAccount(caller);
    await* requireChatAccess(caller, scope_id);
    switch (authorizeRecapCaller(caller, scope_id)) { case (?err) #Err(err); case null result }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Variant for scopes whose message bodies are client-encrypted (PII), where
  // this canister cannot read plaintext: the caller supplies an
  // already-decrypted transcript. Same membership + rate-limit gating as
  // generate_chat_recap.
  public shared ({ caller }) func summarize_transcript(scope_id : Text, transcript : Text) : async { #Ok : Text; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, scope_id);
    auth(caller);
    switch (authorizeRecapCaller(caller, scope_id)) {
      case (?err) { return #Err(err) };
      case null {};
    };
    if (transcript == "") return #Err("No new messages to recap");
    if (not checkAndMarkRecapRateLimit(caller)) return #Err("Please wait a moment before requesting another recap");
    let result = await runRecapCompletion(truncateText(transcript, 6000));
    await admitAccount(caller);
    await* requireChatAccess(caller, scope_id);
    switch (authorizeRecapCaller(caller, scope_id)) { case (?err) #Err(err); case null result }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== Presence (online count) =====================

  // Record the caller's heartbeat. The frontend calls this on an interval;
  // online counts are derived at read time from last_seen_ms.
  public shared ({ caller }) func presence_heartbeat(platform : ?Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    let now = nowMs();
    presence := presence.filter(func(entry) = not entry.user.equal(caller));
    presence := presence.concat([{ user = caller; last_seen_ms = now; platform }]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Every user with a heartbeat inside the 150-second online window. App
  // admin only — this is the OnlineUsersPage/OnlineUsersTab admin surface,
  // not something members should be able to enumerate.
  public query ({ caller }) func list_all_online_users() : async { #Ok : [Types.OnlineUser]; #Err : Text } {
    denyLegacyAccountQuery();
    if (caller.equal(Principal.anonymous())) return #Err("Authenticated caller required");
    if (not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return #Err("App admin required");
    let now = nowMs();
    let windowMs : Nat64 = 150_000;
    let online = presence.filter(func(entry) = entry.last_seen_ms + windowMs >= now);
    #Ok(online.map<Types.PresencePing, Types.OnlineUser>(func(entry) = { user = entry.user; last_seen_ms = entry.last_seen_ms; platform = entry.platform }))
  };

  // ===================== System messages (welcome DM) =====================

  // Governor-only: posts a message into the caller<->target DM, creating the
  // conversation if needed. Bypasses the block check — system announcements
  // (e.g. the post-signup welcome DM) must always deliver.
  public shared ({ caller }) func send_system_message(to_user : Principal, body : Text, idempotency_key : Text) : async { #Ok : Types.Message; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor required");
    if (to_user.equal(Principal.anonymous()) or to_user.equal(caller)) return #Err("Invalid DM target");
    if (body == "" or body.size() > 4000) return #Err("Invalid message body");
    if (not valid(idempotency_key)) return #Err("Invalid idempotency key");
    // Idempotent: a retried send returns the already-posted message.
    for (m in messages.values()) {
      if (m.sender.equal(caller) and m.idempotency_key == idempotency_key) {
        return #Ok(m);
      };
    };
    let aText = Principal.toText(caller);
    let bText = Principal.toText(to_user);
    let (loP, hiP) = if (aText < bText) { (caller, to_user) } else { (to_user, caller) };
    var conv_id : ?Text = null;
    for (link in dmLinks.values()) {
      if (link.a.equal(loP) and link.b.equal(hiP)) { conv_id := ?link.conversation_id };
    };
    switch (conv_id) {
      case null {
        let conversation : Types.Conversation = {
          id = "dm-" # Nat.toText(conversations.size() + 1);
          club_id = "dm"; team_id = null; participants = [loP, hiP]; next_sequence = 1;
        };
        mediaEvidenceRevision += 1;
        conversations := conversations.concat([conversation]);
        dmLinks := dmLinks.concat([{ a = loP; b = hiP; conversation_id = conversation.id }]);
        conv_id := ?conversation.id;
      };
      case (?_) {};
    };
    switch (findConversationIndex(switch (conv_id) { case (?id) id; case null return #Err("Conversation not found") })) {
      case null { #Err("Conversation not found") };
      case (?i) {
        let posted = postMessage(i, caller, body, idempotency_key, null, null);
        ignore fanOutChatNotify(posted);
        ignore fanOutWsPokeForMessage(posted);
        #Ok(posted)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Any authenticated caller may trigger their OWN post-signup welcome DM.
  // The sender is always the governor (the support identity) and the
  // idempotency key is derived from the caller, so it is safe to call on
  // every sign-in — only the first call posts a message.
  public shared ({ caller }) func send_welcome_message(body : Text) : async { #Ok : Types.Message; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (caller.equal(governor)) return #Err("Governor cannot welcome themselves");
    if (body == "" or body.size() > 4000) return #Err("Invalid message body");
    let idempotency_key = "welcome:" # Principal.toText(caller);
    for (m in messages.values()) {
      if (m.idempotency_key == idempotency_key) {
        return #Ok(m);
      };
    };
    let aText = Principal.toText(governor);
    let bText = Principal.toText(caller);
    let (loP, hiP) = if (aText < bText) { (governor, caller) } else { (caller, governor) };
    var conv_id : ?Text = null;
    for (link in dmLinks.values()) {
      if (link.a.equal(loP) and link.b.equal(hiP)) { conv_id := ?link.conversation_id };
    };
    switch (conv_id) {
      case null {
        let conversation : Types.Conversation = {
          id = "dm-" # Nat.toText(conversations.size() + 1);
          club_id = "dm"; team_id = null; participants = [loP, hiP]; next_sequence = 1;
        };
        mediaEvidenceRevision += 1;
        conversations := conversations.concat([conversation]);
        dmLinks := dmLinks.concat([{ a = loP; b = hiP; conversation_id = conversation.id }]);
        conv_id := ?conversation.id;
      };
      case (?_) {};
    };
    switch (findConversationIndex(switch (conv_id) { case (?id) id; case null return #Err("Conversation not found") })) {
      case null { #Err("Conversation not found") };
      case (?i) {
        let posted = postMessage(i, governor, body, idempotency_key, null, null);
        ignore fanOutChatNotify(posted);
        ignore fanOutWsPokeForMessage(posted);
        #Ok(posted)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== Minimum app versions (force update) =====================

  // Public read: the native update prompt checks this before/without login.
  public query func get_minimum_app_versions() : async { #Ok : [(Text, Text)]; #Err : Text } {
    #Ok(minimumAppVersions)
  };

  public shared ({ caller }) func set_minimum_app_versions(versions : [(Text, Text)]) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isGovernor(caller)) {
      switch (await clubDomainRef()) {
        case null { return #Err("club_domain canister not configured") };
        case (?cd) {
          let allowed = try { if (accountAdmissionEnabled) await cd.read_account_is_app_admin(caller) else await cd.is_app_admin(caller) } catch (_) { false };
          if (not allowed) return #Err("App admin required");
        };
      };
    };
    if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced");
    if (versions.size() > 16) return #Err("Too many platforms");
    for ((platform, version) in versions.values()) {
      if (not valid(platform) or not valid(version)) return #Err("Invalid version entry");
    };
    minimumAppVersions := versions;
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== Link preview (HTTPS outcall) =====================

  // Extract the content attribute of <meta property="..."> / <title> from a
  // HTML page. Tolerant substring search, not a parser — misses just mean a
  // null field and the frontend falls back to a plain host card.
  func findMetaContent(body : Text, property : Text) : ?Text {
    let chars = Text.toArray(body);
    let needles = [
      Text.toArray("property=\"" # property # "\" content=\""),
      Text.toArray("name=\"" # property # "\" content=\""),
      Text.toArray("content=\""), // only used after a property/name hit below
    ];
    ignore needles;
    // Try both attribute orders: property-then-content and content-then-property.
    let pNeedles = [Text.toArray("property=\"" # property # "\""), Text.toArray("name=\"" # property # "\"")];
    let size = chars.size();
    for (pn in pNeedles.values()) {
      var i = 0;
      label outer while (i + pn.size() < size and i < 8192) {
        var matched = true;
        var j = 0;
        while (j < pn.size()) {
          if (chars[i + j] != pn[j]) { matched := false; j := pn.size() } else { j += 1 };
        };
        if (matched) {
          // Find the nearest content=" within this tag (bounded look-ahead).
          let cNeedle = Text.toArray("content=\"");
          var k = i + pn.size();
          let limit = if (i + 512 < size) { i + 512 } else { size };
          while (k + cNeedle.size() < limit) {
            var cMatched = true;
            var m = 0;
            while (m < cNeedle.size()) {
              if (chars[k + m] != cNeedle[m]) { cMatched := false; m := cNeedle.size() } else { m += 1 };
            };
            if (chars[k] == '>') { k := limit }; // left the tag without a hit
            if (cMatched) {
              var value = "";
              var p = k + cNeedle.size();
              label read while (p < size and value.size() < 500) {
                let c = chars[p];
                if (c == '\u{22}') { return ?value };
                value := value # Text.fromArray([c]);
                p += 1;
              };
              return null;
            };
            k += 1;
          };
        };
        i += 1;
      };
    };
    null
  };

  func findTitleTag(body : Text) : ?Text {
    let chars = Text.toArray(body);
    let open = Text.toArray("<title>");
    let close = Text.toArray("</title>");
    let size = chars.size();
    var i = 0;
    while (i + open.size() < size and i < 8192) {
      var matched = true;
      var j = 0;
      while (j < open.size()) {
        if (chars[i + j] != open[j]) { matched := false; j := open.size() } else { j += 1 };
      };
      if (matched) {
        var value = "";
        var p = i + open.size();
        label read while (p + close.size() <= size and value.size() < 500) {
          var isClose = true;
          var m = 0;
          while (m < close.size()) {
            if (chars[p + m] != close[m]) { isClose := false; m := close.size() } else { m += 1 };
          };
          if (isClose) { return ?value };
          value := value # Text.fromArray([chars[p]]);
          p += 1;
        };
        return null;
      };
      i += 1;
    };
    null
  };

  // Fetch a page and extract preview metadata. Any authenticated user may
  // call (chat link previews are a member feature); the URL must be a public
  // https:// address. Replicated GET: reads are idempotent, so consensus
  // mode is safe and the cheaper default.
  // Link previews serve every app user (secure sign-in and email accounts —
  // the latter call anonymously, replacing the old Netlify endpoint). Results
  // are cached per URL for 24h so repeat links cost no outcall; anonymous
  // callers share an hourly outcall budget to cap cycle spend from abuse.
  transient let PREVIEW_CACHE_MS : Nat64 = 86_400_000;
  transient let PREVIEW_CACHE_MAX = 2_000;
  transient let ANON_PREVIEW_PER_HOUR = 300;
  transient var previewCache : [(Text, Nat64, Types.LinkPreview)] = [];
  transient var anonPreviewWindowStart : Nat64 = 0;
  transient var anonPreviewCount = 0;

  func cachedPreview(url : Text) : ?Types.LinkPreview {
    let now = nowMs();
    switch (Array.find<(Text, Nat64, Types.LinkPreview)>(previewCache, func((u, t, _)) { u == url and now - t < PREVIEW_CACHE_MS })) {
      case (?(_, _, p)) { ?p };
      case null { null };
    };
  };

  func rememberPreview(url : Text, p : Types.LinkPreview) {
    let now = nowMs();
    let kept = Array.filter<(Text, Nat64, Types.LinkPreview)>(previewCache, func((u, t, _)) { u != url and now - t < PREVIEW_CACHE_MS });
    let trimmed = if (kept.size() >= PREVIEW_CACHE_MAX) Array.sliceToArray(kept, kept.size() - PREVIEW_CACHE_MAX + 1, kept.size()) else kept;
    previewCache := trimmed.concat([(url, now, p)]);
  };

  public shared ({ caller }) func fetch_link_preview(url : Text) : async { #Ok : Types.LinkPreview; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not Text.startsWith(url, #text "https://") or url.size() > 2048) return #Err("URL must be a public https:// address");
    switch (cachedPreview(url)) { case (?p) { return #Ok(p) }; case null {} };
    if (caller.equal(Principal.anonymous())) {
      let now = nowMs();
      if (now - anonPreviewWindowStart >= 3_600_000) { anonPreviewWindowStart := now; anonPreviewCount := 0 };
      if (anonPreviewCount >= ANON_PREVIEW_PER_HOUR) return #Err("Preview limit reached, try again later");
      anonPreviewCount += 1;
    };
    let request : IC.HttpRequestArgs = {
      url;
      max_response_bytes = ?(64_000 : Nat64);
      headers = [
        { name = "User-Agent"; value = "IgniteLinkPreview/1.0" },
        { name = "Accept"; value = "text/html" },
      ];
      body = null;
      method = #get;
      transform = ?{
        function = recapTransform;
        context = Blob.fromArray([]);
      };
      is_replicated = ?true;
    };
    try {
      let response = await Call.httpRequest(request);
      if (response.status < 200 or response.status >= 300) {
        return #Err("Preview fetch returned status " # Nat.toText(response.status));
      };
      let bodyText = switch (Text.decodeUtf8(response.body)) {
        case (?t) { t };
        case null { return #Err("Preview response was not valid UTF-8") };
      };
      let title = switch (findMetaContent(bodyText, "og:title")) {
        case (?t) { ?t };
        case null { findTitleTag(bodyText) };
      };
      let description = switch (findMetaContent(bodyText, "og:description")) {
        case (?d) { ?d };
        case null { findMetaContent(bodyText, "description") };
      };
      let preview : Types.LinkPreview = {
        title = switch (title) { case (?t) { ?truncateText(t, 300) }; case null { null } };
        description = switch (description) { case (?d) { ?truncateText(d, 500) }; case null { null } };
        image = findMetaContent(bodyText, "og:image");
        site_name = findMetaContent(bodyText, "og:site_name");
      };
      rememberPreview(url, preview);
      #Ok(preview)
    } catch (e) {
      #Err("Preview fetch failed: " # Error.message(e))
    }
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // How many participants of the conversation (excluding the caller) sent a
  // heartbeat within the last 150 seconds. Mirrors the Supabase presence
  // window so both backends report comparable numbers.
  public shared ({ caller }) func online_count(conversation_id : Text) : async { #Ok : Nat64; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await* requireChatAccess(caller, conversation_id);
    if (caller.equal(Principal.anonymous())) return #Err("Authenticated caller required");
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    let now = nowMs();
    let windowMs : Nat64 = 150_000;
    var count : Nat64 = 0;
    for (c in conversations.values()) {
      if (c.id == conversation_id) {
        for (p in c.participants.values()) {
          if (not p.equal(caller)) {
            let online = presence.any(func(entry) =
              entry.user.equal(p) and entry.last_seen_ms + windowMs >= now
            );
            if (online) { count += 1 };
          };
        };
      };
    };
    #Ok(count)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Private conversation reads: never expose the app-admin global presence list.
  // Delegated name authorization, not a participant directory. Only the pinned
  // identity service may ask for <=2 exact DM subjects; club/admin roles never
  // substitute for conversation participation. No persistent reader grants.
  public shared ({ caller }) func read_profile_direct_batch(requester : Principal, conversation_id : Text, subjects : [Principal], expected : ?Nat) : async { #Ok : PrivateDirectNames.Batch; #Err : Text } {
    if (Runtime.envVar<system>("IGNITE_PRIVATE_PROFILE_READS_REHEARSAL") != ?"1") return #Err("Private direct names are not released");
    let authority = accountAdmissionAuthority;
    if (caller.isAnonymous() or authority != ?caller) return #Err("Configured identity authority required");
    if (conversation_id == "" or conversation_id.size() > 128 or subjects.size() > 2) return #Err("Exact bounded direct conversation required");
    let ?opening = conversations.find(func c = c.id == conversation_id) else return #Err("Direct conversation not found");
    let revision = mediaEvidenceRevision;
    switch (expected) { case (?r) if (r != revision) return #Err("Direct name revision changed"); case null {} };
    func permitted(c : Types.Conversation) : Bool {
      PrivateDirectNames.permitted(requester, subjects, c.club_id, c.participants,
        c.participants.any(func p = isBlockedPair(requester, p)))
        // create_conversation/get_or_create_dm can name an arbitrary peer.
        // Only that peer's own authenticated message establishes disclosure;
        // a caller-created conversation must never become full-person search.
        and subjects.all(func p = p == requester or messages.any(func m = m.conversation_id == conversation_id and m.sender == p))
        and not convFenced(conversation_id) and not removalReceiver.denied(requester)
        and not subjects.any(func p = removalReceiver.denied(p))
    };
    if (not permitted(opening)) return #Err("Direct name audience denied");
    if (not removalReceiver.enter(requester)) return #Err("Account removal fenced");
    try {
      await admitAccount(requester);
      for (subject in subjects.values()) { await admitAccount(subject) };
      let ?closing = conversations.find(func c = c.id == conversation_id) else return #Err("Direct conversation removed");
      if (authority != accountAdmissionAuthority or revision != mediaEvidenceRevision or closing.participants != opening.participants
        or closing.club_id != opening.club_id or not permitted(closing)) return #Err("Direct name audience changed");
      #Ok({ revision; requester; club = conversation_id; subjects; members = subjects.map(func _ = true) })
    } catch (e) { #Err(Error.message(e)) } finally { removalReceiver.leave(requester) }
  };

  public shared ({ caller }) func get_direct_conversation(conversation_id : Text) : async { #Ok : Types.Conversation; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
      await admitAccount(caller);
      await* requireChatAccess(caller, conversation_id);
      if (not canAccessConversation(caller, conversation_id) or convFenced(conversation_id)) return #Err("Conversation access forbidden");
      switch (conversations.find(func(c) = c.id == conversation_id and c.club_id == "dm" and c.participants.any(func(p) = p.equal(caller)))) {
        case (?conversation) #Ok(conversation);
        case null #Err("Direct conversation not found");
      }
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Both the displayed message and recorded frontier must still exist in the
  // exact broadcast conversation. IDs/timestamps from a browser prove nothing.
  func broadcastReceiptCovers(receipt : Types.Receipt, target : Types.Message) : Bool {
    if (not receipt.read or receipt.conversation_id != BROADCAST_CONVERSATION_ID or target.conversation_id != BROADCAST_CONVERSATION_ID) return false;
    let ?frontier = messages.find(func m = m.id == receipt.message_id and m.conversation_id == BROADCAST_CONVERSATION_ID) else return false;
    if (messages.filter(func m = m.id == receipt.message_id and m.conversation_id == BROADCAST_CONVERSATION_ID).size() != 1) return false;
    BroadcastReadPolicy.covers(target.sequence, frontier.sequence, target.id == frontier.id)
  };

  // Bounded exact-message reader rows, not a global account/presence directory.
  public shared ({ caller }) func list_broadcast_message_readers(message_ids : [Text]) : async { #Ok : [Types.Receipt]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (caller.isAnonymous() or message_ids.size() == 0 or message_ids.size() > 100
      or message_ids.any(func id = id == "" or id.size() > 128 or message_ids.filter(func other = other == id).size() != 1)) return #Err("Exact bounded broadcast messages required");
    if (not removalReceiver.enter(caller)) return #Err("Account removal fenced");
    try {
      await admitAccount(caller);
      await* requireChatAccess(caller, BROADCAST_CONVERSATION_ID);
      if (convFenced(BROADCAST_CONVERSATION_ID) or removalReceiver.denied(caller) or not canAccessConversation(caller, BROADCAST_CONVERSATION_ID)) return #Err("Broadcast access forbidden");
      var result : [Types.Receipt] = [];
      for (id in message_ids.values()) {
        let targets = messages.filter(func m = m.id == id and m.conversation_id == BROADCAST_CONVERSATION_ID);
        if (targets.size() != 1) return #Err("Broadcast message missing or ambiguous");
        for (receipt in receipts.values()) {
          if (broadcastReceiptCovers(receipt, targets[0]) and not removalReceiver.denied(receipt.user) and not isBlockedPair(caller, receipt.user)) {
            if (not BroadcastReadPolicy.canAppend(result.size())) return #Err("Broadcast reader response exceeds 2500 rows; narrow message selection");
            result := result.concat([{ receipt with message_id = id }]);
          };
        };
      };
      #Ok(result)
    } catch (e) { #Err(Error.message(e)) } finally { removalReceiver.leave(caller) }
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Broadcast author is the fixed Announcements label. Only independently
  // recorded readers/reactors can disclose a personal name in those drawers;
  // a caller-supplied principal is never a global person-search selector.
  public shared ({ caller }) func read_profile_broadcast_batch(requester : Principal, message_id : Text, subjects : [Principal], expected : ?Nat) : async { #Ok : PrivateDirectNames.Batch; #Err : Text } {
    if (Runtime.envVar<system>("IGNITE_PRIVATE_PROFILE_READS_REHEARSAL") != ?"1") return #Err("Private broadcast names are not released");
    let authority = accountAdmissionAuthority;
    if (caller.isAnonymous() or authority != ?caller) return #Err("Configured identity authority required");
    let conversation_id = BROADCAST_CONVERSATION_ID;
    if (message_id == "" or message_id.size() > 128 or requester.isAnonymous() or requester.toText() == "aaaaa-aa" or subjects.size() == 0 or subjects.size() > 25
      or subjects.any(func p = p.isAnonymous() or p.toText() == "aaaaa-aa")
      or subjects.any(func p = subjects.filter(func q = q == p).size() != 1)) return #Err("Exact bounded broadcast participants required");
    let revision = mediaEvidenceRevision;
    switch (expected) { case (?r) if (r != revision) return #Err("Broadcast name revision changed"); case null {} };
    func participant(p : Principal) : Bool {
      let targets = messages.filter(func m = m.id == message_id and m.conversation_id == conversation_id);
      if (targets.size() != 1) return false;
      receipts.any(func r = r.user == p and broadcastReceiptCovers(r, targets[0]))
      or reactions.any(func r = r.user == p and r.message_id == message_id)
    };
    func active() : Bool {
      authority == accountAdmissionAuthority and revision == mediaEvidenceRevision
      and conversations.any(func c = c.id == conversation_id and c.club_id == "broadcast")
      and messages.any(func m = m.id == message_id and m.conversation_id == conversation_id)
      and not convFenced(conversation_id) and not removalReceiver.denied(requester)
      and subjects.all(func p = participant(p) and not isBlockedPair(requester, p) and not removalReceiver.denied(p))
    };
    if (not active()) return #Err("Broadcast name audience denied");
    if (not removalReceiver.enter(requester)) return #Err("Account removal fenced");
    try {
      await admitAccount(requester);
      if (not active()) return #Err("Broadcast name audience changed");
      for (subject in subjects.values()) { await admitAccount(subject); if (not active()) return #Err("Broadcast name audience changed") };
      #Ok({ revision; requester; club = message_id; subjects; members = subjects.map(func _ = true) })
    } catch (e) { #Err(Error.message(e)) } finally { removalReceiver.leave(requester) }
  };

  public shared ({ caller }) func read_profile_competition_admin_batch(requester : Principal, conversation_id : Text, subjects : [Principal], expected : ?Nat) : async { #Ok : PrivateDirectNames.Batch; #Err : Text } {
    if (Runtime.envVar<system>("IGNITE_PRIVATE_PROFILE_READS_REHEARSAL") != ?"1" or caller.isAnonymous() or accountAdmissionAuthority != ?caller) return #Err("Configured identity authority required");
    if (subjects.size() == 0 or subjects.size() > 25 or conversation_id == "" or conversation_id.size() > 128) return #Err("Exact bounded admin thread required");
    let binding = privateAdminThreads.find(func t = t.conversation == conversation_id) ?? return #Err("Verified admin thread mapping required");
    if (privateAdminThreads.filter(func t = t.conversation == conversation_id).size() != 1) return #Err("Ambiguous admin thread mapping");
    let configured = competitionDomainCanister ?? return #Err("Competition authority missing");
    let revision = mediaEvidenceRevision;
    func active() : Bool = accountAdmissionAuthority == ?caller and competitionDomainCanister == ?configured and mediaEvidenceRevision == revision
      and privateAdminThreads.any(func t = t == binding) and not convFenced(conversation_id) and not removalReceiver.denied(requester)
      and not subjects.any(func p = removalReceiver.denied(p) or isBlockedPair(requester, p))
      and conversations.any(func c = c.id == conversation_id and c.participants.any(func p = p == requester) and c.participants.any(func p = p == binding.member))
      and (switch (getGroupMetadataFor(conversation_id)) { case (?m) m.kind == "competition_admin" and not m.deleted; case null false });
    if (not active()) return #Err("Admin thread access denied");
    if (not removalReceiver.enter(requester)) return #Err("Account removal fenced");
    try {
      let service : actor { read_profile_admin_thread_batch : shared (Principal, Text, Principal, [Principal], ?Nat) -> async { #Ok : PrivateDirectNames.Batch; #Err : Text } } = actor(configured.toText());
      let first = switch (await (with timeout = 10) service.read_profile_admin_thread_batch(requester, binding.competition, binding.member, subjects, null)) { case (#Err(e)) return #Err(e); case (#Ok(r)) r };
      if (not active() or first.requester != requester or first.club != binding.competition or first.subjects != subjects or first.members != subjects.map(func _ = true)) return #Err("Admin thread audience changed");
      let combined = PrivateProfileAudience.snapshotRevision(debug_show((revision, configured, binding, first.revision)));
      switch (expected) { case (?r) if (r != combined) return #Err("Admin thread revision changed"); case null {} };
      let closing = switch (await (with timeout = 10) service.read_profile_admin_thread_batch(requester, binding.competition, binding.member, subjects, ?first.revision)) { case (#Err(e)) return #Err(e); case (#Ok(r)) r };
      if (not active() or first != closing) return #Err("Admin thread closing audience changed");
      #Ok({ revision = combined; requester; club = conversation_id; subjects; members = first.members })
    } catch (e) { #Err(Error.message(e)) } finally { removalReceiver.leave(requester) }
  };

  public shared ({ caller }) func get_message_window(conversation_id : Text, message_id : Text) : async { #Ok : Types.MessagePage; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
      await admitAccount(caller);
      await* requireChatAccess(caller, conversation_id);
      if (not canReadTeamMessages(caller, conversation_id) or convFenced(conversation_id)) return #Err("Conversation access forbidden");
      switch (messages.find(func(m) = m.conversation_id == conversation_id and m.id == message_id)) {
        case null #Err("Message not found");
        case (?target) {
          let lower : Nat64 = if (target.sequence > 12) target.sequence - 12 else 0;
          let rows = messages.filter(func(m) = m.conversation_id == conversation_id and m.sequence >= lower and m.sequence <= target.sequence + 24);
          #Ok({ messages = rows; next_sequence = if (lower > 1) ?lower else null; latest_sequence = conversationLatestSequence(conversation_id) })
        };
      }
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func list_conversation_online_users(conversation_id : Text) : async { #Ok : [Principal]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
      await admitAccount(caller);
      await* requireChatAccess(caller, conversation_id);
      if (not canAccessConversation(caller, conversation_id) or convFenced(conversation_id)) return #Err("Conversation access forbidden");
      let now = nowMs();
      switch (conversations.find(func(c) = c.id == conversation_id)) {
        case null #Err("Conversation not found");
        case (?conversation) #Ok(conversation.participants.filter(func(p) =
          not removalReceiver.denied(p) and presence.any(func(entry) = entry.user.equal(p) and entry.last_seen_ms + 150_000 >= now)));
      }
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== Typing indicators (ephemeral) =====================

  // TTL window: a typing ping older than this is treated as stale and
  // filtered out at read time (mirrors the old Supabase presence-track
  // auto-expiry). The frontend also auto-clears after 3s of no keystrokes.
  transient let TYPING_TTL_MS : Nat64 = 6_000;

  public shared ({ caller }) func set_typing(conversation_id : Text, is_typing : Bool, name : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    typingPings := typingPings.filter(func(p) = not (p.user.equal(caller) and p.conversation_id == conversation_id));
    if (is_typing) {
      typingPings := typingPings.concat([{ user = caller; conversation_id; name; last_typed_ms = nowMs() }]);
    };
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Live typing users for a conversation, excluding the caller and any ping
  // older than TYPING_TTL_MS. Polled by the frontend on a short interval.
  public shared ({ caller }) func list_typing(conversation_id : Text) : async { #Ok : [Types.TypingUser]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await* requireChatAccess(caller, conversation_id);
    if (caller.equal(Principal.anonymous())) return #Err("Authenticated caller required");
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    let now = nowMs();
    let active = typingPings.filter(func(p) =
      p.conversation_id == conversation_id and
      not p.user.equal(caller) and
      p.last_typed_ms + TYPING_TTL_MS >= now
    );
    #Ok(active.map<Types.TypingPing, Types.TypingUser>(func(p) = { user = p.user; name = p.name }))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== Pinned messages =====================

  transient let PIN_LIMIT = 3;

  public shared ({ caller }) func pin_message(conversation_id : Text, message_id : Text) : async { #Ok : Types.PinnedMessage; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    if (not messages.any(func(m) = m.id == message_id and m.conversation_id == conversation_id)) return #Err("Message not found");
    if (pinnedMessages.any(func(p) = p.conversation_id == conversation_id and p.message_id == message_id)) {
      return #Err("Message already pinned");
    };
    if (pinnedMessages.filter(func(p) = p.conversation_id == conversation_id).size() >= PIN_LIMIT) {
      return #Err("Pin limit reached: at most 3 pinned messages per conversation");
    };
    let pin : Types.PinnedMessage = {
      id = "pin-" # conversation_id # "-" # message_id;
      conversation_id;
      message_id;
      pinned_by = caller;
      created_at_ms = nowMs();
    };
    pinnedMessages := pinnedMessages.concat([pin]);
    #Ok(pin)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func unpin_message(conversation_id : Text, message_id : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (convFenced(conversation_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    pinnedMessages := pinnedMessages.filter(func(p) = not (p.conversation_id == conversation_id and p.message_id == message_id));
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func list_pinned_messages(conversation_id : Text) : async { #Ok : [Types.PinnedMessage]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    denyLegacyAccountQuery();
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await* requireChatAccess(caller, conversation_id);
    if (caller.equal(Principal.anonymous())) return #Err("Authenticated caller required");
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    #Ok(pinnedMessages.filter(func(p) = p.conversation_id == conversation_id))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== Content reports (moderation) =====================
  // Generic report store backing ReportContentDialog for any reportable
  // surface (chat message, user, club, photo, ...). subject_kind/subject_id
  // are opaque to this canister; admins resolve them client-side. Listing and
  // resolution are app_admin/governor only — reporters cannot read others'
  // reports.

  public shared ({ caller }) func submit_content_report(
    subject_kind : Text,
    subject_id : Text,
    conversation_id : ?Text,
    reason : Text,
    details : ?Text,
  ) : async { #Ok : Types.ContentReport; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (subject_kind.size() == 0 or subject_id.size() == 0 or reason.size() == 0) return #Err("Missing required fields");
    if (reason.size() > 200) return #Err("Reason too long");
    switch (details) {
      case (?d) { if (d.size() > 1000) return #Err("Details too long") };
      case null {};
    };
    let report : Types.ContentReport = {
      id = "report-" # Nat64.toText(Nat64.fromIntWrap(Time.now())) # "-" # Nat.toText(contentReports.size());
      reporter = caller;
      subject_kind;
      subject_id;
      conversation_id;
      reason;
      details;
      created_at_ms = nowMs();
      status = "open";
    };
    contentReports := contentReports.concat([report]);
    #Ok(report)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public query ({ caller }) func list_content_reports(status : ?Text) : async { #Ok : [Types.ContentReport]; #Err : Text } {
    denyLegacyAccountQuery();
    if (not (isGovernor(caller) or hasRole(caller, "app_admin", null, null))) return #Err("App admin required");
    switch (status) {
      case null { #Ok(contentReports) };
      case (?s) { #Ok(contentReports.filter(func(r) = r.status == s)) };
    }
  };

  public shared ({ caller }) func resolve_content_report(id : Text, status : Text) : async { #Ok : Types.ContentReport; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (msgFenced(id) or convFenced(id)) return #Err("Club is temporarily locked for a transfer");
    if (not (isGovernor(caller) or hasRole(caller, "app_admin", null, null))) return #Err("App admin required");
    if (status != "open" and status != "reviewed" and status != "dismissed") return #Err("Invalid status");
    var found : ?Types.ContentReport = null;
    contentReports := contentReports.map(func(r) {
      if (r.id == id) { let updated = { r with status }; found := ?updated; updated } else { r }
    });
    switch (found) {
      case (?r) { #Ok(r) };
      case null { #Err("Report not found") };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ===================== User blocking =====================

  public shared ({ caller }) func block_user(user : Principal) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (user.equal(Principal.anonymous()) or user.equal(caller)) return #Err("Invalid block target");
    let exists = blockedUsers.any(func(entry) = entry.blocker.equal(caller) and entry.blocked.equal(user));
    if (not exists) {
      mediaEvidenceRevision += 1;
      blockedUsers := blockedUsers.concat([{ blocker = caller; blocked = user; created_at_ms = nowMs() }]);
    };
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func unblock_user(user : Principal) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (blockedUsers.any(func entry = entry.blocker == caller and entry.blocked == user)) mediaEvidenceRevision += 1;
    blockedUsers := blockedUsers.filter(func(entry) = not (entry.blocker.equal(caller) and entry.blocked.equal(user)));
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Principals the caller has blocked (one direction — what the block list UI shows).
  public query ({ caller }) func list_blocked_users() : async [Principal] {
    denyLegacyAccountQuery();
    if (caller.equal(Principal.anonymous())) return [];
    let mine = blockedUsers.filter(func(entry) = entry.blocker.equal(caller));
    Array.map<Types.BlockedUser, Principal>(mine, func(entry) = entry.blocked)
  };

  // Whether the caller has blocked this user (their own setting only).
  public query ({ caller }) func has_blocked(user : Principal) : async Bool {
    denyLegacyAccountQuery();
    blockedUsers.any(func(entry) = entry.blocker.equal(caller) and entry.blocked.equal(user))
  };
  // Governor-only: moves every stored reference of one user's sign-in ID (old) to a new one.
  // Any NEW stored principal / principal-text field added to this canister must be added here.
  public shared ({ caller }) func rekey_principal(old : Principal, new : Principal, dry_run : Bool) : async { #ok : Nat; #err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    rekeyImpl(caller, old, new, dry_run, false)
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Same as rekey_principal, but allowed when the new sign-in ID already has data:
  // both IDs' records end up under the new one (keyed duplicates keep the new row).
  public shared ({ caller }) func merge_principal(old : Principal, new : Principal, dry_run : Bool) : async { #ok : Nat; #err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    rekeyImpl(caller, old, new, dry_run, true)
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  func rekeyImpl(caller : Principal, old : Principal, new : Principal, dry_run : Bool, allowMerge : Bool) : { #ok : Nat; #err : Text } {
    if (not isGovernor(caller)) return #err("Forbidden");
    if (removalReceiver.denied(old) or removalReceiver.denied(new)) return #err("Removed identity cannot be rekeyed or merged");
    if (old.equal(Principal.anonymous()) or new.equal(Principal.anonymous())) return #err("Invalid principal");
    if (old.equal(new)) return #err("old and new must differ");
    if (old.equal(governor)) return #err("Cannot rekey the governor");

    // Conflict guard: count NON-EPHEMERAL records that already reference `new`.
    // Ephemeral/excluded: presence (online pings), typingPings (typing indicators).
    var conflicts = 0;
    conflicts += roles.filter(func(r) = r.user.equal(new)).size();
    conflicts += conversations.filter(func(c) = c.participants.any(func(p) = p.equal(new))).size();
    conflicts += messages.filter(func(m) = m.sender.equal(new)).size();
    conflicts += receipts.filter(func(r) = r.user.equal(new)).size();
    conflicts += unread.filter(func(u) = u.user.equal(new)).size();
    conflicts += (if (bulkAccessPrincipals.any(func(p) = p.equal(new))) 1 else 0);
    conflicts += groupMetadata.filter(func(g) = g.members.any(func(p) = p.equal(new)) or (switch (g.deleted_by) { case (?p) p.equal(new); case null false })).size();
    conflicts += clubMemberships.filter(func(m) = m.user.equal(new)).size();
    conflicts += competitionAdmins.filter(func(c) = c.user.equal(new)).size();
    conflicts += (if (dmAttachmentsDisabled.any(func(p) = p.equal(new))) 1 else 0);
    conflicts += groupRoles.filter(func(g) = g.user.equal(new)).size();
    conflicts += joinRequests.filter(func(j) = j.user.equal(new)).size();
    conflicts += polls.filter(func(p) = p.creator.equal(new)).size();
    conflicts += pollVotes.filter(func(v) = v.user.equal(new)).size();
    conflicts += mutePreferences.filter(func(m) = m.user.equal(new)).size();
    conflicts += dmLinks.filter(func(d) = d.a.equal(new) or d.b.equal(new)).size();
    conflicts += forwardRecords.filter(func(f) = f.original_sender.equal(new)).size();
    conflicts += scheduledMessages.filter(func(s) = s.sender.equal(new)).size();
    conflicts += attachmentMetadata.filter(func(a) = a.uploader.equal(new)).size();
    conflicts += reactions.filter(func(r) = r.user.equal(new)).size();
    conflicts += userMessagingSettings.filter(func(u) = u.user.equal(new)).size();
    conflicts += blockedUsers.filter(func(b) = b.blocker.equal(new) or b.blocked.equal(new)).size();
    conflicts += pinnedMessages.filter(func(p) = p.pinned_by.equal(new)).size();
    conflicts += contentReports.filter(func(r) = r.reporter.equal(new)).size();
    if (conflicts > 0 and not allowMerge) return #err("New sign-in ID already has " # Nat.toText(conflicts) # " record(s) in messaging_domain");

    var changed = 0;

    let rolesOld = roles.filter(func(r) = r.user.equal(old)).size();
    changed += rolesOld;
    let convOld = conversations.filter(func(c) = c.participants.any(func(p) = p.equal(old))).size();
    changed += convOld;
    let msgOld = messages.filter(func(m) = m.sender.equal(old)).size();
    changed += msgOld;
    let receiptOld = receipts.filter(func(r) = r.user.equal(old)).size();
    changed += receiptOld;
    let unreadOld = unread.filter(func(u) = u.user.equal(old)).size();
    changed += unreadOld;
    let bulkOld = bulkAccessPrincipals.any(func(p) = p.equal(old));
    if (bulkOld) changed += 1;
    let groupMetaOld = groupMetadata.filter(func(g) = g.members.any(func(p) = p.equal(old)) or (switch (g.deleted_by) { case (?p) p.equal(old); case null false })).size();
    changed += groupMetaOld;
    let clubMemOld = clubMemberships.filter(func(m) = m.user.equal(old)).size();
    changed += clubMemOld;
    let compAdminOld = competitionAdmins.filter(func(c) = c.user.equal(old)).size();
    changed += compAdminOld;
    let dmAttachOld = dmAttachmentsDisabled.any(func(p) = p.equal(old));
    if (dmAttachOld) changed += 1;
    let groupRoleOld = groupRoles.filter(func(g) = g.user.equal(old)).size();
    changed += groupRoleOld;
    let joinReqOld = joinRequests.filter(func(j) = j.user.equal(old)).size();
    changed += joinReqOld;
    let pollOld = polls.filter(func(p) = p.creator.equal(old)).size();
    changed += pollOld;
    let pollVoteOld = pollVotes.filter(func(v) = v.user.equal(old)).size();
    changed += pollVoteOld;
    let muteOld = mutePreferences.filter(func(m) = m.user.equal(old)).size();
    changed += muteOld;
    let dmLinkOld = dmLinks.filter(func(d) = d.a.equal(old) or d.b.equal(old)).size();
    changed += dmLinkOld;
    let forwardOld = forwardRecords.filter(func(f) = f.original_sender.equal(old)).size();
    changed += forwardOld;
    let schedOld = scheduledMessages.filter(func(s) = s.sender.equal(old)).size();
    changed += schedOld;
    let attachOld = attachmentMetadata.filter(func(a) = a.uploader.equal(old)).size();
    changed += attachOld;
    let reactOld = reactions.filter(func(r) = r.user.equal(old)).size();
    changed += reactOld;
    let settingsOld = userMessagingSettings.filter(func(u) = u.user.equal(old)).size();
    changed += settingsOld;
    let blockOld = blockedUsers.filter(func(b) = b.blocker.equal(old) or b.blocked.equal(old)).size();
    changed += blockOld;
    let pinOld = pinnedMessages.filter(func(p) = p.pinned_by.equal(old)).size();
    changed += pinOld;

    // Merge: drop OLD keyed rows that collide with an existing NEW row (keep new).
    if (allowMerge and not dry_run) {
      receipts := receipts.filter(func(r) = not (r.user.equal(old) and receipts.any(func(x) = x.user.equal(new) and x.conversation_id == r.conversation_id and x.message_id == r.message_id)));
      unread := unread.filter(func(r) = not (r.user.equal(old) and unread.any(func(x) = x.user.equal(new) and x.conversation_id == r.conversation_id)));
      clubMemberships := clubMemberships.filter(func(r) = not (r.user.equal(old) and clubMemberships.any(func(x) = x.user.equal(new) and x.club_id == r.club_id)));
      groupRoles := groupRoles.filter(func(r) = not (r.user.equal(old) and groupRoles.any(func(x) = x.user.equal(new) and x.conversation_id == r.conversation_id)));
      pollVotes := pollVotes.filter(func(r) = not (r.user.equal(old) and pollVotes.any(func(x) = x.user.equal(new) and x.poll_id == r.poll_id)));
      mutePreferences := mutePreferences.filter(func(r) = not (r.user.equal(old) and mutePreferences.any(func(x) = x.user.equal(new) and x.conversation_id == r.conversation_id)));
      reactions := reactions.filter(func(r) = not (r.user.equal(old) and reactions.any(func(x) = x.user.equal(new) and x.message_id == r.message_id and x.emoji == r.emoji)));
      if (userMessagingSettings.any(func(x) = x.user.equal(new))) userMessagingSettings := userMessagingSettings.filter(func(r) = not r.user.equal(old));
    };

    // Ephemeral: presence pings — keep NEW row on conflict, drop OLD.
    let presenceOldHas = presence.any(func(p) = p.user.equal(old));
    if (presenceOldHas) changed += 1;
    // Ephemeral: typing pings — keep NEW (conversation_id, user) row on conflict, drop OLD.
    let typingOldCount = typingPings.filter(func(t) = t.user.equal(old)).size();
    if (typingOldCount > 0) changed += typingOldCount;

    if (not dry_run) {
      if (rolesOld > 0) roles := roles.map(func(r) = if (r.user.equal(old)) ({ r with user = new }) else r);
      mediaEvidenceRevision += 1;
      if (convOld > 0) conversations := conversations.map(func(c) = if (c.participants.any(func(p) = p.equal(old))) ({ c with participants = Array.filterMap<Principal, Principal>(c.participants, func(p) = if (p.equal(old)) null else ?p).concat(if (c.participants.any(func(p) = p.equal(new))) [] else [new]) }) else c);
      privateAdminThreads := privateAdminThreads.map(func t = if (t.member == old) ({ t with member = new }) else t);
      mediaEvidenceRevision += 1;
      if (msgOld > 0) messages := messages.map(func(m) = if (m.sender.equal(old)) ({ m with sender = new }) else m);
      if (receiptOld > 0) receipts := receipts.map(func(r) = if (r.user.equal(old)) ({ r with user = new }) else r);
      if (unreadOld > 0) unread := unread.map(func(u) = if (u.user.equal(old)) ({ u with user = new }) else u);
      if (bulkOld) bulkAccessPrincipals := bulkAccessPrincipals.filter(func(p) = not p.equal(old)).concat([new]);
      if (groupMetaOld > 0) groupMetadata := groupMetadata.map(func(g) {
        let members2 = if (g.members.any(func(p) = p.equal(old))) {
          Array.filterMap<Principal, Principal>(g.members, func(p) = if (p.equal(old)) null else ?p).concat(if (g.members.any(func(p) = p.equal(new))) [] else [new])
        } else g.members;
        let deletedBy2 = switch (g.deleted_by) { case (?p) if (p.equal(old)) ?new else ?p; case null null };
        { g with members = members2; deleted_by = deletedBy2 }
      });
      if (clubMemOld > 0) clubMemberships := clubMemberships.map(func(m) = if (m.user.equal(old)) ({ m with user = new }) else m);
      if (compAdminOld > 0) competitionAdmins := competitionAdmins.map(func(c) = if (c.user.equal(old)) ({ c with user = new }) else c);
      if (dmAttachOld) dmAttachmentsDisabled := dmAttachmentsDisabled.filter(func(p) = not p.equal(old)).concat([new]);
      if (groupRoleOld > 0) groupRoles := groupRoles.map(func(g) = if (g.user.equal(old)) ({ g with user = new }) else g);
      if (joinReqOld > 0) joinRequests := joinRequests.map(func(j) = if (j.user.equal(old)) ({ j with user = new }) else j);
      if (pollOld > 0) polls := polls.map(func(p) = if (p.creator.equal(old)) ({ p with creator = new }) else p);
      if (pollVoteOld > 0) pollVotes := pollVotes.map(func(v) = if (v.user.equal(old)) ({ v with user = new }) else v);
      if (muteOld > 0) mutePreferences := mutePreferences.map(func(m) = if (m.user.equal(old)) ({ m with user = new }) else m);
      if (dmLinkOld > 0) dmLinks := dmLinks.map(func(d) = { d with a = (if (d.a.equal(old)) new else d.a); b = (if (d.b.equal(old)) new else d.b) });
      if (forwardOld > 0) forwardRecords := forwardRecords.map(func(f) = if (f.original_sender.equal(old)) ({ f with original_sender = new }) else f);
      mediaEvidenceRevision += 1;
      if (schedOld > 0) scheduledMessages := scheduledMessages.map(func(s) = if (s.sender.equal(old)) ({ s with sender = new }) else s);
      mediaEvidenceRevision += 1;
      if (attachOld > 0) attachmentMetadata := attachmentMetadata.map(func(a) = if (a.uploader.equal(old)) ({ a with uploader = new }) else a);
      if (reactOld > 0) reactions := reactions.map(func(r) = if (r.user.equal(old)) ({ r with user = new }) else r);
      if (settingsOld > 0) userMessagingSettings := userMessagingSettings.map(func(u) = if (u.user.equal(old)) ({ u with user = new }) else u);
      if (blockOld > 0) blockedUsers := blockedUsers.map(func(b) = { b with blocker = (if (b.blocker.equal(old)) new else b.blocker); blocked = (if (b.blocked.equal(old)) new else b.blocked) });
      if (pinOld > 0) pinnedMessages := pinnedMessages.map(func(p) = if (p.pinned_by.equal(old)) ({ p with pinned_by = new }) else p);

      if (presenceOldHas) {
        let newHas = presence.any(func(p) = p.user.equal(new));
        if (newHas) {
          presence := presence.filter(func(p) = not p.user.equal(old));
        } else {
          presence := presence.map(func(p) = if (p.user.equal(old)) ({ p with user = new }) else p);
        };
      };
      if (typingOldCount > 0) {
        typingPings := typingPings.filter(func(t) = not (t.user.equal(old) and typingPings.any(func(u) = u.conversation_id == t.conversation_id and u.user.equal(new))))
          .map(func(t) = if (t.user.equal(old)) ({ t with user = new }) else t);
      };
    };

    #ok(changed)
  };

  public shared ({ caller }) func read_club_media_references(club : Text, offset : Nat, expected : ?Nat) : async { #Ok : MediaEvidence.Page; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not isGovernor(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before media inventory");
    switch (expected) { case (?r) { if (r != mediaEvidenceRevision) return #Err("Media inventory revision changed") }; case null { if (offset != 0) return #Err("Revision required after first page") } };
    let total = messages.size() + attachmentMetadata.size() + scheduledMessages.size();
    let (start, end) = MediaEvidence.bounds(offset, total);
    var refs : [MediaEvidence.Reference] = [];
    for (i in Nat.range(start, end)) {
      if (i < messages.size()) {
        let m = messages[i]; if (conversations.any(func(c) = c.id == m.conversation_id and c.club_id == club)) {
          switch (m.attachment) { case (?a) { switch (a.url) { case (?url) { refs := refs.concat([{ resource_id = m.id; url; store = null; path = null; content_hash = null }]) }; case null {} } }; case null {} };
        };
      } else if (i < messages.size() + attachmentMetadata.size()) {
        let a = attachmentMetadata[i - messages.size()];
        if (conversations.any(func(c) = c.id == a.conversation_id and c.club_id == club)) {
          switch (a.url) { case (?url) { refs := refs.concat([{ resource_id = "attachment:" # a.id; url; store = null; path = null; content_hash = null }]) }; case null {} };
        };
      } else {
        let s = scheduledMessages[i - messages.size() - attachmentMetadata.size()];
        if (conversations.any(func(c) = c.id == s.conversation_id and c.club_id == club) and s.replayed_at_ms == null and (Text.contains(s.body, #text "icp0.io") or Text.contains(s.body, #text "clubs/")))
          return #Err("Scheduled media body needs explicit provenance before inventory");
      };
    };
    #Ok({ revision = mediaEvidenceRevision; scanned = end - start; next = if (end < total) ?end else null; references = refs })
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Protected consensus reads for the opt-in local account-removal rehearsal.
  public shared ({ caller }) func read_account_list_messages(conversation_id : Text, after : ?Nat64) : async [Types.Message] {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (not canReadTeamMessages(caller, conversation_id)) throw Error.reject("Conversation access forbidden");
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
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_messages_page(conversation_id : Text, after : ?Nat64, limit : Nat16) : async { #Ok : Types.MessagePage; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
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
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_latest_messages_page(conversation_id : Text, before : ?Nat64, limit : Nat16) : async { #Ok : Types.MessagePage; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (not canReadTeamMessages(caller, conversation_id)) return #Err("Conversation access forbidden");
    if (limit == 0 or limit > 100) return #Err("Invalid page size");
    let latest = conversationLatestSequence(conversation_id);
    switch (before) {
      case (?cursor) { if (cursor > latest) return #Err("Stale cursor") };
      case null {};
    };
    let cap : Nat64 = switch (before) { case (?cursor) { cursor }; case null { latest + 1 } };
    // Messages are appended in send order, so sequence ascends within a
    // conversation: count the matching rows, then drop the surplus oldest.
    var matching : Nat = 0;
    for (m in messages.values()) {
      if (m.conversation_id == conversation_id and m.sequence < cap) { matching += 1 };
    };
    let limit_n = Nat16.toNat(limit);
    let skip = if (matching > limit_n) { matching - limit_n } else { 0 };
    var page_messages : [Types.Message] = [];
    var seen : Nat = 0;
    var oldest_in_page : Nat64 = 0;
    var oldest_set = false;
    for (m in messages.values()) {
      if (m.conversation_id == conversation_id and m.sequence < cap) {
        if (seen >= skip) {
          page_messages := page_messages.concat([m]);
          if (not oldest_set or m.sequence < oldest_in_page) {
            oldest_in_page := m.sequence;
            oldest_set := true;
          };
        };
        seen += 1;
      };
    };
    let next_seq : ?Nat64 = if (skip > 0 and oldest_set) ?oldest_in_page else null;
    #Ok({ messages = page_messages; next_sequence = next_seq; latest_sequence = latest })
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_search_messages(conversation_id : Text, needle : Text, limit : Nat16) : async { #Ok : [Types.Message]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (not canReadTeamMessages(caller, conversation_id)) return #Err("Conversation access forbidden");
    if (limit == 0 or limit > 100) return #Err("Invalid page size");
    let lower_needle = Text.toLower(needle);
    var matches : [Types.Message] = [];
    var i = messages.size();
    while (i > 0 and matches.size() < Nat16.toNat(limit)) {
      i -= 1;
      let m = messages[i];
      if (m.conversation_id == conversation_id and Text.contains(Text.toLower(m.body), #text lower_needle)) {
        matches := matches.concat([m]);
      };
    };
    #Ok(matches)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_reactions(conversation_id : Text) : async { #Ok : [Types.Reaction]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (not canReadTeamMessages(caller, conversation_id)) return #Err("Conversation access forbidden");
    var result : [Types.Reaction] = [];
    for (m in messages.values()) {
      if (m.conversation_id == conversation_id) {
        for (r in reactions.values()) {
          if (r.message_id == m.id) { result := result.concat([r]) };
        };
      };
    };
    #Ok(result)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_open_conversation(conversation_id : Text, limit : Nat16) : async {
    #Ok : { page : Types.MessagePage; reactions : [Types.Reaction]; pins : ?[Types.PinnedMessage]; polls : [Types.PollResults] };
    #Err : Text;
  } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (not canReadTeamMessages(caller, conversation_id)) return #Err("Conversation access forbidden");
    if (limit == 0 or limit > 100) return #Err("Invalid page size");
    let latest = conversationLatestSequence(conversation_id);
    var matching : Nat = 0;
    for (m in messages.values()) {
      if (m.conversation_id == conversation_id) { matching += 1 };
    };
    let limit_n = Nat16.toNat(limit);
    let skip = if (matching > limit_n) { matching - limit_n } else { 0 };
    var page_messages : [Types.Message] = [];
    var seen : Nat = 0;
    var oldest_in_page : Nat64 = 0;
    var oldest_set = false;
    for (m in messages.values()) {
      if (m.conversation_id == conversation_id) {
        if (seen >= skip) {
          page_messages := page_messages.concat([m]);
          if (not oldest_set or m.sequence < oldest_in_page) {
            oldest_in_page := m.sequence;
            oldest_set := true;
          };
        };
        seen += 1;
      };
    };
    var page_reactions : [Types.Reaction] = [];
    for (r in reactions.values()) {
      if (page_messages.find(func(m : Types.Message) : Bool { m.id == r.message_id }) != null) {
        page_reactions := page_reactions.concat([r]);
      };
    };
    let pins : ?[Types.PinnedMessage] = if (caller.equal(Principal.anonymous()) or not canAccessConversation(caller, conversation_id)) {
      null
    } else {
      ?pinnedMessages.filter(func(p) = p.conversation_id == conversation_id)
    };
    let next_seq : ?Nat64 = if (skip > 0 and oldest_set) ?oldest_in_page else null;
    #Ok({
      page = { messages = page_messages; next_sequence = next_seq; latest_sequence = latest };
      reactions = page_reactions;
      pins;
      polls = conversationPagePolls(conversation_id, page_messages);
    })
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_unread_count(conversation_id : Text) : async { #Ok : Types.Unread; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    #Ok(unreadFor(caller, conversation_id))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_export_state() : async { #Ok : Types.State; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (not isGovernor(caller) and not hasBulkAccess(caller)) return #Err("Governor only");
    #Ok({ schema = 4; governor; roles; conversations; messages; receipts; unread; groupMetadata; clubMemberships; competitionAdmins; dmAttachmentsDisabled; groupRoles; joinRequests; polls; pollVotes; mutePreferences; dmLinks; forwardRecords; scheduledMessages; attachmentMetadata; reactions; clubDmSettings; userMessagingSettings; typingPings; pinnedMessages; contentReports })
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_get_group_metadata(conversation_id : Text) : async { #Ok : Types.GroupMetadata; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (not canReadTeamMessages(caller, conversation_id) and not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    switch (getGroupMetadataFor(conversation_id)) {
      case (?meta) { #Ok(meta) };
      case null { #Err("Group metadata not found") };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_can_dm_user(other : Principal) : async Bool {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (caller.equal(Principal.anonymous()) or other.equal(Principal.anonymous())) return false;
    if (caller.equal(other)) return false;
    if (isBlockedPair(caller, other)) return false;
    sharesClub(caller, other)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_dm_attachments_disabled(user : Principal) : async Bool {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    dmAttachmentsDisabled.any(func(p) = p.equal(user))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_is_competition_admin(conversation_id : Text) : async Bool {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    isCompetitionAdminFor(caller, conversation_id)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_get_mini_league_chat(club_id : Text, league_id : Text) : async { #Ok : ?Types.GroupSummary; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatClubMember(caller, club_id);
    if (caller.equal(Principal.anonymous())) return #Err("Forbidden");
    let matches = groupMetadata.filter(func(m) = not m.deleted and m.club_id == ?club_id and m.kind == "mini_league:" # league_id and m.members.any(func(p) = p.equal(caller)));
    if (matches.size() > 1) return #Err("Conflicting league chats");
    #Ok(if (matches.size() == 0) null else ?toGroupSummary(caller, matches[0]))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_groups_by_club(club_id : Text) : async { #Ok : [Types.GroupSummary]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatClubMember(caller, club_id);
    if (not valid(club_id)) return #Err("Invalid club id");
    if (not canBrowseClubGroups(caller, club_id)) return #Err("Club access forbidden");
    let matches = groupMetadata.filter(func(m) = m.club_id == ?club_id and m.team_id == null and not m.deleted);
    #Ok(Array.map<Types.GroupMetadata, Types.GroupSummary>(matches, func(m) = toGroupSummary(caller, m)))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_groups_by_team(team_id : Text) : async { #Ok : [Types.GroupSummary]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (not valid(team_id)) return #Err("Invalid team id");
    var club_of_team = "";
    for (m in groupMetadata.values()) { if (m.team_id == ?team_id) { club_of_team := Option.get(m.club_id, "") } };
    await* requireChatClubMember(caller, club_of_team);
    if (not canBrowseTeamGroups(caller, club_of_team, team_id)) return #Err("Team access forbidden");
    let matches = groupMetadata.filter(func(m) = m.team_id == ?team_id and not m.deleted);
    #Ok(Array.map<Types.GroupMetadata, Types.GroupSummary>(matches, func(m) = toGroupSummary(caller, m)))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_read_receipts(conversation_id : Text) : async { #Ok : [Types.Receipt]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (not canAccessConversation(caller, conversation_id) and not canReadTeamMessages(caller, conversation_id)) return #Err("Conversation access forbidden");
    #Ok(receipts.filter(func(r) = r.conversation_id == conversation_id))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_my_unread_counts() : async [Types.UnreadSummary] {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (caller.equal(Principal.anonymous())) return [];
    var result : [Types.UnreadSummary] = [];
    for (conversation in conversations.values()) {
      let visible = try { await* requireChatAccess(caller, conversation.id); true } catch (_) { false };
      if (visible and conversation.participants.any(func(p) = p.equal(caller))) {
        let u = unreadFor(caller, conversation.id);
        if (u.count > 0) {
          result := result.concat([{ conversation_id = conversation.id; kind = inferConversationKind(conversation); count = u.count }]);
        };
      };
    };
    if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced");
    result
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_deleted_groups() : async { #Ok : [Types.GroupMetadata]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (isGovernor(caller) or hasRole(caller, "app_admin", null, null)) {
      return #Ok(groupMetadata.filter(func(m) = m.deleted));
    };
    if (hasRole(caller, "club_admin", null, null)) {
      return #Ok(groupMetadata.filter(func(m) = m.deleted and (switch (m.club_id) { case (?c) { hasRole(caller, "club_admin", ?c, null) }; case null { false } })));
    };
    #Err("Admin access required")
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_dm_attachments_disabled() : async { #Ok : [Principal]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not (isGovernor(caller) or hasRole(caller, "app_admin", null, null))) return #Err("App admin required");
    #Ok(dmAttachmentsDisabled)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_club_dm_settings() : async { #Ok : [Types.ClubDmSettings]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not (isGovernor(caller) or hasRole(caller, "app_admin", null, null))) return #Err("App admin required");
    #Ok(clubDmSettings)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_get_group_join_policy(conversation_id : Text) : async { join_policy : Text; category : ?Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    joinPolicyOf(conversation_id)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_open_groups(club_id : Text) : async { #Ok : [{ summary : Types.GroupSummary; join_policy : Text; category : ?Text; requested : Bool }]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatClubMember(caller, club_id);
    if (not valid(club_id)) return #Err("Invalid club id");
    if (not canBrowseClubGroups(caller, club_id)) return #Err("Club access forbidden");
    var out : [{ summary : Types.GroupSummary; join_policy : Text; category : ?Text; requested : Bool }] = [];
    for (m in groupMetadata.values()) {
      if (m.club_id == ?club_id and m.team_id == null and not m.deleted) {
        let p = joinPolicyOf(m.conversation_id);
        if (p.join_policy != "invite_only") {
          let requested = joinRequests.any(func(r) = r.conversation_id == m.conversation_id and r.user.equal(caller) and r.status == "pending");
          out := out.concat([{ summary = toGroupSummary(caller, m); join_policy = p.join_policy; category = p.category; requested }]);
        };
      };
    };
    #Ok(out)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_join_requests(conversation_id : Text) : async { #Ok : [Types.JoinRequest]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (not isGroupAdmin(caller, conversation_id)) return #Err("Group admin required");
    #Ok(joinRequests.filter(func(r) = r.conversation_id == conversation_id))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_get_poll_results(poll_id : Text) : async { #Ok : Types.PollResults; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requirePollChatAccess(caller, poll_id);
    switch (findPollIndex(poll_id)) {
      case null { #Err("Poll not found") };
      case (?i) {
        let poll = polls[i];
        if (not canAccessConversation(caller, poll.conversation_id)) return #Err("Conversation access forbidden");
        var counts = Array.repeat<Nat32>(0, poll.options.size());
        var total : Nat32 = 0;
        for (v in pollVotes.values()) {
          if (v.poll_id == poll_id) {
            let idx = Nat32.toNat(v.option_index);
            if (idx < counts.size()) {
              counts := Array.tabulate<Nat32>(counts.size(), func(pos) = if (pos == idx) counts[pos] + 1 else counts[pos]);
              total += 1;
            };
          };
        };
        #Ok({ poll; counts; total_votes = total; votes = ?pollVotes.filter(func(v) = v.poll_id == poll_id and Nat32.toNat(v.option_index) < poll.options.size()) })
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_get_mute_preferences(conversation_ids : [Text]) : async { #Ok : [(Text, Bool)]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (conversation_ids.size() > 300) return #Err("Too many ids");
    if (caller.equal(Principal.anonymous())) return #Ok(Array.map<Text, (Text, Bool)>(conversation_ids, func(id) = (id, false)));
    #Ok(Array.map<Text, (Text, Bool)>(conversation_ids, func(id) {
      var muted = false;
      for (m in mutePreferences.values()) {
        if (m.user.equal(caller) and m.conversation_id == id) { muted := m.muted };
      };
      (id, muted)
    }))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_get_group_metadata_multi(conversation_ids : [Text]) : async { #Ok : [Types.GroupMetadata]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (conversation_ids.size() > 300) return #Err("Too many ids");
    var out : [Types.GroupMetadata] = [];
    for (id in conversation_ids.values()) {
      await* requireChatAccess(caller, id);
      if (canReadTeamMessages(caller, id) or canAccessConversation(caller, id)) {
        switch (getGroupMetadataFor(id)) { case (?meta) { out := out.concat([meta]) }; case null {} };
      };
    };
    if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced");
    #Ok(out)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_groups_by_clubs(club_ids : [Text]) : async { #Ok : [Types.GroupSummary]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (club_ids.size() > 200) return #Err("Too many ids");
    for (club in club_ids.values()) { await* requireChatClubMember(caller, club) };
    let allowed = club_ids.filter(func(c) = valid(c) and canBrowseClubGroups(caller, c));
    let matches = groupMetadata.filter(func(m) =
      m.team_id == null and not m.deleted and (switch (m.club_id) { case (?c) allowed.any(func(a) = a == c); case null false })
    );
    if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced");
    #Ok(Array.map<Types.GroupMetadata, Types.GroupSummary>(matches, func(m) = toGroupSummary(caller, m)))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_get_mute_preference(conversation_id : Text) : async Bool {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (caller.equal(Principal.anonymous())) return false;
    for (m in mutePreferences.values()) {
      if (m.user.equal(caller) and m.conversation_id == conversation_id) { return m.muted };
    };
    false
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_read_conversation_club(conversation_id : Text) : async { #Ok : ?Text; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (Principal.isAnonymous(caller)) return #Err("Sign in required");
    switch (findConversationIndex(conversation_id)) {
      case null { #Ok(null) };
      case (?i) { if (not canAccessConversation(caller, conversation_id)) #Err("Forbidden") else #Ok(?conversations[i].club_id) };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_messages_since(conversation_id : Text, since_ms : Nat64) : async { #Ok : [Types.MessageWithReactions]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (not canReadTeamMessages(caller, conversation_id)) return #Err("Conversation access forbidden");
    var result : [Types.MessageWithReactions] = [];
    for (m in messages.values()) {
      if (m.conversation_id == conversation_id and m.created_at_ms > since_ms and result.size() < 200) {
        result := result.concat([{ message = m; reactions = reactionsSummaryFor(m.id) }]);
      };
    };
    #Ok(result)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_get_user_messaging_settings() : async Types.UserMessagingSettings {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    for (s in userMessagingSettings.values()) { if (s.user.equal(caller)) { return s } };
    { user = caller; hide_message_preview = false; ai_catchup_enabled = false }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_unread_count_by_club(principal : Principal) : async { #Ok : [Types.ClubUnreadSummary]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (not caller.equal(principal) and not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return #Err("Access forbidden");
    if (not removalReceiver.enter(principal)) return #Err("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(principal);
    var result : [Types.ClubUnreadSummary] = [];
    for (conversation in conversations.values()) {
      let visible = try { await* requireChatAccess(principal, conversation.id); true } catch (_) { false };
      if (visible and conversation.participants.any(func(p) = p.equal(principal))) {
        let u = unreadFor(principal, conversation.id);
        if (u.count > 0) {
          var found = false;
          result := Array.map<Types.ClubUnreadSummary, Types.ClubUnreadSummary>(result, func(s) = if (s.club_id == conversation.club_id) { found := true; { s with count = s.count + u.count } } else { s });
          if (not found) { result := result.concat([{ club_id = conversation.club_id; count = u.count }]) };
        };
      };
    };
    if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced");
    if (removalReceiver.denied(principal)) throw Error.reject("Account removal fenced");
    #Ok(result)
    } finally { removalReceiver.leave(principal) };
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_recent_conversations(principal : Principal, limit : Nat16) : async { #Ok : [Types.RecentConversation]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (not caller.equal(principal) and not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return #Err("Access forbidden");
    if (not removalReceiver.enter(principal)) return #Err("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(principal);
    if (limit == 0 or limit > 100) return #Err("Invalid limit");
    var entries : [Types.RecentConversation] = [];
    for (conversation in conversations.values()) {
      let visible = try { await* requireChatAccess(principal, conversation.id); true } catch (_) { false };
      if (visible and conversation.participants.any(func(p) = p.equal(principal)) and not isGroupDeleted(conversation.id)) {
        let lastSeq : Nat64 = if (conversation.next_sequence == 0) 0 else conversation.next_sequence - 1;
        entries := entries.concat([{ conversation_id = conversation.id; kind = inferConversationKind(conversation); last_message_sequence = lastSeq; last_message_at_ms = null }]);
      };
    };
    let sorted = entries.sort(func(a, b) = Nat64.compare(b.last_message_sequence, a.last_message_sequence));
    let take = if (sorted.size() < Nat16.toNat(limit)) sorted.size() else Nat16.toNat(limit);
    if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced");
    if (removalReceiver.denied(principal)) throw Error.reject("Account removal fenced");
    #Ok(Array.tabulate<Types.RecentConversation>(take, func(i) = sorted[i]))
    } finally { removalReceiver.leave(principal) };
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_all_online_users() : async { #Ok : [Types.OnlineUser]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (caller.equal(Principal.anonymous())) return #Err("Authenticated caller required");
    if (not isGovernor(caller) and not hasRole(caller, "app_admin", null, null)) return #Err("App admin required");
    let now = nowMs();
    let windowMs : Nat64 = 150_000;
    let online = presence.filter(func(entry) = entry.last_seen_ms + windowMs >= now);
    #Ok(online.map<Types.PresencePing, Types.OnlineUser>(func(entry) = { user = entry.user; last_seen_ms = entry.last_seen_ms; platform = entry.platform }))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_online_count(conversation_id : Text) : async { #Ok : Nat64; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (caller.equal(Principal.anonymous())) return #Err("Authenticated caller required");
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    let now = nowMs();
    let windowMs : Nat64 = 150_000;
    var count : Nat64 = 0;
    for (c in conversations.values()) {
      if (c.id == conversation_id) {
        for (p in c.participants.values()) {
          if (not p.equal(caller)) {
            let online = presence.any(func(entry) =
              entry.user.equal(p) and entry.last_seen_ms + windowMs >= now
            );
            if (online) { count += 1 };
          };
        };
      };
    };
    #Ok(count)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_typing(conversation_id : Text) : async { #Ok : [Types.TypingUser]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (caller.equal(Principal.anonymous())) return #Err("Authenticated caller required");
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    let now = nowMs();
    let active = typingPings.filter(func(p) =
      p.conversation_id == conversation_id and
      not p.user.equal(caller) and
      p.last_typed_ms + TYPING_TTL_MS >= now
    );
    #Ok(active.map<Types.TypingPing, Types.TypingUser>(func(p) = { user = p.user; name = p.name }))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_pinned_messages(conversation_id : Text) : async { #Ok : [Types.PinnedMessage]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    await* requireChatAccess(caller, conversation_id);
    if (caller.equal(Principal.anonymous())) return #Err("Authenticated caller required");
    if (not canAccessConversation(caller, conversation_id)) return #Err("Conversation access forbidden");
    #Ok(pinnedMessages.filter(func(p) = p.conversation_id == conversation_id))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_content_reports(status : ?Text) : async { #Ok : [Types.ContentReport]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (not (isGovernor(caller) or hasRole(caller, "app_admin", null, null))) return #Err("App admin required");
    switch (status) {
      case null { #Ok(contentReports) };
      case (?s) { #Ok(contentReports.filter(func(r) = r.status == s)) };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_blocked_users() : async [Principal] {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (caller.equal(Principal.anonymous())) return [];
    let mine = blockedUsers.filter(func(entry) = entry.blocker.equal(caller));
    Array.map<Types.BlockedUser, Principal>(mine, func(entry) = entry.blocked)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_has_blocked(user : Principal) : async Bool {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    blockedUsers.any(func(entry) = entry.blocker.equal(caller) and entry.blocked.equal(user))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Trusted delegation checks the original human, never the queue's identity.
  public shared ({ caller }) func read_account_can_read_digest(subject : Principal, conversation_id : Text) : async Bool {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    let configured = notificationQueueCanister;
    if (configured != ?caller) return false;
    if (not removalReceiver.enter(subject)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    await admitAccount(subject);
    try { await* requireChatAccess(subject, conversation_id) } catch (_) { return false };
    configured == notificationQueueCanister and not convFenced(conversation_id) and canReadTeamMessages(subject, conversation_id)
  
    } finally { removalReceiver.leave(subject) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Resource-specific delegation; this returns no message bodies or participants.
  public shared ({ caller }) func read_vault_chat_access(subject : Principal, chat_type : Text, chat_id : Text) : async { #Ok : { club : Text; team : ?Text; can_manage : Bool }; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (vaultDomainCanister != ?caller) return #Err("Vault authority required");
    if (not removalReceiver.enter(subject)) return #Err("Account fenced");
    try {
      await admitAccount(subject);
      let conversation = conversations.find(func c =
        (chat_type == "team" and c.team_id == ?chat_id) or
        (chat_type == "club" and c.club_id == chat_id and c.team_id == null and inferConversationKind(c) == "club") or
        (chat_type == "group" and c.id == chat_id)) ?? return #Err("Conversation not found");
      try { await* requireChatAccess(subject, conversation.id) } catch (_) { return #Err("Conversation access forbidden") };
      if (vaultDomainCanister != ?caller or conversations.find(func c = c.id == conversation.id) != ?conversation or not canAccessConversation(subject, conversation.id) or convFenced(conversation.id)) return #Err("Conversation access forbidden");
      let manager = isGovernor(subject) or isGroupAdmin(subject, conversation.id) or hasRole(subject, "club_admin", ?conversation.club_id, null) or
        (conversation.team_id != null and (hasRole(subject, "team_admin", ?conversation.club_id, conversation.team_id) or hasRole(subject, "coach", ?conversation.club_id, conversation.team_id)));
      #Ok({ club = conversation.club_id; team = conversation.team_id; can_manage = manager })
    } finally { removalReceiver.leave(subject) }
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  public shared ({ caller }) func set_vault_domain_canister(id : Principal) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not isGovernor(caller) or id.equal(Principal.anonymous())) return #Err("Governor required");
    vaultDomainCanister := ?id; #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func prepare_account_removal(request : RemovalReceiver.Request) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    switch (removalReceiver.prepare(caller, request)) {
      case (#Err(e)) #Err(e);
      case (#Ok) {
        // Cancel only unfinished local schedules; preserve historical messages.
        scheduledMessages := scheduledMessages.filter(func(s) = s.replayed_at_ms != null or not request.subjects.any(func(p) = p.equal(s.sender)));
        #Ok
      }
    }
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  public shared ({ caller }) func read_account_removal_drain(request : RemovalReceiver.Request) : async { #Ok : RemovalReceiver.Receipt; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    // Timer-originated sweeps remain conservative pending work; each outgoing
    // reminder also has an original-subject hold through its queue reply.
    removalReceiver.receipt(caller, request, Principal.fromActor(this), if (photoReminderSweepRunning) 1 else 0)
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func seal_account_removal(request : RemovalReceiver.Request) : async { #Ok : RemovalReceiver.Receipt; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    // Timer-originated sweeps remain conservative pending work; each outgoing
    // reminder also has an original-subject hold through its queue reply.
    removalReceiver.seal(caller, request, Principal.fromActor(this), if (photoReminderSweepRunning) 1 else 0)
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
}
