import PrivateNameWriterWindow "../../shared/PrivateNameWriterWindow";
import PrivateNameWriterEndpoints "../../shared/PrivateNameWriterEndpoints";
import AccountAdmission "../../shared/AccountAdmission";
import BroadcastErasure "../../shared/BroadcastErasure";
import OpeningConfiguration "../../shared/OpeningConfiguration";
import RemovalReceiver "../../shared/RemovalReceiver";
import RemovalEndpoints "../../shared/PrivateNameRemovalEndpoints";
import Map "mo:core/Map";
import EmailOutbox "../../shared/EmailOutbox";
import Error "mo:core/Error";
import PrimMem "mo:⛔";
import Cycles "mo:core/Cycles";
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Nat "mo:core/Nat";
import Nat16 "mo:core/Nat16";
import Nat32 "mo:core/Nat32";
import PrivateProfileAudience "../../shared/PrivateProfileAudience";
import Int "mo:core/Int";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Random "mo:core/Random";
import Text "mo:core/Text";
import Nat8 "mo:core/Nat8";
import Iter "mo:core/Iter";
import Types "types";
import Welcome "welcomeSettings";
import FixtureOperations "fixtureOperations";
import BroadcastPlan "broadcastPlan";
import ScorePrivacy "scorePrivacy";
import ClubSnapshot "clubSnapshot";
import PrivateAdminNames "privateAdminNames";

