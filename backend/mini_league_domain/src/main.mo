import PrivateNameWriterWindow "../../shared/PrivateNameWriterWindow";
import PrivateNameWriterEndpoints "../../shared/PrivateNameWriterEndpoints";
import AccountAdmission "../../shared/AccountAdmission";
import OpeningConfiguration "../../shared/OpeningConfiguration";
import RemovalReceiver "../../shared/RemovalReceiver";
import RemovalEndpoints "../../shared/PrivateNameRemovalEndpoints";
import Map "mo:core/Map";
import Error "mo:core/Error";
import PrimMem "mo:⛔";
import Cycles "mo:core/Cycles";
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Text "mo:core/Text";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Random "mo:core/Random";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Types "types";
import PrivateProfileAudience "../../shared/PrivateProfileAudience";

persistent actor class Main(governorInit : Principal) = this {
  // Local rehearsal only. Eligibility never grants resource permissions.
  transient let accountAdmissionEnabled = Runtime.envVar<system>("IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL") == ?"1";
  transient let accountAdmissionAuthority = switch (Runtime.envVar<system>("IGNITE_ACCOUNT_SERVICE_IDENTITY")) {
    case (?id) ?Principal.fromText(id); case null null
  };
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
    [("club_domain", OpeningConfiguration.optional(clubDomainCanister)),
     ("events_domain", OpeningConfiguration.optional(eventsDomainCanister))]
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
  var leagues : [Types.MiniLeague];
  var sessions : [Types.MiniLeagueSession];
  var players : [Types.MiniLeaguePlayer];
  var invites : [Types.MiniLeagueInvite];
  var groups : [Types.MiniLeagueGroup];
  var groupPlayers : [Types.MiniLeagueGroupPlayer];
  var duties : [Types.MiniLeagueGroupDuty];
  var availability : [Types.MiniLeagueSessionAvailability];
  var admins : [Types.MiniLeagueAdmin];
  var joinLinks : [Types.MiniLeagueJoinLink];
  var children : [Types.MiniLeagueChild];
  var guardians : [Types.MiniLeagueGuardian];
  var clubDomainCanister : ?Principal;
  var eventsDomainCanister : ?Principal;
  var transferFences : [Text];

  func auth(caller : Principal) { if (caller.equal(Principal.anonymous())) Runtime.trap("Authenticated caller required") };
  func valid(value : Text) : Bool { value != "" and value.size() <= 128 };
  func validOpt(value : ?Text, maxLen : Nat) : Bool { switch (value) { case null true; case (?text) text.size() <= maxLen } };
  func nowMs() : Nat64 { Nat.toNat64(Int.abs(Time.now()) / 1_000_000) };

  func validLeagueStatus(value : Text) : Bool { value == "active" or value == "archived" };
  func validSessionStatus(value : Text) : Bool { value == "scheduled" or value == "cancelled" or value == "completed" };
  func validDutyStatus(value : Text) : Bool { value == "open" or value == "claimed" or value == "completed" };
  func validAvailabilityStatus(value : Text) : Bool { value == "available" or value == "unavailable" or value == "maybe" };
  func validInviteStatus(value : Text) : Bool { value == "pending" or value == "claimed" };


  // ---- Club transfer fence + snapshot (governor-only operator tooling) ----
  // Inspect is advisory only; the runner re-digests the source before cutover.
  func isFenced(club : Text) : Bool = transferFences.any(func(c) = c == club);
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
    transferFences := transferFences.filter(func(c) = c != club);
    if (fenced) transferFences := transferFences.concat([club]);
    #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  func leagueFenced(id : Text) : Bool = transferFences.size() > 0 and leagues.any(func(l) = l.id == id and isFenced(l.club_id));
  func sessionFenced(id : Text) : Bool = transferFences.size() > 0 and sessions.any(func(s) = s.id == id and leagueFenced(s.mini_league_id));
  func groupFenced(id : Text) : Bool = transferFences.size() > 0 and groups.any(func(g) = g.id == id and sessionFenced(g.session_id));
  func playerFenced(id : Text) : Bool = transferFences.size() > 0 and players.any(func(p) = p.id == id and leagueFenced(p.mini_league_id));
  func dutyFenced(id : Text) : Bool = transferFences.size() > 0 and duties.any(func(d) = d.id == id and groupFenced(d.group_id));
  type LeagueSnapshot = { roles : [Types.RoleGrant]; leagues : [Types.MiniLeague]; sessions : [Types.MiniLeagueSession]; players : [Types.MiniLeaguePlayer];
    invites : [Types.MiniLeagueInvite]; groups : [Types.MiniLeagueGroup]; group_players : [Types.MiniLeagueGroupPlayer]; duties : [Types.MiniLeagueGroupDuty];
    availability : [Types.MiniLeagueSessionAvailability]; admins : [Types.MiniLeagueAdmin]; join_links : [Types.MiniLeagueJoinLink];
    children : [Types.MiniLeagueChild]; guardians : [Types.MiniLeagueGuardian] };
  func leagueSnapshot(c : Text) : LeagueSnapshot {
    let ls = leagues.filter(func(x) = x.club_id == c);
    let inL = func(id : Text) : Bool = ls.any(func(l) = l.id == id);
    let ss = sessions.filter(func(x) = inL(x.mini_league_id));
    let inS = func(id : Text) : Bool = ss.any(func(s) = s.id == id);
    let gs = groups.filter(func(x) = inS(x.session_id));
    let inG = func(id : Text) : Bool = gs.any(func(g) = g.id == id);
    let ps = players.filter(func(x) = inL(x.mini_league_id));
    let kids = children.filter(func(k) = ps.any(func(p) = p.child_id == ?k.id));
    { roles = roles.filter(func(x) = x.club_id == c); leagues = ls; sessions = ss; players = ps;
      invites = invites.filter(func(x) = inL(x.mini_league_id)); groups = gs; group_players = groupPlayers.filter(func(x) = inG(x.group_id));
      duties = duties.filter(func(x) = inG(x.group_id)); availability = availability.filter(func(x) = inS(x.session_id));
      admins = admins.filter(func(x) = inL(x.mini_league_id)); join_links = joinLinks.filter(func(x) = inL(x.mini_league_id));
      children = kids; guardians = guardians.filter(func(g) = kids.any(func(k) = k.id == g.child_id)) }
  };
  // Children/guardians are person records shared across leagues: copied (upserted), never purged.
  func dropLeagueClub(c : Text) {
    let s = leagueSnapshot(c);
    let inL = func(id : Text) : Bool = s.leagues.any(func(l) = l.id == id);
    let inS = func(id : Text) : Bool = s.sessions.any(func(x) = x.id == id);
    let inG = func(id : Text) : Bool = s.groups.any(func(x) = x.id == id);
    roles := roles.filter(func(x) = x.club_id != c); leagues := leagues.filter(func(x) = x.club_id != c);
    sessions := sessions.filter(func(x) = not inL(x.mini_league_id)); players := players.filter(func(x) = not inL(x.mini_league_id));
    invites := invites.filter(func(x) = not inL(x.mini_league_id)); groups := groups.filter(func(x) = not inS(x.session_id));
    groupPlayers := groupPlayers.filter(func(x) = not inG(x.group_id)); duties := duties.filter(func(x) = not inG(x.group_id));
    availability := availability.filter(func(x) = not inS(x.session_id)); admins := admins.filter(func(x) = not inL(x.mini_league_id));
    joinLinks := joinLinks.filter(func(x) = not inL(x.mini_league_id));
  };
  public query ({ caller }) func export_club_snapshot(club : Text) : async { #Ok : Blob; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before export");
    #Ok(to_candid (leagueSnapshot(club)))
  };
  public shared ({ caller }) func import_club_snapshot(club : Text, snapshot : Blob) : async { #Ok : Nat; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not isGovernor(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before import");
    let decoded : ?LeagueSnapshot = from_candid (snapshot);
    let s = switch (decoded) { case (?x) x; case null return #Err("Invalid snapshot") };
    if (removalReceiver.snapshotDenied(snapshot)) return #Err("Snapshot references fenced account");
    let inL = func(id : Text) : Bool = s.leagues.any(func(l) = l.id == id);
    let inS = func(id : Text) : Bool = s.sessions.any(func(x) = x.id == id);
    let inG = func(id : Text) : Bool = s.groups.any(func(x) = x.id == id);
    if (s.roles.any(func(x) = x.club_id != club) or s.leagues.any(func(x) = x.club_id != club)
        or s.sessions.any(func(x) = not inL(x.mini_league_id)) or s.players.any(func(x) = not inL(x.mini_league_id))
        or s.invites.any(func(x) = not inL(x.mini_league_id)) or s.admins.any(func(x) = not inL(x.mini_league_id))
        or s.join_links.any(func(x) = not inL(x.mini_league_id)) or s.groups.any(func(x) = not inS(x.session_id))
        or s.availability.any(func(x) = not inS(x.session_id)) or s.group_players.any(func(x) = not inG(x.group_id))
        or s.duties.any(func(x) = not inG(x.group_id))) return #Err("Snapshot contains foreign records");
    if (s.leagues.any(func(e) = leagues.any(func(x) = x.id == e.id and x.club_id != club))) return #Err("Snapshot id collides with another club");
    dropLeagueClub(club);
    roles := roles.concat(s.roles); leagues := leagues.concat(s.leagues); sessions := sessions.concat(s.sessions); players := players.concat(s.players);
    invites := invites.concat(s.invites); groups := groups.concat(s.groups); groupPlayers := groupPlayers.concat(s.group_players);
    duties := duties.concat(s.duties); availability := availability.concat(s.availability); admins := admins.concat(s.admins);
    joinLinks := joinLinks.concat(s.join_links);
    children := children.filter(func(k) = not s.children.any(func(y) = y.id == k.id)).concat(s.children);
    guardians := guardians.filter(func(g) = not s.guardians.any(func(y) = y.child_id == g.child_id and y.guardian_user_id.equal(g.guardian_user_id))).concat(s.guardians);
    #Ok(s.leagues.size())
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  public shared ({ caller }) func purge_club_snapshot(club : Text) : async { #Ok : Nat; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not isGovernor(caller)) return #Err("Governor required");
    if (not isFenced(club)) return #Err("Club must be fenced before purge");
    let n = leagues.size(); dropLeagueClub(club); #Ok(n - leagues.size())
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  func isGovernor(caller : Principal) : Bool { not caller.equal(Principal.anonymous()) and governor.equal(caller) };
  func hasRole(caller : Principal, role : Text, club : Text, team : ?Text) : Bool {
    roles.any(func(grant) { grant.user.equal(caller) and grant.role == role and grant.club_id == club and (grant.team_id == team or grant.team_id == null) })
  };
  // Any role grant scoped to the club counts as membership for read
  // visibility — mirrors events_domain's isClubMember so members (not just
  // admins/coaches) can see mini-leagues shown to their club.
  func isClubMember(caller : Principal, club : Text) : Bool {
    roles.any(func(grant) = grant.user.equal(caller) and grant.club_id == club)
  };
  func isClubAdmin(caller : Principal, club_id : Text) : Bool {
    isGovernor(caller) or hasRole(caller, "club_admin", club_id, null)
  };
  // Creation must use current club authority, not a manually populated mirror.
  func currentClubAdmin(caller : Principal, club : Text) : async* Bool {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    if (isGovernor(caller)) return true;
    let id = switch (clubDomainCanister) { case null return false; case (?id) id };
    let domain : actor { read_account_list_user_club_roles : shared (Principal, Text) -> async [(Text, ?Text)] } = actor(id.toText());
    let fresh = try { do { let removalReply = await (with timeout = 10) domain.read_account_list_user_club_roles(caller, club); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply } } catch (_) { return false };
    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (clubDomainCanister != ?id or isFenced(club)) return false;
    roles := roles.filter(func(r) = not (r.user.equal(caller) and r.club_id == club)).concat(
      fresh.map(func((role, team)) : Types.RoleGrant = { user = caller; role; club_id = club; team_id = team })
    );
    fresh.any(func((role, _)) = role == "club_admin")
  
    } finally { removalReceiver.leave(caller) };
  };
  // League-admin = club admin OR the league creator OR explicitly granted via
  // mini_league_admins — mirrors can_view_mini_league / the admin-management
  // semantics of ManageMiniLeagueAdminsSheet.
  func isLeagueAdminGrant(caller : Principal, mini_league_id : Text) : Bool {
    admins.any(func(item) = item.mini_league_id == mini_league_id and item.user_id.equal(caller))
  };
  func isLeagueAdmin(caller : Principal, league : Types.MiniLeague) : Bool {
    isGovernor(caller) or league.created_by.equal(caller) or isClubAdmin(caller, league.club_id) or isLeagueAdminGrant(caller, league.id)
  };
  // Mirrors can_view_mini_league(): league admins, club members, or the
  // parent/claimant of a player enrolled in the league can view it.
  // Mirrors are candidates, never child-link authority. Query callers use
  // composite reads; writes use consensus and recheck local rows after await.
  public composite query ({ caller }) func verify_child_guardian(user : Principal, child : Text) : async Bool {
    denyLegacyAccountQuery();
    if (caller != Principal.fromActor(this)) return false;
    let id = switch (clubDomainCanister) { case null return false; case (?id) id };
    let domain : actor { has_child_guardian : shared query (Principal, Text) -> async Bool } = actor(id.toText());
    let allowed = try { await domain.has_child_guardian(user, child) } catch (_) { false };
    allowed and clubDomainCanister == ?id
  };
  func currentGuardianWrite(user : Principal, child : Text) : async* Bool {
    let id = switch (clubDomainCanister) { case null return false; case (?id) id };
    let domain : actor { read_has_child_guardian : shared (Principal, Text) -> async Bool } = actor(id.toText());
    let allowed = try { await (with timeout = 10) domain.read_has_child_guardian(user, child) } catch (_) { false };
    allowed and clubDomainCanister == ?id
  };
  public composite query ({ caller }) func verify_player_access(user : Principal, player : Types.MiniLeaguePlayer) : async Bool {
    denyLegacyAccountQuery();
    if (caller != Principal.fromActor(this)) return false;
    switch (player.child_id) {
      case (?child) await this.verify_child_guardian(user, child);
      case null player.claimed_by == ?user or player.parent_user_id == ?user.toText();
    }
  };
  func playerAccessWrite(user : Principal, player : Types.MiniLeaguePlayer) : async* Bool {
    switch (player.child_id) {
      case (?child) await* currentGuardianWrite(user, child);
      case null player.claimed_by == ?user or player.parent_user_id == ?user.toText();
    }
  };
  public composite query ({ caller = origin }) func verify_league_access(viewer : Principal, league : Types.MiniLeague) : async Bool {
    denyLegacyAccountQuery();
    if (origin != Principal.fromActor(this)) return false;
    let caller = viewer;
    if (Principal.isAnonymous(caller)) return false;
    if (isLeagueAdmin(caller, league) or isClubMember(caller, league.club_id)) return true;
    for (p in players.values()) {
      if (p.mini_league_id == league.id and (await this.verify_player_access(caller, p))) return true;
    };
    false
  };
  public composite query ({ caller = origin }) func filter_visible_leagues(viewer : Principal, candidates : [Types.MiniLeague]) : async [Types.MiniLeague] {
    denyLegacyAccountQuery();
    if (origin != Principal.fromActor(this)) return [];
    let caller = viewer;
    var out : [Types.MiniLeague] = [];
    for (league in candidates.values()) if (await this.verify_league_access(caller, league)) out := out.concat([league]);
    out
  };
  func findLeague(id : Text) : ?Types.MiniLeague { leagues.find(func(item) = item.id == id) };
  func requireLeagueAdmin(caller : Principal, id : Text) : { #Ok : Types.MiniLeague; #Err : Text } {
    switch (findLeague(id)) {
      case null #Err("Mini-league not found");
      case (?league) { if (not isLeagueAdmin(caller, league)) #Err("Mini-league admin required") else #Ok(league) };
    }
  };
  func findSession(id : Text) : ?Types.MiniLeagueSession { sessions.find(func(item) = item.id == id) };
  func requireSessionAdmin(caller : Principal, id : Text) : { #Ok : Types.MiniLeagueSession; #Err : Text } {
    switch (findSession(id)) {
      case null #Err("Session not found");
      case (?session) {
        switch (requireLeagueAdmin(caller, session.mini_league_id)) {
          case (#Err(e)) #Err(e);
          case (#Ok(_)) #Ok(session);
        }
      };
    }
  };
  func findGroup(id : Text) : ?Types.MiniLeagueGroup { groups.find(func(item) = item.id == id) };
  func groupLeagueId(group : Types.MiniLeagueGroup) : ?Text {
    switch (findSession(group.session_id)) { case (?session) ?session.mini_league_id; case null null };
  };
  func requireGroupAdmin(caller : Principal, id : Text) : { #Ok : Types.MiniLeagueGroup; #Err : Text } {
    switch (findGroup(id)) {
      case null #Err("Group not found");
      case (?group) {
        switch (groupLeagueId(group)) {
          case null #Err("Session not found");
          case (?leagueId) {
            switch (requireLeagueAdmin(caller, leagueId)) {
              case (#Err(e)) #Err(e);
              case (#Ok(_)) #Ok(group);
            }
          };
        }
      };
    }
  };
  func findPlayer(id : Text) : ?Types.MiniLeaguePlayer { players.find(func(item) = item.id == id) };
  func findChild(id : Text) : ?Types.MiniLeagueChild { children.find(func(item) = item.id == id) };
  func nextId(prefix : Text, size : Nat) : Text { prefix # "-" # Nat.toText(size) };

  transient let hexDigits : [Text] = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"];

  // 128 bits of raw_rand entropy, hex-encoded, for bearer tokens (join
  // links, claim invites) — those must be unguessable, unlike the
  // sequential entity ids nextId produces. Update methods only.
  func randomToken(prefix : Text) : async Text {
    let blob = await Random.blob();
    var out = prefix # "-";
    var i = 0;
    label fill for (b in blob.values()) {
      if (i >= 16) break fill;
      let n = Nat8.toNat(b);
      out #= hexDigits[n / 16] # hexDigits[n % 16];
      i += 1;
    };
    out
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

  public shared ({ caller }) func set_club_domain_canister(id : Principal) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (id.equal(Principal.anonymous())) return #Err("Invalid club_domain canister id");
    clubDomainCanister := ?id;
    #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func set_events_domain_canister(id : Principal) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (Principal.isAnonymous(id)) return #Err("Invalid canister id");
    eventsDomainCanister := ?id;
    #Ok
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
  // Trusted events authority supplies the original signed caller. No user may impersonate a parent.
  public composite query ({ caller }) func can_read_league_matches(viewer : Principal, league_id : Text, club_id : Text) : async Bool {
    denyLegacyAccountQuery();
    if (eventsDomainCanister != ?caller or Principal.isAnonymous(viewer)) return false;
    switch (findLeague(league_id)) {
      case null false;
      case (?league) league.club_id == club_id and league.status == "active" and (await this.verify_league_access(viewer, league));
    }
  };

  public shared ({ caller }) func read_can_read_league_matches(viewer : Principal, league_id : Text, club_id : Text) : async Bool {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(viewer)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(viewer); if (removalReceiver.denied(viewer)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventsDomainCanister != ?caller or Principal.isAnonymous(viewer)) return false;
    let league = switch (findLeague(league_id)) { case null return false; case (?l) l };
    if (league.club_id != club_id or league.status != "active") return false;
    if (isLeagueAdmin(viewer, league) or isClubMember(viewer, club_id)) return true;
    for (p in players.values()) {
      if (p.mini_league_id == league_id and (do { let removalReply = await* playerAccessWrite(viewer, p); if (removalReceiver.denied(viewer)) throw Error.reject("Account removal fenced after callback"); removalReply })) {
        return eventsDomainCanister == ?caller and findLeague(league_id) == ?league and findPlayer(p.id) == ?p and not leagueFenced(league_id);
      };
    };
    false
  
    } finally { removalReceiver.leave(viewer) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func grant_role(principal : Principal, role : Text, club_id : Text, team_id : ?Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller); if (not isGovernor(caller)) return #Err("Governor only");
    if (principal.equal(Principal.anonymous()) or not valid(role) or not valid(club_id)) return #Err("Invalid role assignment");
    if (not roles.any(func(item) = item.user.equal(principal) and item.role == role and item.club_id == club_id and item.team_id == team_id)) {
      roles := roles.concat([{ user = principal; role; club_id; team_id }]);
    };
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // ---------------- Mini-leagues ----------------

  public shared ({ caller }) func create_mini_league(club_id : Text, name : Text, description : ?Text, logo_url : ?Text, team_size : Nat16, min_players_per_side : Nat16, minutes_per_half : Nat16, bib_colors : [Text], show_matches_to_members : Bool) : async { #Ok : Types.MiniLeague; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (isFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not valid(club_id) or not valid(name) or not validOpt(description, 2000) or not validOpt(logo_url, 512)) return #Err("Invalid mini-league");
    if (not (do { let removalReply = await* currentClubAdmin(caller, club_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Club admin required");
    let now = nowMs();
    let created : Types.MiniLeague = {
      id = nextId("mlg-" # club_id, leagues.size()); club_id; name; description; logo_url;
      team_size; min_players_per_side; minutes_per_half; bib_colors; show_matches_to_members;
      status = "active"; created_by = caller; created_at_ms = now; updated_at_ms = now;
    };
    leagues := leagues.concat([created]);
    #Ok(created)
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func update_mini_league(id : Text, name : Text, description : ?Text, logo_url : ?Text, team_size : Nat16, min_players_per_side : Nat16, minutes_per_half : Nat16, bib_colors : [Text], show_matches_to_members : Bool) : async { #Ok : Types.MiniLeague; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (leagueFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireLeagueAdmin(caller, id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(current)) {
        if (not valid(name) or not validOpt(description, 2000) or not validOpt(logo_url, 512)) return #Err("Invalid mini-league update");
        let updated : Types.MiniLeague = { current with name; description; logo_url; team_size; min_players_per_side; minutes_per_half; bib_colors; show_matches_to_members; updated_at_ms = nowMs() };
        leagues := leagues.map(func(item) = if (item.id == id) updated else item);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func set_mini_league_status(id : Text, status : Text) : async { #Ok : Types.MiniLeague; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (leagueFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not validLeagueStatus(status)) return #Err("Invalid status");
    switch (requireLeagueAdmin(caller, id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(current)) {
        let updated : Types.MiniLeague = { current with status; updated_at_ms = nowMs() };
        leagues := leagues.map(func(item) = if (item.id == id) updated else item);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public composite query ({ caller }) func get_mini_league(id : Text) : async { #Ok : Types.MiniLeague; #Err : Text } {
    denyLegacyAccountQuery();
    switch (findLeague(id)) {
      case null #Err("Mini-league not found");
      case (?league) { if (not (await this.verify_league_access(caller, league))) #Err("Forbidden") else #Ok(league) };
    }
  };

  public composite query ({ caller }) func list_mini_leagues_by_club(club_id : Text) : async [Types.MiniLeague] {
    denyLegacyAccountQuery();
    await this.filter_visible_leagues(caller, leagues.filter(func(item) = item.club_id == club_id))
  };

  func addNewsRecipient(recipients : [Principal], candidate : ?Principal) : [Principal] {
    switch (candidate) {
      case null { recipients };
      case (?user) {
        if (user.equal(Principal.anonymous()) or recipients.any(func(existing) = existing.equal(user))) recipients
        else recipients.concat([user])
      };
    }
  };

  public composite query ({ caller }) func get_news_audience(mini_league_id : Text, requester : Principal) : async { #Ok : Types.MiniLeagueNewsAudience; #Err : Text } {
    denyLegacyAccountQuery();
    switch (clubDomainCanister) {
      case null { return #Err("club_domain canister not configured") };
      case (?clubDomain) { if (not caller.equal(clubDomain)) return #Err("club_domain only") };
    };
    if (requester.equal(Principal.anonymous())) return #Err("Authenticated requester required");
    switch (findLeague(mini_league_id)) {
      case null { #Err("Mini-league not found") };
      case (?league) {
        // The caller is the configured club_domain canister, which checks the
        // user's club-admin role before asking for this recipient snapshot.
        if (requester.equal(Principal.anonymous())) return #Err("Authenticated requester required");
        var recipients = addNewsRecipient([], ?league.created_by);
        for (admin in admins.values()) {
          if (admin.mini_league_id == mini_league_id) recipients := addNewsRecipient(recipients, ?admin.user_id);
        };
        for (grant in roles.values()) {
          if (grant.club_id == league.club_id and grant.role == "club_admin") recipients := addNewsRecipient(recipients, ?grant.user);
        };
        for (player in players.values()) {
          if (player.mini_league_id == mini_league_id) {
            switch (player.claimed_by) { case (?u) { if (await this.verify_player_access(u, player)) recipients := addNewsRecipient(recipients, ?u) }; case null {} };
            switch (player.child_id) {
              case (?childId) {
                switch (findChild(childId)) {
                  case (?child) {
                    switch (child.parent_user_id) { case (?u) { if (await this.verify_child_guardian(u, childId)) recipients := addNewsRecipient(recipients, ?u) }; case null {} };
                    switch (child.claimed_by) { case (?u) { if (await this.verify_child_guardian(u, childId)) recipients := addNewsRecipient(recipients, ?u) }; case null {} };
                  };
                  case null {};
                };
                for (guardian in guardians.values()) {
                  if (guardian.child_id == childId and (await this.verify_child_guardian(guardian.guardian_user_id, childId))) recipients := addNewsRecipient(recipients, ?guardian.guardian_user_id);
                };
              };
              case null {};
            };
            if (recipients.size() > 500) return #Err("Mini-league news audience exceeds 500 members");
          };
        };
        #Ok({ club_id = league.club_id; recipients })
      };
    }
  };

  // ---- Batched reads (same canViewLeague visibility; capped) ----
  public composite query ({ caller }) func get_mini_leagues(ids : [Text]) : async { #Ok : [Types.MiniLeague]; #Err : Text } {
    denyLegacyAccountQuery();
    if (ids.size() > 300) return #Err("Too many ids");
    #Ok(await this.filter_visible_leagues(caller, leagues.filter(func(item) = ids.any(func(i) = i == item.id))))
  };

  public composite query ({ caller }) func list_mini_leagues_by_clubs(club_ids : [Text]) : async { #Ok : [Types.MiniLeague]; #Err : Text } {
    denyLegacyAccountQuery();
    if (club_ids.size() > 200) return #Err("Too many ids");
    #Ok(await this.filter_visible_leagues(caller, leagues.filter(func(item) = club_ids.any(func(c) = c == item.club_id))))
  };

  // Caller-scoped: leagues the caller administers, belongs to via a club
  // role grant, or has a claimed player in.
  public composite query ({ caller }) func my_leagues() : async [Types.MiniLeague] {
    denyLegacyAccountQuery();
    await this.filter_visible_leagues(caller, leagues)
  };

  // UI permissions use the same authoritative checks as league mutations.
  // This is caller-scoped, not an arbitrary-user permission oracle.
  public composite query ({ caller }) func get_my_league_access(ids : [Text]) : async { #Ok : [{ id : Text; can_manage : Bool; can_delete : Bool; is_club_admin : Bool }]; #Err : Text } {
    denyLegacyAccountQuery();
    if (ids.size() > 200) return #Err("Too many ids");
    #Ok((await this.filter_visible_leagues(caller, leagues.filter(func(l) = ids.any(func(id) = id == l.id)))).map(func(l) = {
      id = l.id; can_manage = isLeagueAdmin(caller, l); can_delete = isLeagueAdmin(caller, l); is_club_admin = isClubAdmin(caller, l.club_id)
    }))
  };

  // Same visibility as list_players; never expose unrelated club members.
  // Parent/guardian links and scoped admins travel in the league snapshot.
  public composite query ({ caller }) func get_league_members(id : Text) : async { #Ok : [{ user_id : Text; is_staff : Bool; is_parent : Bool }]; #Err : Text } {
    denyLegacyAccountQuery();
    let league = switch (findLeague(id)) { case null return #Err("Mini-league not found"); case (?l) l };
    if (not (await this.verify_league_access(caller, league))) return #Err("Forbidden");
    var parentIds : [Text] = [];
    var staffIds : [Text] = [league.created_by.toText()];
    let add = func(ids : [Text], id : Text) : [Text] {
      if (id == "" or ids.any(func(x) = x == id)) ids else ids.concat([id])
    };
    for (p in players.values()) {
      if (p.mini_league_id == id) {
        switch (p.parent_user_id) { case (?u) { let user = Principal.fromText(u); if (await this.verify_player_access(user, p)) parentIds := add(parentIds, u) }; case null {} };
        switch (p.claimed_by) { case (?u) { if (await this.verify_player_access(u, p)) parentIds := add(parentIds, u.toText()) }; case null {} };
        switch (p.child_id) {
          case (?child) {
            for (g in guardians.values()) { if (g.child_id == child and (await this.verify_child_guardian(g.guardian_user_id, child))) parentIds := add(parentIds, g.guardian_user_id.toText()) };
          };
          case null {};
        };
        if (parentIds.size() > 500) return #Err("League member list exceeds 500");
      };
    };
    for (a in admins.values()) { if (a.mini_league_id == id) staffIds := add(staffIds, a.user_id.toText()) };
    for (r in roles.values()) { if (r.club_id == league.club_id and (r.role == "league_admin" or r.role == "club_admin") and r.team_id == null) staffIds := add(staffIds, r.user.toText()) };
    var all = parentIds;
    for (u in staffIds.values()) { all := add(all, u) };
    if (all.size() > 500) return #Err("League member list exceeds 500");
    #Ok(all.map(func(u) = { user_id = u; is_staff = staffIds.any(func(x) = x == u); is_parent = parentIds.any(func(x) = x == u) }))
  };

  // The configured event authority asks for opaque RSVP subjects only.
  // Every player/guardian is revalidated through the consensus authority.
  public shared ({ caller }) func read_event_notification_subjects(league_id : Text, club_id : Text) : async { #Ok : [{ user : Text; child : ?Text }]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (eventsDomainCanister != ?caller) return #Err("Events authority required");
    let league = findLeague(league_id) ?? return #Err("Mini-league not found");
    if (league.club_id != club_id or leagueFenced(league_id)) return #Err("League scope mismatch or locked");
    let initialPlayers = players.filter(func(p) = p.mini_league_id == league_id);
    let initialGuardians = guardians;
    var out : [{ user : Text; child : ?Text }] = [];
    for (player in initialPlayers.values()) {
      var users : [Principal] = switch (player.claimed_by) { case (?p) [p]; case null [] };
      switch (player.parent_user_id) { case (?id) { let p = try { Principal.fromText(id) } catch (_) { return #Err("Invalid league parent") }; if (not users.any(func(u) = u == p)) users := users.concat([p]) }; case null {} };
      switch (player.child_id) {
        case null {};
        case (?child) {
          for (g in initialGuardians.values()) if (g.child_id == child and not users.any(func(u) = u == g.guardian_user_id)) users := users.concat([g.guardian_user_id]);
        }
      };
      for (user in users.values()) {
        if (not removalReceiver.enter(user)) return #Err("League parent fenced");
        try {
          await admitAccount(user);
          let allowed = await* playerAccessWrite(user, player);
          if (allowed and not removalReceiver.denied(user)) {
            let subject = { user = user.toText(); child = player.child_id };
            if (not out.any(func(s) = s == subject)) out := out.concat([subject]);
          }
        } finally { removalReceiver.leave(user) };
      };
      if (out.size() > 500) return #Err("League audience exceeds 500");
    };
    // Local explicit league administration is authority; club role candidates
    // must be refreshed through the club service before any staff subject is added.
    let initialAdmins = admins;
    var staff : [Principal] = [league.created_by];
    for (a in initialAdmins.values()) if (a.mini_league_id == league_id and not staff.any(func(u) = u == a.user_id)) staff := staff.concat([a.user_id]);
    for (r in roles.values()) if (r.club_id == club_id and (r.role == "league_admin" or r.role == "club_admin" or r.role == "coach") and not staff.any(func(u) = u == r.user)) staff := staff.concat([r.user]);
    for (user in staff.values()) {
      if (not removalReceiver.enter(user)) return #Err("League staff fenced");
      try {
        await admitAccount(user);
        let explicit = user == league.created_by or initialAdmins.any(func(a) = a.mini_league_id == league_id and a.user_id == user);
        let authority = clubDomainCanister ?? return #Err("Club authority unavailable");
        let cd : actor { read_account_list_user_club_roles : shared (Principal, Text) -> async [(Text, ?Text)] } = actor(authority.toText());
        let fresh = try { await (with timeout = 10) cd.read_account_list_user_club_roles(user, club_id) } catch (_) { return #Err("League staff unavailable") };
        if (clubDomainCanister != ?authority) return #Err("Club authority changed");
        if ((explicit or fresh.any(func((role, _)) = role == "club_admin" or role == "league_admin" or role == "coach")) and not removalReceiver.denied(user)) {
          let subject = { user = user.toText(); child = null };
          if (not out.any(func(s) = s == subject)) out := out.concat([subject]);
        };
      } finally { removalReceiver.leave(user) };
      if (out.size() > 500) return #Err("League audience exceeds 500");
    };
    if (admins != initialAdmins) return #Err("League staff changed");
    if (eventsDomainCanister != ?caller or findLeague(league_id) != ?league or players.filter(func(p) = p.mini_league_id == league_id) != initialPlayers or guardians != initialGuardians or leagueFenced(league_id)) return #Err("League audience changed");
    #Ok(out)
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Public: unauthenticated directory listing for the home page "browse
  // mini-leagues" picker. No PII (created_by/admin lists excluded) — just
  // enough to resolve a name/club for active leagues.
  public query func list_public_mini_leagues() : async [Types.PublicMiniLeagueSummary] {
    leagues.filter(func(item) = item.status == "active").map(func(item) = { id = item.id; name = item.name; club_id = item.club_id })
  };

  // ---------------- Sessions ----------------

  public shared ({ caller }) func create_session(mini_league_id : Text, session_date : Text, start_time : Text, end_time : ?Text, location_name : ?Text, address : ?Text, postcode : ?Text, team_size_override : ?Nat16) : async { #Ok : Types.MiniLeagueSession; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (leagueFenced(mini_league_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        if (not valid(session_date) or not valid(start_time) or not validOpt(end_time, 32) or not validOpt(location_name, 256) or not validOpt(address, 256) or not validOpt(postcode, 32)) return #Err("Invalid session");
        let now = nowMs();
        let created : Types.MiniLeagueSession = {
          id = nextId("mls-" # mini_league_id, sessions.size()); mini_league_id; session_date; start_time; end_time;
          location_name; address; postcode; team_size_override; status = "scheduled"; linked_event_id = null;
          created_by = caller; created_at_ms = now; updated_at_ms = now;
        };
        sessions := sessions.concat([created]);
        #Ok(created)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func update_session(id : Text, session_date : Text, start_time : Text, end_time : ?Text, location_name : ?Text, address : ?Text, postcode : ?Text, team_size_override : ?Nat16) : async { #Ok : Types.MiniLeagueSession; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (sessionFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireSessionAdmin(caller, id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(current)) {
        if (not valid(session_date) or not valid(start_time) or not validOpt(end_time, 32) or not validOpt(location_name, 256) or not validOpt(address, 256) or not validOpt(postcode, 32)) return #Err("Invalid session update");
        let updated : Types.MiniLeagueSession = { current with session_date; start_time; end_time; location_name; address; postcode; team_size_override; updated_at_ms = nowMs() };
        sessions := sessions.map(func(item) = if (item.id == id) updated else item);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Cancellation kept separate from update_session, mirroring
  // set_event_cancelled, so cancelling cannot clobber other fields.
  public shared ({ caller }) func cancel_session(id : Text) : async { #Ok : Types.MiniLeagueSession; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (sessionFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireSessionAdmin(caller, id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(current)) {
        let updated : Types.MiniLeagueSession = { current with status = "cancelled"; updated_at_ms = nowMs() };
        sessions := sessions.map(func(item) = if (item.id == id) updated else item);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func set_session_status(id : Text, status : Text) : async { #Ok : Types.MiniLeagueSession; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (sessionFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not validSessionStatus(status)) return #Err("Invalid status");
    switch (requireSessionAdmin(caller, id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(current)) {
        let updated : Types.MiniLeagueSession = { current with status; updated_at_ms = nowMs() };
        sessions := sessions.map(func(item) = if (item.id == id) updated else item);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public composite query ({ caller }) func list_sessions(mini_league_id : Text) : async { #Ok : [Types.MiniLeagueSession]; #Err : Text } {
    denyLegacyAccountQuery();
    switch (findLeague(mini_league_id)) {
      case null #Err("Mini-league not found");
      case (?league) {
        if (not (await this.verify_league_access(caller, league))) return #Err("Forbidden");
        #Ok(sessions.filter(func(item) = item.mini_league_id == mini_league_id))
      };
    }
  };

  // ---------------- Players ----------------

  public shared ({ caller }) func add_player(mini_league_id : Text, name : Text, child_id : ?Text, parent_user_id : ?Text, ability_rating : ?Nat16, notes : ?Text) : async { #Ok : Types.MiniLeaguePlayer; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (leagueFenced(mini_league_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        if (not valid(name) or not validOpt(child_id, 128) or not validOpt(parent_user_id, 128) or not validOpt(notes, 2000)) return #Err("Invalid player");
        let now = nowMs();
        let created : Types.MiniLeaguePlayer = {
          id = nextId("mlp-" # mini_league_id, players.size()); mini_league_id; name; child_id; parent_user_id;
          claimed_by = null; ability_rating; notes; created_at_ms = now; updated_at_ms = now;
        };
        players := players.concat([created]);
        // Mirrors the Supabase `children` upsert: ensure a child record
        // exists for the pending-status lookup / delete cascade below.
        switch (child_id) {
          case (?cid) {
            if (findChild(cid) == null) {
              children := children.concat([{ id = cid; parent_user_id = null; claimed_by = null; created_at_ms = now; updated_at_ms = now }]);
            };
          };
          case null {};
        };
        #Ok(created)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func update_player(id : Text, name : Text, ability_rating : ?Nat16, notes : ?Text) : async { #Ok : Types.MiniLeaguePlayer; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (playerFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (findPlayer(id)) {
      case null #Err("Player not found");
      case (?current) {
        switch (requireLeagueAdmin(caller, current.mini_league_id)) {
          case (#Err(e)) #Err(e);
          case (#Ok(_)) {
            if (not valid(name) or not validOpt(notes, 2000)) return #Err("Invalid player update");
            let updated : Types.MiniLeaguePlayer = { current with name; ability_rating; notes; updated_at_ms = nowMs() };
            players := players.map(func(item) = if (item.id == id) updated else item);
            #Ok(updated)
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func remove_player(id : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (playerFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (findPlayer(id)) {
      case null #Err("Player not found");
      case (?current) {
        switch (requireLeagueAdmin(caller, current.mini_league_id)) {
          case (#Err(e)) #Err(e);
          case (#Ok(_)) {
            players := players.filter(func(item) = item.id != id);
            groupPlayers := groupPlayers.filter(func(item) = item.player_id != id);
            duties := duties.map(func(item) = if (item.assigned_to == ?id) { { item with assigned_to = null } } else item);
            availability := availability.filter(func(item) = item.player_id != id);
            // Mirrors the Supabase delete cascade: once no other player row
            // (in any league) still references this child, the child record
            // and its guardian links are removed too (ManagePlayersDialog
            // ~lines 392-449).
            switch (current.child_id) {
              case (?cid) {
                if (not players.any(func(item) = item.child_id == ?cid)) {
                  children := children.filter(func(item) = item.id != cid);
                  guardians := guardians.filter(func(item) = item.child_id != cid);
                };
              };
              case null {};
            };
            #Ok
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public composite query ({ caller }) func list_players(mini_league_id : Text) : async { #Ok : [Types.MiniLeaguePlayer]; #Err : Text } {
    denyLegacyAccountQuery();
    switch (findLeague(mini_league_id)) {
      case null #Err("Mini-league not found");
      case (?league) {
        if (not (await this.verify_league_access(caller, league))) return #Err("Forbidden");
        #Ok(players.filter(func(item) = item.mini_league_id == mini_league_id))
      };
    }
  };

  // ---------------- Children / guardians ----------------
  //
  // Mirrors the slice of Supabase `children` + `child_guardians` consumed by
  // ManagePlayersDialog's pending-status lookup: a child is "pending" when
  // nobody (parent or guardian) is linked to it yet.

  // League-admin gate shared by the guardian-link/status helpers below:
  // true when the caller administers at least one league containing a
  // player linked to this child.
  func isChildLeagueAdmin(caller : Principal, child_id : Text) : Bool {
    players.any(func(p) = p.child_id == ?child_id and (switch (findLeague(p.mini_league_id)) { case (?league) isLeagueAdmin(caller, league); case null false }))
  };

  // Links a guardian (second parent) to a child for pending-status purposes.
  // Mirrors the `child_guardians` insert AddSecondParentDialog performs on
  // the Supabase branch; idempotent on (child_id, guardian_user_id).
  public shared ({ caller }) func link_mini_league_guardian(child_id : Text, guardian_user_id : Principal) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (not removalReceiver.enter(guardian_user_id)) return #Err("Guardian fenced");
    try {
    await admitAccount(guardian_user_id);
    auth(caller);
    if (not valid(child_id)) return #Err("Invalid child");
    if (guardian_user_id.equal(Principal.anonymous())) return #Err("Invalid guardian principal");
    if (not isChildLeagueAdmin(caller, child_id)) return #Err("Mini-league admin required");
    if (not (do { let removalReply = await* currentGuardianWrite(guardian_user_id, child_id); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Verified child guardian required");
    if (removalReceiver.denied(guardian_user_id)) return #Err("Guardian fenced after callback");
    if (not isChildLeagueAdmin(caller, child_id) or players.any(func(p) = p.child_id == ?child_id and leagueFenced(p.mini_league_id))) return #Err("Child authority changed");
    if (findChild(child_id) == null) {
      children := children.concat([{ id = child_id; parent_user_id = null; claimed_by = null; created_at_ms = nowMs(); updated_at_ms = nowMs() }]);
    };
    if (not guardians.any(func(item) = item.child_id == child_id and item.guardian_user_id.equal(guardian_user_id))) {
      guardians := guardians.concat([{ child_id; guardian_user_id; created_at_ms = nowMs() }]);
    };
    #Ok
  
    } finally { removalReceiver.leave(guardian_user_id) };
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Matches exactly what ManagePlayersDialog computes client-side from
  // Supabase: pending when the player has no parent_user_id AND (no linked
  // child OR the child has no parent_id AND no child_guardians rows).
  public composite query ({ caller }) func get_player_guardian_status(player_id : Text) : async { #Ok : Types.PlayerGuardianStatus; #Err : Text } {
    denyLegacyAccountQuery();
    switch (findPlayer(player_id)) {
      case null #Err("Player not found");
      case (?player) {
        switch (findLeague(player.mini_league_id)) {
          case null #Err("Mini-league not found");
          case (?league) {
            if (not isLeagueAdmin(caller, league) and not (await this.verify_player_access(caller, player))) return #Err("Forbidden");
            var guardianCount : Nat = 0;
            var parentLinked = false;
            switch (player.child_id) {
              case null { parentLinked := player.parent_user_id != null or player.claimed_by != null };
              case (?cid) {
                var candidates : [Principal] = [];
                switch (player.claimed_by) { case (?u) candidates := candidates.concat([u]); case null {} };
                switch (player.parent_user_id) { case (?u) candidates := candidates.concat([Principal.fromText(u)]); case null {} };
                for (g in guardians.values()) if (g.child_id == cid and not candidates.any(func(u) = u == g.guardian_user_id)) candidates := candidates.concat([g.guardian_user_id]);
                for (u in candidates.values()) if (await this.verify_child_guardian(u, cid)) { guardianCount += 1; parentLinked := true };
              };
            };
            let pending = not parentLinked and guardianCount == 0;
            #Ok({ parent_linked = parentLinked; guardian_count = guardianCount; pending })
          };
        }
      };
    }
  };

  // ---------------- Invites ----------------

  // Creates a join-link invite token, standing in for the Supabase generic
  // invites table rows the join-link cards create. Optionally pre-binds a
  // player row (second-parent invites); otherwise a new player is created on
  // claim (primary parent join-link flow).
  public shared ({ caller }) func create_invite(mini_league_id : Text, player_id : ?Text, label_text : ?Text) : async { #Ok : Types.MiniLeagueInvite; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (leagueFenced(mini_league_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    let leagueForAuth = findLeague(mini_league_id) ?? return #Err("Mini-league not found");
    ignore await* currentClubAdmin(caller, leagueForAuth.club_id);
    if (leagueFenced(mini_league_id)) return #Err("Club is temporarily locked for a transfer");
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        switch (player_id) {
          case (?pid) { switch (findPlayer(pid)) { case null return #Err("Player not found"); case (?p) { if (p.mini_league_id != mini_league_id) return #Err("Player belongs to another league"); if (p.claimed_by != null or p.parent_user_id != null) return #Err("Player already linked") } } };
          case null {};
        };
        if (not validOpt(label_text, 256)) return #Err("Invalid invite");
        let created : Types.MiniLeagueInvite = {
          token = do { let removalReply = await randomToken("mli"); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }; mini_league_id; player_id; label_text;
          status = "pending"; claimed_by = null; created_by = caller; created_at_ms = nowMs(); claimed_at_ms = null;
        };
        if (leagueFenced(mini_league_id)) return #Err("Club is temporarily locked for a transfer");
        switch (requireLeagueAdmin(caller, mini_league_id)) { case (#Err(e)) return #Err(e); case (#Ok(_)) {} };
        switch (player_id) { case (?pid) { switch (findPlayer(pid)) { case null return #Err("Player not found"); case (?p) { if (p.mini_league_id != mini_league_id or p.claimed_by != null or p.parent_user_id != null) return #Err("Player no longer eligible") } } }; case null {} };
        invites := invites.concat([created]);
        #Ok(created)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Mirrors claim_mini_league_invite(_token): binds the caller as the
  // claimant of the invite's player (creating one named after the caller's
  // player_name when the invite has no pre-bound player), and returns the
  // (mini_league_id, club_id, player_id) triple like the Postgres function.
  public shared ({ caller }) func claim_invite(token : Text, player_name : Text) : async { #Ok : Types.ClaimedInvite; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (invites.find(func(item) = item.token == token)) {
      case null #Err("Invite not found");
      case (?invite) {
        if (leagueFenced(invite.mini_league_id)) return #Err("Club is temporarily locked for a transfer");
        let issuerLeague = findLeague(invite.mini_league_id) ?? return #Err("Mini-league not found");
        ignore await* currentClubAdmin(invite.created_by, issuerLeague.club_id);
        let currentInvite = invites.find(func i = i.token == token) ?? return #Err("Invite not found");
        if (currentInvite.status != invite.status or currentInvite.claimed_by != invite.claimed_by or removalReceiver.denied(invite.created_by) or not isLeagueAdmin(invite.created_by, issuerLeague) or leagueFenced(invite.mini_league_id) or removalReceiver.denied(caller)) return #Err("Invite authorization changed");
        if (invite.status != "pending") {
          if (invite.claimed_by == ?caller) switch (invite.player_id, findLeague(invite.mini_league_id)) { case (?pid, ?league) return #Ok({ mini_league_id = league.id; club_id = league.club_id; player_id = pid }); case _ {} };
          return #Err("Invite already claimed")
        };
        switch (findLeague(invite.mini_league_id)) {
          case null #Err("Mini-league not found");
          case (?league) {
            let playerId = switch (invite.player_id) {
              case (?pid) {
                switch (findPlayer(pid)) {
                  case null return #Err("Player not found");
                  case (?player) {
                    if (player.mini_league_id != invite.mini_league_id) return #Err("Player belongs to another league");
                    if (player.claimed_by != null or player.parent_user_id != null) return #Err("Player already linked");
                    players := players.map(func(item) = if (item.id == pid) { { item with claimed_by = ?caller; updated_at_ms = nowMs() } } else item);
                    pid
                  };
                }
              };
              case null {
                if (not valid(player_name)) return #Err("Invalid player name");
                let now = nowMs();
                let created : Types.MiniLeaguePlayer = {
                  id = nextId("mlp-" # invite.mini_league_id, players.size()); mini_league_id = invite.mini_league_id;
                  name = player_name; child_id = null; parent_user_id = null; claimed_by = ?caller;
                  ability_rating = null; notes = null; created_at_ms = now; updated_at_ms = now;
                };
                players := players.concat([created]);
                created.id
              };
            };
            invites := invites.map(func(item) = if (item.token == token) { { item with status = "claimed"; player_id = ?playerId; claimed_by = ?caller; claimed_at_ms = ?nowMs() } } else item);
            #Ok({ mini_league_id = league.id; club_id = league.club_id; player_id = playerId })
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Bearer preview contains no parent/email/child identifier. Claim binds caller atomically.
  public query func get_player_invite_preview(token : Text) : async { #Ok : ?{ token : Text; mini_league_id : Text; club_id : Text; league_name : Text; player_name : ?Text; status : Text }; #Err : Text } {
    let invite = switch (invites.find(func(i) = i.token == token)) { case null return #Ok(null); case (?i) i };
    let league = switch (findLeague(invite.mini_league_id)) { case null return #Ok(null); case (?l) l };
    let name : ?Text = null;
    #Ok(?{ token; mini_league_id = league.id; club_id = league.club_id; league_name = league.name; player_name = name; status = invite.status })
  };

  public query ({ caller }) func list_invites(mini_league_id : Text) : async { #Ok : [Types.MiniLeagueInvite]; #Err : Text } {
    denyLegacyAccountQuery();
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) #Ok(invites.filter(func(item) = item.mini_league_id == mini_league_id));
    }
  };

  // ---------------- Groups ----------------

  public shared ({ caller }) func create_group(session_id : Text, name : Text, ability_band : ?Text, display_order : Nat16, target_size : Nat16, pitch_name : ?Text) : async { #Ok : Types.MiniLeagueGroup; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (sessionFenced(session_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireSessionAdmin(caller, session_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        if (not valid(name) or not validOpt(ability_band, 64) or not validOpt(pitch_name, 128)) return #Err("Invalid group");
        let now = nowMs();
        let created : Types.MiniLeagueGroup = {
          id = nextId("mlgr-" # session_id, groups.size()); session_id; name; ability_band; display_order; target_size;
          pitch_name; linked_event_id = null; created_at_ms = now; updated_at_ms = now;
        };
        groups := groups.concat([created]);
        #Ok(created)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func update_group(id : Text, name : Text, ability_band : ?Text, display_order : Nat16, target_size : Nat16, pitch_name : ?Text) : async { #Ok : Types.MiniLeagueGroup; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (groupFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireGroupAdmin(caller, id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(current)) {
        if (not valid(name) or not validOpt(ability_band, 64) or not validOpt(pitch_name, 128)) return #Err("Invalid group update");
        let updated : Types.MiniLeagueGroup = { current with name; ability_band; display_order; target_size; pitch_name; updated_at_ms = nowMs() };
        groups := groups.map(func(item) = if (item.id == id) updated else item);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func assign_player_to_group(group_id : Text, player_id : Text, jersey_number : ?Nat16) : async { #Ok : Types.MiniLeagueGroupPlayer; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (groupFenced(group_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireGroupAdmin(caller, group_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        if (findPlayer(player_id) == null) return #Err("Player not found");
        let value : Types.MiniLeagueGroupPlayer = { group_id; player_id; jersey_number; created_at_ms = nowMs() };
        groupPlayers := groupPlayers.filter(func(item) = not (item.group_id == group_id and item.player_id == player_id));
        groupPlayers := groupPlayers.concat([value]);
        #Ok(value)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func unassign_player_from_group(group_id : Text, player_id : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (groupFenced(group_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireGroupAdmin(caller, group_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        groupPlayers := groupPlayers.filter(func(item) = not (item.group_id == group_id and item.player_id == player_id));
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public composite query ({ caller }) func list_group_players(group_id : Text) : async { #Ok : [Types.MiniLeagueGroupPlayer]; #Err : Text } {
    denyLegacyAccountQuery();
    switch (findGroup(group_id)) {
      case null #Err("Group not found");
      case (?group) {
        switch (groupLeagueId(group)) {
          case null #Err("Session not found");
          case (?leagueId) {
            switch (findLeague(leagueId)) {
              case null #Err("Mini-league not found");
              case (?league) {
                if (not (await this.verify_league_access(caller, league))) return #Err("Forbidden");
                #Ok(groupPlayers.filter(func(item) = item.group_id == group_id))
              };
            }
          };
        }
      };
    }
  };

  public composite query ({ caller }) func list_groups(session_id : Text) : async { #Ok : [Types.MiniLeagueGroup]; #Err : Text } {
    denyLegacyAccountQuery();
    switch (findSession(session_id)) {
      case null #Err("Session not found");
      case (?session) {
        switch (findLeague(session.mini_league_id)) {
          case null #Err("Mini-league not found");
          case (?league) {
            if (not (await this.verify_league_access(caller, league))) return #Err("Forbidden");
            #Ok(groups.filter(func(item) = item.session_id == session_id))
          };
        }
      };
    }
  };

  // ---------------- Group duties ----------------

  public shared ({ caller }) func create_duty(group_id : Text, name : Text, points : ?Nat16) : async { #Ok : Types.MiniLeagueGroupDuty; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (groupFenced(group_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireGroupAdmin(caller, group_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        if (not valid(name)) return #Err("Invalid duty");
        let now = nowMs();
        let created : Types.MiniLeagueGroupDuty = {
          id = nextId("mld-" # group_id, duties.size()); group_id; name; assigned_to = null; status = "open";
          completed = false; points; points_awarded = false; created_at_ms = now; updated_at_ms = now;
        };
        duties := duties.concat([created]);
        #Ok(created)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Any player-linked caller (the claimed parent) or a league admin can
  // claim an open duty for a player — mirrors the member-facing duty claim
  // flow in EventDutiesSection/MatchDutiesDialog.
  public shared ({ caller }) func claim_duty(id : Text, player_id : Text) : async { #Ok : Types.MiniLeagueGroupDuty; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (dutyFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (duties.find(func(item) = item.id == id)) {
      case null #Err("Duty not found");
      case (?current) {
        switch (findGroup(current.group_id)) {
          case null #Err("Group not found");
          case (?group) {
            switch (groupLeagueId(group)) {
              case null #Err("Session not found");
              case (?leagueId) {
                switch (findLeague(leagueId)) {
                  case null #Err("Mini-league not found");
                  case (?league) {
                    let player = findPlayer(player_id);
                    let isPlayerClaimant = switch (player) { case (?p) p.mini_league_id == league.id and (do { let removalReply = await* playerAccessWrite(caller, p); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }); case null false };
                    if (not (isLeagueAdmin(caller, league) or isPlayerClaimant)) return #Err("Forbidden");
                    if (player == null or player != findPlayer(player_id) or (switch (player) { case (?p) p.mini_league_id != league.id; case null true })) return #Err("Player authority changed");
                    if (leagueFenced(league.id)) return #Err("Club is temporarily locked for a transfer");
                    if (findLeague(league.id) != ?league or duties.find(func(d) = d.id == id) != ?current) return #Err("Duty authority changed");
                    let updated : Types.MiniLeagueGroupDuty = { current with assigned_to = ?player_id; status = "claimed"; updated_at_ms = nowMs() };
                    duties := duties.map(func(item) = if (item.id == id) updated else item);
                    #Ok(updated)
                  };
                }
              };
            }
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func complete_duty(id : Text, points_awarded : Bool) : async { #Ok : Types.MiniLeagueGroupDuty; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (dutyFenced(id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (duties.find(func(item) = item.id == id)) {
      case null #Err("Duty not found");
      case (?current) {
        switch (requireGroupAdmin(caller, current.group_id)) {
          case (#Err(e)) #Err(e);
          case (#Ok(_)) {
            let updated : Types.MiniLeagueGroupDuty = { current with status = "completed"; completed = true; points_awarded; updated_at_ms = nowMs() };
            duties := duties.map(func(item) = if (item.id == id) updated else item);
            #Ok(updated)
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public composite query ({ caller }) func list_duties(group_id : Text) : async { #Ok : [Types.MiniLeagueGroupDuty]; #Err : Text } {
    denyLegacyAccountQuery();
    switch (findGroup(group_id)) {
      case null #Err("Group not found");
      case (?group) {
        switch (groupLeagueId(group)) {
          case null #Err("Session not found");
          case (?leagueId) {
            switch (findLeague(leagueId)) {
              case null #Err("Mini-league not found");
              case (?league) {
                if (not (await this.verify_league_access(caller, league))) return #Err("Forbidden");
                #Ok(duties.filter(func(item) = item.group_id == group_id))
              };
            }
          };
        }
      };
    }
  };

  // ---------------- Session availability ----------------

  // Setting availability trusts either a league admin (marking on behalf of
  // a player) or the claimed parent of that player, mirroring the
  // events_domain set_rsvp guard shape.
  public shared ({ caller }) func set_availability(session_id : Text, player_id : Text, status : Text) : async { #Ok : Types.MiniLeagueSessionAvailability; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (sessionFenced(session_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not validAvailabilityStatus(status)) return #Err("Invalid availability status");
    switch (findSession(session_id)) {
      case null #Err("Session not found");
      case (?session) {
        switch (findLeague(session.mini_league_id)) {
          case null #Err("Mini-league not found");
          case (?league) {
            let player = findPlayer(player_id);
            let isPlayerClaimant = switch (player) { case (?p) p.mini_league_id == league.id and (do { let removalReply = await* playerAccessWrite(caller, p); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }); case null false };
            if (not (isLeagueAdmin(caller, league) or isPlayerClaimant)) return #Err("Forbidden");
            if (player == null or player != findPlayer(player_id) or (switch (player) { case (?p) p.mini_league_id != league.id; case null true })) return #Err("Player authority changed");
                    if (leagueFenced(league.id)) return #Err("Club is temporarily locked for a transfer");
            if (findLeague(league.id) != ?league or findSession(session_id) != ?session) return #Err("Session authority changed");
            let now = nowMs();
            let existing = availability.find(func(item) = item.session_id == session_id and item.player_id == player_id);
            let value : Types.MiniLeagueSessionAvailability = {
              id = switch (existing) { case (?current) current.id; case null nextId("mla-" # session_id, availability.size()) };
              session_id; player_id; status; marked_by = ?caller;
              created_at_ms = switch (existing) { case (?current) current.created_at_ms; case null now };
              updated_at_ms = now;
            };
            availability := availability.filter(func(item) = not (item.session_id == session_id and item.player_id == player_id));
            availability := availability.concat([value]);
            #Ok(value)
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public composite query ({ caller }) func get_availability(session_id : Text, player_id : Text) : async { #Ok : ?Types.MiniLeagueSessionAvailability; #Err : Text } {
    denyLegacyAccountQuery();
    switch (findSession(session_id)) {
      case null #Err("Session not found");
      case (?session) {
        switch (findLeague(session.mini_league_id)) {
          case null #Err("Mini-league not found");
          case (?league) {
            if (not (await this.verify_league_access(caller, league))) return #Err("Forbidden");
            #Ok(availability.find(func(item) = item.session_id == session_id and item.player_id == player_id))
          };
        }
      };
    }
  };

  public composite query ({ caller }) func list_session_availability(session_id : Text) : async { #Ok : [Types.MiniLeagueSessionAvailability]; #Err : Text } {
    denyLegacyAccountQuery();
    switch (findSession(session_id)) {
      case null #Err("Session not found");
      case (?session) {
        switch (findLeague(session.mini_league_id)) {
          case null #Err("Mini-league not found");
          case (?league) {
            if (not (await this.verify_league_access(caller, league))) return #Err("Forbidden");
            #Ok(availability.filter(func(item) = item.session_id == session_id))
          };
        }
      };
    }
  };

  // Caller-scoped: availability rows for players the caller has claimed.
  public composite query ({ caller }) func my_availability() : async [Types.MiniLeagueSessionAvailability] {
    denyLegacyAccountQuery();
    var myPlayerIds : [Text] = [];
    for (p in players.values()) if (await this.verify_player_access(caller, p)) myPlayerIds := myPlayerIds.concat([p.id]);
    availability.filter(func(item) = myPlayerIds.any(func(pid) = pid == item.player_id))
  };

  // ---------------- Admins ----------------

  public shared ({ caller }) func add_admin(mini_league_id : Text, user_id : Principal) : async { #Ok : Types.MiniLeagueAdmin; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (leagueFenced(mini_league_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        if (user_id.equal(Principal.anonymous())) return #Err("Invalid admin principal");
        if (admins.any(func(item) = item.mini_league_id == mini_league_id and item.user_id.equal(user_id))) return #Err("Already an admin");
        let created : Types.MiniLeagueAdmin = { id = nextId("mlad-" # mini_league_id, admins.size()); mini_league_id; user_id; granted_by = ?caller; created_at_ms = nowMs() };
        admins := admins.concat([created]);
        #Ok(created)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func remove_admin(mini_league_id : Text, user_id : Principal) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (leagueFenced(mini_league_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        admins := admins.filter(func(item) = not (item.mini_league_id == mini_league_id and item.user_id.equal(user_id)));
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public query ({ caller }) func list_admins(mini_league_id : Text) : async { #Ok : [Types.MiniLeagueAdmin]; #Err : Text } {
    denyLegacyAccountQuery();
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) #Ok(admins.filter(func(item) = item.mini_league_id == mini_league_id));
    }
  };

  // ---------------- Join links ----------------

  // Join links are scoped per (league, role): a league can hold one active
  // player link and one active admin link at the same time.
  func validJoinLinkRole(value : Text) : Bool { value == "player" or value == "admin" };

  public shared ({ caller }) func create_mini_league_join_link(mini_league_id : Text, role : Text) : async { #Ok : Types.MiniLeagueJoinLink; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (leagueFenced(mini_league_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    let leagueForAuth = findLeague(mini_league_id) ?? return #Err("Mini-league not found");
    ignore await* currentClubAdmin(caller, leagueForAuth.club_id);
    if (leagueFenced(mini_league_id)) return #Err("Club is temporarily locked for a transfer");
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        if (not validJoinLinkRole(role)) return #Err("Invalid join link role");
        if (joinLinks.any(func(item) = item.mini_league_id == mini_league_id and item.role == role and not item.revoked)) return #Err("Active join link already exists");
        let link : Types.MiniLeagueJoinLink = {
          mini_league_id;
          token = do { let removalReply = await randomToken("mljl"); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
          role;
          revoked = false;
          created_by = caller;
          created_at_ms = nowMs();
          revision = 1;
        };
        switch (requireLeagueAdmin(caller, mini_league_id)) { case (#Err(e)) return #Err(e); case _ {} };
        if (leagueFenced(mini_league_id) or joinLinks.any(func l = l.mini_league_id == mini_league_id and l.role == role and not l.revoked)) return #Err("Join link changed");
        joinLinks := joinLinks.concat([link]);
        #Ok(link)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func rotate_mini_league_join_link(mini_league_id : Text, role : Text) : async { #Ok : Types.MiniLeagueJoinLink; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (leagueFenced(mini_league_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    let leagueForAuth = findLeague(mini_league_id) ?? return #Err("Mini-league not found");
    ignore await* currentClubAdmin(caller, leagueForAuth.club_id);
    if (leagueFenced(mini_league_id)) return #Err("Club is temporarily locked for a transfer");
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        if (not validJoinLinkRole(role)) return #Err("Invalid join link role");
        switch (joinLinks.find(func(item) = item.mini_league_id == mini_league_id and item.role == role and not item.revoked)) {
          case null #Err("No active join link");
          case (?current) {
            let rotated : Types.MiniLeagueJoinLink = { current with token = do { let removalReply = await randomToken("mljl"); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }; revision = current.revision + 1 };
            let latest = joinLinks.find(func l = l.token == current.token and not l.revoked) ?? return #Err("Join link changed");
            switch (requireLeagueAdmin(caller, mini_league_id)) { case (#Err(e)) return #Err(e); case _ {} };
            if (latest.revision != current.revision or leagueFenced(mini_league_id)) return #Err("Join link changed");
            joinLinks := joinLinks.map(func(item) = if (item.mini_league_id == mini_league_id and item.role == role and not item.revoked) rotated else item);
            #Ok(rotated)
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func revoke_mini_league_join_link(mini_league_id : Text, role : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (leagueFenced(mini_league_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        if (not validJoinLinkRole(role)) return #Err("Invalid join link role");
        joinLinks := joinLinks.map(func(item) = if (item.mini_league_id == mini_league_id and item.role == role and not item.revoked) { { item with revoked = true } } else item);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Token lookup for the claim page: the token itself is the capability, so
  // any caller holding it may resolve which league/role it belongs to.
  public query func get_join_link_by_token(token : Text) : async { #Ok : Types.MiniLeagueJoinLink; #Err : Text } {
    switch (joinLinks.find(func(item) = item.token == token and not item.revoked)) {
      case null #Err("Join link not found");
      case (?link) #Ok(link);
    }
  };

  // Claims an admin join link: grants the caller league-admin rights instead
  // of minting a roster player.
  public shared ({ caller }) func claim_admin_join_link(token : Text) : async { #Ok : { mini_league_id : Text; club_id : Text }; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (joinLinks.find(func(item) = item.token == token)) {
      case null #Err("Join link not found");
      case (?link) {
        if (link.revoked) return #Err("Join link revoked");
        let issuerLeague = findLeague(link.mini_league_id) ?? return #Err("Mini-league not found");
        ignore await* currentClubAdmin(link.created_by, issuerLeague.club_id);
        let currentLink = joinLinks.find(func l = l.token == token) ?? return #Err("Join link not found");
        if (currentLink.revoked or currentLink.revision != link.revision or removalReceiver.denied(link.created_by) or not isLeagueAdmin(link.created_by, issuerLeague) or leagueFenced(link.mini_league_id) or removalReceiver.denied(caller)) return #Err("Invite authorization changed");
        if (link.role != "admin") return #Err("Join link is not an admin link");
        switch (findLeague(link.mini_league_id)) {
          case null #Err("Mini-league not found");
          case (?league) {
            if (not admins.any(func(item) = item.mini_league_id == link.mini_league_id and item.user_id.equal(caller))) {
              admins := admins.concat([{ id = nextId("mlad-" # link.mini_league_id, admins.size()); mini_league_id = link.mini_league_id; user_id = caller; granted_by = ?link.created_by; created_at_ms = nowMs() }]);
            };
            #Ok({ mini_league_id = league.id; club_id = league.club_id })
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Mirrors join_competition_by_token but mints a fresh player record,
  // since mini-league join links are not pre-bound to an existing player.
  public shared ({ caller }) func join_mini_league_by_token(token : Text, player_name : Text) : async { #Ok : Types.ClaimedInvite; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    auth(caller);
    switch (joinLinks.find(func(item) = item.token == token)) {
      case null #Err("Join link not found");
      case (?link) {
        if (link.revoked) return #Err("Join link revoked");
        let issuerLeague = findLeague(link.mini_league_id) ?? return #Err("Mini-league not found");
        ignore await* currentClubAdmin(link.created_by, issuerLeague.club_id);
        let currentLink = joinLinks.find(func l = l.token == token) ?? return #Err("Join link not found");
        if (currentLink.revoked or currentLink.revision != link.revision or removalReceiver.denied(link.created_by) or not isLeagueAdmin(link.created_by, issuerLeague) or leagueFenced(link.mini_league_id) or removalReceiver.denied(caller)) return #Err("Invite authorization changed");
        if (link.role == "admin") return #Err("Use claim_admin_join_link for admin links");
        if (not valid(player_name)) return #Err("Invalid player name");
        switch (findLeague(link.mini_league_id)) {
          case null #Err("Mini-league not found");
          case (?league) {
            // Idempotent: a retry after a lost response (or a parent re-adding
            // the same child) returns the existing player instead of minting a
            // duplicate roster row.
            switch (players.find(func(p) = p.mini_league_id == link.mini_league_id and p.claimed_by == ?caller and p.name == player_name)) {
              case (?existing) return #Ok({ mini_league_id = league.id; club_id = league.club_id; player_id = existing.id });
              case null {};
            };
            let now = nowMs();
            let created : Types.MiniLeaguePlayer = {
              id = nextId("mlp-" # link.mini_league_id, players.size()); mini_league_id = link.mini_league_id;
              name = player_name; child_id = null; parent_user_id = null; claimed_by = ?caller;
              ability_rating = null; notes = null; created_at_ms = now; updated_at_ms = now;
            };
            players := players.concat([created]);
            #Ok({ mini_league_id = league.id; club_id = league.club_id; player_id = created.id })
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public query ({ caller }) func list_mini_league_join_links(mini_league_id : Text) : async { #Ok : [Types.MiniLeagueJoinLink]; #Err : Text } {
    denyLegacyAccountQuery();
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) #Ok(joinLinks.filter(func(item) = item.mini_league_id == mini_league_id));
    }
  };

  // ---------------- Delete / duplicate ----------------

  // Deletes a league and every row scoped to it (sessions, players, groups
  // and their players/duties, availability, invites, admins, join links).
  // Mirrors the Supabase mini_leagues delete, which cascades via FK.
  public shared ({ caller }) func delete_mini_league(mini_league_id : Text) : async { #Ok; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (leagueFenced(mini_league_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        let sessionIds = sessions.filter(func(item) = item.mini_league_id == mini_league_id).map(func(item) = item.id);
        let groupIds = groups.filter(func(item) = sessionIds.any(func(sid) = sid == item.session_id)).map(func(item) = item.id);
        let childIdsHere = players.filter(func(item) = item.mini_league_id == mini_league_id and item.child_id != null).map(func(item) = switch (item.child_id) { case (?cid) cid; case null "" });
        leagues := leagues.filter(func(item) = item.id != mini_league_id);
        sessions := sessions.filter(func(item) = item.mini_league_id != mini_league_id);
        players := players.filter(func(item) = item.mini_league_id != mini_league_id);
        invites := invites.filter(func(item) = item.mini_league_id != mini_league_id);
        groups := groups.filter(func(item) = not sessionIds.any(func(sid) = sid == item.session_id));
        groupPlayers := groupPlayers.filter(func(item) = not groupIds.any(func(gid) = gid == item.group_id));
        duties := duties.filter(func(item) = not groupIds.any(func(gid) = gid == item.group_id));
        availability := availability.filter(func(item) = not sessionIds.any(func(sid) = sid == item.session_id));
        admins := admins.filter(func(item) = item.mini_league_id != mini_league_id);
        joinLinks := joinLinks.filter(func(item) = item.mini_league_id != mini_league_id);
        // Same orphan-child cleanup as remove_player, applied per child that
        // was referenced only within the league just deleted.
        let orphanChildIds = childIdsHere.filter(func(cid) = not players.any(func(item) = item.child_id == ?cid));
        children := children.filter(func(item) = not orphanChildIds.any(func(cid) = cid == item.id));
        guardians := guardians.filter(func(item) = not orphanChildIds.any(func(cid) = cid == item.child_id));
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  // Clones a league with its roster (players keep name/rating/notes and any
  // child/parent links, mirroring the Supabase duplicate flow), under a new
  // id. Sessions, groups, duties and availability are not copied — they are
  // per-session state, same as the Supabase duplicateLeagueMutation.
  public shared ({ caller }) func duplicate_mini_league(mini_league_id : Text, new_name : Text) : async { #Ok : Types.MiniLeague; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (leagueFenced(mini_league_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(league)) {
        if (not valid(new_name)) return #Err("Invalid league name");
        let now = nowMs();
        let created : Types.MiniLeague = {
          id = nextId("mlg-" # league.club_id, leagues.size());
          club_id = league.club_id;
          name = new_name;
          description = league.description;
          logo_url = league.logo_url;
          team_size = league.team_size;
          min_players_per_side = league.min_players_per_side;
          minutes_per_half = league.minutes_per_half;
          bib_colors = league.bib_colors;
          show_matches_to_members = league.show_matches_to_members;
          status = "active";
          created_by = caller;
          created_at_ms = now;
          updated_at_ms = now;
        };
        leagues := leagues.concat([created]);
        let clonedPlayers = players.filter(func(item) = item.mini_league_id == mini_league_id).map(func(item) : Types.MiniLeaguePlayer {
          {
            id = nextId("mlp-" # created.id, players.size());
            mini_league_id = created.id;
            name = item.name;
            child_id = item.child_id;
            parent_user_id = item.parent_user_id;
            claimed_by = item.claimed_by;
            ability_rating = item.ability_rating;
            notes = item.notes;
            created_at_ms = now;
            updated_at_ms = now;
          }
        });
        players := players.concat(clonedPlayers);
        #Ok(created)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
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

    let oldText = Principal.toText(old);
    let newText = Principal.toText(new);
    let oldTextPrefixed = "principal:" # oldText;
    let newTextPrefixed = "principal:" # newText;

    var conflicts = 0;
    conflicts += roles.filter(func(item) = item.user.equal(new)).size();
    conflicts += leagues.filter(func(item) = item.created_by.equal(new)).size();
    conflicts += sessions.filter(func(item) = item.created_by.equal(new)).size();
    conflicts += players.filter(func(item) = item.claimed_by == ?new or item.parent_user_id == ?newText or item.parent_user_id == ?newTextPrefixed).size();
    conflicts += invites.filter(func(item) = item.claimed_by == ?new or item.created_by.equal(new)).size();
    conflicts += availability.filter(func(item) = item.marked_by == ?new).size();
    conflicts += admins.filter(func(item) = item.user_id.equal(new) or item.granted_by == ?new).size();
    conflicts += joinLinks.filter(func(item) = item.created_by.equal(new)).size();
    conflicts += children.filter(func(item) = item.parent_user_id == ?new or item.claimed_by == ?new).size();
    conflicts += guardians.filter(func(item) = item.guardian_user_id.equal(new)).size();

    if (conflicts > 0) return #err("New sign-in ID already has " # Nat.toText(conflicts) # " record(s) in mini_league_domain");

    var changed = 0;

    let newRoles = roles.map(func(item : Types.RoleGrant) : Types.RoleGrant {
      if (item.user.equal(old)) { changed += 1; { item with user = new } } else item
    });
    let newLeagues = leagues.map(func(item : Types.MiniLeague) : Types.MiniLeague {
      if (item.created_by.equal(old)) { changed += 1; { item with created_by = new } } else item
    });
    let newSessions = sessions.map(func(item : Types.MiniLeagueSession) : Types.MiniLeagueSession {
      if (item.created_by.equal(old)) { changed += 1; { item with created_by = new } } else item
    });
    let newPlayers = players.map(func(item : Types.MiniLeaguePlayer) : Types.MiniLeaguePlayer {
      var touched = false;
      var claimed_by = item.claimed_by;
      var parent_user_id = item.parent_user_id;
      if (claimed_by == ?old) { claimed_by := ?new; touched := true };
      if (parent_user_id == ?oldText) { parent_user_id := ?newText; touched := true };
      if (parent_user_id == ?oldTextPrefixed) { parent_user_id := ?newTextPrefixed; touched := true };
      if (touched) { changed += 1; { item with claimed_by; parent_user_id } } else item
    });
    let newInvites = invites.map(func(item : Types.MiniLeagueInvite) : Types.MiniLeagueInvite {
      var touched = false;
      var claimed_by = item.claimed_by;
      var created_by = item.created_by;
      if (claimed_by == ?old) { claimed_by := ?new; touched := true };
      if (created_by.equal(old)) { created_by := new; touched := true };
      if (touched) { changed += 1; { item with claimed_by; created_by } } else item
    });
    let newAvailability = availability.map(func(item : Types.MiniLeagueSessionAvailability) : Types.MiniLeagueSessionAvailability {
      if (item.marked_by == ?old) { changed += 1; { item with marked_by = ?new } } else item
    });
    let newAdmins = admins.map(func(item : Types.MiniLeagueAdmin) : Types.MiniLeagueAdmin {
      var touched = false;
      var user_id = item.user_id;
      var granted_by = item.granted_by;
      if (user_id.equal(old)) { user_id := new; touched := true };
      if (granted_by == ?old) { granted_by := ?new; touched := true };
      if (touched) { changed += 1; { item with user_id; granted_by } } else item
    });
    let newJoinLinks = joinLinks.map(func(item : Types.MiniLeagueJoinLink) : Types.MiniLeagueJoinLink {
      if (item.created_by.equal(old)) { changed += 1; { item with created_by = new } } else item
    });
    let newChildren = children.map(func(item : Types.MiniLeagueChild) : Types.MiniLeagueChild {
      var touched = false;
      var parent_user_id = item.parent_user_id;
      var claimed_by = item.claimed_by;
      if (parent_user_id == ?old) { parent_user_id := ?new; touched := true };
      if (claimed_by == ?old) { claimed_by := ?new; touched := true };
      if (touched) { changed += 1; { item with parent_user_id; claimed_by } } else item
    });
    let newGuardians = guardians.map(func(item : Types.MiniLeagueGuardian) : Types.MiniLeagueGuardian {
      if (item.guardian_user_id.equal(old)) { changed += 1; { item with guardian_user_id = new } } else item
    });

    if (not dry_run) {
      roles := newRoles;
      leagues := newLeagues;
      sessions := newSessions;
      players := newPlayers;
      invites := newInvites;
      availability := newAvailability;
      admins := newAdmins;
      joinLinks := newJoinLinks;
      children := newChildren;
      guardians := newGuardians;
    };

    #ok(changed)
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };


  // Additive protected consensus reads; live UI rollout is a separate release gate.
  public shared ({ caller }) func read_account_verify_child_guardian(user : Principal, child : Text) : async Bool {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (caller != Principal.fromActor(this)) return false;
    if (not removalReceiver.enter(user)) return false;
    try {
    let eligible = await accountAdmission.eligible(user);
    if (removalReceiver.denied(user) or not eligible) return false;
    let allowed = await* currentGuardianWrite(user, child);
    allowed and not removalReceiver.denied(user)
    } finally { removalReceiver.leave(user) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_verify_player_access(user : Principal, player : Types.MiniLeaguePlayer) : async Bool {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (caller != Principal.fromActor(this)) return false;
    if (not removalReceiver.enter(user)) return false;
    try {
    let eligible = await accountAdmission.eligible(user);
    if (removalReceiver.denied(user) or not eligible) return false;
    let current = switch (findPlayer(player.id)) { case null return false; case (?p) p };
    if (current != player) return false;
    let allowed = await* playerAccessWrite(user, current);
    allowed and not removalReceiver.denied(user) and findPlayer(player.id) == ?current and not playerFenced(player.id)
    } finally { removalReceiver.leave(user) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller = origin }) func read_account_verify_league_access(viewer : Principal, league : Types.MiniLeague) : async Bool {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(viewer)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    if (origin != Principal.fromActor(this)) return false;
    do { let removalReply = await admitAccount(viewer); if (removalReceiver.denied(viewer)) throw Error.reject("Account removal fenced after callback"); removalReply };
    let caller = viewer;
    if (Principal.isAnonymous(caller)) return false;
    if (isLeagueAdmin(caller, league) or isClubMember(caller, league.club_id)) return true;
    for (p in players.values()) {
      if (p.mini_league_id == league.id and (do { let removalReply = await this.read_account_verify_player_access(caller, p); if (removalReceiver.denied(viewer)) throw Error.reject("Account removal fenced after callback"); removalReply })) return true;
    };
    false
  
    } finally { removalReceiver.leave(viewer) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller = origin }) func read_account_filter_visible_leagues(viewer : Principal, candidates : [Types.MiniLeague]) : async [Types.MiniLeague] {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(viewer)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    if (origin != Principal.fromActor(this)) return [];
    do { let removalReply = await admitAccount(viewer); if (removalReceiver.denied(viewer)) throw Error.reject("Account removal fenced after callback"); removalReply };
    let caller = viewer;
    var out : [Types.MiniLeague] = [];
    for (league in candidates.values()) if (do { let removalReply = await this.read_account_verify_league_access(caller, league); if (removalReceiver.denied(viewer)) throw Error.reject("Account removal fenced after callback"); removalReply }) out := out.concat([league]);
    out
  
    } finally { removalReceiver.leave(viewer) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_can_read_league_matches(viewer : Principal, league_id : Text, club_id : Text) : async Bool {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(viewer)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(viewer); if (removalReceiver.denied(viewer)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (eventsDomainCanister != ?caller or Principal.isAnonymous(viewer)) return false;
    switch (findLeague(league_id)) {
      case null false;
      case (?league) league.club_id == club_id and league.status == "active" and (do { let removalReply = await this.read_account_verify_league_access(viewer, league); if (removalReceiver.denied(viewer)) throw Error.reject("Account removal fenced after callback"); removalReply });
    }
  
    } finally { removalReceiver.leave(viewer) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_get_mini_league(id : Text) : async { #Ok : Types.MiniLeague; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (findLeague(id)) {
      case null #Err("Mini-league not found");
      case (?league) { if (not (do { let removalReply = await this.read_account_verify_league_access(caller, league); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) #Err("Forbidden") else #Ok(league) };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_mini_leagues_by_club(club_id : Text) : async [Types.MiniLeague] {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    do { let removalReply = await this.read_account_filter_visible_leagues(caller, leagues.filter(func(item) = item.club_id == club_id)); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_get_news_audience(mini_league_id : Text, requester : Principal) : async { #Ok : Types.MiniLeagueNewsAudience; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(requester)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(requester); if (removalReceiver.denied(requester)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (clubDomainCanister) {
      case null { return #Err("club_domain canister not configured") };
      case (?clubDomain) { if (not caller.equal(clubDomain)) return #Err("club_domain only") };
    };
    if (requester.equal(Principal.anonymous())) return #Err("Authenticated requester required");
    switch (findLeague(mini_league_id)) {
      case null { #Err("Mini-league not found") };
      case (?league) {
        // The caller is the configured club_domain canister, which checks the
        // user's club-admin role before asking for this recipient snapshot.
        if (requester.equal(Principal.anonymous())) return #Err("Authenticated requester required");
        var recipients = addNewsRecipient([], ?league.created_by);
        for (admin in admins.values()) {
          if (admin.mini_league_id == mini_league_id) recipients := addNewsRecipient(recipients, ?admin.user_id);
        };
        for (grant in roles.values()) {
          if (grant.club_id == league.club_id and grant.role == "club_admin") recipients := addNewsRecipient(recipients, ?grant.user);
        };
        for (player in players.values()) {
          if (player.mini_league_id == mini_league_id) {
            switch (player.claimed_by) { case (?u) { if (do { let removalReply = await this.read_account_verify_player_access(u, player); if (removalReceiver.denied(requester)) throw Error.reject("Account removal fenced after callback"); removalReply }) recipients := addNewsRecipient(recipients, ?u) }; case null {} };
            switch (player.child_id) {
              case (?childId) {
                switch (findChild(childId)) {
                  case (?child) {
                    switch (child.parent_user_id) { case (?u) { if (do { let removalReply = await this.read_account_verify_child_guardian(u, childId); if (removalReceiver.denied(requester)) throw Error.reject("Account removal fenced after callback"); removalReply }) recipients := addNewsRecipient(recipients, ?u) }; case null {} };
                    switch (child.claimed_by) { case (?u) { if (do { let removalReply = await this.read_account_verify_child_guardian(u, childId); if (removalReceiver.denied(requester)) throw Error.reject("Account removal fenced after callback"); removalReply }) recipients := addNewsRecipient(recipients, ?u) }; case null {} };
                  };
                  case null {};
                };
                for (guardian in guardians.values()) {
                  if (guardian.child_id == childId and (do { let removalReply = await this.read_account_verify_child_guardian(guardian.guardian_user_id, childId); if (removalReceiver.denied(requester)) throw Error.reject("Account removal fenced after callback"); removalReply })) recipients := addNewsRecipient(recipients, ?guardian.guardian_user_id);
                };
              };
              case null {};
            };
            if (recipients.size() > 500) return #Err("Mini-league news audience exceeds 500 members");
          };
        };
        #Ok({ club_id = league.club_id; recipients })
      };
    }
  
    } finally { removalReceiver.leave(requester) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_get_mini_leagues(ids : [Text]) : async { #Ok : [Types.MiniLeague]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (ids.size() > 300) return #Err("Too many ids");
    #Ok(do { let removalReply = await this.read_account_filter_visible_leagues(caller, leagues.filter(func(item) = ids.any(func(i) = i == item.id))); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_mini_leagues_by_clubs(club_ids : [Text]) : async { #Ok : [Types.MiniLeague]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (club_ids.size() > 200) return #Err("Too many ids");
    #Ok(do { let removalReply = await this.read_account_filter_visible_leagues(caller, leagues.filter(func(item) = club_ids.any(func(c) = c == item.club_id))); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_my_leagues() : async [Types.MiniLeague] {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    do { let removalReply = await this.read_account_filter_visible_leagues(caller, leagues); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_get_my_league_access(ids : [Text]) : async { #Ok : [{ id : Text; can_manage : Bool; can_delete : Bool; is_club_admin : Bool }]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    if (ids.size() > 200) return #Err("Too many ids");
    #Ok((do { let removalReply = await this.read_account_filter_visible_leagues(caller, leagues.filter(func(l) = ids.any(func(id) = id == l.id))); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }).map(func(l) = {
      id = l.id; can_manage = isLeagueAdmin(caller, l); can_delete = isLeagueAdmin(caller, l); is_club_admin = isClubAdmin(caller, l.club_id)
    }))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_profile_audience_batch(requester : Principal, id : Text, subjects : [Principal], expected : ?Nat) : async { #Ok : { revision : Nat; requester : Principal; club : Text; subjects : [Principal]; members : [Bool] }; #Err : Text } {
    if (Runtime.envVar<system>("IGNITE_PRIVATE_PROFILE_READS_REHEARSAL") != ?"1") return #Err("Private league names are not released");
    if (accountAdmissionAuthority != ?caller or caller.isAnonymous()) return #Err("Configured identity authority required");
    if (requester.isAnonymous() or id == "" or id.size() > 128 or subjects.size() > 25 or subjects.any(func p = p.isAnonymous())) return #Err("Bounded exact league required");
    if (not removalReceiver.enter(requester)) return #Err("Account removal fenced");
    try {
      let league = findLeague(id) ?? return #Err("League not found");
      let playerChildren = players.filter(func p = p.mini_league_id == id).map(func p = p.child_id);
      func snapshot() : Text = debug_show((findLeague(id), players.filter(func p = p.mini_league_id == id), guardians.filter(func g = playerChildren.any(func c = c == ?g.child_id)), admins.filter(func a = a.mini_league_id == id), roles.filter(func r = r.club_id == league.club_id), clubDomainCanister, accountAdmissionAuthority));
      let pinned = snapshot();
      if (Text.encodeUtf8(pinned).size() > 32_768) return #Err("League audience exceeds bounded evidence");
      let remote = await privateNameRemoteRevision([requester].concat(subjects));
      let revision = PrivateProfileAudience.snapshotRevision(debug_show((pinned, remote)));
      func active() : Bool = snapshot() == pinned and not leagueFenced(id) and not removalReceiver.denied(requester);
      switch (expected) { case (?r) if (r != revision) return #Err("League audience changed"); case null {} };
      await admitAccount(requester);
      if (not active()) return #Err("League audience changed");
      if (not (await* privateNameLeagueMember(requester, league))) return #Err("League membership required");
      if (not active()) return #Err("League audience changed");
      var members : [Bool] = [];
      for (subject in subjects.values()) {
        await admitAccount(subject);
        if (not active()) return #Err("League audience changed");
        let allowed = await* privateNameLeagueMember(subject, league);
        if (not active()) return #Err("League audience changed");
        members := members.concat([allowed and not removalReceiver.denied(subject)]);
      };
      let closing = await privateNameRemoteRevision([requester].concat(subjects));
      if (not active() or remote != closing) return #Err("Remote league membership changed");
      #Ok({ revision; requester; club = id; subjects; members })
    } finally { removalReceiver.leave(requester) }
  };
  func privateNameLeagueMember(user : Principal, league : Types.MiniLeague) : async* Bool {
    if (leagueFenced(league.id) or removalReceiver.denied(user)) return false;
    if (league.created_by == user or isLeagueAdminGrant(user, league.id)) return true;
    let authority = clubDomainCanister;
    switch (authority) {
      case (?id) {
        let domain : actor { read_has_club_staff_role : shared (Principal, Text) -> async Bool } = actor(id.toText());
        let member = try { await (with timeout = 10) domain.read_has_club_staff_role(user, league.club_id) } catch (_) { return false };
        if (clubDomainCanister != authority or removalReceiver.denied(user) or leagueFenced(league.id)) return false;
        if (member) return true;
      };
      case null return false;
    };
    let candidates = players.filter(func p = p.mini_league_id == league.id);
    if (candidates.size() > 500) return false;
    for (player in candidates.values()) {
      let allowed = await* playerAccessWrite(user, player);
      if (clubDomainCanister != authority or removalReceiver.denied(user) or leagueFenced(league.id)) return false;
      if (allowed and findPlayer(player.id) == ?player) return true;
    };
    false
  };
  func privateNameRemoteRevision(subjects : [Principal]) : async ?Nat {
    switch (clubDomainCanister) {
      case null null;
      case (?authority) {
        let domain : actor { read_profile_remote_revision : shared ([Principal], ?Nat) -> async { #Ok : Nat; #Err : Text } } = actor(authority.toText());
        switch (await (with timeout = 10) domain.read_profile_remote_revision(subjects, null)) { case (#Ok(r)) ?r; case (#Err(e)) throw Error.reject(e) }
      }
    }
  };

  public shared ({ caller }) func read_account_get_league_members(id : Text) : async { #Ok : [{ user_id : Text; is_staff : Bool; is_parent : Bool }]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    let league = switch (findLeague(id)) { case null return #Err("Mini-league not found"); case (?l) l };
    if (not (do { let removalReply = await this.read_account_verify_league_access(caller, league); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Forbidden");
    var parentIds : [Text] = [];
    var staffIds : [Text] = [league.created_by.toText()];
    let add = func(ids : [Text], id : Text) : [Text] {
      if (id == "" or ids.any(func(x) = x == id)) ids else ids.concat([id])
    };
    for (p in players.values()) {
      if (p.mini_league_id == id) {
        switch (p.parent_user_id) { case (?u) { let user = Principal.fromText(u); if (do { let removalReply = await this.read_account_verify_player_access(user, p); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }) parentIds := add(parentIds, u) }; case null {} };
        switch (p.claimed_by) { case (?u) { if (do { let removalReply = await this.read_account_verify_player_access(u, p); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }) parentIds := add(parentIds, u.toText()) }; case null {} };
        switch (p.child_id) {
          case (?child) {
            for (g in guardians.values()) { if (g.child_id == child and (do { let removalReply = await this.read_account_verify_child_guardian(g.guardian_user_id, child); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) parentIds := add(parentIds, g.guardian_user_id.toText()) };
          };
          case null {};
        };
        if (parentIds.size() > 500) return #Err("League member list exceeds 500");
      };
    };
    for (a in admins.values()) { if (a.mini_league_id == id) staffIds := add(staffIds, a.user_id.toText()) };
    for (r in roles.values()) { if (r.club_id == league.club_id and (r.role == "league_admin" or r.role == "club_admin") and r.team_id == null) staffIds := add(staffIds, r.user.toText()) };
    var all = parentIds;
    for (u in staffIds.values()) { all := add(all, u) };
    if (all.size() > 500) return #Err("League member list exceeds 500");
    #Ok(all.map(func(u) = { user_id = u; is_staff = staffIds.any(func(x) = x == u); is_parent = parentIds.any(func(x) = x == u) }))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_sessions(mini_league_id : Text) : async { #Ok : [Types.MiniLeagueSession]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (findLeague(mini_league_id)) {
      case null #Err("Mini-league not found");
      case (?league) {
        if (not (do { let removalReply = await this.read_account_verify_league_access(caller, league); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Forbidden");
        #Ok(sessions.filter(func(item) = item.mini_league_id == mini_league_id))
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_players(mini_league_id : Text) : async { #Ok : [Types.MiniLeaguePlayer]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (findLeague(mini_league_id)) {
      case null #Err("Mini-league not found");
      case (?league) {
        if (not (do { let removalReply = await this.read_account_verify_league_access(caller, league); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Forbidden");
        #Ok(players.filter(func(item) = item.mini_league_id == mini_league_id))
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_get_player_guardian_status(player_id : Text) : async { #Ok : Types.PlayerGuardianStatus; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (findPlayer(player_id)) {
      case null #Err("Player not found");
      case (?player) {
        switch (findLeague(player.mini_league_id)) {
          case null #Err("Mini-league not found");
          case (?league) {
            if (not isLeagueAdmin(caller, league) and not (do { let removalReply = await this.read_account_verify_player_access(caller, player); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Forbidden");
            var guardianCount : Nat = 0;
            var parentLinked = false;
            switch (player.child_id) {
              case null { parentLinked := player.parent_user_id != null or player.claimed_by != null };
              case (?cid) {
                var candidates : [Principal] = [];
                switch (player.claimed_by) { case (?u) candidates := candidates.concat([u]); case null {} };
                switch (player.parent_user_id) { case (?u) candidates := candidates.concat([Principal.fromText(u)]); case null {} };
                for (g in guardians.values()) if (g.child_id == cid and not candidates.any(func(u) = u == g.guardian_user_id)) candidates := candidates.concat([g.guardian_user_id]);
                for (u in candidates.values()) if (do { let removalReply = await this.read_account_verify_child_guardian(u, cid); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }) { guardianCount += 1; parentLinked := true };
              };
            };
            let pending = not parentLinked and guardianCount == 0;
            #Ok({ parent_linked = parentLinked; guardian_count = guardianCount; pending })
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_invites(mini_league_id : Text) : async { #Ok : [Types.MiniLeagueInvite]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) #Ok(invites.filter(func(item) = item.mini_league_id == mini_league_id));
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_group_players(group_id : Text) : async { #Ok : [Types.MiniLeagueGroupPlayer]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (findGroup(group_id)) {
      case null #Err("Group not found");
      case (?group) {
        switch (groupLeagueId(group)) {
          case null #Err("Session not found");
          case (?leagueId) {
            switch (findLeague(leagueId)) {
              case null #Err("Mini-league not found");
              case (?league) {
                if (not (do { let removalReply = await this.read_account_verify_league_access(caller, league); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Forbidden");
                #Ok(groupPlayers.filter(func(item) = item.group_id == group_id))
              };
            }
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_groups(session_id : Text) : async { #Ok : [Types.MiniLeagueGroup]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (findSession(session_id)) {
      case null #Err("Session not found");
      case (?session) {
        switch (findLeague(session.mini_league_id)) {
          case null #Err("Mini-league not found");
          case (?league) {
            if (not (do { let removalReply = await this.read_account_verify_league_access(caller, league); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Forbidden");
            #Ok(groups.filter(func(item) = item.session_id == session_id))
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_duties(group_id : Text) : async { #Ok : [Types.MiniLeagueGroupDuty]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (findGroup(group_id)) {
      case null #Err("Group not found");
      case (?group) {
        switch (groupLeagueId(group)) {
          case null #Err("Session not found");
          case (?leagueId) {
            switch (findLeague(leagueId)) {
              case null #Err("Mini-league not found");
              case (?league) {
                if (not (do { let removalReply = await this.read_account_verify_league_access(caller, league); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Forbidden");
                #Ok(duties.filter(func(item) = item.group_id == group_id))
              };
            }
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_get_availability(session_id : Text, player_id : Text) : async { #Ok : ?Types.MiniLeagueSessionAvailability; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (findSession(session_id)) {
      case null #Err("Session not found");
      case (?session) {
        switch (findLeague(session.mini_league_id)) {
          case null #Err("Mini-league not found");
          case (?league) {
            if (not (do { let removalReply = await this.read_account_verify_league_access(caller, league); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Forbidden");
            #Ok(availability.find(func(item) = item.session_id == session_id and item.player_id == player_id))
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_session_availability(session_id : Text) : async { #Ok : [Types.MiniLeagueSessionAvailability]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (findSession(session_id)) {
      case null #Err("Session not found");
      case (?session) {
        switch (findLeague(session.mini_league_id)) {
          case null #Err("Mini-league not found");
          case (?league) {
            if (not (do { let removalReply = await this.read_account_verify_league_access(caller, league); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply })) return #Err("Forbidden");
            #Ok(availability.filter(func(item) = item.session_id == session_id))
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_my_availability() : async [Types.MiniLeagueSessionAvailability] {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    var myPlayerIds : [Text] = [];
    for (p in players.values()) if (do { let removalReply = await this.read_account_verify_player_access(caller, p); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply }) myPlayerIds := myPlayerIds.concat([p.id]);
    availability.filter(func(item) = myPlayerIds.any(func(pid) = pid == item.player_id))
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_admins(mini_league_id : Text) : async { #Ok : [Types.MiniLeagueAdmin]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) #Ok(admins.filter(func(item) = item.mini_league_id == mini_league_id));
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };

  public shared ({ caller }) func read_account_list_mini_league_join_links(mini_league_id : Text) : async { #Ok : [Types.MiniLeagueJoinLink]; #Err : Text } {
    let privateWriterLease = switch (privateNameWriterGate.enter()) { case (#Ok(key)) key; case (#Err(reason)) throw Error.reject(reason) };
    try {

    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {

    do { let removalReply = await admitAccount(caller); if (removalReceiver.denied(caller)) throw Error.reject("Account removal fenced after callback"); removalReply };
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) #Ok(joinLinks.filter(func(item) = item.mini_league_id == mini_league_id));
    }
  
    } finally { removalReceiver.leave(caller) };
  
    } finally { privateNameWriterGate.leave(privateWriterLease) };
  };
};