persistent actor class Main(governorInit : Principal) = this {
  // Local rehearsal only. Eligibility never grants resource permissions.
  transient let accountAdmissionEnabled = Runtime.envVar<system>("IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL") == ?"1";
  transient let accountAdmissionAuthority = switch (Runtime.envVar<system>("IGNITE_ACCOUNT_SERVICE_IDENTITY")) {
    case (?id) ?Principal.fromText(id); case null null
  };
  transient let privateMessagingAuthority = Runtime.envVar<system>("IGNITE_PRIVATE_PROFILE_MESSAGING");
  transient let accountAdmission = AccountAdmission.Gate(accountAdmissionEnabled, accountAdmissionAuthority);
  // Separate stop-the-world rehearsal only; never enabled by deploy scripts.
  var private_name_writer_intents : Map.Map<Text, PrivateNameWriterWindow.Intent>;
  transient let privateNameWriterGate = PrivateNameWriterWindow.Gate(Runtime.envVar<system>("IGNITE_PRIVATE_NAME_WRITER_REHEARSAL") == ?"1", accountAdmissionAuthority, private_name_writer_intents, 4096);
  include PrivateNameWriterEndpoints(privateNameWriterGate, Principal.fromActor(this));

  var removal_intents : Map.Map<Text, RemovalReceiver.Request>;
  var removal_subjects : Map.Map<Principal, Text>;
  var removal_active : Map.Map<Principal, Nat>;
  transient let removalReceiver = RemovalReceiver.Gate(accountAdmissionEnabled, accountAdmissionAuthority, removal_intents, removal_subjects, removal_active);
  include RemovalEndpoints(removalReceiver, Principal.fromActor(this), func _ = 0, func () = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) Runtime.trap(reason) }, privateNameWriterGate.leave);
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
    if (participantClubAuthorities.size() > 64) Runtime.trap("Opening authority set exceeds bounded owner scope");
    [("club_domain", OpeningConfiguration.optional(clubDomainCanister)),
     ("events_domain", OpeningConfiguration.optional(eventsDomainCanister)),
     ("vault_domain", OpeningConfiguration.optional(vaultDomainCanister)),
     ("pii_access_control", OpeningConfiguration.optional(piiAccessControlCanister))]
      .concat(participantClubAuthorities.map(func p = ("participant_club_authority", p.toText())))
  };
  // Live memory reading for the admin health page (public, like cycles_balance).
  public query func memory_stats() : async { heap_bytes : Nat; memory_bytes : Nat; stable_bytes : Nat } {
    {
      heap_bytes = PrimMem.rts_heap_size();
      memory_bytes = PrimMem.rts_memory_size();
      stable_bytes = PrimMem.nat64ToNat(PrimMem.stableMemorySize()) * 65536;
    }
  };

  var governor : Principal;

  if (governor.equal(Principal.anonymous()) and not governorInit.equal(Principal.anonymous())) {
    governor := governorInit;
  };
  var roles : [Types.RoleGrant];
  var competitions : [Types.Competition];
  var entries : [Types.TeamEntry];
  var tokens : [Types.JoinToken];
  var seasons : [Types.Season];
  var matches : [Types.Match];
  var scorePrivacySettings : [ScorePrivacy.Setting];
  var playhqMatchMetadata : [Types.PlayHQMatchMeta];
  var playhqStats : [Types.PlayHQStat];
  var playhqClaims : [Types.PlayHQClaim];
  var playhqCompetitionLinks : [Types.PlayHQCompetitionLink];
  func readableMatch(game : Types.Match, manager : Bool) : Types.MatchRead {
    ScorePrivacy.mask(game, not manager and ScorePrivacy.hidden(scorePrivacySettings, game.competition_id, game.division_id))
  };
  public query func get_score_privacy(competition_id : Text) : async [ScorePrivacy.Setting] {
    scorePrivacySettings.filter(func(x) = x.competition_id == competition_id)
  };
  public shared ({ caller }) func set_score_privacy(competition_id : Text, division : ?Text, hide_scores : ?Bool) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    scorePrivacySettings := scorePrivacySettings.filter(func(x) = not (x.competition_id == competition_id and x.division == division));
    switch (hide_scores) { case (?hide) { scorePrivacySettings := scorePrivacySettings.concat([{ competition_id; division; hide_scores = hide }]) }; case null {} };
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  var bulkAccessPrincipals : [Principal];
  var chatSettings : [Types.ChatSettings];
  var competitionWelcomeSettings : [Welcome.Settings];
  var competitionInvites : [Types.CompetitionInvite];
  var competitionJoinLinks : [Types.CompetitionJoinLink];
  var competitionOfficialEmailInvites : [Types.CompetitionOfficialEmailInvite];
  var competitionWelcomeJobs : [Types.CompetitionWelcomeJob];
  var competitionMemberWelcomeJobs : [Types.CompetitionMemberWelcomeJob];
  var eoiSubmissions : [Types.EoiSubmission];

  func eoiHex(b : Blob) : Text {
    let digits = "0123456789abcdef".chars().toArray();
    var out = "";
    for (byte in b.vals()) {
      let n = byte.toNat();
      out #= Text.fromChar(digits[n / 16]) # Text.fromChar(digits[n % 16]);
    };
    out
  };

  func eoiClip(t : Text, max : Nat) : Text { if (t.size() > max) "" else t };

  // Public (anonymous allowed) expression-of-interest submission — parity
  // with the Supabase anon insert on eoi_submissions. Size-capped and
  // capped per season to bound spam; club/season existence is checked by
  // the frontend against club_domain's public EOI config before submit.
  public shared func submit_public_eoi(
    club_id : Text, season_id : Text, parent_name : Text, parent_email : Text,
    parent_mobile : ?Text, player_name : Text, player_dob : ?Text, player_gender : ?Text,
    preferred_teammates : ?Text, preferred_position : ?Text, skill_level : ?Nat16,
    training_days : [Text], game_days : [Text], notes : ?Text, source : Text,
  ) : async { #Ok : Text; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    let pn = eoiClip(parent_name.trim(#char ' '), 120);
    let pe = eoiClip(parent_email.trim(#char ' ').toLower(), 200);
    let pl = eoiClip(player_name.trim(#char ' '), 120);
    if (club_id == "" or season_id == "" or pn == "" or pl == "" or not pe.contains(#char '@')) return #Err("Missing required fields");
    if (training_days.size() > 7 or game_days.size() > 7) return #Err("Invalid days");
    let authority = clubDomainCanister ?? return #Err("EOI authority not configured");
    let club : actor { can_accept_public_eoi : shared (Text, Text) -> async Bool } = actor(authority.toText());
    if (not (await club.can_accept_public_eoi(club_id, season_id)) or isFenced(club_id)) return #Err("EOI form is not accepting registrations");
    let recent = eoiSubmissions.filter(func e = e.parent_email == pe and nowMs() - e.created_at_ms < 86_400_000);
    if (recent.size() >= 3) return #Err("Registration email limit reached");
    let small = func(o : ?Text) : ?Text = switch (o) { case (?t) { let c = eoiClip(t, 1000); if (c == "") null else ?c }; case null null };
    if (eoiSubmissions.filter(func(e) = e.season_id == season_id).size() >= 5000) return #Err("This form is full");
    let dup = eoiSubmissions.find(func(e) = e.season_id == season_id and e.parent_email == pe and e.player_name.toLower() == pl.toLower());
    if (dup != null) return #Err("An expression of interest for this player was already submitted");
    let rnd = await Random.blob();
    let hex = eoiHex(rnd);
    let now = nowMs();
    let id = "eoi-" # Text.fromIter(hex.chars().take(16));
    let entry : Types.EoiSubmission = {
      id; club_id; season_id;
      claim_token = hex;
      status = "submitted";
      source = if (source == "embed") "website" else if (source == "app") "app" else "website";
      parent_name = pn; parent_email = pe; parent_mobile = small(parent_mobile); parent_user_id = null;
      player_name = pl; player_dob = small(player_dob); player_gender = small(player_gender);
      age_group = null; preferred_position = small(preferred_position); preferred_teammates = small(preferred_teammates);
      skill_level; returning_player = false; game_days; training_days;
      extra_notes = null; notes = small(notes); child_id = null; assigned_team_id = null;
      invite_sent_count = 0; invite_sent_at_ms = null;
      submitted_at_ms = now; created_at_ms = now; updated_at_ms = now;
      allocated_at_ms = null; confirmed_at_ms = null; registered_at_ms = null; withdrawn_at_ms = null;
      claimed_at_ms = null; parent_confirmed_at_ms = null; revision = 0;
    };
    if (eoiSubmissions.any(func e = e.season_id == season_id and e.parent_email == pe and e.player_name.toLower() == pl.toLower())) return #Err("Registration already exists");
    if (eoiSubmissions.filter(func e = e.parent_email == pe and now - e.created_at_ms < 86_400_000).size() >= 3) return #Err("Registration email limit reached");
    switch (emailOutbox.enqueue("eoi:" # id # ":initial", "eoi", id, "", now)) { case (#Err(e)) return #Err(e); case (#Ok) {} };
    eoiSubmissions := eoiSubmissions.concat([entry]);
    #Ok(id)
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  var divisionSettings : [Types.DivisionSetting];
  var competitionLadderSettings : [Types.CompetitionLadderSetting];
  var broadcasts : [Types.Broadcast];
  var broadcastDeliveries : Map.Map<Text, { sender : Principal; competition : Text; divisions : [Text]; title : Text; body : Text; broadcast_id : Text; completed : [(Text, Nat16)]; unknown : ?Text }>;
  var emailJobs : Map.Map<Text, EmailOutbox.Job>;
  var emailWorkers : [Principal];
  var fixtureReceipts : Map.Map<Text, FixtureOperations.Receipt>;
  var broadcastPlans:Map.Map<Text,[BroadcastPlan.Target]>;
  transient let emailOutbox = EmailOutbox.Queue(emailJobs);
  public shared ({ caller }) func set_email_workers(workers : [Principal]) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not isGovernor(caller) or workers.size() > 10 or workers.any(func p = Principal.isAnonymous(p))) return #Err("Governor and valid workers required");
    emailWorkers := workers; #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  public shared ({ caller }) func queue_official_invite_email(token : Text, ciphertext : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) return #Err("Account unavailable");
    try {
      auth(caller); await admitAccount(caller);
      let invite = competitionOfficialEmailInvites.find(func i = i.token == token) ?? return #Err("Invitation missing");
      await syncForCompetition(caller, invite.competition_id);
      if (removalReceiver.denied(caller) or compFenced(invite.competition_id) or not canManageCompetition(caller, invite.competition_id) or not competitionOfficialEmailInvites.any(func i = i == invite) or invite.revoked or invite.accepted_by != null) return #Err("Invitation unavailable");
      if (ciphertext.size() < 32) return #Err("Encrypted email payload required");
      if (Map.entries(emailJobs).filter(func pair = nowMs() - pair.1.created_at_ms < 86_400_000).size() >= 100) return #Err("Daily invitation email limit reached");
      emailOutbox.enqueue("official:" # token, "official", token, ciphertext, nowMs())
    } finally { removalReceiver.leave(caller) }
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  public shared ({ caller }) func claim_email_job() : async { #Ok : ?{ job : EmailOutbox.Job; to : Text; subject : Text; body : Text; token : Text }; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not emailWorkers.any(func p = p == caller)) return #Err("Email worker required");
    let claimed = emailOutbox.claim(caller, func job {
      if (job.kind == "eoi") return eoiSubmissions.any(func e = e.id == job.resource and e.status != "withdrawn" and e.parent_user_id == null and not isFenced(e.club_id));
      if (job.kind == "official") return competitionOfficialEmailInvites.any(func i = i.token == job.resource and not i.revoked and i.accepted_by == null and i.expires_at_ms > nowMs() and not compFenced(i.competition_id));
      if (job.kind == "official_welcome") return competitionOfficialEmailInvites.any(func i = i.token == job.resource and not i.revoked and i.accepted_by != null and not compFenced(i.competition_id) and competitionWelcomeSettings.any(func s = s.competition_id == i.competition_id and s.enabled));
      if (job.kind == "member_welcome") return competitionMemberWelcomeJobs.any(func j = j.token == job.resource and not removalReceiver.denied(j.member) and not compFenced(j.competition_id) and competitionWelcomeSettings.any(func s = s.competition_id == j.competition_id and s.enabled));
      false
    });
    let job = claimed ?? return #Ok(null);
    if (job.kind == "official") {
      let invite = competitionOfficialEmailInvites.find(func i = i.token == job.resource) ?? return #Err("Invite missing");
      return #Ok(?{ job; to = invite.email_hash; subject = "You're invited to an Ignite competition"; body = invite.verification_code_hash; token = "" })
    };
    if (job.kind == "eoi") {
      let entry = eoiSubmissions.find(func e = e.id == job.resource) ?? return #Err("EOI missing");
      return #Ok(?{ job; to = entry.parent_email; subject = "Complete your Ignite registration"; body = "Your expression of interest has been received. Continue your registration using the link below."; token = entry.claim_token })
    };
    let source = if (job.kind == "official_welcome") {
      let j = competitionWelcomeJobs.find(func j = j.token == job.resource) ?? return #Err("Welcome missing");
      (j.competition_id, j.to)
    } else {
      let j = competitionMemberWelcomeJobs.find(func j = j.token == job.resource) ?? return #Err("Welcome missing");
      (j.competition_id, j.to)
    };
    let settings = competitionWelcomeSettings.find(func s = s.competition_id == source.0 and s.enabled) ?? return #Err("Welcome disabled");
    #Ok(?{ job; to = source.1; subject = settings.subject; body = settings.message; token = "" })
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  public shared ({ caller }) func finish_email_job(id : Text, attempt : Nat, outcome : Text, provider_id : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not emailWorkers.any(func p = p == caller)) return #Err("Email worker required");
    let before = Map.get(emailJobs, Text.compare, id) ?? return #Err("Email job missing");
    let reply = emailOutbox.finish(caller, id, attempt, outcome, provider_id);
    switch reply { case (#Err(e)) return #Err(e); case (#Ok) {} };
    if (outcome == "sent" and before.state == "processing") {
      let job = Map.get(emailJobs, Text.compare, id) ?? return #Err("Email job missing");
      if (job.kind == "eoi") eoiSubmissions := eoiSubmissions.map(func e = if (e.id == job.resource) ({ e with invite_sent_count = e.invite_sent_count + 1; invite_sent_at_ms = ?nowMs() }) else e);
    }; #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  public shared ({caller}) func reconcile_email_job(id:Text,attempt:Nat,provider_id:Text):async{#Ok;#Err:Text} {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if(not emailWorkers.any(func p = p==caller))return #Err("Original email worker required");
    emailOutbox.reconcile(caller,id,attempt,"sent",provider_id)
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  public shared ({caller}) func compact_email_jobs(cursor:?Text,limit:Nat):async{#Ok:{next_cursor:?Text;scanned:Nat};#Err:Text} {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if(not isGovernor(caller) or limit==0 or limit > 200)return #Err("Governor and bounded page required");
    #Ok(emailOutbox.compact(cursor,limit))
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  var clubDomainCanister : ?Principal;
  var participantClubAuthorities : [Principal];
  var eventsDomainCanister : ?Principal;
  var vaultDomainCanister : ?Principal;
  var piiAccessControlCanister : ?Principal;
  var personalCompetitionOwners : [(Text, Principal)];
  var roleLinks : [Types.RoleLink];
  var officialChats : [Types.OfficialChat];
  var transferFences : [Text];

  // ---------------- Referee / committee officials ----------------


  // ---- Club transfer fence + snapshot (governor-only operator tooling) ----
  // Inspect is advisory only; the runner re-digests the source before cutover.
  func fenceGov(caller : Principal) : Bool = not caller.equal(Principal.anonymous()) and governor.equal(caller);
  func isFenced(club : Text) : Bool = transferFences.any(func(c) = c == club);
  func fenceBlobHas(hay : Blob, needle : Text) : Bool {
    let h = Blob.toArray(hay); let n = Blob.toArray(Text.encodeUtf8(needle));
    if (n.size() == 0 or n.size() > h.size()) return false;
    var i = 0;
    while (i + n.size() <= h.size()) { var j = 0; while (j < n.size() and h[i + j] == n[j]) j += 1; if (j == n.size()) return true; i += 1 };
    false
  };
  system func inspect({ caller : Principal; arg : Blob }) : Bool {
    if (transferFences.size() == 0 or fenceGov(caller)) return true;
    not transferFences.any(func(c) = fenceBlobHas(arg, c))
  };
  public shared ({ caller }) func set_transfer_fence(club : Text, fenced : Bool) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not fenceGov(caller)) return #Err("Governor required");
    transferFences := transferFences.filter(func(c) = c != club);
    if (fenced) transferFences := transferFences.concat([club]);
    #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  func compFenced(id : Text) : Bool = transferFences.size() > 0 and competitions.any(func(x) = x.id == id and isFenced(x.club_id));
  func matchFenced(id : Text) : Bool = transferFences.size() > 0 and matches.any(func(x) = x.id == id and compFenced(x.competition_id));
  type FenceSnapshot = ClubSnapshot.FenceSnapshot;
  func emailInClub(job : EmailOutbox.Job, club : Text) : Bool {
    if (job.kind == "eoi") return eoiSubmissions.any(func e = e.id == job.resource and e.club_id == club);
    if (job.kind == "official" or job.kind == "official_welcome") return competitionOfficialEmailInvites.any(func i = i.token == job.resource and competitions.any(func c = c.id == i.competition_id and c.club_id == club));
    if (job.kind == "member_welcome") return competitionMemberWelcomeJobs.any(func j = j.token == job.resource and competitions.any(func c = c.id == j.competition_id and c.club_id == club));
    false
  };
  func clubRecovery(c : Text) : ClubSnapshot.Recovery {
    let inC = func(id : Text) : Bool = competitions.any(func x = x.club_id == c and x.id == id);
    let deliveries = Map.entries(broadcastDeliveries).filter(func pair = inC(pair.1.competition)).toArray();
    { email_jobs = Map.entries(emailJobs).filter(func pair = emailInClub(pair.1, c)).toArray();
      fixture_receipts = Map.entries(fixtureReceipts).filter(func pair = inC(pair.1.input.competition_id)).toArray();
      broadcast_deliveries = deliveries;
      broadcast_plans = Map.entries(broadcastPlans).filter(func pair = deliveries.any(func d = d.0 == pair.0)).toArray() }
  };
  func fenceSnapshot(c : Text) : FenceSnapshot {
    let rootC = competitions.filter(func(x) = x.club_id == c);
    let inC = func(k : Text) : Bool = rootC.any(func(x) = x.id == k);
    { recovery = ?clubRecovery(c); playhq_links = ?playhqCompetitionLinks.filter(func x = x.club_id == c); playhq_metadata=?playhqMatchMetadata.filter(func(x)=inC(x.competition_id));playhq_stats=?playhqStats.filter(func(x)=inC(x.competition_id));score_privacy = ?scorePrivacySettings.filter(func(x) = inC(x.competition_id));
      competitions = competitions.filter(func(x) = x.club_id == c);
      roles = roles.filter(func(x) = inC(x.competition_id));
      entries = entries.filter(func(x) = inC(x.competition_id));
      tokens = tokens.filter(func(x) = inC(x.competition_id));
      seasons = seasons.filter(func(x) = inC(x.competition_id));
      matches = matches.filter(func(x) = inC(x.competition_id));
      chat_settings = chatSettings.filter(func(x) = inC(x.competition_id));
      welcome = competitionWelcomeSettings.filter(func(x) = inC(x.competition_id));
      invites = competitionInvites.filter(func(x) = inC(x.competition_id));
      join_links = competitionJoinLinks.filter(func(x) = inC(x.competition_id));
      official_invites = competitionOfficialEmailInvites.filter(func(x) = inC(x.competition_id));
      welcome_jobs = competitionWelcomeJobs.filter(func(x) = inC(x.competition_id));
      member_welcome_jobs = ?competitionMemberWelcomeJobs.filter(func(x) = inC(x.competition_id));
      eoi = eoiSubmissions.filter(func(x) = x.club_id == c);
      divisions = divisionSettings.filter(func(x) = inC(x.competition_id));
      ladders = competitionLadderSettings.filter(func(x) = inC(x.competition_id));
      broadcasts = broadcasts.filter(func(x) = inC(x.competition_id));
      owners = personalCompetitionOwners.filter(func(x) = inC(x.0));
      role_links = roleLinks.filter(func(x) = inC(x.competition_id));
      official_chats = officialChats.filter(func(x) = inC(x.competition_id)) }
  };
  func fenceDrop(c : Text) {
    let recovery = clubRecovery(c);
    for ((key, _) in recovery.email_jobs.values()) Map.remove(emailJobs, Text.compare, key);
    for ((key, _) in recovery.fixture_receipts.values()) Map.remove(fixtureReceipts, Text.compare, key);
    for ((key, _) in recovery.broadcast_deliveries.values()) Map.remove(broadcastDeliveries, Text.compare, key);
    for ((key, _) in recovery.broadcast_plans.values()) Map.remove(broadcastPlans, Text.compare, key);
    let rootC = competitions.filter(func(x) = x.club_id == c);
    let inC = func(k : Text) : Bool = rootC.any(func(x) = x.id == k);
    scorePrivacySettings := scorePrivacySettings.filter(func(x) = not inC(x.competition_id));
    playhqMatchMetadata:=playhqMatchMetadata.filter(func(x)=not inC(x.competition_id));
    playhqStats:=playhqStats.filter(func(x)=not inC(x.competition_id));
    playhqCompetitionLinks := playhqCompetitionLinks.filter(func x = x.club_id != c);
    competitions := competitions.filter(func(x) = not (x.club_id == c));
    roles := roles.filter(func(x) = not (inC(x.competition_id)));
    entries := entries.filter(func(x) = not (inC(x.competition_id)));
    tokens := tokens.filter(func(x) = not (inC(x.competition_id)));
    seasons := seasons.filter(func(x) = not (inC(x.competition_id)));
    matches := matches.filter(func(x) = not (inC(x.competition_id)));
    chatSettings := chatSettings.filter(func(x) = not (inC(x.competition_id)));
    competitionWelcomeSettings := competitionWelcomeSettings.filter(func(x) = not (inC(x.competition_id)));
    competitionInvites := competitionInvites.filter(func(x) = not (inC(x.competition_id)));
    competitionJoinLinks := competitionJoinLinks.filter(func(x) = not (inC(x.competition_id)));
    competitionOfficialEmailInvites := competitionOfficialEmailInvites.filter(func(x) = not (inC(x.competition_id)));
    competitionWelcomeJobs := competitionWelcomeJobs.filter(func(x) = not (inC(x.competition_id)));
    competitionMemberWelcomeJobs := competitionMemberWelcomeJobs.filter(func(x) = not (inC(x.competition_id)));
    eoiSubmissions := eoiSubmissions.filter(func(x) = not (x.club_id == c));
    divisionSettings := divisionSettings.filter(func(x) = not (inC(x.competition_id)));
    competitionLadderSettings := competitionLadderSettings.filter(func(x) = not (inC(x.competition_id)));
    broadcasts := broadcasts.filter(func(x) = not (inC(x.competition_id)));
    personalCompetitionOwners := personalCompetitionOwners.filter(func(x) = not (inC(x.0)));
    roleLinks := roleLinks.filter(func(x) = not (inC(x.competition_id)));
    officialChats := officialChats.filter(func(x) = not (inC(x.competition_id)));
  };
  public query ({ caller }) func export_club_snapshot(club : Text) : async { #Ok : Blob; #Err : Text } {
    if (not fenceGov(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before export");
    #Ok(to_candid (fenceSnapshot(club)))
  };
  public shared ({ caller }) func import_club_snapshot(club : Text, snapshot : Blob) : async { #Ok : Nat; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not fenceGov(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before import");
    let decoded : ?FenceSnapshot = from_candid (snapshot);
    let s = switch (decoded) { case (?x) x; case null return #Err("Invalid snapshot") };
    if (removalReceiver.snapshotDenied(snapshot)) return #Err("Snapshot references fenced account");
    if (broadcastErasureSubjects.entries().any(func pair = fenceBlobHas(snapshot, pair.0.toText()))) return #Err("Snapshot restores broadcast-erasure subject");
    let privacy = switch (s.score_privacy) { case (?rows) rows; case null [] };
    let phqMeta=s.playhq_metadata??[];let phqStats=s.playhq_stats??[];
    let phqLinks = s.playhq_links ?? [];
    if (s.playhq_links == null and playhqCompetitionLinks.any(func x = x.club_id == club)) return #Err("Legacy snapshot omits existing PlayHQ links");
    if (ClubSnapshot.duplicateKeys(phqLinks.map(func x = x.competition_id)) or ClubSnapshot.duplicateKeys(phqLinks.map(func x = x.tenant # "\u{1f}" # x.grade_id))) return #Err("Duplicate PlayHQ links");
    let c = club;
    let rootC = s.competitions;
    let inC = func(k : Text) : Bool = rootC.any(func(x) = x.id == k);
    if (phqLinks.any(func x = x.club_id != club or not inC(x.competition_id) or not valid(x.tenant) or not valid(x.grade_id))) return #Err("Foreign or invalid PlayHQ links");
    if (phqLinks.any(func x = playhqCompetitionLinks.any(func old = old.competition_id == x.competition_id and (old.club_id != x.club_id or old.tenant != x.tenant or old.grade_id != x.grade_id or old.sport != x.sport)))) return #Err("PlayHQ source binding conflict");
    if (phqMeta.any(func x = phqLinks.any(func link = link.competition_id == x.competition_id and (link.tenant != x.tenant or link.grade_id != x.grade_id)))) return #Err("PlayHQ metadata source mismatch");
    let existingRecovery = clubRecovery(club);
    if (s.recovery == null and (existingRecovery.email_jobs.size() > 0 or existingRecovery.fixture_receipts.size() > 0 or existingRecovery.broadcast_deliveries.size() > 0)) return #Err("Legacy snapshot omits existing recovery records");
    let recovery : ClubSnapshot.Recovery = s.recovery ?? ({ email_jobs = []; fixture_receipts = []; broadcast_deliveries = []; broadcast_plans = [] });
    if (ClubSnapshot.duplicateKeys(recovery.email_jobs.map(func pair = pair.0)) or ClubSnapshot.duplicateKeys(recovery.fixture_receipts.map(func pair = pair.0)) or ClubSnapshot.duplicateKeys(recovery.broadcast_deliveries.map(func pair = pair.0)) or ClubSnapshot.duplicateKeys(recovery.broadcast_plans.map(func pair = pair.0))) return #Err("Duplicate recovery keys");
    if (recovery.email_jobs.any(func pair = switch (Map.get(emailJobs, Text.compare, pair.0)) { case (?old) old != pair.1; case null false }) or recovery.broadcast_deliveries.any(func pair = switch (Map.get(broadcastDeliveries, Text.compare, pair.0)) { case (?old) old != pair.1; case null false })) return #Err("Snapshot must not roll back delivery evidence");
    let emailOwned = func(j : EmailOutbox.Job) : Bool {
      if (j.kind == "eoi") return s.eoi.any(func e = e.id == j.resource);
      if (j.kind == "official" or j.kind == "official_welcome") return s.official_invites.any(func i = i.token == j.resource);
      if (j.kind == "member_welcome") return (s.member_welcome_jobs ?? []).any(func w = w.token == j.resource);
      false
    };
    if (recovery.email_jobs.any(func pair = pair.0 != pair.1.id or not emailOwned(pair.1)) or recovery.fixture_receipts.any(func pair = not inC(pair.1.input.competition_id) or not s.matches.any(func m = m.id == pair.1.match_id and m.competition_id == pair.1.input.competition_id)) or recovery.broadcast_deliveries.any(func pair = not inC(pair.1.competition) or not s.broadcasts.any(func b = b.id == pair.1.broadcast_id and b.competition_id == pair.1.competition)) or recovery.broadcast_plans.any(func pair = not recovery.broadcast_deliveries.any(func d = d.0 == pair.0))) return #Err("Foreign recovery snapshot records");
    // An unknown provider/queue commit cannot be moved to a different authority.
    if (recovery.email_jobs.any(func pair = pair.1.state == "processing" or pair.1.state == "unknown") or existingRecovery.email_jobs.any(func pair = pair.1.state == "processing" or pair.1.state == "unknown") or recovery.broadcast_deliveries.any(func pair = pair.1.unknown != null) or existingRecovery.broadcast_deliveries.any(func pair = pair.1.unknown != null)) return #Err("Resolve original delivery outcomes before snapshot replacement");
    if (recovery.email_jobs.any(func pair = switch (Map.get(emailJobs, Text.compare, pair.0)) { case (?j) not emailInClub(j, club); case null false }) or recovery.fixture_receipts.any(func pair = switch (Map.get(fixtureReceipts, Text.compare, pair.0)) { case (?r) not competitions.any(func c = c.id == r.input.competition_id and c.club_id == club); case null false }) or recovery.broadcast_deliveries.any(func pair = switch (Map.get(broadcastDeliveries, Text.compare, pair.0)) { case (?r) not competitions.any(func c = c.id == r.competition and c.club_id == club); case null false }) or recovery.broadcast_plans.any(func pair = Map.get(broadcastPlans, Text.compare, pair.0) != null and not existingRecovery.broadcast_plans.any(func old = old.0 == pair.0))) return #Err("Recovery key collides with another scope");
    if(phqMeta.any(func(x)=not inC(x.competition_id) or not s.matches.any(func(m)=m.id==x.match_id and m.competition_id==x.competition_id)) or phqStats.any(func(x)=not phqMeta.any(func(m)=m.match_id==x.match_id and m.game_id==x.game_id and m.tenant==x.tenant and m.competition_id==x.competition_id))) return #Err("Foreign PlayHQ snapshot records");
    if (privacy.any(func(x) = not inC(x.competition_id))
        or s.competitions.any(func(x) = not (x.club_id == c))
        or s.roles.any(func(x) = not (inC(x.competition_id)))
        or s.entries.any(func(x) = not (inC(x.competition_id)))
        or s.tokens.any(func(x) = not (inC(x.competition_id)))
        or s.seasons.any(func(x) = not (inC(x.competition_id)))
        or s.matches.any(func(x) = not (inC(x.competition_id)))
        or s.chat_settings.any(func(x) = not (inC(x.competition_id)))
        or s.welcome.any(func(x) = not (inC(x.competition_id)))
        or s.invites.any(func(x) = not (inC(x.competition_id)))
        or s.join_links.any(func(x) = not (inC(x.competition_id)))
        or s.official_invites.any(func(x) = not (inC(x.competition_id)))
        or s.welcome_jobs.any(func(x) = not (inC(x.competition_id)))
        or (s.member_welcome_jobs ?? []).any(func(x) = not (inC(x.competition_id)))
        or s.eoi.any(func(x) = not (x.club_id == c))
        or s.divisions.any(func(x) = not (inC(x.competition_id)))
        or s.ladders.any(func(x) = not (inC(x.competition_id)))
        or s.broadcasts.any(func(x) = not (inC(x.competition_id)))
        or s.owners.any(func(x) = not (inC(x.0)))
        or s.role_links.any(func(x) = not (inC(x.competition_id)))
        or s.official_chats.any(func(x) = not (inC(x.competition_id)))) return #Err("Snapshot contains foreign records");
    if (s.competitions.any(func(e) = competitions.any(func(x) = x.id == e.id and x.club_id != club))) return #Err("Snapshot id collides with another club");
    fenceDrop(club); // idempotent replace
    scorePrivacySettings := scorePrivacySettings.concat(privacy);
    playhqMatchMetadata:=playhqMatchMetadata.concat(phqMeta);playhqStats:=playhqStats.concat(phqStats);
    playhqCompetitionLinks := playhqCompetitionLinks.concat(phqLinks);
    competitions := competitions.concat(s.competitions);
    roles := roles.concat(s.roles);
    entries := entries.concat(s.entries);
    tokens := tokens.concat(s.tokens);
    seasons := seasons.concat(s.seasons);
    matches := matches.concat(s.matches);
    chatSettings := chatSettings.concat(s.chat_settings);
    competitionWelcomeSettings := competitionWelcomeSettings.concat(s.welcome);
    competitionInvites := competitionInvites.concat(s.invites);
    competitionJoinLinks := competitionJoinLinks.concat(s.join_links);
    competitionOfficialEmailInvites := competitionOfficialEmailInvites.concat(s.official_invites);
    competitionWelcomeJobs := competitionWelcomeJobs.concat(s.welcome_jobs);
    competitionMemberWelcomeJobs := competitionMemberWelcomeJobs.concat(s.member_welcome_jobs ?? []);
    eoiSubmissions := eoiSubmissions.concat(s.eoi);
    divisionSettings := divisionSettings.concat(s.divisions);
    competitionLadderSettings := competitionLadderSettings.concat(s.ladders);
    broadcasts := broadcasts.concat(s.broadcasts);
    personalCompetitionOwners := personalCompetitionOwners.concat(s.owners);
    roleLinks := roleLinks.concat(s.role_links);
    officialChats := officialChats.concat(s.official_chats);
    for ((key, row) in recovery.email_jobs.values()) Map.add(emailJobs, Text.compare, key, row);
    for ((key, row) in recovery.fixture_receipts.values()) Map.add(fixtureReceipts, Text.compare, key, row);
    for ((key, row) in recovery.broadcast_deliveries.values()) Map.add(broadcastDeliveries, Text.compare, key, row);
    for ((key, row) in recovery.broadcast_plans.values()) Map.add(broadcastPlans, Text.compare, key, row);
    #Ok(s.competitions.size())
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  public shared ({ caller }) func purge_club_snapshot(club : Text) : async { #Ok : Nat; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not fenceGov(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before purge");
    let recovery = clubRecovery(club);
    if (recovery.email_jobs.any(func pair = pair.1.state == "processing" or pair.1.state == "unknown") or recovery.broadcast_deliveries.any(func pair = pair.1.unknown != null)) return #Err("Unresolved delivery receipts must remain at original authority");
    let n = fenceSnapshot(club).competitions.size(); fenceDrop(club); #Ok(n)
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  func isOfficialRole(role : Text) : Bool { role == "referee" or role == "committee" };
  func isChatScope(scope : Text) : Bool { scope == "referees" or scope == "committee" or scope == "coordinators" or scope == "all_members" };

  func competitionName(competition_id : Text) : ?Text {
    switch (competitions.find(func(c) = c.id == competition_id)) { case (?c) ?c.name; case null null }
  };

  // Replaces any active link for (competition, role) with a fresh
  // unguessable token; the old link stops working immediately.
  public shared ({ caller }) func create_role_link(competition_id : Text, role : Text) : async { #Ok : Types.RoleLink; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (not isOfficialRole(role)) return #Err("Invalid role");
    if (competitionName(competition_id) == null) return #Err("Competition not found");
    let hex = eoiHex(do { let removalReply = await Random.blob(); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply });
    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id) or competitionName(competition_id) == null or not canManageCompetition(caller, competition_id)) return #Err("Competition authorization changed");
    let link : Types.RoleLink = { competition_id; role; token = "crl-" # hex; revoked = false; created_by = caller; created_at_ms = nowMs() };
    roleLinks := roleLinks.filter(func(l) = not (l.competition_id == competition_id and l.role == role)).concat([link]);
    #Ok(link)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func revoke_role_link(competition_id : Text, role : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    roleLinks := roleLinks.filter(func(l) = not (l.competition_id == competition_id and l.role == role));
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func get_role_link(competition_id : Text, role : Text) : async { #Ok : ?Types.RoleLink; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    #Ok(roleLinks.find(func(l) = l.competition_id == competition_id and l.role == role and not l.revoked))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Public: what the join page shows before sign-in.
  public query func get_role_link_preview(token : Text) : async { #Ok : Types.RoleLinkPreview; #Err : Text } {
    switch (roleLinks.find(func(l) = l.token == token and not l.revoked)) {
      case null #Err("Link not found");
      case (?l) switch (competitionName(l.competition_id)) {
        case null #Err("Competition not found");
        case (?name) #Ok({ competition_id = l.competition_id; name; role = l.role });
      };
    }
  };

  public shared ({ caller }) func accept_role_link(token : Text) : async { #Ok : Types.RoleGrant; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (roleLinks.find(func(l) = l.token == token and not l.revoked)) {
      case null #Err("Link not found or turned off");
      case (?l) {
        let grant : Types.RoleGrant = { user = caller; role = l.role; competition_id = l.competition_id; team_id = null };
        if (not roles.any(func(r) = r.user.equal(caller) and r.role == l.role and r.competition_id == l.competition_id and r.team_id == null)) {
          roles := roles.concat([grant]);
        };
        #Ok(grant)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func set_official_chat(competition_id : Text, scope : Text, conversation_id : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (not isChatScope(scope) or not valid(conversation_id)) return #Err("Invalid chat");
    officialChats := officialChats.filter(func(c) = not (c.competition_id == competition_id and c.scope == scope)).concat([{ competition_id; scope; conversation_id }]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Readable by competition managers and anyone holding a role in it.
  public query ({ caller }) func list_official_chats(competition_id : Text) : async { #Ok : [Types.OfficialChat]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    let hasRole = roles.any(func(r) = r.user.equal(caller) and r.competition_id == competition_id);
    if (not canManageCompetition(caller, competition_id) and not hasRole) return #Err("Forbidden");
    #Ok(officialChats.filter(func(c) = c.competition_id == competition_id))
  };

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

  func isGovernor(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and governor.equal(caller)
  };

  func hasBulkAccess(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and bulkAccessPrincipals.any(func(p) = p.equal(caller))
  };

  func canManageCompetition(caller : Principal, competition_id : Text) : Bool {
    if (isGovernor(caller)) return true;
    var competition_club = "";
    for (item in competitions.values()) {
      if (item.id == competition_id) { competition_club := item.club_id };
    };
    let competition_admin = roles.any(func(role) {
      role.user.equal(caller) and (role.role == "competition_admin" or role.role == "admin" or role.role == "owner") and role.competition_id == competition_id
    });
    let club_admin = competition_club != "" and roles.any(func(role) {
      role.user.equal(caller) and role.role == "club_admin" and role.competition_id == competition_club
    });
    // Caller-owned clubless ("personal") competitions: the creator gets the
    // same admin rights a club_admin would have, with no club involved.
    let personal_owner = personalCompetitionOwners.any(func(pair) = pair.0 == competition_id and pair.1.equal(caller));
    competition_admin or club_admin or personal_owner
  };

  public shared ({ caller }) func grant_role(principal : Principal, role : Text, competition_id : Text, team_id : ?Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (principal.equal(Principal.anonymous()) or not valid(role) or not valid(competition_id)) return #Err("Invalid role assignment");
    if (not roles.any(func(item) = item.user.equal(principal) and item.role == role and item.competition_id == competition_id and item.team_id == team_id)) {
      roles := roles.concat([{ user = principal; role; competition_id; team_id }]);
    };
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func create_competition(club_id : Text, name : Text, season : Text) : async { #Ok : Types.Competition; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller); do { let removalReply = await syncClubAdmin(caller, club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (not valid(club_id) or not valid(name) or not valid(season)) return #Err("Invalid competition");
    let club_ok = isGovernor(caller) or roles.any(func(role) = role.user.equal(caller) and role.role == "club_admin" and role.competition_id == club_id);
    if (not club_ok) return #Err("Club admin required");
    let id = "cmp-" # club_id # "-" # Nat.toText(competitions.size() + 1);
    let competition : Types.Competition = { id; club_id; name; season; status = "open"; description = null; visibility = "private"; points_win = 3; points_draw = 1; points_loss = 0; revision = 1 };
    competitions := competitions.concat([competition]);
    #Ok(competition)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func create_competition_event(
    operation_id : Text,
    competition_id : Text,
    title : Text,
    description : Text,
    event_type : Text,
    location : ?Text,
    starts_at_ms : Nat64,
    ends_at_ms : Nat64,
  ) : async { #Ok : Nat16; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (not valid(operation_id) or not valid(title) or description.size() > 2000 or not valid(event_type) or starts_at_ms >= ends_at_ms) return #Err("Invalid competition event");
    switch (location) { case (?value) { if (value.size() > 256) return #Err("Location too long") }; case null {} };
    let competitionClub = switch (competitions.find(func(item) = item.id == competition_id)) {
      case null return #Err("Competition not found");
      case (?competition) competition.club_id;
    };
    let targets = entries
      .filter(func(entry) = entry.competition_id == competition_id and (entry.status == "accepted" or entry.status == "registered"))
      .map(func(entry) = { team_id = entry.team_id; club_id = entry.club_id });
    if (targets.size() == 0) return #Ok(0);
    let eventsCanister = switch (eventsDomainCanister) {
      case null return #Err("events_domain canister not configured");
      case (?value) value;
    };
    let eventDomain : actor {
      create_competition_events : shared (Text, Text, Principal, Text, [{ team_id : Text; club_id : Text }], Text, Text, Text, ?Text, Nat64, Nat64) -> async { #Ok : [Text]; #Err : Text };
    } = actor (Principal.toText(eventsCanister));
    try {
      switch (do { let removalReply = await eventDomain.create_competition_events(operation_id, competition_id, caller, competitionClub, targets, title, description, event_type, location, starts_at_ms, ends_at_ms); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }) {
        case (#Err(error)) #Err(error);
        case (#Ok(eventIds)) #Ok(Nat.toNat16(eventIds.size()));
      }
    } catch (_) {
      #Err("Competition event fan-out failed; retry with the same operation id")
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Clubless ("personal") competition — no club_domain club involved. The
  // caller is recorded as owner and gets admin rights via
  // canManageCompetition; club_id is "" to mark it personal everywhere a
  // Competition is read.
  public shared ({ caller }) func create_personal_competition(name : Text, season : Text) : async { #Ok : Types.Competition; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    if (not valid(name) or not valid(season)) return #Err("Invalid competition");
    let id = "cmp-personal-" # Principal.toText(caller) # "-" # Nat.toText(competitions.size() + 1);
    let competition : Types.Competition = { id; club_id = ""; name; season; status = "open"; description = null; visibility = "private"; points_win = 3; points_draw = 1; points_loss = 0; revision = 1 };
    competitions := competitions.concat([competition]);
    personalCompetitionOwners := personalCompetitionOwners.concat([(id, caller)]);
    #Ok(competition)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Lists the caller's own clubless competitions (owner-only; not visible
  // via list_competitions/list_competitions_multi since those are club-scoped).
  public query ({ caller }) func list_my_personal_competitions() : async { #Ok : [Types.Competition]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    let mine = personalCompetitionOwners.filter(func(pair) = pair.1.equal(caller)).map(func(pair) = pair.0);
    #Ok(competitions.filter(func(item) = mine.any(func(id) = id == item.id)))
  };

  // Location only. Hidden competitions are never discoverable to strangers;
  // the resource methods still independently authorize reads and writes.
  public shared ({ caller }) func set_participant_club_authorities(ids : [Principal]) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not isGovernor(caller)) return #Err("Governor only");
    if (ids.size() > 64 or ids.any(func(p) = p.equal(Principal.anonymous()))) return #Err("Invalid authorities");
    participantClubAuthorities := ids; #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  func participantAuthorities() : [Principal] {
    switch (clubDomainCanister) { case null participantClubAuthorities; case (?p) if (participantClubAuthorities.any(func(x) = x.equal(p))) participantClubAuthorities else participantClubAuthorities.concat([p]) }
  };
  type TeamAccess = { club_id : ?Text; is_member : Bool; can_manage : Bool };
  func teamAccess(user : Principal, teamId : Text) : async TeamAccess {
    var result : TeamAccess = { club_id = null; is_member = false; can_manage = false };
    for (id in participantAuthorities().values()) {
      let authority : actor { read_competition_team_access : shared query (Text, Principal) -> async TeamAccess; read_account_read_competition_team_access : shared (Text, Principal) -> async TeamAccess } = actor (id.toText());
      let row = try { if (accountAdmissionEnabled) await (with timeout = 10) authority.read_account_read_competition_team_access(teamId, user) else await (with timeout = 10) authority.read_competition_team_access(teamId, user) } catch (_) { return { club_id = null; is_member = false; can_manage = false } };
      switch (row.club_id) { case null {}; case (?_) { if (result.club_id != null) return { club_id = null; is_member = false; can_manage = false }; result := row } };
    };
    result
  };
  func participantVisible(user : Principal, id : Text) : async Bool {
    switch (competitions.find(func(c) = c.id == id)) { case null return false; case (?c) {
      if ((c.visibility == "public" and c.status != "archived") or canManageCompetition(user, id) or roles.any(func(r) = r.competition_id == id and r.user.equal(user))) return true;
    } };
    let teams = entries.filter(func(e) = e.competition_id == id and (e.status == "accepted" or e.status == "registered")).map(func(e) = e.team_id);
    if (teams.size() > 500) return false;
    for (teamId in teams.values()) { if ((await teamAccess(user, teamId)).is_member) return true };
    false
  };
  func invitedManager(user : Principal, id : Text) : async Bool {
    let invitations = entries.filter(func(e) = e.competition_id == id and e.status == "invited");
    if (invitations.size() > 500) return false;
    for (e in invitations.values()) { if ((await teamAccess(user, e.team_id)).can_manage) return true };
    false
  };
  func privateParticipant(user : Principal, id : Text) : async Bool {
    if (canManageCompetition(user, id) or roles.any(func r = r.competition_id == id and r.user.equal(user))) return true;
    let accepted = entries.filter(func e = e.competition_id == id and (e.status == "accepted" or e.status == "registered"));
    if (accepted.size() > 500) return false;
    for (entry in accepted.values()) {
      let access = await teamAccess(user, entry.team_id);
      if (removalReceiver.denied(user) or compFenced(id)) return false;
      if (access.is_member and entries.any(func current = current == entry)) return true;
    };
    false
  };
  var broadcastErasureSubjects : Map.Map<Principal, [Principal]>;
  public shared ({ caller }) func prepare_my_broadcast_erasure() : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    auth(caller);
    if (isGovernor(caller)) return #Err("Governor erasure forbidden");
    if (broadcastErasureSubjects.get(caller) != null) return #Ok;
    let configured = accountAdmissionAuthority;
    let account = await AccountAdmission.Gate(true, configured).account(caller);
    if (configured != accountAdmissionAuthority) return #Err("Identity authority changed");
    let a = account ?? return #Err("Authoritative account aliases unavailable");
    if (a.principals.size() == 0 or a.principals.size() > 8 or a.principals.any(isGovernor)) return #Err("Invalid erasure account");
    for (p in a.principals.values()) broadcastErasureSubjects.add(p, a.principals);
    #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  public shared ({ caller }) func check_my_broadcast_erasure() : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    auth(caller);
    let subjects = broadcastErasureSubjects.get(caller) ?? return #Err("Prepare broadcast cleanup first");
    checkBroadcastErasure(subjects)
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  func checkBroadcastErasure(subjects : [Principal]) : { #Ok; #Err : Text } {
    for ((key, r) in broadcastDeliveries.entries()) {
      let plan = broadcastPlans.get(key);
      let affected = subjects.any(func p = p == r.sender) or (switch plan { case (?rows) rows.any(func t = t.officials.any(func p = subjects.any(func s = s == p))); case null false });
      if (affected) {
        let rows = plan ?? return #Err("Original broadcast plan missing; erasure blocked");
        if (not BroadcastErasure.completed(rows.map(func t = t.club), r.completed, r.unknown)) return #Err("Original broadcast must complete before erasure");
      }
    };
    #Ok
  };
  public shared ({ caller }) func purge_my_data() : async { #Ok : Nat; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    auth(caller);
    if (isGovernor(caller)) return #Err("Governor erasure forbidden");
    // Preparation is durable and blocks new broadcasts, including suspended callbacks.
    let subjects = broadcastErasureSubjects.get(caller) ?? return #Err("Prepare broadcast cleanup first");
    switch (checkBroadcastErasure(subjects)) { case (#Err(e)) return #Err(e); case (#Ok) {} };
    var count = roles.filter(func r = r.user == caller).size();
    roles := roles.filter(func r = r.user != caller);
    count += competitionInvites.filter(func r = r.invitee == caller or r.created_by == caller).size();
    competitionInvites := competitionInvites.filter(func r = r.invitee != caller and r.created_by != caller);
    competitionJoinLinks := competitionJoinLinks.map(func r = if (r.created_by == caller) ({ r with revoked = true; created_by = Principal.anonymous() }) else r);
    roleLinks := roleLinks.map(func r = if (r.created_by == caller) ({ r with revoked = true; created_by = Principal.anonymous() }) else r);
    let removedInviteTokens = competitionOfficialEmailInvites.filter(func r = r.created_by == caller or r.accepted_by == ?caller).map(func r = r.token);
    let removedMemberTokens=competitionMemberWelcomeJobs.filter(func r = r.member==caller).map(func r = r.token);
    let removedEois=eoiSubmissions.filter(func r = r.parent_user_id==?caller).map(func r = r.id);
    count+=emailOutbox.scrub(func j = removedInviteTokens.any(func t = t==j.resource) or removedMemberTokens.any(func t = t==j.resource) or removedEois.any(func id = id==j.resource));
    competitionWelcomeJobs := competitionWelcomeJobs.filter(func r = not removedInviteTokens.any(func token = token == r.token));
    competitionOfficialEmailInvites := competitionOfficialEmailInvites.filter(func r = r.created_by != caller and r.accepted_by != ?caller);
    competitionMemberWelcomeJobs := competitionMemberWelcomeJobs.filter(func r = r.member != caller);
    personalCompetitionOwners := personalCompetitionOwners.filter(func r = r.1 != caller);
    for((key,r) in Map.entries(fixtureReceipts).toArray().values())if(r.creator==caller){Map.remove(fixtureReceipts,Text.compare,key);Map.add(fixtureReceipts,Text.compare,"erased:" # r.match_id,{r with creator=Principal.anonymous()})};
    tokens := tokens.map(func r = if (r.issued_by == caller) ({ r with used = true; issued_by = Principal.anonymous() }) else r);
    broadcasts := broadcasts.map(func r = if (subjects.any(func p = p == r.sender)) ({ r with sender = Principal.anonymous() }) else r);
    eoiSubmissions := eoiSubmissions.filter(func r = r.parent_user_id != ?caller);
    playhqClaims := playhqClaims.filter(func r = r.user != caller);
    bulkAccessPrincipals := bulkAccessPrincipals.filter(func p = p != caller);
    // Keep unknown-write evidence, but scrub identity and make it non-replayable.
    for ((key, receipt) in Map.entries(broadcastDeliveries).toArray().values()) {
      if (subjects.any(func p = p == receipt.sender)) {
        Map.remove(broadcastDeliveries, Text.compare, key);
        Map.add(broadcastDeliveries, Text.compare, "erased:" # receipt.broadcast_id, { receipt with sender = Principal.anonymous() });
        switch(Map.get(broadcastPlans,Text.compare,key)){case (?plan){Map.remove(broadcastPlans,Text.compare,key);Map.add(broadcastPlans,Text.compare,"erased:" # receipt.broadcast_id,plan.map(func t = {t with officials=t.officials.filter(func p = not subjects.any(func s = s == p))}))};case null {}};
      }
    };
    // Officials also occur in other senders' frozen plans.
    for ((key, plan) in Map.entries(broadcastPlans).toArray().values()) {
      Map.add(broadcastPlans, Text.compare, key, plan.map(func t = { t with officials = t.officials.filter(func p = not subjects.any(func s = s == p)) }));
    };
    #Ok(count)
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  public shared ({ caller }) func read_my_competition_cards() : async { #Ok : [{ competition : Types.Competition; entries : [Types.TeamEntry] }]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) return #Err("Account unavailable");
    try {
      auth(caller); await admitAccount(caller);
      if (competitions.size() > 500) return #Err("Competition inventory requires paging");
      var rows : [{ competition : Types.Competition; entries : [Types.TeamEntry] }] = [];
      for (item in competitions.values()) {
        await syncForCompetition(caller, item.id);
        let visible = await privateParticipant(caller, item.id);
        let invited = if (visible) false else await invitedManager(caller, item.id);
        if (removalReceiver.denied(caller)) return #Err("Account access changed");
        if ((visible or invited) and not compFenced(item.id) and competitions.any(func current = current == item)) {
          var scopedEntries : [Types.TeamEntry] = [];
          if (canManageCompetition(caller, item.id)) {
            scopedEntries := entries.filter(func e = e.competition_id == item.id);
          } else {
            for (entry in entries.filter(func e = e.competition_id == item.id).values()) {
              let access = await teamAccess(caller, entry.team_id);
              if (removalReceiver.denied(caller) or compFenced(item.id)) return #Err("Competition access changed");
              if ((access.can_manage or (access.is_member and (entry.status == "accepted" or entry.status == "registered"))) and entries.any(func current = current == entry)) scopedEntries := scopedEntries.concat([entry]);
            };
          };
          if (competitions.any(func current = current == item)) rows := rows.concat([{ competition = item; entries = scopedEntries }]);
        }
      };
      #Ok(rows)
    } finally { removalReceiver.leave(caller) }
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  public shared ({ caller }) func read_resource_club(kind : Text, id : Text) : async { #Ok : ?Text; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller); if (not valid(id)) return #Err("Invalid id");
    if (kind == "eoi") {
      switch (eoiSubmissions.find(func(e) = e.id == id)) {
        case null return #Ok(null);
        case (?e) { do { let removalReply = await syncClubAdmin(caller, e.club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }; return #Ok(if (e.parent_user_id == ?caller or canManageClub(caller, e.club_id)) ?e.club_id else null) };
      }
    };
    let cid = if (kind == "match") switch (matches.find(func(m) = m.id == id)) { case null return #Ok(null); case (?m) m.competition_id } else id;
    do { let removalReply = await syncForCompetition(caller, cid); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (not (do { let removalReply = await participantVisible(caller, cid); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }) and not (do { let removalReply = await invitedManager(caller, cid); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Ok(null);
    #Ok(switch (competitions.find(func(c) = c.id == cid)) { case null null; case (?c) if (c.club_id == "") null else ?c.club_id })
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  public query ({ caller }) func read_token_club(token : Text) : async { #Ok : ?Text; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller); if (not valid(token)) return #Err("Invalid token");
    switch (eoiSubmissions.find(func(e) = e.claim_token == token and (e.parent_user_id == null or e.parent_user_id == ?caller))) { case (?e) return #Ok(?e.club_id); case null {} };
    let cid = switch (competitionJoinLinks.find(func(l) = l.token == token and not l.revoked)) { case (?l) ?l.competition_id; case null switch (roleLinks.find(func(l) = l.token == token and not l.revoked)) { case (?l) ?l.competition_id; case null switch (competitionOfficialEmailInvites.find(func(i) = i.token == token)) { case (?i) ?i.competition_id; case null null } } };
    #Ok(switch (cid) { case null null; case (?id) switch (competitions.find(func(c) = c.id == id)) { case null null; case (?c) if (c.club_id == "") null else ?c.club_id } })
  };
  public shared ({ caller }) func read_competition_club(id : Text) : async { #Ok : ?Text; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller); do { let removalReply = await syncForCompetition(caller, id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (not (do { let removalReply = await participantVisible(caller, id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }) and not (do { let removalReply = await invitedManager(caller, id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Ok(null);
    #Ok(switch (competitions.find(func(c) = c.id == id)) { case null null; case (?c) if (c.club_id == "") null else ?c.club_id })
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Competition settings (name, description, status, visibility, ladder
  // scoring). Season stays create-only. Mirrors the Supabase
  // CompetitionSettingsPage update.
  public shared ({ caller }) func update_competition_settings(competition_id : Text, name : Text, description : ?Text, status : Text, visibility : Text, points_win : Nat16, points_draw : Nat16, points_loss : Nat16) : async { #Ok : Types.Competition; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (not valid(name)) return #Err("Invalid name");
    if (not valid(status) or not valid(visibility)) return #Err("Invalid settings");
    switch (description) {
      case (?d) { if (d.size() > 2000) return #Err("Description too long") };
      case null {};
    };
    var updated : ?Types.Competition = null;
    competitions := competitions.map(func(item : Types.Competition) : Types.Competition {
      if (item.id != competition_id) return item;
      let next : Types.Competition = { item with name; description; status; visibility; points_win; points_draw; points_loss; revision = item.revision + 1 };
      updated := ?next;
      next
    });
    switch (updated) {
      case (?competition) #Ok(competition);
      case null #Err("Competition not found");
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func register_team(competition_id : Text, team_id : Text, club_id : Text) : async { #Ok : Types.TeamEntry; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    let competition_club = switch (competitions.find(func(item) = item.id == competition_id)) {
      case (?competition) competition.club_id;
      case null return #Err("Competition not found");
    };
    if (club_id != competition_club or not valid(team_id)) return #Err("Team club mismatch");
    let access = do { let removalReply = await teamAccess(caller, team_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (access.club_id != ?club_id) return #Err("Team club mismatch");
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (entries.any(func(item) = item.competition_id == competition_id and item.team_id == team_id)) return #Err("Team already registered");
    let entry : Types.TeamEntry = { competition_id; team_id; club_id; status = "registered"; division_id = null };
    entries := entries.concat([entry]);
    #Ok(entry)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Entry-invite flow: the competition manager invites a team (status
  // "invited"); an admin of that team accepts or declines. Mirrors the
  // Supabase competition_entries status transitions read by
  // TeamCompetitionsSection.

  public shared ({ caller }) func invite_team(competition_id : Text, team_id : Text) : async { #Ok : Types.TeamEntry; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    let competition_club = switch (competitions.find(func(item) = item.id == competition_id)) {
      case (?competition) competition.club_id;
      case null return #Err("Competition not found");
    };
    if (not valid(team_id)) return #Err("Invalid team");
    let access = do { let removalReply = await teamAccess(caller, team_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    let participantClub = switch (access.club_id) { case null return #Err("Team not found"); case (?c) c };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (entries.any(func(item) = item.competition_id == competition_id and item.team_id == team_id)) return #Err("Team already entered");
    let entry : Types.TeamEntry = { competition_id; team_id; club_id = participantClub; status = "invited"; division_id = null };
    entries := entries.concat([entry]);
    #Ok(entry)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func respond_to_entry_invite(competition_id : Text, team_id : Text, accept : Bool) : async { #Ok : Types.TeamEntry; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    let access = do { let removalReply = await teamAccess(caller, team_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    switch (entries.find(func(item) = item.competition_id == competition_id and item.team_id == team_id)) {
      case null { #Err("Entry invite not found") };
      case (?current) {
        if (current.status != "invited") return #Err("Entry invite already answered");
        if (not access.can_manage) return #Err("Team admin required");
        let updated : Types.TeamEntry = { current with club_id = switch (access.club_id) { case (?c) c; case null return #Err("Team not found") }; status = if (accept) "accepted" else "declined" };
        entries := entries.map(func(item) = if (item.competition_id == competition_id and item.team_id == team_id) updated else item);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func list_entries_by_team(team_id : Text) : async { #Ok : [Types.TeamEntry]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller); let access = do { let removalReply = await teamAccess(caller, team_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    #Ok(entries.filter(func(e) = e.team_id == team_id and (access.is_member or canManageCompetition(caller, e.competition_id))))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public query ({ caller }) func can_invite_players_to_team(team_id : Text) : async Bool {
    denyLegacyAccountQuery();
    auth(caller);
    if (not valid(team_id)) return false;
    entries.any(func(entry) =
      entry.team_id == team_id and
      (entry.status == "accepted" or entry.status == "registered") and
      canManageCompetition(caller, entry.competition_id)
    )
  };

  public shared query ({ caller }) func is_competition_invite_manager(team_id : Text, requester : Principal) : async Bool {
    denyLegacyAccountQuery();
    if (requester.equal(Principal.anonymous()) or not valid(team_id)) return false;
    switch (clubDomainCanister) {
      case null { false };
      case (?clubDomain) {
        caller.equal(clubDomain) and entries.any(func(entry) =
          entry.team_id == team_id and
          (entry.status == "accepted" or entry.status == "registered") and
          canManageCompetition(requester, entry.competition_id)
        )
      };
    }
  };

  // Assigns a registered team to a division (null clears the assignment).
  public shared ({ caller }) func assign_division(competition_id : Text, team_id : Text, division_id : ?Text) : async { #Ok : Types.TeamEntry; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    switch (division_id) { case (?d) { if (d.size() > 128) return #Err("Invalid division") }; case null {} };
    switch (entries.find(func(item) = item.competition_id == competition_id and item.team_id == team_id)) {
      case null { #Err("Team is not registered in competition") };
      case (?current) {
        let updated : Types.TeamEntry = { current with division_id };
        entries := entries.map(func(item) = if (item.competition_id == competition_id and item.team_id == team_id) updated else item);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // One local commit: completed results are never cleared by a division move.
  public shared ({ caller }) func move_team_division(competition_id : Text, team_id : Text, expected_division : ?Text, division_id : ?Text, clear_fixtures : Bool) : async { #Ok : Nat; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) return #Err("Account unavailable");
    try {
      auth(caller); await admitAccount(caller); await syncForCompetition(caller, competition_id);
      if (removalReceiver.denied(caller) or compFenced(competition_id) or not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
      switch (division_id) { case (?d) { if (d.size() == 0 or d.size() > 128) return #Err("Invalid division") }; case null {} };
      let current = entries.find(func e = e.competition_id == competition_id and e.team_id == team_id) ?? return #Err("Team not registered");
      if (current.division_id != expected_division) return #Err("Team division changed; refresh before moving");
      if (current.division_id == division_id) return #Ok(0);
      let affected = matches.filter(func m = clear_fixtures and m.competition_id == competition_id and m.status != "completed" and (m.home_team == team_id or m.away_team == team_id) and ((expected_division == null and division_id == null) or (m.division_id != null and (m.division_id == expected_division or m.division_id == division_id))));
      if (affected.any(func m = matchFenced(m.id))) return #Err("Fixture temporarily locked");
      entries := entries.map(func e = if (e == current) ({ e with division_id }) else e);
      matches := matches.filter(func m = not affected.any(func removed = removed.id == m.id));
      #Ok(affected.size())
    } finally { removalReceiver.leave(caller) }
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func issue_join_token(competition_id : Text, team_id : Text, expires_at_ms : Nat64) : async { #Ok : Types.JoinToken; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (expires_at_ms <= Nat64.fromIntWrap(Time.now() / 1_000_000)) return #Err("Join token must expire in the future");
    if (not entries.any(func(item) = item.competition_id == competition_id and item.team_id == team_id)) return #Err("Team is not registered in competition");
    let token : Types.JoinToken = {
      id = "tok-" # competition_id # "-" # Nat.toText(tokens.size() + 1);
      competition_id;
      team_id;
      issued_by = caller;
      expires_at_ms;
      used = false;
    };
    tokens := tokens.concat([token]);
    #Ok(token)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func claim_join_token(token_id : Text) : async { #Ok : Text; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    var target_token : ?Types.JoinToken = null;
    var token_index = 0;
    var found_index = 0;
    for (item in tokens.values()) {
      if (item.id == token_id) { target_token := ?item; found_index := token_index };
      token_index += 1;
    };
    switch (target_token) {
      case null { #Err("Token not found") };
      case (?token) {
        if (token.used) return #Err("Token already used");
        if (token.expires_at_ms <= Nat64.fromIntWrap(Time.now() / 1_000_000)) return #Err("Join token expired");
        let registered = entries.any(func(entry) = entry.competition_id == token.competition_id and entry.team_id == token.team_id);
        if (not registered) return #Err("Team is not registered in competition");
        let updated_token : Types.JoinToken = { token with used = true };
        tokens := Array.tabulate<Types.JoinToken>(tokens.size(), func(idx) {
          if (idx == found_index) updated_token else tokens[idx]
        });
        #Ok("claimed:" # token.competition_id # ":" # token.team_id)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func create_season(competition_id : Text, name : Text) : async { #Ok : Types.Season; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (not valid(name)) return #Err("Invalid season");
    if (seasons.any(func(item) = item.competition_id == competition_id and item.name == name)) return #Err("Season already exists");
    let season : Types.Season = { competition_id; name; status = "draft"; divisions = []; revision = 1 };
    seasons := seasons.concat([season]);
    #Ok(season)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Duplicates a season's structure (division list) under a new name,
  // matching the Supabase duplicate_season_structure RPC. Entries and
  // matches are competition-scoped, so they carry over unchanged; the new
  // season starts as a draft.
  public shared ({ caller }) func duplicate_season(competition_id : Text, source_name : Text, new_name : Text) : async { #Ok : Types.Season; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (not valid(new_name)) return #Err("Invalid season");
    if (seasons.any(func(item) = item.competition_id == competition_id and item.name == new_name)) return #Err("Season already exists");
    switch (seasons.find(func(item) = item.competition_id == competition_id and item.name == source_name)) {
      case null { #Err("Source season not found") };
      case (?source) {
        let season : Types.Season = { competition_id; name = new_name; status = "draft"; divisions = source.divisions; revision = 1 };
        seasons := seasons.concat([season]);
        #Ok(season)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Replaces a season's division structure.
  public shared ({ caller }) func set_season_divisions(competition_id : Text, name : Text, divisions : [Text]) : async { #Ok : Types.Season; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (divisions.size() > 64 or divisions.any(func(d) = not valid(d))) return #Err("Invalid divisions");
    switch (seasons.find(func(item) = item.competition_id == competition_id and item.name == name)) {
      case null { #Err("Season not found") };
      case (?current) {
        let updated : Types.Season = { current with divisions; revision = current.revision + 1 };
        seasons := seasons.map(func(item) = if (item.competition_id == competition_id and item.name == name) updated else item);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func set_season_status(competition_id : Text, status : Text, expected_revision : Nat64) : async { #Ok : Types.Season; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    var found_idx : ?Nat = null;
    var idx = 0;
    for (item in seasons.values()) {
      if (item.competition_id == competition_id) { found_idx := ?idx };
      idx += 1;
    };
    switch (found_idx) {
      case null { #Err("Season not found") };
      case (?i) {
        let current = seasons[i];
        if (current.revision != expected_revision) return #Err("Season revision conflict");
        if (status != "draft" and status != "active" and status != "archived") return #Err("Invalid season status");
        if (current.status == "archived" and status != "archived") return #Err("Archived season cannot reopen");
        let updated : Types.Season = { current with status; revision = current.revision + 1 };
        seasons := Array.tabulate<Types.Season>(seasons.size(), func(position) {
          if (position == i) updated else seasons[position]
        });
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func record_match(competition_id : Text, home_team : Text, away_team : Text) : async { #Ok : Types.Match; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (home_team == away_team or not valid(home_team) or not valid(away_team)) return #Err("Invalid match teams");
    let home_ok = entries.any(func(entry) = entry.competition_id == competition_id and entry.team_id == home_team and (entry.status == "accepted" or entry.status == "registered"));
    let away_ok = entries.any(func(entry) = entry.competition_id == competition_id and entry.team_id == away_team and (entry.status == "accepted" or entry.status == "registered"));
    if (not home_ok or not away_ok) return #Err("Both teams must be registered");
    let game : Types.Match = {
      id = "match-" # competition_id # "-" # Nat.toText(matches.size() + 1);
      competition_id;
      home_team;
      away_team;
      status = "scheduled";
      home_score = 0;
      away_score = 0;
      division_id = null;
      scheduled_at_ms = null;
      venue = null;
      pitch_number = null;
      round_number = null;
      duration_minutes = null;
      arrival_minutes_before = null;
      notes = null;
      revision = 1;
    };
    matches := matches.concat([game]);
    #Ok(game)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func set_match_result(match_id : Text, home_score : Nat16, away_score : Nat16, expected_revision : Nat64) : async { #Ok : Types.Match; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (matchFenced(match_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    let competition_id = switch (matches.find(func item = item.id == match_id)) {
      case null return #Err("Match not found"); case (?item) item.competition_id;
    };
    await syncForCompetition(caller, competition_id);
    if (removalReceiver.denied(caller) or matchFenced(match_id)) return #Err("Match access changed");
    var found_idx : ?Nat = null;
    var idx = 0;
    for (item in matches.values()) {
      if (item.id == match_id) { found_idx := ?idx };
      idx += 1;
    };
    switch (found_idx) {
      case null { #Err("Match not found") };
      case (?i) {
        let current = matches[i];
        if (not canManageCompetition(caller, current.competition_id)) return #Err("Competition management forbidden");
        if (current.revision != expected_revision) return #Err("Match revision conflict");
        let updated : Types.Match = { current with home_score; away_score; status = "completed"; revision = current.revision + 1 };
        matches := Array.tabulate<Types.Match>(matches.size(), func(position) {
          if (position == i) updated else matches[position]
        });
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Edits fixture details (teams, schedule, venue, division, notes) without
  // touching the score — scores stay under set_match_result so result
  // recording keeps its own optimistic lock. Mirrors the Supabase
  // competition_matches columns the edit-match dialog writes.
  public shared ({ caller }) func update_match_details(match_id : Text, home_team : Text, away_team : Text, division_id : ?Text, scheduled_at_ms : ?Nat64, venue : ?Text, pitch_number : ?Text, round_number : ?Nat16, duration_minutes : ?Nat16, arrival_minutes_before : ?Nat16, notes : ?Text, expected_revision : Nat64) : async { #Ok : Types.Match; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (matchFenced(match_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    func optValid(value : ?Text, max : Nat) : Bool {
      switch (value) { case null true; case (?text) text.size() <= max }
    };
    if (home_team == away_team or not valid(home_team) or not valid(away_team) or not optValid(venue, 256) or not optValid(pitch_number, 64) or not optValid(notes, 2000)) return #Err("Invalid match details");
    switch (division_id) { case (?d) { if (d.size() > 128) return #Err("Invalid division") }; case null {} };
    let owner = switch (matches.find(func item = item.id == match_id)) {
      case null return #Err("Match not found"); case (?item) item.competition_id;
    };
    await syncForCompetition(caller, owner);
    if (removalReceiver.denied(caller) or matchFenced(match_id) or compFenced(owner)) return #Err("Match access changed");
    switch (matches.find(func(item) = item.id == match_id)) {
      case null { #Err("Match not found") };
      case (?current) {
        if (not canManageCompetition(caller, current.competition_id)) return #Err("Competition management forbidden");
        if (current.revision != expected_revision) return #Err("Match revision conflict");
        let home_ok = entries.any(func(entry) = entry.competition_id == current.competition_id and entry.team_id == home_team and (entry.status == "accepted" or entry.status == "registered"));
        let away_ok = entries.any(func(entry) = entry.competition_id == current.competition_id and entry.team_id == away_team and (entry.status == "accepted" or entry.status == "registered"));
        if (not home_ok or not away_ok) return #Err("Both teams must be registered");
        let updated : Types.Match = { current with home_team; away_team; division_id; scheduled_at_ms; venue; pitch_number; round_number; duration_minutes; arrival_minutes_before; notes; revision = current.revision + 1 };
        matches := matches.map(func(item) = if (item.id == match_id) updated else item);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Request-bound creation commits all fixture fields together. Replaying an
  // acknowledged request only reads the same match; it never recreates it.
  public shared ({ caller }) func create_fixture(operation : Text, input : FixtureOperations.Input) : async { #Ok : Types.Match; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) return #Err("Account unavailable");
    try {
      auth(caller); await admitAccount(caller); await syncForCompetition(caller, input.competition_id);
      if (removalReceiver.denied(caller) or compFenced(input.competition_id) or not canManageCompetition(caller,input.competition_id)) return #Err("Competition manager required");
      if (operation.size() == 0 or operation.size() > 128 or input.home_team == input.away_team or not valid(input.home_team) or not valid(input.away_team)) return #Err("Invalid fixture request");
      let key = caller.toText() # "\u{1f}" # operation;
      if (broadcastErasureSubjects.get(caller) != null) return #Err("Broadcast account cleanup pending or complete");
      switch (Map.get(fixtureReceipts, Text.compare, key)) {
        case (?r) {
          if (r.creator != caller or r.input != input) return #Err("Fixture operation conflict");
          return #Ok(matches.find(func m = m.id == r.match_id) ?? return #Err("Created fixture no longer exists"))
        }; case null {};
      };
      if (Map.size(fixtureReceipts) >= 100_000) return #Err("Fixture receipt capacity reached");
      if (not entries.any(func e = e.competition_id == input.competition_id and e.team_id == input.home_team and (e.status == "accepted" or e.status == "registered")) or not entries.any(func e = e.competition_id == input.competition_id and e.team_id == input.away_team and (e.status == "accepted" or e.status == "registered"))) return #Err("Both teams must be registered");
      switch(input.venue) { case (?v) { if(v.size() > 256) return #Err("Venue too long") }; case null {} };
      switch(input.notes) { case (?v) { if(v.size() > 2000) return #Err("Notes too long") }; case null {} };
      switch(input.pitch_number) { case (?v) { if(v.size() > 64) return #Err("Pitch too long") }; case null {} };
      switch(input.division_id) { case (?v) { if(not seasons.any(func s = s.competition_id == input.competition_id and s.divisions.any(func d = d == v))) return #Err("Division unavailable") }; case null {} };
      let id = "fixture-" # input.competition_id # "-" # Nat.toText(matches.size()+1) # "-" # Nat64.toText(nowMs());
      let game : Types.Match = { id; competition_id=input.competition_id; home_team=input.home_team; away_team=input.away_team; division_id=input.division_id; scheduled_at_ms=input.scheduled_at_ms; venue=input.venue; pitch_number=input.pitch_number; round_number=input.round_number; duration_minutes=input.duration_minutes; arrival_minutes_before=input.arrival_minutes_before; notes=input.notes; home_score=0; away_score=0; status="scheduled"; revision=1 };
      matches := matches.concat([game]); Map.add(fixtureReceipts,Text.compare,key,{creator=caller;input;match_id=id}); #Ok(game)
    } finally { removalReceiver.leave(caller) }
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  public shared ({caller}) func read_fixture_operation(operation:Text):async{#Ok:?FixtureOperations.Receipt;#Err:Text} {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if(not removalReceiver.enter(caller))return #Err("Account unavailable");
    try {
      auth(caller);await admitAccount(caller);
      let r=Map.get(fixtureReceipts,Text.compare,caller.toText() # "\u{1f}" # operation)??return #Ok(null);
      await syncForCompetition(caller,r.input.competition_id);
      if(removalReceiver.denied(caller) or compFenced(r.input.competition_id) or not canManageCompetition(caller,r.input.competition_id))return #Err("Fixture manager required");
      #Ok(?r)
    }finally{removalReceiver.leave(caller)}
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public query ({ caller }) func list_competitions(club_id : Text) : async { #Ok : [Types.Competition]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    #Ok(competitions.filter(func(item) = item.club_id == club_id))
  };

  // Cross-club listing for the competitions page when no single club is
  // selected. Authenticated callers only; mirrors the Supabase query which
  // lists every visible competition.
  public query ({ caller }) func list_competitions_multi(club_ids : [Text]) : async { #Ok : [Types.Competition]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    #Ok(competitions.filter(func(item) = club_ids.any(func(id) = id == item.club_id)))
  };

  public query ({ caller }) func list_public_competitions() : async { #Ok : [Types.Competition]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    #Ok(competitions.filter(func(item) = item.visibility == "public" and item.status != "archived"))
  };

  // Anonymous by design: backs the public competition web page. Returns the
  // competition, its matches and ladder-visibility settings only when the
  // competition is explicitly public and not archived. Team names on matches
  // are plain text already shown on public fixtures; no PII is exposed.
  public query func get_public_competition_page(competition_id : Text) : async {
    #Ok : {
      competition : Types.Competition;
      matches : [Types.MatchRead];
      hide_ladder : Bool;
      hidden_divisions : [Text];
    };
    #Err : Text;
  } {
    let found = competitions.filter(func(item) = item.id == competition_id and item.visibility == "public" and item.status != "archived");
    if (found.size() == 0) return #Err("Competition not found");
    let hideLadder = competitionLadderSettings.any(func(item) = item.competition_id == competition_id and item.hide_ladder);
    let hiddenDivisions = divisionSettings.filter(func(item) = item.competition_id == competition_id and item.hide_ladder).map(func(item) = item.division);
    #Ok({
      competition = found[0];
      matches = matches.filter(func(item) = item.competition_id == competition_id).map(func(game) = readableMatch(game, false));
      hide_ladder = hideLadder;
      hidden_divisions = hiddenDivisions;
    });
  };

  public query ({ caller }) func list_my_news_competitions() : async { #Ok : [Types.Competition]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    #Ok(competitions.filter(func(item) = canManageCompetition(caller, item.id)))
  };

  public shared ({ caller }) func list_entries(competition_id : Text) : async { #Ok : [Types.TeamEntry]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (not (do { let removalReply = await participantVisible(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Competition access forbidden");
    #Ok(entries.filter(func(item) = item.competition_id == competition_id))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func list_seasons(competition_id : Text) : async { #Ok : [Types.Season]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (not (do { let removalReply = await participantVisible(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Competition access forbidden");
    #Ok(seasons.filter(func(item) = item.competition_id == competition_id))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func list_matches(competition_id : Text) : async { #Ok : [Types.MatchRead]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (not (do { let removalReply = await participantVisible(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Competition access forbidden");
    #Ok(matches.filter(func(item) = item.competition_id == competition_id).map(func(game) = readableMatch(game, canManageCompetition(caller, competition_id))))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public query ({ caller }) func is_competition_admin(competition_id : Text) : async { #Ok : Bool; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    #Ok(canManageCompetition(caller, competition_id))
  };

  public shared ({ caller }) func addBulkAccessPrincipal(principal : Principal) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not isGovernor(caller)) return #Err("Governor only");
    if (principal.equal(Principal.anonymous())) return #Err("Invalid principal");
    if (not bulkAccessPrincipals.any(func(p) = p.equal(principal))) { bulkAccessPrincipals := bulkAccessPrincipals.concat([principal]) };
    #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func removeBulkAccessPrincipal(principal : Principal) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not isGovernor(caller)) return #Err("Governor only");
    bulkAccessPrincipals := bulkAccessPrincipals.filter(func(p) = not p.equal(principal));
    #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public query ({ caller }) func listBulkAccessPrincipals() : async { #Ok : [Principal]; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor only");
    #Ok(bulkAccessPrincipals)
  };

  public query ({ caller }) func export_state() : async { #Ok : Types.State; #Err : Text } {
    if (not isGovernor(caller) and not hasBulkAccess(caller)) return #Err("Governor only");
    #Ok({ schema = 6; governor; roles; competitions; entries; tokens; seasons; matches; chatSettings; competitionWelcomeSettings; competitionInvites; competitionJoinLinks; competitionOfficialEmailInvites; eoiSubmissions })
  };

  // ---------------- Competition roles (admin-managed, not governor-only) ----------------

  public shared ({ caller }) func add_competition_role(competition_id : Text, principal : Principal, role : Text, team_id : ?Text) : async { #Ok : Types.RoleGrant; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (principal.equal(Principal.anonymous()) or not valid(role)) return #Err("Invalid role assignment");
    let grant : Types.RoleGrant = { user = principal; role; competition_id; team_id };
    if (not roles.any(func(item) = item.user.equal(principal) and item.role == role and item.competition_id == competition_id and item.team_id == team_id)) {
      roles := roles.concat([grant]);
    };
    #Ok(grant)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func remove_competition_role(competition_id : Text, principal : Principal, role : Text, team_id : ?Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    roles := roles.filter(func(item) = not (item.user.equal(principal) and item.role == role and item.competition_id == competition_id and item.team_id == team_id));
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func list_competition_roles(competition_id : Text) : async { #Ok : [Types.RoleGrant]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    #Ok(roles.filter(func(item) = item.competition_id == competition_id))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ---------------- Chat settings ----------------

  public shared ({ caller }) func get_competition_welcome_email(competition_id : Text) : async Welcome.Result {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller); do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    Welcome.read(competitionWelcomeSettings, competition_id, competitions.any(func(c) = c.id == competition_id), canManageCompetition(caller, competition_id))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func set_competition_welcome_email(competition_id : Text, enabled : Bool, subject : Text, message : Text) : async Welcome.Result {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller); do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    let settings : Welcome.Settings = { competition_id; enabled; subject; message };
    switch (Welcome.write(competitionWelcomeSettings, settings, competitions.any(func(c) = c.id == competition_id), canManageCompetition(caller, competition_id))) {
      case (#Err(error)) #Err(error);
      case (#Ok(rows)) { competitionWelcomeSettings := rows; #Ok(settings) };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  public shared ({caller}) func read_competition_welcome_message(competition_id : Text) : async {#Ok:?{subject:Text;message:Text};#Err:Text} {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if(not removalReceiver.enter(caller))return #Err("Account unavailable");
    try {
      auth(caller);await admitAccount(caller);await syncForCompetition(caller,competition_id);
      if(not(await privateParticipant(caller,competition_id)) or removalReceiver.denied(caller) or compFenced(competition_id))return #Err("Competition participation required");
      let settings=competitionWelcomeSettings.find(func s = s.competition_id==competition_id and s.enabled);
      #Ok(switch settings {case (?s)?{subject=s.subject;message=s.message};case null null})
    } finally {removalReceiver.leave(caller)}
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  func findChatSettings(competition_id : Text) : ?Types.ChatSettings {
    chatSettings.find(func(item) = item.competition_id == competition_id)
  };

  public query ({ caller }) func get_chat_settings(competition_id : Text) : async { #Ok : Types.ChatSettings; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    switch (findChatSettings(competition_id)) {
      case (?settings) #Ok(settings);
      case null #Ok({ competition_id; chat_enabled = true; admins_only = false; revision = 0 : Nat64 });
    }
  };

  public shared ({ caller }) func set_chat_settings(competition_id : Text, chat_enabled : Bool, admins_only : Bool, expected_revision : Nat64) : async { #Ok : Types.ChatSettings; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    let current_revision : Nat64 = switch (findChatSettings(competition_id)) { case (?s) s.revision; case null 0 };
    if (current_revision != expected_revision) return #Err("Chat settings revision conflict");
    let updated : Types.ChatSettings = { competition_id; chat_enabled; admins_only; revision = current_revision + 1 };
    chatSettings := chatSettings.filter(func(item) = item.competition_id != competition_id);
    chatSettings := chatSettings.concat([updated]);
    #Ok(updated)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ---------------- Competition invites (accept/decline) ----------------

  public shared ({ caller }) func create_competition_invite(competition_id : Text, invitee : Principal, role : Text, team_id : ?Text) : async { #Ok : Types.CompetitionInvite; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (invitee.equal(Principal.anonymous()) or not valid(role)) return #Err("Invalid invite");
    let invite : Types.CompetitionInvite = {
      id = "inv-" # competition_id # "-" # Nat.toText(competitionInvites.size() + 1);
      competition_id;
      invitee;
      role;
      team_id;
      status = "pending";
      created_by = caller;
      created_at_ms = Nat64.fromIntWrap(Time.now() / 1_000_000);
      responded_at_ms = null;
    };
    competitionInvites := competitionInvites.concat([invite]);
    #Ok(invite)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func accept_competition_invite(invite_id : Text) : async { #Ok : Types.CompetitionInvite; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (competitionInvites.find(func(item) = item.id == invite_id)) {
      case null #Err("Invite not found");
      case (?invite) {
        if (not invite.invitee.equal(caller)) return #Err("Invite does not belong to caller");
        if (invite.status != "pending") return #Err("Invite already resolved");
        let updated : Types.CompetitionInvite = { invite with status = "accepted"; responded_at_ms = ?Nat64.fromIntWrap(Time.now() / 1_000_000) };
        competitionInvites := competitionInvites.map(func(item) = if (item.id == invite_id) updated else item);
        if (not roles.any(func(item) = item.user.equal(invite.invitee) and item.role == invite.role and item.competition_id == invite.competition_id and item.team_id == invite.team_id)) {
          roles := roles.concat([{ user = invite.invitee; role = invite.role; competition_id = invite.competition_id; team_id = invite.team_id }]);
        };
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func decline_competition_invite(invite_id : Text) : async { #Ok : Types.CompetitionInvite; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (competitionInvites.find(func(item) = item.id == invite_id)) {
      case null #Err("Invite not found");
      case (?invite) {
        if (not invite.invitee.equal(caller)) return #Err("Invite does not belong to caller");
        if (invite.status != "pending") return #Err("Invite already resolved");
        let updated : Types.CompetitionInvite = { invite with status = "declined"; responded_at_ms = ?Nat64.fromIntWrap(Time.now() / 1_000_000) };
        competitionInvites := competitionInvites.map(func(item) = if (item.id == invite_id) updated else item);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func list_competition_invites(competition_id : Text) : async { #Ok : [Types.CompetitionInvite]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    #Ok(competitionInvites.filter(func(item) = item.competition_id == competition_id))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Caller-scoped: invites addressed to the caller, across all competitions.
  public query ({ caller }) func list_invites_by_invitee() : async { #Ok : [Types.CompetitionInvite]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    #Ok(competitionInvites.filter(func(item) = item.invitee.equal(caller)))
  };

  // ---------------- Competition-wide join links ----------------

  public shared ({ caller }) func create_competition_join_link(competition_id : Text, role : Text, team_id : ?Text) : async { #Ok : Types.CompetitionJoinLink; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (not valid(role)) return #Err("Invalid role");
    if (competitionJoinLinks.any(func(item) = item.competition_id == competition_id and item.role == role and not item.revoked)) return #Err("Active join link already exists");
    let link : Types.CompetitionJoinLink = {
      competition_id;
      token = "cjl-" # competition_id # "-" # Nat.toText(competitionJoinLinks.size() + 1);
      role;
      team_id;
      revoked = false;
      created_by = caller;
      created_at_ms = Nat64.fromIntWrap(Time.now() / 1_000_000);
      revision = 1;
    };
    competitionJoinLinks := competitionJoinLinks.concat([link]);
    #Ok(link)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func create_competition_official_link(competition_id : Text, role : Text, token : Text) : async { #Ok : Types.CompetitionJoinLink; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (role != "referee" and role != "committee_member") return #Err("Invalid official role");
    if (token.size() < 32 or token.size() > 128 or not valid(token)) return #Err("Invalid role link token");
    if (competitionJoinLinks.any(func(item) = item.token == token and item.competition_id != competition_id)) return #Err("Role link token already exists");
    let now = Nat64.fromIntWrap(Time.now() / 1_000_000);
    switch (competitionJoinLinks.find(func(item) = item.competition_id == competition_id and item.role == role and item.team_id == null and not item.revoked)) {
      case (?current) {
        let updated : Types.CompetitionJoinLink = { current with token; created_by = caller; created_at_ms = now; revision = current.revision + 1 };
        competitionJoinLinks := competitionJoinLinks.map(func(item) = if (item.competition_id == competition_id and item.role == role and item.team_id == null and not item.revoked) updated else item);
        #Ok(updated)
      };
      case null {
        let link : Types.CompetitionJoinLink = {
          competition_id; token; role; team_id = null; revoked = false;
          created_by = caller; created_at_ms = now; revision = 1;
        };
        competitionJoinLinks := competitionJoinLinks.concat([link]);
        #Ok(link)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func revoke_competition_official_link(competition_id : Text, role : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (role != "referee" and role != "committee_member") return #Err("Invalid official role");
    competitionJoinLinks := competitionJoinLinks.map(func(item) =
      if (item.competition_id == competition_id and item.role == role and item.team_id == null and not item.revoked)
      { { item with revoked = true } } else item
    );
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func create_competition_official_email_invite(
    competition_id : Text,
    role : Text,
    token : Text,
    email_hash : Text,
    verification_code_hash : Text,
  ) : async { #Ok : Types.CompetitionOfficialEmailInvite; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (role != "referee" and role != "committee_member") return #Err("Invalid official role");
    if (token.size() < 32 or token.size() > 128 or email_hash.size() != 64 or verification_code_hash.size() != 64) return #Err("Invalid email invitation");
    if (competitionOfficialEmailInvites.any(func(item) = item.token == token)) return #Err("Invitation token already exists");
    let now = Nat64.fromIntWrap(Time.now() / 1_000_000);
    let invite : Types.CompetitionOfficialEmailInvite = {
      competition_id; token; role; email_hash; verification_code_hash; created_by = caller;
      created_at_ms = now; expires_at_ms = now + 172_800_000; attempts = 0;
      accepted_by = null; revoked = false;
    };
    competitionOfficialEmailInvites := competitionOfficialEmailInvites.concat([invite]);
    #Ok(invite)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public query func get_competition_official_email_invite_preview(token : Text) : async { #Ok : { status : Text; competition_id : Text; competition_name : Text; role : Text }; #Err : Text } {
    switch (competitionOfficialEmailInvites.find(func(item) = item.token == token)) {
      case null { #Err("Invitation not found") };
      case (?invite) {
        let competition = switch (competitions.find(func(item) = item.id == invite.competition_id)) {
          case null { return #Err("Competition not found") };
          case (?value) value;
        };
        let status = if (invite.revoked) "revoked" else if (invite.accepted_by != null) "used" else if (nowMs() >= invite.expires_at_ms) "expired" else if (competition.status == "archived") "archived" else "valid";
        #Ok({ status; competition_id = invite.competition_id; competition_name = competition.name; role = invite.role })
      };
    }
  };

  public shared ({ caller }) func accept_competition_official_email_invite(token : Text, email_hash : Text, verification_code_hash : Text) : async { #Ok : Types.RoleGrant; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    var inviteIndex : ?Nat = null;
    var position : Nat = 0;
    for (candidate in competitionOfficialEmailInvites.values()) {
      if (candidate.token == token) inviteIndex := ?position;
      position += 1;
    };
    let index = switch (inviteIndex) {
      case null { return #Err("Invitation not found") };
      case (?value) value;
    };
    let invite = competitionOfficialEmailInvites[index];
    if (invite.revoked or nowMs() >= invite.expires_at_ms) return #Err("Invitation expired or revoked");
    if (not competitions.any(func(competition) = competition.id == invite.competition_id and competition.status != "archived")) return #Err("Competition is archived");
    switch (invite.accepted_by) {
      case (?acceptedBy) {
        if (acceptedBy.equal(caller)) return #Ok({ user = caller; role = invite.role; competition_id = invite.competition_id; team_id = null });
        return #Err("Invitation already used");
      };
      case null {};
    };
    if (invite.attempts >= 5) return #Err("Verification attempts exceeded");
    if (invite.email_hash != email_hash or invite.verification_code_hash != verification_code_hash) {
      let updated = { invite with attempts = invite.attempts + 1 };
      competitionOfficialEmailInvites := Array.tabulate<Types.CompetitionOfficialEmailInvite>(competitionOfficialEmailInvites.size(), func(i) = if (i == index) updated else competitionOfficialEmailInvites[i]);
      return #Err("Email or verification code is incorrect");
    };
    let updated = { invite with accepted_by = ?caller };
    competitionOfficialEmailInvites := Array.tabulate<Types.CompetitionOfficialEmailInvite>(competitionOfficialEmailInvites.size(), func(i) = if (i == index) updated else competitionOfficialEmailInvites[i]);
    if (not roles.any(func(item) = item.user.equal(caller) and item.role == invite.role and item.competition_id == invite.competition_id and item.team_id == null)) {
      roles := roles.concat([{ user = caller; role = invite.role; competition_id = invite.competition_id; team_id = null }]);
    };
    #Ok({ user = caller; role = invite.role; competition_id = invite.competition_id; team_id = null })
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func revoke_competition_official_email_invite(token : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (competitionOfficialEmailInvites.find(func(item) = item.token == token)) {
      case null { #Err("Invitation not found") };
      case (?invite) {
        if (not canManageCompetition(caller, invite.competition_id)) return #Err("Competition management forbidden");
        competitionOfficialEmailInvites := competitionOfficialEmailInvites.map(func(item) = if (item.token == token) { { item with revoked = true } } else item);
        competitionWelcomeJobs := competitionWelcomeJobs.filter(func(job) = job.token != token);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ---------------- Competition welcome email jobs ----------------
  // A manager registers a pending welcome email when creating an official
  // email invite, but only while the competition's welcome settings are
  // enabled. The recipient address lives only here (keyed by the unguessable
  // invite token); the delivery edge function reads it back after acceptance
  // so the browser never has to be trusted for the recipient.

  public shared ({ caller }) func register_competition_welcome_job(token : Text, to : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (competitionOfficialEmailInvites.find(func(item) = item.token == token)) {
      case null { #Err("Invitation not found") };
      case (?invite) {
        if (invite.revoked or invite.accepted_by != null) return #Err("Invitation is no longer pending");
        if (not canManageCompetition(caller, invite.competition_id)) return #Err("Competition management forbidden");
        let enabled = switch (competitionWelcomeSettings.find(func(row) = row.competition_id == invite.competition_id)) {
          case (?row) row.enabled;
          case null false;
        };
        if (not enabled) return #Err("Welcome email is not enabled for this competition");
        if (to.size() < 5 or to.size() > 254 or not Text.contains(to, #char '@')) return #Err("Invalid recipient address");
        if (competitionWelcomeJobs.any(func(job) = job.token == token)) return #Err("Welcome email already registered");
        switch (emailOutbox.enqueue("welcome:" # token, "official_welcome", token, "", nowMs())) { case (#Err(e)) return #Err(e); case (#Ok) {} };
        competitionWelcomeJobs := competitionWelcomeJobs.concat([{ token; competition_id = invite.competition_id; to; created_at_ms = nowMs() }]);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Public capability query (like club_domain's get_welcome_email_job): the
  // token is the secret. Returns nothing when the settings were disabled
  // after registration, so a manager switching welcome emails off also
  // stops pending deliveries.
  public query func get_competition_welcome_email_job(token : Text) : async { #Ok : { competition_id : Text; to : Text; subject : Text; message : Text; competition_name : Text }; #Err : Text } {
    switch (competitionWelcomeJobs.find(func(job) = job.token == token)) {
      case null { #Err("No welcome email pending for this invitation") };
      case (?job) {
        let settings = switch (competitionWelcomeSettings.find(func(row) = row.competition_id == job.competition_id)) {
          case null { return #Err("Welcome email is not enabled for this competition") };
          case (?row) row;
        };
        if (not settings.enabled) return #Err("Welcome email is not enabled for this competition");
        let competition = switch (competitions.find(func(item) = item.id == job.competition_id)) {
          case null { return #Err("Competition not found") };
          case (?value) value;
        };
        #Ok({ competition_id = job.competition_id; to = job.to; subject = settings.subject; message = settings.message; competition_name = competition.name })
      };
    }
  };

  // ---------------- Member self-registered welcome emails ----------------
  // Existing members (e.g. a manager whose team just accepted a competition
  // entry) have no inviter-supplied welcome job, and ICP accounts carry no
  // email. The member registers their own pending welcome: the canister
  // verifies they belong to the competition and stores the browser-generated
  // unguessable token as the capability the delivery edge function reads
  // back — same trust shape as register_competition_welcome_job. One job
  // per member per competition keeps the fixed-template email unspamable.
  public shared ({ caller }) func register_member_welcome_job(competition_id : Text, token : Text, to : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (competitions.find(func(item) = item.id == competition_id)) {
      case null { #Err("Competition not found") };
      case (?_competition) {
        let hasCompetitionRole = roles.any(func(r) = r.user.equal(caller) and r.competition_id == competition_id);
        var enteredMember = false;
        let accepted = entries.filter(func e = e.competition_id == competition_id and (e.status == "accepted" or e.status == "registered"));
        if (accepted.size() > 500) return #Err("Participant inventory too large");
        for (entry in accepted.values()) {
          let access = await teamAccess(caller, entry.team_id);
          if (removalReceiver.denied(caller) or compFenced(competition_id)) return #Err("Competition access changed");
          if (access.is_member and entries.any(func current = current == entry)) enteredMember := true;
        };
        if (not (isGovernor(caller) or hasCompetitionRole or enteredMember)) return #Err("Competition membership required");
        let enabled = switch (competitionWelcomeSettings.find(func(row) = row.competition_id == competition_id)) {
          case (?row) row.enabled;
          case null false;
        };
        if (not enabled) return #Err("Welcome email is not enabled for this competition");
        if (to.size() < 5 or to.size() > 254 or not Text.contains(to, #char '@')) return #Err("Invalid recipient address");
        if (token.size() < 16 or token.size() > 128) return #Err("Invalid token");
        if (competitionMemberWelcomeJobs.any(func(job) = job.token == token) or competitionWelcomeJobs.any(func(job) = job.token == token)) return #Err("Token already used");
        if (competitionMemberWelcomeJobs.any(func(job) = job.competition_id == competition_id and job.member.equal(caller))) return #Err("Welcome email already registered");
        switch (emailOutbox.enqueue("welcome:" # token, "member_welcome", token, "", nowMs())) { case (#Err(e)) return #Err(e); case (#Ok) {} };
        competitionMemberWelcomeJobs := competitionMemberWelcomeJobs.concat([{ token; competition_id; member = caller; to; created_at_ms = nowMs() }]);
        #Ok
      };
    }

    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Public capability query (like get_competition_welcome_email_job): the
  // token is the secret. Returns nothing when the settings were disabled
  // after registration, so a manager switching welcome emails off also
  // stops pending deliveries.
  public query func get_member_welcome_email_job(token : Text) : async { #Ok : { competition_id : Text; to : Text; subject : Text; message : Text; competition_name : Text }; #Err : Text } {
    switch (competitionMemberWelcomeJobs.find(func(job) = job.token == token)) {
      case null { #Err("No welcome email pending for this token") };
      case (?job) {
        let settings = switch (competitionWelcomeSettings.find(func(row) = row.competition_id == job.competition_id)) {
          case null { return #Err("Welcome email is not enabled for this competition") };
          case (?row) row;
        };
        if (not settings.enabled) return #Err("Welcome email is not enabled for this competition");
        let competition = switch (competitions.find(func(item) = item.id == job.competition_id)) {
          case null { return #Err("Competition not found") };
          case (?value) value;
        };
        #Ok({ competition_id = job.competition_id; to = job.to; subject = settings.subject; message = settings.message; competition_name = competition.name })
      };
    }
  };

  public shared ({ caller }) func rotate_competition_join_link(competition_id : Text) : async { #Ok : Types.CompetitionJoinLink; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    switch (competitionJoinLinks.find(func(item) = item.competition_id == competition_id and not item.revoked)) {
      case null #Err("No active join link");
      case (?current) {
        let rotated : Types.CompetitionJoinLink = {
          current with token = "cjl-" # competition_id # "-" # Nat.toText(competitionJoinLinks.size() + 1);
          revision = current.revision + 1;
        };
        competitionJoinLinks := competitionJoinLinks.map(func(item) = if (item.competition_id == competition_id and not item.revoked) rotated else item);
        #Ok(rotated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func revoke_competition_join_link(competition_id : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    competitionJoinLinks := competitionJoinLinks.map(func(item) = if (item.competition_id == competition_id and not item.revoked) { { item with revoked = true } } else item);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func list_competition_join_links(competition_id : Text) : async { #Ok : [Types.CompetitionJoinLink]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    #Ok(competitionJoinLinks.filter(func(item) = item.competition_id == competition_id))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func join_competition_by_token(token : Text) : async { #Ok : Types.RoleGrant; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (competitionJoinLinks.find(func(item) = item.token == token)) {
      case null #Err("Join link not found");
      case (?link) {
        if (link.revoked) return #Err("Join link revoked");
        let competition = switch (competitions.find(func item = item.id == link.competition_id)) {
          case null return #Err("Competition not found"); case (?item) item;
        };
        if (competition.status == "archived" or compFenced(link.competition_id)) return #Err("Competition unavailable");
        let grant : Types.RoleGrant = { user = caller; role = link.role; competition_id = link.competition_id; team_id = link.team_id };
        if (not roles.any(func(item) = item.user.equal(caller) and item.role == link.role and item.competition_id == link.competition_id and item.team_id == link.team_id)) {
          roles := roles.concat([grant]);
        };
        #Ok(grant)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Public join-link preview, callable pre-auth (anonymous callers allowed —
  // mirrors the Supabase SECURITY DEFINER join-token RPCs). Exposes only
  // non-sensitive fields. #Err carries "unknown" | "disabled" | "archived"
  // so the join page can pick the right message without a second call.
  public query func get_join_link_preview(token : Text) : async { #Ok : Types.JoinLinkPreview; #Err : Text } {
    switch (competitionJoinLinks.find(func(item) = item.token == token)) {
      case null #Err("unknown");
      case (?link) {
        if (link.revoked) return #Err("disabled");
        let competition = switch (competitions.find(func(item) = item.id == link.competition_id)) {
          case (?c) c;
          case null return #Err("unknown");
        };
        if (competition.status == "archived") return #Err("archived");
        // Divisions of the active season, else the most recently created one.
        let compSeasons = seasons.filter(func(item) = item.competition_id == link.competition_id);
        let season = switch (compSeasons.find(func(item) = item.status == "active")) {
          case (?s) ?s;
          case null if (compSeasons.size() == 0) null else ?compSeasons[compSeasons.size() - 1];
        };
        #Ok({
          competition_id = competition.id;
          role = link.role;
          name = competition.name;
          club_id = competition.club_id;
          season = competition.season;
          competition_status = competition.status;
          divisions = switch (season) { case (?s) s.divisions; case null [] };
          entered_team_ids = entries.filter(func(item) = item.competition_id == link.competition_id and (item.status == "accepted" or item.status == "invited")).map(func(item) = item.team_id);
        })
      };
    }
  };

  // Team-admin self-entry via a competition join link: validates the token,
  // then registers the caller's team with an optional division. Unlike
  // register_team/invite_team this does not require competition-management
  // rights — the join link IS the organiser's authorization.
  public shared ({ caller }) func join_competition_with_link(token : Text, team_id : Text, division_id : ?Text) : async { #Ok : Types.TeamEntry; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    if (not valid(team_id)) return #Err("team_not_found");
    let access = do { let removalReply = await teamAccess(caller, team_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (not access.can_manage) return #Err("not_team_admin");
    switch (competitionJoinLinks.find(func(item) = item.token == token)) {
      case null #Err("invalid_token");
      case (?link) {
        if (link.revoked) return #Err("invalid_token");
        if (link.role == "referee" or link.role == "committee" or link.role == "committee_member") return #Err("Team entry link required");
        let competition = switch (competitions.find(func(item) = item.id == link.competition_id)) {
          case (?c) c;
          case null return #Err("Competition not found");
        };
        if (competition.status == "archived") return #Err("Competition archived");
        if (compFenced(link.competition_id)) return #Err("Club is temporarily locked for a transfer");
        if (entries.any(func(item) = item.competition_id == link.competition_id and item.team_id == team_id)) return #Err("Team already entered");
        switch (division_id) {
          case (?d) {
            if (d.size() > 128) return #Err("Invalid division");
            if (not seasons.any(func(s) = s.competition_id == link.competition_id and s.divisions.any(func(div) = div == d))) return #Err("Invalid division");
          };
          case null {};
        };
        let entry : Types.TeamEntry = { competition_id = link.competition_id; team_id; club_id = switch (access.club_id) { case (?c) c; case null return #Err("team_not_found") }; status = "accepted"; division_id };
        entries := entries.concat([entry]);
        #Ok(entry)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ---------------- Match deletion / round trimming ----------------

  public shared ({ caller }) func delete_match(match_id : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (matchFenced(match_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (matches.find(func(item) = item.id == match_id)) {
      case null #Err("Match not found");
      case (?current) {
        if (not canManageCompetition(caller, current.competition_id)) return #Err("Competition management forbidden");
        matches := matches.filter(func(item) = item.id != match_id);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Removes matches scheduled beyond round `max_round` for a competition —
  // matches without a round number are left untouched. Returns the count of
  // matches removed.
  public shared ({ caller }) func trim_rounds(competition_id : Text, max_round : Nat16) : async { #Ok : Nat; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    let before = matches.size();
    matches := matches.filter(func(item) = not (item.competition_id == competition_id and (switch (item.round_number) { case (?r) r > max_round; case null false })));
    #Ok(before - matches.size())
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ---------------- Expression-of-interest (EOI) submissions ----------------

  func canManageClub(caller : Principal, club_id : Text) : Bool {
    if (isGovernor(caller)) return true;
    roles.any(func(role) = role.user.equal(caller) and role.role == "club_admin" and role.competition_id == club_id)
  };

  func nowMs() : Nat64 { Nat64.fromIntWrap(Time.now() / 1_000_000) };

  public shared ({ caller }) func list_eoi_submissions(club_id : Text, season_id : ?Text) : async { #Ok : [Types.EoiSubmission]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    do { let removalReply = await syncClubAdmin(caller, club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (not canManageClub(caller, club_id)) return #Err("Club admin required");
    #Ok(eoiSubmissions.filter(func(item) {
      item.club_id == club_id and (switch (season_id) { case (?s) item.season_id == s; case null true })
    }))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func get_eoi_stats(club_id : Text, season_id : ?Text) : async { #Ok : Types.EoiStats; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    do { let removalReply = await syncClubAdmin(caller, club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (not canManageClub(caller, club_id)) return #Err("Club admin required");
    let scoped = eoiSubmissions.filter(func(item) {
      item.club_id == club_id and (switch (season_id) { case (?s) item.season_id == s; case null true })
    });
    var total = 0; var submitted = 0; var allocated = 0; var confirmed = 0; var registered = 0; var withdrawn = 0;
    var new_players = 0; var returning_players = 0;
    for (item in scoped.values()) {
      total += 1;
      if (item.status == "submitted") submitted += 1;
      if (item.status == "allocated") allocated += 1;
      if (item.status == "confirmed") confirmed += 1;
      if (item.status == "registered") registered += 1;
      if (item.status == "withdrawn") withdrawn += 1;
      if (item.returning_player) returning_players += 1 else new_players += 1;
    };
    // Form-view tracking (views/conversion_rate) has no canister store —
    // NEEDS-CANISTER: no eoi_form_views equivalent, always report 0.
    #Ok({ total; submitted; allocated; confirmed; registered; withdrawn; new_players; returning_players; views = 0; conversion_rate = 0.0 })
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func suggest_eoi_teams(season_id : Text) : async { #Ok : [Types.EoiTeamSuggestion]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    let candidates = eoiSubmissions.filter(func(item) {
      item.season_id == season_id and item.assigned_team_id == null and
      (item.status == "submitted" or item.status == "preferences_completed")
    });
    switch (candidates.values().next()) {
      case (?first) { do { let removalReply = await syncClubAdmin(caller, first.club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }; if (candidates.any(func(e) = e.club_id != first.club_id)) return #Err("Ambiguous season ownership"); if (not canManageClub(caller, first.club_id)) return #Err("Club admin required") };
      case null {};
    };
    var groups : [Types.EoiTeamSuggestion] = [];
    for (item in candidates.values()) {
      let ag = switch (item.age_group) { case (?a) a; case null "Unknown" };
      let skill = switch (item.skill_level) { case (?s) Int.toFloat(Nat16.toNat(s)); case null 3.0 };
      switch (groups.find(func(g) = g.age_group == ag)) {
        case (?existing) {
          let newCount = existing.player_count + 1;
          let newAvg = ((existing.avg_skill * Int.toFloat(existing.player_count)) + skill) / Int.toFloat(newCount);
          let updated : Types.EoiTeamSuggestion = { age_group = ag; player_count = newCount; avg_skill = newAvg; submission_ids = existing.submission_ids.concat([item.id]) };
          groups := groups.map(func(g) = if (g.age_group == ag) updated else g);
        };
        case null {
          groups := groups.concat([{ age_group = ag; player_count = 1; avg_skill = skill; submission_ids = [item.id] }]);
        };
      };
    };
    #Ok(groups)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public query ({ caller }) func get_my_pending_eois() : async { #Ok : [Types.EoiSubmission]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    #Ok(eoiSubmissions.filter(func(item) {
      item.parent_user_id == ?caller and (
        item.status == "submitted" or item.status == "preferences_completed" or item.status == "allocated"
      )
    }))
  };

  public shared ({ caller }) func confirm_eoi_placement(submission_id : Text) : async { #Ok : Types.EoiSubmission; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (eoiSubmissions.find(func(item) = item.id == submission_id)) {
      case null #Err("EOI submission not found");
      case (?current) {
        if (isFenced(current.club_id)) return #Err("Club is temporarily locked for a transfer");
        if (current.parent_user_id != ?caller) return #Err("EOI submission does not belong to caller");
        let now = nowMs();
        let updated : Types.EoiSubmission = { current with status = "confirmed"; confirmed_at_ms = ?now; parent_confirmed_at_ms = ?now; updated_at_ms = now; revision = current.revision + 1 };
        eoiSubmissions := eoiSubmissions.map(func(item) = if (item.id == submission_id) updated else item);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func claim_eoi_by_token(token : Text) : async { #Ok : Types.EoiSubmission; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (eoiSubmissions.find(func(item) = item.claim_token == token)) {
      case null #Err("EOI submission not found");
      case (?current) {
        if (isFenced(current.club_id)) return #Err("Club is temporarily locked for a transfer");
        if (current.parent_user_id != null and current.parent_user_id != ?caller) return #Err("EOI submission already claimed");
        let updated : Types.EoiSubmission = { current with parent_user_id = ?caller; claimed_at_ms = ?nowMs(); updated_at_ms = nowMs() };
        eoiSubmissions := eoiSubmissions.map(func(item) = if (item.id == current.id) updated else item);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func update_eoi_submission(id : Text, extra_notes : ?Text, preferred_teammates : ?Text, preferred_position : ?Text) : async { #Ok : Types.EoiSubmission; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    func optValid(value : ?Text, max : Nat) : Bool {
      switch (value) { case null true; case (?text) text.size() <= max }
    };
    if (not optValid(extra_notes, 2000) or not optValid(preferred_teammates, 500) or not optValid(preferred_position, 128)) return #Err("Invalid EOI update");
    switch (eoiSubmissions.find(func(item) = item.id == id)) {
      case null #Err("EOI submission not found");
      case (?current) {
        if (isFenced(current.club_id)) return #Err("Club is temporarily locked for a transfer");
        if (current.parent_user_id != ?caller) return #Err("EOI submission does not belong to caller");
        let updated : Types.EoiSubmission = { current with extra_notes; preferred_teammates; preferred_position; status = "preferences_completed"; updated_at_ms = nowMs(); revision = current.revision + 1 };
        eoiSubmissions := eoiSubmissions.map(func(item) = if (item.id == id) updated else item);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func update_eoi_status(id : Text, status : Text) : async { #Ok : Types.EoiSubmission; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (eoiSubmissions.find(func(e) = e.id == id)) { case (?e) { do { let removalReply = await syncClubAdmin(caller, e.club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }; if (isFenced(e.club_id)) return #Err("Club is temporarily locked for a transfer") }; case null {} };
    let validStatuses = ["invited", "submitted", "preferences_completed", "allocated", "confirmed", "registered", "withdrawn"];
    if (not validStatuses.any(func(s) = s == status)) return #Err("Invalid EOI status");
    switch (eoiSubmissions.find(func(item) = item.id == id)) {
      case null #Err("EOI submission not found");
      case (?current) {
        if (not canManageClub(caller, current.club_id)) return #Err("Club admin required");
        let now = nowMs();
        let updated : Types.EoiSubmission = {
          current with
          status;
          updated_at_ms = now;
          allocated_at_ms = if (status == "allocated") ?now else current.allocated_at_ms;
          confirmed_at_ms = if (status == "confirmed") ?now else current.confirmed_at_ms;
          registered_at_ms = if (status == "registered") ?now else current.registered_at_ms;
          withdrawn_at_ms = if (status == "withdrawn") ?now else current.withdrawn_at_ms;
          revision = current.revision + 1;
        };
        eoiSubmissions := eoiSubmissions.map(func(item) = if (item.id == id) updated else item);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  func doAssignEoiTeam(caller : Principal, id : Text, team_id : ?Text) : { #Ok : Types.EoiSubmission; #Err : Text } {
    switch (eoiSubmissions.find(func(item) = item.id == id)) {
      case null #Err("EOI submission not found");
      case (?current) {
        if (not canManageClub(caller, current.club_id)) return #Err("Club admin required");
        let now = nowMs();
        let newStatus = switch (team_id) { case (?_) "allocated"; case null "submitted" };
        let updated : Types.EoiSubmission = {
          current with
          assigned_team_id = team_id;
          status = newStatus;
          allocated_at_ms = switch (team_id) { case (?_) ?now; case null null };
          updated_at_ms = now;
          revision = current.revision + 1;
        };
        eoiSubmissions := eoiSubmissions.map(func(item) = if (item.id == id) updated else item);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func assign_eoi_team(id : Text, team_id : ?Text) : async { #Ok : Types.EoiSubmission; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (eoiSubmissions.find(func(e) = e.id == id)) { case (?e) { do { let removalReply = await syncClubAdmin(caller, e.club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }; if (isFenced(e.club_id)) return #Err("Club is temporarily locked for a transfer") }; case null {} };
    switch (team_id) { case null {}; case (?team) {
      let access = do { let removalReply = await teamAccess(caller, team); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
      switch (eoiSubmissions.find(func(e) = e.id == id)) {
        case null return #Err("EOI submission not found");
        case (?e) { if (access.club_id != ?e.club_id) return #Err("Team club mismatch"); if (isFenced(e.club_id)) return #Err("Club is temporarily locked for a transfer") };
      };
    } };
    doAssignEoiTeam(caller, id, team_id)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func allocate_eoi_to_team(id : Text, team_id : ?Text) : async { #Ok : Types.EoiSubmission; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (eoiSubmissions.find(func(e) = e.id == id)) { case (?e) { do { let removalReply = await syncClubAdmin(caller, e.club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }; if (isFenced(e.club_id)) return #Err("Club is temporarily locked for a transfer") }; case null {} };
    switch (team_id) { case null {}; case (?team) {
      let access = do { let removalReply = await teamAccess(caller, team); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
      switch (eoiSubmissions.find(func(e) = e.id == id)) {
        case null return #Err("EOI submission not found");
        case (?e) { if (access.club_id != ?e.club_id) return #Err("Team club mismatch"); if (isFenced(e.club_id)) return #Err("Club is temporarily locked for a transfer") };
      };
    } };
    doAssignEoiTeam(caller, id, team_id)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func delete_eoi(id : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (eoiSubmissions.find(func(e) = e.id == id)) { case (?e) { do { let removalReply = await syncClubAdmin(caller, e.club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }; if (isFenced(e.club_id)) return #Err("Club is temporarily locked for a transfer") }; case null {} };
    switch (eoiSubmissions.find(func(item) = item.id == id)) {
      case null #Err("EOI submission not found");
      case (?current) {
        if (not canManageClub(caller, current.club_id)) return #Err("Club admin required");
        eoiSubmissions := eoiSubmissions.filter(func(item) = item.id != id);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Requests queue only; sent counters advance solely after worker receipts.
  public shared ({ caller }) func resend_eoi_invite(id : Text) : async { #Ok : Types.EoiSubmission; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (eoiSubmissions.find(func(e) = e.id == id)) { case (?e) { do { let removalReply = await syncClubAdmin(caller, e.club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }; if (isFenced(e.club_id)) return #Err("Club is temporarily locked for a transfer") }; case null {} };
    switch (eoiSubmissions.find(func(item) = item.id == id)) {
      case null #Err("EOI submission not found");
      case (?current) {
        if (not canManageClub(caller, current.club_id)) return #Err("Club admin required");
        let pending = Map.entries(emailJobs).any(func pair = pair.1.kind == "eoi" and pair.1.resource == id and (pair.1.state == "pending" or pair.1.state == "processing" or pair.1.state == "unknown"));
        if (pending) return #Err("Previous email is pending or unresolved");
        switch (emailOutbox.enqueue("eoi:" # id # ":" # Nat16.toText(current.invite_sent_count + 1), "eoi", id, "", nowMs())) { case (#Err(e)) #Err(e); case (#Ok) #Ok(current) }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func bulk_resend_eoi_invites(ids : [Text]) : async { #Ok : { ok : Nat; fail : Nat }; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    if (ids.size() > 200) return #Err("Too many submissions");
    var ok = 0; var fail = 0;
    for (id in ids.values()) {
      switch (eoiSubmissions.find(func(e) = e.id == id)) { case (?e) { do { let removalReply = await syncClubAdmin(caller, e.club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply } }; case null {} };
      switch (eoiSubmissions.find(func(item) = item.id == id)) {
        case null { fail += 1 };
        case (?current) {
          if (isFenced(current.club_id) or not canManageClub(caller, current.club_id)) { fail += 1 } else {
            let pending = Map.entries(emailJobs).any(func pair = pair.1.kind == "eoi" and pair.1.resource == id and (pair.1.state == "pending" or pair.1.state == "processing" or pair.1.state == "unknown"));
            if (pending) { fail += 1 } else {
              switch (emailOutbox.enqueue("eoi:" # id # ":" # Nat16.toText(current.invite_sent_count + 1), "eoi", id, "", nowMs())) { case (#Err(_)) fail += 1; case (#Ok) ok += 1 }
            };
          };
        };
      };
    };
    #Ok({ ok; fail })
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ---------------- Competition engagement summary ----------------

  // Admin-only club engagement rollup: active teams (accepted|registered
  // entries), total/completed matches for a set of competitions over a
  // window. since_ms/until_ms are accepted for interface parity with the
  // invite-stats-style window queries elsewhere; matches/entries here carry
  // no timestamp to filter by, so the window is not yet applied to the
  // underlying rows (NEEDS-CANISTER: scheduled_at_ms exists but matches
  // outside the window are intentionally still counted for now, matching
  // the existing CompetitionPanel Supabase behaviour of using all rows).
  public query ({ caller }) func competition_engagement_summary(competition_ids : [Text], since_ms : Int, until_ms : Int) : async { #Ok : [Types.CompetitionEngagementSummary]; #Err : Text } {
    auth(caller);
    // Legacy query cannot refresh authority; use the protected consensus read.
    if (not isGovernor(caller)) return #Err("Use authorized competition summary");
    if (competition_ids.size() > 100 or since_ms > until_ms) return #Err("Invalid summary scope");
    for (id in competition_ids.values()) {
      if (removalReceiver.denied(caller) or compFenced(id) or not canManageCompetition(caller, id)) return #Err("Competition manager required");
    };
    if (competition_ids.any(func id = compFenced(id) or not canManageCompetition(caller, id))) return #Err("Competition access changed");
    #Ok(competition_ids.map(func(cid : Text) : Types.CompetitionEngagementSummary {
      let compEntries = entries.filter(func(item) = item.competition_id == cid and (item.status == "accepted" or item.status == "registered"));
      let compMatches = matches.filter(func item = item.competition_id == cid and (switch (item.scheduled_at_ms) { case null false; case (?time) Nat64.toNat(time) >= since_ms and Nat64.toNat(time) <= until_ms }));
      let completed = compMatches.filter(func(item) = item.status == "completed");
      let count = broadcasts.filter(func item = item.competition_id == cid and Nat64.toNat(item.created_at_ms) >= since_ms and Nat64.toNat(item.created_at_ms) <= until_ms).size();
      { competition_id = cid; active_teams = compEntries.size(); total_matches = compMatches.size(); results_entered = completed.size(); broadcasts = count }
    }))
  };


  // ---------------- club_domain role mirror ----------------
  // Mirrors the caller's live club_admin grant for one club from club_domain
  // (source of truth). Errors or an unwired club_domain revoke stale mirrors.
  func syncClubAdmin(caller : Principal, club_id : Text) : async () {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    switch (clubDomainCanister) {
      case null { roles := roles.filter(func(item) = not (item.user.equal(caller) and item.role == "club_admin" and item.competition_id == club_id)) };
      case (?cid) {
        let cd : actor { list_user_club_roles : shared query (Principal, Text) -> async [(Text, ?Text)]; read_account_list_user_club_roles : shared (Principal, Text) -> async [(Text, ?Text)] } = actor (Principal.toText(cid));
        try {
          let fresh = if (accountAdmissionEnabled) do { let removalReply = await cd.read_account_list_user_club_roles(caller, club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply } else do { let removalReply = await cd.list_user_club_roles(caller, club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
          do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
          if (clubDomainCanister != ?cid or isFenced(club_id)) Runtime.trap("Competition authority changed");
          let isAdmin = fresh.any(func((role, _)) = role == "club_admin");
          roles := roles.filter(func(item) = not (item.user.equal(caller) and item.role == "club_admin" and item.competition_id == club_id));
          if (isAdmin) roles := roles.concat([{ user = caller; role = "club_admin"; competition_id = club_id; team_id = null }]);
        } catch (_) {
          roles := roles.filter(func(item) = not (item.user.equal(caller) and item.role == "club_admin" and item.competition_id == club_id));
        };
      };
    };
  
    } finally { removalReceiver.leave(caller) };
  };

  func syncForCompetition(caller : Principal, competition_id : Text) : async () {
    switch (competitions.find(func(item) = item.id == competition_id)) {
      case (?c) await syncClubAdmin(caller, c.club_id);
      case null {};
    };
  };

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

  public shared ({ caller }) func set_events_domain_canister(id : Principal) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (id.equal(Principal.anonymous())) return #Err("Invalid canister id");
    eventsDomainCanister := ?id;
    #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func set_vault_domain_canister(id : Principal) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (id.equal(Principal.anonymous())) return #Err("Invalid canister id");
    vaultDomainCanister := ?id;
    #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func set_pii_access_control_canister(id : Principal) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (id.equal(Principal.anonymous())) return #Err("Invalid canister id");
    piiAccessControlCanister := ?id;
    #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  /// Refreshes the caller's mirrored club-admin role for a competition's
  /// organiser club so later management queries see it.
  public shared ({ caller }) func sync_my_competition_access(competition_id : Text) : async { #Ok : Bool; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    #Ok(canManageCompetition(caller, competition_id))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func get_news_audience(competition_id : Text, requester : Principal) : async { #Ok : Types.CompetitionNewsAudience; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(requester)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(requester); if (removalReceiver.denied(requester)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    switch (clubDomainCanister) {
      case null { return #Err("club_domain canister not configured") };
      case (?clubDomain) { if (not caller.equal(clubDomain)) return #Err("club_domain only") };
    };
    auth(requester);
    do { let removalReply = await syncForCompetition(requester, competition_id); if (removalReceiver.denied(requester)) throw Error.reject("Account removal fenced after callback"); removalReply };
    let competition = switch (competitions.find(func(item) = item.id == competition_id)) {
      case null return #Err("Competition not found");
      case (?item) item;
    };
    let teams = entries
      .filter(func(entry) = entry.competition_id == competition_id and (entry.status == "accepted" or entry.status == "registered"))
      .map(func(entry) = entry.team_id);
    if (teams.size() > 100) return #Err("Competition audience exceeds 100 teams");
    let allowedRoles = ["competition_admin", "admin", "owner", "league_admin", "competition_official", "referee", "committee_member"];
    var recipients : [Principal] = [];
    for (role in roles.values()) {
      if (role.competition_id == competition_id and allowedRoles.any(func(value) = value == role.role) and not recipients.any(func(user) = user.equal(role.user))) {
        recipients := recipients.concat([role.user]);
      };
    };
    if (recipients.size() > 500) return #Err("Competition audience exceeds 500 officials");
    #Ok({ competition_id; club_id = competition.club_id; team_ids = teams; recipients; can_publish = canManageCompetition(requester, competition_id) })
  
    } finally { removalReceiver.leave(requester) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // The infrastructure caller may not supply arbitrary public requests: only
  // the configured events service can ask on behalf of the original human.
  public shared ({ caller }) func read_history_score_access(competition_id : Text, team_id : Text, starts_at_ms : Nat64, requester : Principal, manager_only : Bool) : async { #Ok : Bool; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(requester)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    let authority = eventsDomainCanister;
    if (authority != ?caller) return #Err("Trusted events canister only");
    auth(requester);
    do { let removalReply = await admitAccount(requester); if (removalReceiver.denied(requester)) throw Error.reject("Account removal fenced after callback"); removalReply };
    do { let removalReply = await syncForCompetition(requester, competition_id); if (removalReceiver.denied(requester)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (authority != eventsDomainCanister or compFenced(competition_id)) return #Err("Competition authority changed or locked");
    if (not competitions.any(func(c) = c.id == competition_id)) return #Err("Competition not found");
    if (canManageCompetition(requester, competition_id)) return #Ok(true);
    if (manager_only) return #Ok(false);
    // Legacy competition-wide events have no verified match association.
    // Timestamp/team coincidences must never grant a division-show override.
    ignore team_id; ignore starts_at_ms;
    #Ok(not scorePrivacySettings.any(func(s) = s.competition_id == competition_id and s.hide_scores))
  
    } finally { removalReceiver.leave(requester) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({caller}) func read_match_score_access(competition_id : Text, match_id : Text, team_id : Text, requester : Principal, manager_only : Bool) : async { #Ok : Bool; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(requester)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    let authority = eventsDomainCanister;
    if (authority != ?caller) return #Err("Trusted events canister only");
    auth(requester); do { let removalReply = await admitAccount(requester); if (removalReceiver.denied(requester)) throw Error.reject("Account removal fenced after callback"); removalReply }; do { let removalReply = await syncForCompetition(requester,competition_id); if (removalReceiver.denied(requester)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (authority != eventsDomainCanister or compFenced(competition_id)) return #Err("Competition authority changed or locked");
    let game = switch(matches.find(func(m)=m.id==match_id and m.competition_id==competition_id)) {
      case null return #Err("Match not found"); case (?m) m
    };
    if(game.home_team!=team_id and game.away_team!=team_id) return #Err("Match team mismatch");
    if(canManageCompetition(requester,competition_id)) return #Ok(true);
    if(manager_only) return #Ok(false);
    #Ok(not ScorePrivacy.hidden(scorePrivacySettings,competition_id,game.division_id))
  
    } finally { removalReceiver.leave(requester) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({caller}) func materialize_match_events(match_id : Text) : async { #Ok : [Text]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    auth(caller); do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    let original=switch(matches.find(func(m)=m.id==match_id)){case null return #Err("Match not found");case(?m)m};
    do { let removalReply = await syncForCompetition(caller,original.competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if(matchFenced(match_id) or not canManageCompetition(caller,original.competition_id)) return #Err("Competition manager required");
    let game=switch(matches.find(func(m)=m.id==match_id and m.revision==original.revision)){case null return #Err("Match changed");case(?m)m};
    let starts=switch(game.scheduled_at_ms){case null return #Err("Schedule the match first");case(?s)s};
    let teams=entries.filter(func(e)=e.competition_id==game.competition_id and (e.status=="accepted" or e.status=="registered") and (e.team_id==game.home_team or e.team_id==game.away_team)).map(func(e)={team_id=e.team_id;club_id=e.club_id});
    if(teams.size()!=2) return #Err("Both teams must be registered");
    let authority=switch(eventsDomainCanister){case null return #Err("Events authority unavailable");case(?id)id};
    let service : actor { materialize_competition_fixture : shared ({match_id:Text;competition_id:Text;creator:Principal;teams:[{team_id:Text;club_id:Text}];starts_at_ms:Nat64;ends_at_ms:Nat64;title:Text;venue:?Text},Nat64) -> async {#Ok:[Text];#Err:Text} }=actor(authority.toText());
    let result=try{do { let removalReply = await (with timeout=10) service.materialize_competition_fixture({match_id;competition_id=game.competition_id;creator=caller;teams;starts_at_ms=starts;ends_at_ms=starts+Nat64.fromNat(Nat16.toNat(game.duration_minutes??90))*60_000;title=game.home_team#" vs "#game.away_team;venue=game.venue},game.revision); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }}catch(_){return #Err("Fixture synchronization unresolved; retain the same fixture request")};
    if(eventsDomainCanister!=?authority or matchFenced(match_id) or not matches.any(func m = m.id == game.id and m.revision == game.revision)) return #Err("Fixture authority or revision changed");
    result
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({caller}) func write_history_match_result(match_id:Text,team_id:Text,requester:Principal,own:Nat32,opponent:Nat32):async {#Ok;#Err:Text}{
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(requester)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    let authority=eventsDomainCanister;
    if(authority!=?caller)return #Err("Trusted events canister only");
    auth(requester);do { let removalReply = await admitAccount(requester); if (removalReceiver.denied(requester)) throw Error.reject("Account removal fenced after callback"); removalReply };
    let before=switch(matches.find(func(m)=m.id==match_id)){case null return #Err("Match not found");case(?m)m};
    do { let removalReply = await syncForCompetition(requester,before.competition_id); if (removalReceiver.denied(requester)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if(authority!=eventsDomainCanister or matchFenced(match_id) or not canManageCompetition(requester,before.competition_id))return #Err("Competition manager required");
    let current=switch(matches.find(func(m)=m.id==match_id and m.revision==before.revision)){case null return #Err("Match changed");case(?m)m};
    if(team_id!=current.home_team and team_id!=current.away_team)return #Err("Match team mismatch");
    if (own > 65535 or opponent > 65535) return #Err("Score too large");
    let updated={current with home_score=Nat16.fromNat(Nat32.toNat(if(team_id==current.home_team)own else opponent));away_score=Nat16.fromNat(Nat32.toNat(if(team_id==current.home_team)opponent else own));status="completed";revision=current.revision+1};
    matches:=matches.map(func(m)=if(m.id==match_id)updated else m);#Ok
  
    } finally { removalReceiver.leave(requester) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({caller}) func read_history_match_result(match_id:Text,team_id:Text,requester:Principal):async {#Ok:{home:?Nat16;away:?Nat16;hidden:Bool};#Err:Text}{
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(requester)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    let authority=eventsDomainCanister;
    if(authority!=?caller)return #Err("Trusted events canister only");
    auth(requester);do { let removalReply = await admitAccount(requester); if (removalReceiver.denied(requester)) throw Error.reject("Account removal fenced after callback"); removalReply };
    let before=switch(matches.find(func(m)=m.id==match_id)){case null return #Err("Match not found");case(?m)m};
    do { let removalReply = await syncForCompetition(requester,before.competition_id); if (removalReceiver.denied(requester)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if(authority!=eventsDomainCanister or matchFenced(match_id))return #Err("Competition authority changed");
    let current=switch(matches.find(func(m)=m.id==match_id)){case null return #Err("Match not found");case(?m)m};
    if(team_id!=current.home_team and team_id!=current.away_team)return #Err("Match team mismatch");
    let hidden=not canManageCompetition(requester,current.competition_id) and ScorePrivacy.hidden(scorePrivacySettings,current.competition_id,current.division_id);
    #Ok({hidden;home=if(hidden)null else ?(if(team_id==current.home_team)current.home_score else current.away_score);away=if(hidden)null else ?(if(team_id==current.home_team)current.away_score else current.home_score)})
  
    } finally { removalReceiver.leave(requester) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // The competition and its immutable source configuration commit together.
  // The club/tenant/grade tuple is the durable receipt: retries return the same
  // current competition and cannot create another competition after a lost reply.
  public shared ({ caller }) func link_playhq_competition(club_id : Text, name : Text, season : Text, tenant : Text, grade_id : Text, sport : ?Text) : async { #Ok : Types.Competition; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
      auth(caller);
      if (not valid(club_id) or not valid(name) or season.size() > 128 or not valid(tenant) or not valid(grade_id) or Text.contains(tenant, #text "\u{1f}") or Text.contains(grade_id, #text "\u{1f}")) return #Err("Invalid PlayHQ link");
      switch (sport) { case (?value) if (not valid(value)) return #Err("Invalid sport"); case null {} };
      await admitAccount(caller);
      await syncClubAdmin(caller, club_id);
      if (removalReceiver.denied(caller) or isFenced(club_id) or not canManageClub(caller, club_id)) return #Err("Club admin required or authority changed");
      switch (playhqCompetitionLinks.find(func x = x.club_id == club_id and x.tenant == tenant and x.grade_id == grade_id)) {
        case (?existing) {
          if (existing.sport != sport) return #Err("PlayHQ sport binding conflict");
          return switch (competitions.find(func c = c.id == existing.competition_id and c.club_id == club_id)) { case (?c) #Ok(c); case null #Err("PlayHQ link requires reconciliation") }
        };
        case null {};
      };
      let id = "cmp-" # club_id # "-" # Nat.toText(competitions.size() + 1);
      if (competitions.any(func c = c.id == id)) return #Err("Competition identifier conflict");
      let competition : Types.Competition = { id; club_id; name; season; status = "active"; description = null; visibility = "public"; points_win = 3; points_draw = 1; points_loss = 0; revision = 1 };
      competitions := competitions.concat([competition]);
      playhqCompetitionLinks := playhqCompetitionLinks.concat([{ competition_id = id; club_id; tenant; grade_id; sport; last_synced_at_ms = null }]);
      #Ok(competition)
    } finally { removalReceiver.leave(caller) }
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func list_playhq_competitions(club_id : Text) : async { #Ok : [{ competition : Types.Competition; link : Types.PlayHQCompetitionLink }]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
      auth(caller); if (not valid(club_id)) return #Err("Invalid club");
      await admitAccount(caller); await syncClubAdmin(caller, club_id);
      if (removalReceiver.denied(caller) or isFenced(club_id)) return #Err("Club access changed");
      let manager = canManageClub(caller, club_id);
      let rows = playhqCompetitionLinks.filter(func x = x.club_id == club_id);
      var result : [{ competition : Types.Competition; link : Types.PlayHQCompetitionLink }] = [];
      for (link in rows.values()) {
        switch (competitions.find(func c = c.id == link.competition_id and c.club_id == club_id and (c.visibility == "public" or manager))) { case (?competition) result := result.concat([{ competition; link }]); case null {} };
      };
      #Ok(result)
    } finally { removalReceiver.leave(caller) }
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({caller}) func sync_playhq_grade(competition_id:Text,tenant:Text,grade:Text) : async {#Ok:Nat;#Err:Text} {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    auth(caller);do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };do { let removalReply = await syncForCompetition(caller,competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if(compFenced(competition_id) or not canManageCompetition(caller,competition_id)) return #Err("Competition manager required");
    let sourceLink = playhqCompetitionLinks.find(func x = x.competition_id == competition_id);
    switch (sourceLink) { case (?link) if (link.tenant != tenant or link.grade_id != grade) return #Err("PlayHQ source does not match the saved link"); case null {} };
    let authority=switch(eventsDomainCanister){case null return #Err("Events authority unavailable");case(?id)id};
    let service:actor{fetch_playhq_grade:shared(Text,Text)->async{#Ok:Types.PlayHQFeed;#Err:Text}}=actor(authority.toText());
    let feed=switch(try{do { let removalReply = await(with timeout=120)service.fetch_playhq_grade(tenant,grade); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }}catch(_){return #Err("PlayHQ synchronization unavailable")}){case(#Err(e))return #Err(e);case(#Ok(f))f};
    do { let removalReply = await syncForCompetition(caller,competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if(eventsDomainCanister!=?authority or compFenced(competition_id) or not canManageCompetition(caller,competition_id)) return #Err("Competition access changed");
    if (playhqCompetitionLinks.find(func x = x.competition_id == competition_id) != sourceLink) return #Err("PlayHQ source changed");
    if (feed.games.size() > 200 or feed.stats.size() > 2000) return #Err("Feed exceeds import bounds");
    var incoming:[Types.PlayHQMatchMeta]=[];var imported:[Types.Match]=[];var statRows:[Types.PlayHQStat]=[];
    for(g in feed.games.values()) {
      let previous=playhqMatchMetadata.find(func(m)=m.competition_id==competition_id and m.tenant==tenant and m.game_id==g.game_id);
      let id=switch(previous){case null "phq-"#competition_id#"-"#tenant#"-"#g.game_id;case(?m)m.match_id};
      let old=matches.find(func(m)=m.id==id);
      // Local edits win over refresh; never overwrite a manually changed revision.
      let override=switch(previous,old){case(?p,?m)p.synced_revision!=m.revision;case _ false};
      let revision : Nat64 = switch(old){case null 1;case(?m)m.revision+1};
      let row:Types.Match=switch(old){case(?m)if(override)m else ({m with status=g.status;home_score=g.home_score??m.home_score;away_score=g.away_score??m.away_score;scheduled_at_ms=g.starts_at_ms;venue=g.venue;revision});case null ({id;competition_id;home_team=g.home_id;away_team=g.away_id;status=g.status;home_score=g.home_score??0;away_score=g.away_score??0;division_id=?grade;scheduled_at_ms=g.starts_at_ms;venue=g.venue;pitch_number=null;round_number=null;duration_minutes=null;arrival_minutes_before=null;notes=null;revision})};
      imported:=imported.concat([row]);
      incoming:=incoming.concat([{match_id=id;competition_id;tenant;grade_id=grade;game_id=g.game_id;home_id=g.home_id;away_id=g.away_id;home_name=g.home_name;away_name=g.away_name;synced_revision=if(override)switch(previous){case(?p)p.synced_revision;case null row.revision}else row.revision}]);
    };
    for(s in feed.stats.values()) {
      let meta=switch(incoming.find(func(m)=m.game_id==s.game_id)){case null return #Err("Unassociated player statistics");case(?m)m};
      if (s.team_id != meta.home_id and s.team_id != meta.away_id or s.stats_json.size() > 8192) return #Err("Invalid player statistics");
      statRows:=statRows.concat([{competition_id;match_id=meta.match_id;tenant;game_id=s.game_id;team_id=s.team_id;player_id=s.player_id;player_name=s.player_name;stats_json=s.stats_json}]);
    };
    matches:=matches.filter(func(m)=not imported.any(func(i)=i.id==m.id)).concat(imported);
    playhqMatchMetadata:=playhqMatchMetadata.filter(func(m)=not incoming.any(func(i)=i.match_id==m.match_id)).concat(incoming);
    playhqStats:=playhqStats.filter(func(s)=not incoming.any(func(i)=i.match_id==s.match_id)).concat(statRows);
    playhqCompetitionLinks := playhqCompetitionLinks.map(func x = if (x.competition_id == competition_id) ({ x with last_synced_at_ms = ?nowMs() }) else x);
    #Ok(imported.size())
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({caller}) func read_playhq_stats(competition_id:Text) : async {#Ok:{matches:[Types.PlayHQMatchMeta];stats:[Types.PlayHQStat];claims:[{player_id:Text;tenant:Text;mine:Bool}]};#Err:Text} {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    auth(caller);do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };do { let removalReply = await syncForCompetition(caller,competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    let member=canManageCompetition(caller,competition_id) or roles.any(func(r)=r.user==caller and r.competition_id==competition_id) or (do { let removalReply = await participantVisible(caller,competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply });
    if(not member or compFenced(competition_id)) return #Err("Competition access denied");
    let manager=canManageCompetition(caller,competition_id);
    let meta=playhqMatchMetadata.filter(func(m)=m.competition_id==competition_id);
    let safe=playhqStats.filter(func(s)=s.competition_id==competition_id and matches.any(func(m)=m.id==s.match_id and (manager or not ScorePrivacy.hidden(scorePrivacySettings,competition_id,m.division_id))));
    #Ok({matches=meta;stats=safe;claims=playhqClaims.filter(func(c)=c.user==caller and safe.any(func(s)=s.tenant==c.tenant and s.player_id==c.player_id)).map(func(c)={player_id=c.player_id;tenant=c.tenant;mine=true})})
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  public shared ({caller}) func claim_playhq_player(competition_id:Text,tenant:Text,player_id:Text) : async {#Ok;#Err:Text} {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    auth(caller);do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };do { let removalReply = await syncForCompetition(caller,competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if(compFenced(competition_id)) return #Err("Competition locked");
    var eligible=canManageCompetition(caller,competition_id) or roles.any(func(r)=r.user==caller and r.competition_id==competition_id);
    let participantTeams=entries.filter(func(e)=e.competition_id==competition_id and (e.status=="accepted" or e.status=="registered"));
    if (participantTeams.size() > 500) return #Err("Participant inventory too large");
    for(entry in participantTeams.values()){if(not eligible and (do { let removalReply = await teamAccess(caller,entry.team_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }).is_member)eligible:=true};
    if(not eligible) return #Err("Competition membership required");
    if(not playhqStats.any(func(s)=s.competition_id==competition_id and s.tenant==tenant and s.player_id==player_id)) return #Err("Player not found");
    // Non-exclusive self-identification never grants player or guardian authority.
    if(playhqClaims.any(func(c)=c.tenant==tenant and c.player_id==player_id and c.user==caller)) return #Ok;
    if(compFenced(competition_id)) return #Err("Competition locked");
    playhqClaims:=playhqClaims.concat([{tenant;player_id;user=caller}]);#Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Name audiences never inherit public competition visibility. Snapshot all
  // local permission-bearing inputs and recheck after every consensus await.
  public shared ({ caller }) func read_profile_audience_batch(requester : Principal, competition_id : Text, subjects : [Principal], expected : ?Nat) : async { #Ok : { revision : Nat; requester : Principal; club : Text; subjects : [Principal]; members : [Bool] }; #Err : Text } {
    if (Runtime.envVar<system>("IGNITE_PRIVATE_PROFILE_READS_REHEARSAL") != ?"1") return #Err("Private competition names are not released");
    if (accountAdmissionAuthority != ?caller or caller.isAnonymous()) return #Err("Configured identity authority required");
    if (requester.isAnonymous() or subjects.size() > 25 or subjects.any(func p = p.isAnonymous()) or competition_id == "" or competition_id.size() > 128) return #Err("Bounded exact competition required");
    if (not removalReceiver.enter(requester)) return #Err("Account removal fenced");
    try {
      func snapshot() : Text = debug_show((competitions.filter(func c = c.id == competition_id), roles.filter(func r = r.competition_id == competition_id or r.role == "club_admin"), entries.filter(func e = e.competition_id == competition_id), personalCompetitionOwners.filter(func o = o.0 == competition_id), clubDomainCanister, participantClubAuthorities, accountAdmissionAuthority));
      let pinned = snapshot();
      if (Text.encodeUtf8(pinned).size() > 32_768) return #Err("Competition audience exceeds bounded evidence");
      func active() : Bool = pinned == snapshot() and not compFenced(competition_id) and not removalReceiver.denied(requester);
      let remote = await privateNameRemoteRevisions([requester].concat(subjects));
      if (not active()) return #Err("Competition audience changed");
      let revision = PrivateProfileAudience.snapshotRevision(debug_show((pinned, remote)));
      switch (expected) { case (?r) if (r != revision) return #Err("Competition audience changed"); case null {} };
      await admitAccount(requester);
      if (not active()) return #Err("Competition audience changed");
      if (not (await privateNameParticipant(requester, competition_id))) return #Err("Private competition membership required");
      if (not active()) return #Err("Competition audience changed");
      var members : [Bool] = [];
      for (subject in subjects.values()) {
        await admitAccount(subject);
        if (not active()) return #Err("Competition audience changed");
        let allowed = await privateNameParticipant(subject, competition_id);
        if (not active()) return #Err("Competition audience changed");
        members := members.concat([allowed and not removalReceiver.denied(subject)]);
      };
      let closing = await privateNameRemoteRevisions([requester].concat(subjects));
      if (not active() or remote != closing) return #Err("Remote competition membership changed");
      #Ok({ revision; requester; club = competition_id; subjects; members })
    } finally { removalReceiver.leave(requester) }
  };
  func privateNameParticipant(user : Principal, id : Text) : async Bool {
    if (not competitions.any(func c = c.id == id)) return false;
    if (isGovernor(user) or personalCompetitionOwners.any(func o = o.0 == id and o.1 == user) or roles.any(func r = r.competition_id == id and r.user == user and r.role != "club_admin")) return true;
    let competition = competitions.find(func c = c.id == id) ?? return false;
    switch (clubDomainCanister) {
      case (?authority) {
        let domain : actor { read_account_list_user_club_roles : shared (Principal, Text) -> async [(Text, ?Text)] } = actor(authority.toText());
        let grants = try { await (with timeout = 10) domain.read_account_list_user_club_roles(user, competition.club_id) } catch (_) { return false };
        if (removalReceiver.denied(user) or compFenced(id)) return false;
        if (grants.any(func g = g.0 == "club_admin" or g.0 == "app_admin")) return true;
      };
      case null {};
    };
    let accepted = entries.filter(func e = e.competition_id == id and (e.status == "accepted" or e.status == "registered"));
    if (accepted.size() > 500) return false;
    for (entry in accepted.values()) {
      for (authority in participantAuthorities().values()) {
        let domain : actor { read_account_read_competition_team_access : shared (Text, Principal) -> async TeamAccess } = actor(authority.toText());
        let access = try { await (with timeout = 10) domain.read_account_read_competition_team_access(entry.team_id, user) } catch (_) { return false };
        if (compFenced(id) or removalReceiver.denied(user)) return false;
        if (access.is_member and entries.any(func e = e == entry)) return true;
      }
    };
    false
  };
  func privateNameRemoteRevisions(subjects : [Principal]) : async [(Principal, Nat)] {
    var evidence : [(Principal, Nat)] = [];
    if (participantAuthorities().size() > 64) throw Error.reject("Bounded participant authorities required");
    for (authority in participantAuthorities().values()) {
      let domain : actor { read_profile_remote_revision : shared ([Principal], ?Nat) -> async { #Ok : Nat; #Err : Text } } = actor(authority.toText());
      let reply = await (with timeout = 10) domain.read_profile_remote_revision(subjects, null);
      let revision = switch (reply) { case (#Ok(r)) r; case (#Err(e)) throw Error.reject(e) };
      evidence := evidence.concat([(authority, revision)]);
    };
    evidence
  };

  // Exact thread member/current administrators only; broad competition
  // membership and stale role mirrors cannot stand in for a private inbox.
  public shared ({ caller }) func read_profile_admin_thread_batch(requester : Principal, competition_id : Text, member : Principal, subjects : [Principal], expected : ?Nat) : async { #Ok : { revision : Nat; requester : Principal; club : Text; subjects : [Principal]; members : [Bool] }; #Err : Text } {
    if (Runtime.envVar<system>("IGNITE_PRIVATE_PROFILE_READS_REHEARSAL") != ?"1"
      or privateMessagingAuthority != ?caller.toText() or caller.isAnonymous()) return #Err("Configured private messaging authority required");
    if (competition_id == "" or competition_id.size() > 128 or not competitions.any(func c = c.id == competition_id)) return #Err("Exact existing competition required");
    func admins() : [Principal] {
      roles.filter(func r = r.competition_id == competition_id and (r.role == "competition_admin" or r.role == "admin" or r.role == "owner")).map(func r = r.user)
    };
    if (not PrivateAdminNames.permitted(requester, member, subjects, admins())) return #Err("Exact admin thread participants required");
    if (not removalReceiver.enter(requester)) return #Err("Account removal fenced");
    try {
      func snapshot() : Text = debug_show((competitions.filter(func c = c.id == competition_id), roles.filter(func r = r.competition_id == competition_id or r.role == "club_admin"), entries.filter(func e = e.competition_id == competition_id), personalCompetitionOwners.filter(func o = o.0 == competition_id), clubDomainCanister, participantClubAuthorities));
      let pinned = snapshot();
      if (Text.encodeUtf8(pinned).size() > 32_768) return #Err("Bounded competition evidence required");
      func active() : Bool = pinned == snapshot() and not compFenced(competition_id)
        and privateMessagingAuthority == ?caller.toText()
        and not removalReceiver.denied(requester) and not removalReceiver.denied(member)
        and not subjects.any(func p = removalReceiver.denied(p));
      let people = [requester, member].concat(subjects).filter(func p = not p.isAnonymous());
      // Deduplicate so the remote <=26-person admission contract stays bounded.
      var unique : [Principal] = [];
      for (p in people.values()) if (not unique.any(func q = q == p)) unique := unique.concat([p]);
      if (unique.size() > 26) return #Err("Bounded admin thread people required");
      let remote = await privateNameRemoteRevisions(unique);
      if (not active()) return #Err("Admin thread authority changed");
      let revision = PrivateProfileAudience.snapshotRevision(debug_show((pinned, remote, member)));
      switch (expected) { case (?r) if (r != revision) return #Err("Admin thread revision changed"); case null {} };
      for (p in unique.values()) { await admitAccount(p); if (not active()) return #Err("Admin thread admission changed") };
      let validMember = await privateNameParticipant(member, competition_id);
      if (not active() or not validMember or not PrivateAdminNames.permitted(requester, member, subjects, admins())) return #Err("Admin thread membership changed");
      let closing = await privateNameRemoteRevisions(unique);
      if (not active() or closing != remote) return #Err("Admin thread remote membership changed");
      #Ok({ revision; requester; club = competition_id; subjects; members = subjects.map(func _ = true) })
    } catch (e) { #Err(Error.message(e)) } finally { removalReceiver.leave(requester) }
  };

  // Existing thread-open/list callers cannot read a manager-only role list
  // as their service principal. Delegate the original human, and disclose
  // only current admin principals after the owning membership checks.
  public shared ({ caller }) func read_private_admin_thread_participants(requester : Principal, competition_id : Text) : async { #Ok : [Principal]; #Err : Text } {
    if (Runtime.envVar<system>("IGNITE_PRIVATE_PROFILE_READS_REHEARSAL") != ?"1" or privateMessagingAuthority != ?caller.toText()) return #Err("Configured private messaging required");
    let pinned = debug_show((roles.filter(func r = r.competition_id == competition_id), competitions.filter(func c = c.id == competition_id), clubDomainCanister, participantClubAuthorities));
    if (Text.encodeUtf8(pinned).size() > 32_768) return #Err("Bounded competition required");
    await admitAccount(requester);
    if (not (await privateNameParticipant(requester, competition_id))) return #Err("Competition membership required");
    if (pinned != debug_show((roles.filter(func r = r.competition_id == competition_id), competitions.filter(func c = c.id == competition_id), clubDomainCanister, participantClubAuthorities)) or compFenced(competition_id) or removalReceiver.denied(requester)) return #Err("Competition authority changed");
    #Ok(roles.filter(func r = r.competition_id == competition_id and (r.role == "competition_admin" or r.role == "admin" or r.role == "owner")).map(func r = r.user))
  };

  public shared ({ caller }) func get_vault_access(competition_id : Text, requester : Principal) : async { #Ok : { club_id : Text; is_member : Bool; can_manage : Bool }; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(requester)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(requester); if (removalReceiver.denied(requester)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    let isTrustedCaller = (switch (vaultDomainCanister) {
      case (?vaultDomain) caller.equal(vaultDomain);
      case null false;
    }) or (switch (piiAccessControlCanister) {
      case (?piiCanister) caller.equal(piiCanister);
      case null false;
    });
    if (not isTrustedCaller) return #Err("Trusted vault or PII canister only");
    auth(requester);
    do { let removalReply = await syncForCompetition(requester, competition_id); if (removalReceiver.denied(requester)) throw Error.reject("Account removal fenced after callback"); removalReply };
    let competition = switch (competitions.find(func(item) = item.id == competition_id)) {
      case null return #Err("Competition not found");
      case (?item) item;
    };
    let canManage = canManageCompetition(requester, competition_id);
    var isMember = canManage or roles.any(func(grant) = grant.competition_id == competition_id and grant.user.equal(requester));
    if (not isMember) isMember := do { let removalReply = await participantVisible(requester, competition_id); if (removalReceiver.denied(requester)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    #Ok({ club_id = competition.club_id; is_member = isMember; can_manage = canManage })
  
    } finally { removalReceiver.leave(requester) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ---------------- Division ladder visibility ----------------
  public query ({ caller }) func list_division_settings(competition_id : Text) : async { #Ok : [Types.DivisionSetting]; #Err : Text } {
    denyLegacyAccountQuery();
    ignore caller;
    #Ok(divisionSettings.filter(func(item) = item.competition_id == competition_id))
  };

  public shared ({ caller }) func set_division_hide_ladder(competition_id : Text, division : Text, hide_ladder : Bool) : async { #Ok : Types.DivisionSetting; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (not valid(division)) return #Err("Invalid division");
    let value : Types.DivisionSetting = { competition_id; division; hide_ladder };
    divisionSettings := divisionSettings.filter(func(item) = not (item.competition_id == competition_id and item.division == division)).concat([value]);
    #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public query func get_competition_hide_ladder(competition_id : Text) : async { #Ok : Bool; #Err : Text } {
    if (not competitions.any(func(item) = item.id == competition_id)) return #Err("Competition not found");
    #Ok(competitionLadderSettings.any(func(item) = item.competition_id == competition_id and item.hide_ladder))
  };

  public shared ({ caller }) func set_competition_hide_ladder(competition_id : Text, hide_ladder : Bool) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (not competitions.any(func(item) = item.id == competition_id)) return #Err("Competition not found");
    competitionLadderSettings := competitionLadderSettings.filter(func(item) = item.competition_id != competition_id);
    if (hide_ladder) {
      competitionLadderSettings := competitionLadderSettings.concat([{ competition_id; hide_ladder }]);
    };
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ---------------- Competition broadcasts ----------------
  public shared ({ caller }) func queue_competition_broadcast(operation : Text, competition : Text, divisions : [Text], title : Text, body : Text) : async { #Ok : Nat; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) return #Err("Account unavailable");
    try {
      auth(caller); await admitAccount(caller); await syncForCompetition(caller, competition);
      if (removalReceiver.denied(caller) or compFenced(competition) or not canManageCompetition(caller, competition)) return #Err("Competition manager required");
      if (operation.size() == 0 or operation.size() > 128 or divisions.size() > 100 or title.size() > 200 or body.size() == 0 or body.size() > 4000) return #Err("Invalid broadcast");
      let key = caller.toText() # "\u{1f}" # operation;
      for ((otherKey, pending) in Map.entries(broadcastDeliveries)) {
        if (otherKey != key and pending.sender == caller and pending.competition == competition and pending.unknown != null) return #Err("Previous broadcast outcome unresolved; no new send permitted");
      };
      var receipt = switch (Map.get(broadcastDeliveries, Text.compare, key)) {
        case (?existing) {
          if (existing.sender != caller or existing.competition != competition or existing.divisions != divisions or existing.title != title or existing.body != body) return #Err("Broadcast operation conflict");
          existing
        };
        case null {
          let id = "bc-" # competition # "-" # Nat.toText(broadcasts.size() + 1);
          broadcasts := broadcasts.concat([{ id; competition_id = competition; sender = caller; title; body; created_at_ms = Nat64.fromIntWrap(Time.now() / 1_000_000) }]);
          { sender = caller; competition; divisions; title; body; broadcast_id = id; completed = [] : [(Text, Nat16)]; unknown = null : ?Text }
        }
      };
      if (broadcastErasureSubjects.get(caller) != null) return #Err("Broadcast account cleanup pending or complete");
      Map.add(broadcastDeliveries, Text.compare, key, receipt);
      let selected = entries.filter(func e = e.competition_id == competition and (e.status == "accepted" or e.status == "registered") and (divisions.size() == 0 or (switch (e.division_id) { case null false; case (?d) divisions.any(func v = v == d) })));
      if (selected.size() > 100) return #Err("Broadcast team inventory exceeds bound");
      var clubIds : [Text] = [];
      for (entry in selected.values()) if (not clubIds.any(func id = id == entry.club_id)) clubIds := clubIds.concat([entry.club_id]);
      let host = switch (competitions.find(func c = c.id == competition)) { case null return #Err("Competition not found"); case (?c) c.club_id };
      if (host != "" and not clubIds.any(func id = id == host)) clubIds := clubIds.concat([host]);
      let plan=switch(Map.get(broadcastPlans,Text.compare,key)) {
        case (?p)p;
        case null {
          if(receipt.unknown!=null or receipt.completed.size()!=0)return #Err("Historical broadcast lacks exact plan; retain unresolved evidence");
          var targets:[BroadcastPlan.Target]=[];
          for(club in clubIds.values()) {
            let teams=selected.filter(func e = e.club_id==club).map(func e = e.team_id);
            var authority=if(club==host)clubDomainCanister else null;
            for(team in teams.values())for(id in participantAuthorities().values()) {
              let service:actor{read_competition_team_access:shared query(Text,Principal)->async{club_id:?Text;is_member:Bool;can_manage:Bool}}=actor(id.toText());
              let access=try{await service.read_competition_team_access(team,caller)}catch(_){return #Err("Broadcast ownership unavailable")};
              if(access.club_id==?club){if(authority!=null and authority!=?id)return #Err("Ambiguous broadcast owner");authority:=?id}
            };
            let id=authority??return #Err("Broadcast club owner unavailable");
            targets:=targets.concat([{club;authority=id;teams;officials=if(club==host)roles.filter(func r = r.competition_id==competition).map(func r = r.user)else []}])
          };
          await syncForCompetition(caller,competition);
          if(broadcastErasureSubjects.get(caller) != null or targets.any(func t = t.officials.any(func p = broadcastErasureSubjects.get(p) != null)) or removalReceiver.denied(caller) or compFenced(competition) or not canManageCompetition(caller,competition) or not selected.all(func e = entries.any(func current = current==e)) or Map.get(broadcastDeliveries,Text.compare,key)!=?receipt)return #Err("Broadcast planning changed");
          Map.add(broadcastPlans,Text.compare,key,targets);targets
        }
      };
      switch(receipt.unknown) {case (?club){
        let target=plan.find(func t = t.club==club)??return #Err("Original broadcast target missing");
        let service:actor{reconcile_competition_broadcast:shared(Text,Text)->async{#Ok:?Nat16;#Err:Text}}=actor(target.authority.toText());
        let recovered=switch(try{await service.reconcile_competition_broadcast(club,receipt.broadcast_id)}catch(_){return #Err("Broadcast outcome still unresolved")}){case(#Err(e))return #Err(e);case(#Ok(v))v};
        if(Map.get(broadcastDeliveries,Text.compare,key)!=?receipt or removalReceiver.denied(caller) or compFenced(competition) or not canManageCompetition(caller,competition))return #Err("Broadcast reconciliation changed");
        let n=recovered??return #Err("No acceptance proof; original broadcast remains locked");
        receipt:={receipt with unknown=null;completed=receipt.completed.concat([(club,n)])};Map.add(broadcastDeliveries,Text.compare,key,receipt)
      };case null {}};
      var count : Nat = 0;
      for ((_, n) in receipt.completed.values()) count += Nat16.toNat(n);
      for (target in plan.values()) {
        let club=target.club;
        if (not receipt.completed.any(func pair = pair.0 == club)) {
          let clubTeams=target.teams;let id=target.authority;
          await syncForCompetition(caller, competition);
          if (broadcastErasureSubjects.get(caller) != null or target.officials.any(func p = broadcastErasureSubjects.get(p) != null) or removalReceiver.denied(caller) or compFenced(competition) or not canManageCompetition(caller, competition)) return #Err("Broadcast access changed");
          let officials=target.officials;
          if (Map.get(broadcastDeliveries, Text.compare, key) != ?receipt) return #Err("Broadcast operation already active");
          receipt := { receipt with unknown = ?club }; Map.add(broadcastDeliveries, Text.compare, key, receipt);
          let service : actor { relay_competition_broadcast : shared (Principal, Text, Text, [Text], [Principal], Text, Text) -> async { #Ok : Nat16; #Err : Text } } = actor(id.toText());
          let reply = try { await (with timeout = 10) service.relay_competition_broadcast(caller, club, competition, clubTeams, officials, body, receipt.broadcast_id) } catch (_) { return #Err("Broadcast outcome unresolved; retain original operation") };
          switch reply {
            case (#Err(e)) {
              return #Err("Broadcast unresolved; retain exact receipt: " # e)
            };
            case (#Ok(n)) { count += Nat16.toNat(n); receipt := { receipt with unknown = null; completed = receipt.completed.concat([(club, n)]) }; Map.add(broadcastDeliveries, Text.compare, key, receipt) }
          }
        }
      };
      #Ok(count)
    } finally { removalReceiver.leave(caller) }
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  // Stored log only; push delivery is fanned out by the sender's client
  // through notification_queue (same path as announcement broadcasts).
  public shared ({ caller }) func send_competition_broadcast(competition_id : Text, title : Text, body : Text) : async { #Ok : Types.Broadcast; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    do { let removalReply = await syncForCompetition(caller, competition_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (compFenced(competition_id)) return #Err("Club is temporarily locked for a transfer");
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (title.size() == 0 or title.size() > 200 or body.size() == 0 or body.size() > 4000) return #Err("Invalid broadcast");
    let value : Types.Broadcast = { id = "bc-" # competition_id # "-" # Nat.toText(broadcasts.size() + 1); competition_id; sender = caller; title; body; created_at_ms = Nat64.fromIntWrap(Time.now() / 1_000_000) };
    broadcasts := broadcasts.concat([value]);
    #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public query ({ caller }) func list_competition_broadcasts(competition_id : Text) : async { #Ok : [Types.Broadcast]; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller) or compFenced(competition_id)) return #Err("Use authorized competition broadcasts");
    #Ok(broadcasts.filter(func(item) = item.competition_id == competition_id).reverse())
  };

  // Governor-only: moves every stored reference of one user's sign-in ID (old) to a new one.
  // Any NEW stored principal / principal-text field added to this canister must be added here.
  public shared ({ caller }) func rekey_principal(old : Principal, new : Principal, dry_run : Bool) : async { #ok : Nat; #err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (removalReceiver.denied(old) or removalReceiver.denied(new)) return #err("Account removal fenced");
    if (not isGovernor(caller)) return #err("Forbidden");
    if (old.equal(Principal.anonymous()) or new.equal(Principal.anonymous())) return #err("Invalid principal");
    if (old.equal(new)) return #err("old and new must differ");
    if (old.equal(governor)) return #err("Cannot rekey the governor");
    for((_,r) in Map.entries(broadcastDeliveries))if(r.sender==old and r.unknown!=null)return #err("Resolve original broadcast before account rekey");
    for ((key, r) in Map.entries(broadcastDeliveries)) if (r.unknown != null and (switch (Map.get(broadcastPlans, Text.compare, key)) { case (?plan) plan.any(func t = t.officials.any(func p = p == old)); case null false })) return #err("Resolve original official broadcast before rekey");
    let oldPrefix=old.toText() # "\u{1f}";let newPrefix=new.toText() # "\u{1f}";
    let fixtureUpdates=Map.entries(fixtureReceipts).toArray();
    for((key,r) in fixtureUpdates.values()) {
      if(r.creator==old) {
        let destination=newPrefix # (Text.stripStart(key,#text oldPrefix)??key);
        if(Map.get(fixtureReceipts,Text.compare,destination)!=null)return #err("Destination fixture operation conflict")
      }
    };

    var conflicts = 0;
    conflicts += roles.filter(func(item) = item.user.equal(new)).size();
    conflicts += tokens.filter(func(item) = item.issued_by.equal(new)).size();
    conflicts += competitionInvites.filter(func(item) = item.invitee.equal(new) or item.created_by.equal(new)).size();
    conflicts += competitionJoinLinks.filter(func(item) = item.created_by.equal(new)).size();
    conflicts += eoiSubmissions.filter(func(item) = item.parent_user_id == ?new).size();
    conflicts += broadcasts.filter(func(item) = item.sender.equal(new)).size();
    for ((_, receipt) in Map.entries(broadcastDeliveries)) if (receipt.sender == new) conflicts += 1;
    conflicts += playhqClaims.filter(func(item)=item.user==new).size();
    conflicts+=personalCompetitionOwners.filter(func r = r.1==new).size();
    conflicts+=roleLinks.filter(func r = r.created_by==new).size();
    conflicts+=competitionOfficialEmailInvites.filter(func r = r.created_by==new or r.accepted_by==?new).size();
    conflicts+=competitionMemberWelcomeJobs.filter(func r = r.member==new).size();
    if (bulkAccessPrincipals.any(func(p) = p.equal(new))) { conflicts += 1 };

    if (conflicts > 0) return #err("New sign-in ID already has " # Nat.toText(conflicts) # " record(s) in competition_domain");

    var changed = 0;
    let newOwners=personalCompetitionOwners.map(func r {if(r.1==old){changed+=1;(r.0,new)}else r});
    let newRoleLinks=roleLinks.map(func r {if(r.created_by==old){changed+=1;{r with created_by=new}}else r});
    let newOfficialInvites=competitionOfficialEmailInvites.map(func r {if(r.created_by==old or r.accepted_by==?old){changed+=1;{r with created_by=if(r.created_by==old)new else r.created_by;accepted_by=if(r.accepted_by==?old)?new else r.accepted_by}}else r});
    let newMemberJobs=competitionMemberWelcomeJobs.map(func r {if(r.member==old){changed+=1;{r with member=new}}else r});
    for((_,r) in fixtureUpdates.values())if(r.creator==old)changed+=1;
    for ((_, plan) in Map.entries(broadcastPlans)) for (target in plan.values()) changed += target.officials.filter(func p = p == old).size();

    let newRoles = roles.map(func(item : Types.RoleGrant) : Types.RoleGrant {
      if (item.user.equal(old)) { changed += 1; { item with user = new } } else item
    });
    let newTokens = tokens.map(func(item : Types.JoinToken) : Types.JoinToken {
      if (item.issued_by.equal(old)) { changed += 1; { item with issued_by = new } } else item
    });
    let newCompetitionInvites = competitionInvites.map(func(item : Types.CompetitionInvite) : Types.CompetitionInvite {
      var touched = false;
      var invitee = item.invitee;
      var created_by = item.created_by;
      if (invitee.equal(old)) { invitee := new; touched := true };
      if (created_by.equal(old)) { created_by := new; touched := true };
      if (touched) { changed += 1; { item with invitee; created_by } } else item
    });
    let newCompetitionJoinLinks = competitionJoinLinks.map(func(item : Types.CompetitionJoinLink) : Types.CompetitionJoinLink {
      if (item.created_by.equal(old)) { changed += 1; { item with created_by = new } } else item
    });
    let newEoiSubmissions = eoiSubmissions.map(func(item : Types.EoiSubmission) : Types.EoiSubmission {
      if (item.parent_user_id == ?old) { changed += 1; { item with parent_user_id = ?new } } else item
    });
    let newBroadcasts = broadcasts.map(func(item : Types.Broadcast) : Types.Broadcast {
      if (item.sender.equal(old)) { changed += 1; { item with sender = new } } else item
    });
    for ((_, receipt) in Map.entries(broadcastDeliveries)) if (receipt.sender == old) changed += 1;
    var newBulkAccessPrincipals = bulkAccessPrincipals;
    let newPlayhqClaims=playhqClaims.map(func(c):Types.PlayHQClaim {if(c.user==old){changed+=1;{c with user=new}}else c});
    if (bulkAccessPrincipals.any(func(p) = p.equal(old))) {
      let hasNew = bulkAccessPrincipals.any(func(p) = p.equal(new));
      newBulkAccessPrincipals := bulkAccessPrincipals.filterMap(func(p) : ?Principal {
        if (p.equal(old)) { if (hasNew) null else ?new } else ?p
      });
      changed += 1;
    };

    if (not dry_run) {
      personalCompetitionOwners:=newOwners;roleLinks:=newRoleLinks;competitionOfficialEmailInvites:=newOfficialInvites;competitionMemberWelcomeJobs:=newMemberJobs;
      for((key,r) in fixtureUpdates.values())if(r.creator==old){Map.remove(fixtureReceipts,Text.compare,key);Map.add(fixtureReceipts,Text.compare,newPrefix # (Text.stripStart(key,#text oldPrefix)??key),{r with creator=new})};
      let updates = Map.entries(broadcastDeliveries).toArray();
      for ((key, receipt) in updates.values()) {
        if (receipt.sender == old) {
          let suffix = Text.stripStart(key, #text (old.toText() # "\u{1f}")) ?? key;
          Map.remove(broadcastDeliveries, Text.compare, key);
          Map.add(broadcastDeliveries, Text.compare, new.toText() # "\u{1f}" # suffix, { receipt with sender = new });
          switch(Map.get(broadcastPlans,Text.compare,key)){case (?plan){Map.remove(broadcastPlans,Text.compare,key);Map.add(broadcastPlans,Text.compare,new.toText() # "\u{1f}" # suffix,plan)};case null {}};
        }
      };
      roles := newRoles;
      for ((key, plan) in Map.entries(broadcastPlans).toArray().values()) Map.add(broadcastPlans, Text.compare, key, plan.map(func t = { t with officials = t.officials.map(func p = if (p == old) new else p) }));
      tokens := newTokens;
      competitionInvites := newCompetitionInvites;
      competitionJoinLinks := newCompetitionJoinLinks;
      eoiSubmissions := newEoiSubmissions;
      broadcasts := newBroadcasts;
      bulkAccessPrincipals := newBulkAccessPrincipals;
      playhqClaims:=newPlayhqClaims;
    };

    #ok(changed)
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };


  // Additive protected consensus reads; live UI rollout is a separate release gate.
  public shared ({ caller }) func read_account_list_official_chats(competition_id : Text) : async { #Ok : [Types.OfficialChat]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    let hasRole = roles.any(func(r) = r.user.equal(caller) and r.competition_id == competition_id);
    if (not canManageCompetition(caller, competition_id) and not hasRole) return #Err("Forbidden");
    #Ok(officialChats.filter(func(c) = c.competition_id == competition_id))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_my_personal_competitions() : async { #Ok : [Types.Competition]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    let mine = personalCompetitionOwners.filter(func(pair) = pair.1.equal(caller)).map(func(pair) = pair.0);
    #Ok(competitions.filter(func(item) = mine.any(func(id) = id == item.id)))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_read_token_club(token : Text) : async { #Ok : ?Text; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller); if (not valid(token)) return #Err("Invalid token");
    switch (eoiSubmissions.find(func(e) = e.claim_token == token and (e.parent_user_id == null or e.parent_user_id == ?caller))) { case (?e) return #Ok(?e.club_id); case null {} };
    let cid = switch (competitionJoinLinks.find(func(l) = l.token == token and not l.revoked)) { case (?l) ?l.competition_id; case null switch (roleLinks.find(func(l) = l.token == token and not l.revoked)) { case (?l) ?l.competition_id; case null switch (competitionOfficialEmailInvites.find(func(i) = i.token == token)) { case (?i) ?i.competition_id; case null null } } };
    #Ok(switch (cid) { case null null; case (?id) switch (competitions.find(func(c) = c.id == id)) { case null null; case (?c) if (c.club_id == "") null else ?c.club_id } })
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_can_invite_players_to_team(team_id : Text) : async Bool {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    if (not valid(team_id)) return false;
    entries.any(func(entry) =
      entry.team_id == team_id and
      (entry.status == "accepted" or entry.status == "registered") and
      canManageCompetition(caller, entry.competition_id)
    )
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_is_competition_invite_manager(team_id : Text, requester : Principal) : async Bool {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(requester)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(requester); if (removalReceiver.denied(requester)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (requester.equal(Principal.anonymous()) or not valid(team_id)) return false;
    switch (clubDomainCanister) {
      case null { false };
      case (?clubDomain) {
        caller.equal(clubDomain) and entries.any(func(entry) =
          entry.team_id == team_id and
          (entry.status == "accepted" or entry.status == "registered") and
          canManageCompetition(requester, entry.competition_id)
        )
      };
    }
  
    } finally { removalReceiver.leave(requester) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_competitions(club_id : Text) : async { #Ok : [Types.Competition]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    #Ok(competitions.filter(func(item) = item.club_id == club_id))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_competitions_multi(club_ids : [Text]) : async { #Ok : [Types.Competition]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    #Ok(competitions.filter(func(item) = club_ids.any(func(id) = id == item.club_id)))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_public_competitions() : async { #Ok : [Types.Competition]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    #Ok(competitions.filter(func(item) = item.visibility == "public" and item.status != "archived"))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_my_news_competitions() : async { #Ok : [Types.Competition]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    #Ok(competitions.filter(func(item) = canManageCompetition(caller, item.id)))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_is_competition_admin(competition_id : Text) : async { #Ok : Bool; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    #Ok(canManageCompetition(caller, competition_id))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_get_chat_settings(competition_id : Text) : async { #Ok : Types.ChatSettings; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (findChatSettings(competition_id)) {
      case (?settings) #Ok(settings);
      case null #Ok({ competition_id; chat_enabled = true; admins_only = false; revision = 0 : Nat64 });
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_invites_by_invitee() : async { #Ok : [Types.CompetitionInvite]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    #Ok(competitionInvites.filter(func(item) = item.invitee.equal(caller)))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_get_my_pending_eois() : async { #Ok : [Types.EoiSubmission]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    #Ok(eoiSubmissions.filter(func(item) {
      item.parent_user_id == ?caller and (
        item.status == "submitted" or item.status == "preferences_completed" or item.status == "allocated"
      )
    }))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_competition_engagement_summary(competition_ids : [Text], since_ms : Int, until_ms : Int) : async { #Ok : [Types.CompetitionEngagementSummary]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    if (competition_ids.size() > 100 or since_ms > until_ms) return #Err("Invalid summary scope");
    for (id in competition_ids.values()) {
      await syncForCompetition(caller, id);
      if (removalReceiver.denied(caller) or compFenced(id) or not canManageCompetition(caller, id)) return #Err("Competition manager required");
    };
    if (competition_ids.any(func id = compFenced(id) or not canManageCompetition(caller, id))) return #Err("Competition access changed");
    #Ok(competition_ids.map(func(cid : Text) : Types.CompetitionEngagementSummary {
      let compEntries = entries.filter(func(item) = item.competition_id == cid and (item.status == "accepted" or item.status == "registered"));
      let compMatches = matches.filter(func item = item.competition_id == cid and (switch (item.scheduled_at_ms) { case null false; case (?time) Nat64.toNat(time) >= since_ms and Nat64.toNat(time) <= until_ms }));
      let completed = compMatches.filter(func(item) = item.status == "completed");
      let count = broadcasts.filter(func item = item.competition_id == cid and Nat64.toNat(item.created_at_ms) >= since_ms and Nat64.toNat(item.created_at_ms) <= until_ms).size();
      { competition_id = cid; active_teams = compEntries.size(); total_matches = compMatches.size(); results_entered = completed.size(); broadcasts = count }
    }))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_division_settings(competition_id : Text) : async { #Ok : [Types.DivisionSetting]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    ignore caller;
    #Ok(divisionSettings.filter(func(item) = item.competition_id == competition_id))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_competition_broadcasts(competition_id : Text) : async { #Ok : [Types.Broadcast]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    await syncForCompetition(caller, competition_id);
    let permitted = await privateParticipant(caller, competition_id);
    if (not permitted or removalReceiver.denied(caller) or compFenced(competition_id)) return #Err("Competition access forbidden");
    #Ok(broadcasts.filter(func(item) = item.competition_id == competition_id).reverse())
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
};
