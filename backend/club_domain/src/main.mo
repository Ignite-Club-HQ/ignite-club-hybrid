import AccountAdmission "../../shared/AccountAdmission";
import OpeningConfiguration "../../shared/OpeningConfiguration";
import RemovalReceiver "../../shared/RemovalReceiver";
import Error "mo:core/Error";
import MediaEvidence "../../shared/MediaEvidence";
import Blob "mo:core/Blob";
import PrimMem "mo:⛔";
import Cycles "mo:core/Cycles";
import Array "mo:core/Array";
import Char "mo:core/Char";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Nat16 "mo:core/Nat16";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Map "mo:core/Map";
import Random "mo:core/Random";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Timer "mo:core/Timer";
import Types "types";
import AccountErasure "accountErasure";
import AccountUnlinkFence "accountUnlinkFence";
import Oql "../../shared/Oql";
import OqlClubs "oqlClubs";
import MediaQuota "mediaQuota";
import MediaQuotaCutover "mediaQuotaCutover";
import MediaRetainedQuota "mediaRetainedQuota";
import MediaRetainedCutover "mediaRetainedCutover";
import MediaJournalRetirement "mediaJournalRetirement";
import MediaJournalToken "../../shared/MediaJournalToken";
import MediaGrowthReservations "mediaGrowthReservations";
import MembershipPage "membershipPage";
import MembershipIndex "membershipIndex";

persistent actor class Main(governorInit : Principal) = this {
  // Local rehearsal only. Eligibility never grants resource permissions.
  transient let accountAdmissionEnabled = Runtime.envVar<system>("IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL") == ?"1";
  transient let accountAdmissionAuthority = switch (Runtime.envVar<system>("IGNITE_ACCOUNT_SERVICE_IDENTITY")) {
    case (?id) ?Principal.fromText(id); case null null
  };
  var removal_intents : Map.Map<Text, RemovalReceiver.Request>;
  var removal_subjects : Map.Map<Principal, Text>;
  var removal_active : Map.Map<Principal, Nat>;
  transient let removalReceiver = RemovalReceiver.Gate(accountAdmissionEnabled, accountAdmissionAuthority, removal_intents, removal_subjects, removal_active);
  transient let accountAdmission = AccountAdmission.Gate(accountAdmissionEnabled, accountAdmissionAuthority);
  func admitAccount(subject : Principal) : async () {
    if (removalReceiver.denied(subject)) throw Error.reject("Account removal fenced");
    let eligible = await accountAdmission.eligible(subject);
    if (removalReceiver.denied(subject) or not eligible) throw Error.reject("Account admission denied or unavailable");
  };
  func denyLegacyAccountQuery() {
    if (accountAdmissionEnabled) Runtime.trap("Use protected consensus account read");
  };
  // Only configure on newly provisioned group authorities. Existing shared
  // clubs keep their creation path; partial configuration refuses all creates.
  transient let newClubRouter = Runtime.envVar<system>("IGNITE_NEW_CLUB_PLACEMENT_ROUTER");
  transient let newClubGroup = Runtime.envVar<system>("IGNITE_NEW_CLUB_PLACEMENT_GROUP");
  transient let newClubTarget = Runtime.envVar<system>("IGNITE_NEW_CLUB_PLACEMENT_TARGET");
  func creatorPlacementAllowed(subject : Principal, clubId : Text) : async Bool {
    switch (newClubRouter, newClubGroup, newClubTarget) {
      case (null, null, null) true;
      case (?routerId, ?groupId, ?targetAlias) {
        let router : actor {
          read_new_club_creation_authorized : shared (Principal, Text, Text, Text) -> async { #Ok : Bool; #Err : Text }
        } = actor(routerId);
        try {
          switch (await (with timeout = 30) router.read_new_club_creation_authorized(subject, clubId, targetAlias, groupId)) {
            case (#Ok(allowed)) allowed; case (#Err(_)) false
          }
        } catch (_) { false }
      };
      case _ false
    }
  };
  /// Public: remaining cycles (shown in admin settings).
  public query func cycles_balance() : async Nat { Cycles.balance() };
  /// Bounded consensus configuration evidence; never changes or grants access.
  public shared ({ caller }) func read_group_opening_configuration() : async [(Text, Text)] {
    if (not isGovernor(caller)) Runtime.trap("Governor required");
    if (competitionAuthorities.size() > 64 or mediaQuotaStores.size() > 64) Runtime.trap("Opening authority set exceeds bounded owner scope");
    [
      ("club_domain", Principal.fromActor(this).toText()),
      ("identity_access", OpeningConfiguration.optional(identityAccessCanister)),
      ("notification_queue", OpeningConfiguration.optional(notificationQueueCanister)),
      ("mini_league_domain", OpeningConfiguration.optional(miniLeagueDomainCanister)),
      ("competition_domain", OpeningConfiguration.optional(competitionDomainCanister)),
      ("events_domain", OpeningConfiguration.optional(eventsDomainCanister)),
      ("messaging_domain", OpeningConfiguration.optional(messagingDomainCanister)),
      ("pii_access_control", OpeningConfiguration.optional(piiCanister))
    ].concat(competitionAuthorities.map(func p = ("competition_authority", p.toText())))
      .concat(mediaQuotaStores.map(func p = ("media_store", p.toText())))
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
  public query func usage_stats() : async { clubs : Nat; teams : Nat; accounts : Nat; news_posts : Nat } {
    { clubs = profiles.size(); teams = teams.size(); accounts = accounts.size(); news_posts = newsPosts.size() };
  };

  /// Public: remaining cycles of any canister this canister controls
  /// (the frontend asset canister adds club_domain as a controller at deploy
  /// time so admin settings can show its balance too).
  public shared func canister_cycles(canister_id : Principal) : async Nat {
    let ic = actor ("aaaaa-aa") : actor {
      canister_status : shared { canister_id : Principal } -> async { cycles : Nat };
    };
    let status = await ic.canister_status({ canister_id });
    status.cycles;
  };

  transient let challengeTtlNs : Nat64 = 600_000_000_000;

  // IC HTTP gateway request/response shapes for `http_request` (same contract
  // media_blob_store uses). Body is raw bytes; JSON is encoded by hand below.
  type HttpRequest = {
    url : Text;
    method : Text;
    headers : [(Text, Text)];
    body : Blob;
  };
  type HttpResponse = {
    status_code : Nat16;
    headers : [(Text, Text)];
    body : Blob;
  };

  var governor : Principal;
  var mediaEvidenceRevision : Nat;
  var competitionAuthorities : [Principal];
  var identityAccessCanister : ?Principal;
  var identityUnlinkReceipts : [(Text, Principal, Nat64)];
  // Preparation-only ledger. No upload activation API until legacy usage
  // import and recoverable store-side sagas exist; existing stores unchanged.
  var mediaQuotaLedger : MediaQuota.Ledger;
  var mediaQuotaStores : [Principal];
  var mediaQuotaCutover : MediaQuotaCutover.State;
  var mediaRetainedState : MediaRetainedCutover.State;
  var mediaJournalState : MediaJournalRetirement.State;
  var mediaGrowthState : MediaGrowthReservations.State;
  var mediaGrowthRouter : ?{ router : Principal; group : Text; target : Text };
  transient let growthRehearsal = Runtime.envVar<system>("IGNITE_MEDIA_GROWTH_LOCAL_REHEARSAL") == ?"1";
  transient let routerGrowthRehearsal = Runtime.envVar<system>("IGNITE_MEDIA_ROUTER_GROWTH_LOCAL_REHEARSAL") == ?"1";
  transient let retainedRehearsal = Runtime.envVar<system>("IGNITE_MEDIA_RETAINED_LOCAL_REHEARSAL") == ?"1";

  if (governor.equal(Principal.anonymous()) and not governorInit.equal(Principal.anonymous())) {
    governor := governorInit;
  };
  var acl : Types.Acl;
  var aclVersion : Nat64;

  var profiles : [Types.ClubProfile];
  var settings : [Types.ClubSettings];
  var inviteMessageDefaults : [Types.InviteMessageDefault];
  var teamWelcomeEmails : [Types.TeamWelcomeEmail];
  var teams : [Types.ClubTeam];
  var sponsors : [Types.ClubSponsor];
  var clubListings : [(Text, Types.Listing)];
  var frozenClubs : [(Text, Nat64)];

  var accounts : [Types.Account];
  var accountExclusions : [Types.AccountExclusion];
  var accountFamilies : [Types.Family];
  var accountChallenges : [Types.Challenge];
  var accountRoles : [Types.AccountRole];
  var nextChallengeId : Nat64;

  // Bounded idempotency log for `mutate`: keyed by client-supplied
  // request_id, remembers a text fingerprint of the request that produced
  // each cached successful result. A retry with the identical request_id
  // and payload replays the original result without re-validating
  // `expected_revision` (which would otherwise have advanced); a retry
  // with the same request_id but a different payload is rejected rather
  // than silently applied or replayed.
  var mutationLog : [(Text, Text, Types.Mutation)];

  var newsPosts : [Types.NewsPost];
  var newsAudienceRecipients : [Types.NewsAudienceRecipient];
  // (post_id, kind "competition" | "mini_league", target_id)
  var newsTargets : [(Text, Text, Text)];
  var parentInvites : [Types.ParentInvite];
  var roleRequests : [Types.RoleRequest];
  var teamInvites : [Types.TeamInvite];
  var teamInviteLinks : [Types.TeamInviteLink];
  var pendingInvites : [Types.PendingInvite];
  // (code, invite_id) — short share-link codes, lazily created, stable once minted.
  var inviteShortCodes : [(Text, Text)];
  var teamCreationRequests : [Types.TeamCreationRequest];
  var teamPlayerPositions : [Types.TeamPlayerPosition];
  var teamCaptains : [Types.TeamCaptain];
  var clubJoinRequests : [Types.ClubJoinRequest];
  var themePrefs : [(Principal, Text)];
  // Per-user accessibility preferences (textScale/highContrast/reduceMotion/
  // boldText) serialized as JSON, mirroring themePrefs. Added 20261017_000000.
  var accessibilityPrefs : [(Principal, Text)];
  // Caller-recorded presence heartbeat: principal text -> last-seen ms
  // (Time.now() / 1_000_000). Written by record_presence_heartbeat on every
  // app foreground/interval tick; read by list_online_presence (governor or
  // app_admin only) to back the admin "Online Users" page now that ICP
  // accounts have no Supabase realtime presence channel.
  var presenceLastSeen : [(Text, Int)];
  var clubTerms : [Types.ClubTerm];
  var removedMembers : [Types.RemovedMember];
  var memberPayments : [Types.MemberPayment];
  var teamSponsorAllocations : [Types.TeamSponsorAllocation];
  var seasons : [Types.Season];
  var seasonTeamSummaries : [Types.SeasonTeamSummary];
  var seasonPlayerStats : [Types.SeasonPlayerStat];

  // Governor-set notification_queue canister id for the manual-payment fee
  // reminder fan-out (Phase 3 F6). Fail-closed while unset.
  var notificationQueueCanister : ?Principal;
  var miniLeagueDomainCanister : ?Principal;
  var competitionDomainCanister : ?Principal;
  // Governor-set downstream canister ids for the permanent-delete fan-out.
  // While unset, that domain's cross-canister cleanup is skipped (the local
  // purge still completes) — mirrored by the deploy script's wiring calls.
  var eventsDomainCanister : ?Principal;
  var messagingDomainCanister : ?Principal;
  var piiCanister : ?Principal;
  var clubSubscriptions : [Types.ClubSubscription];
  var teamSubscriptions : [Types.TeamSubscription];
  // New state added 20261015_000000: pending-invite labels, season EOI
  // config blobs, season team assignments, club association-kind flags,
  // class enrolments, and per-club theme JSON blobs.
  var pendingInviteLabels : [(Text, Text)];
  var seasonEoiConfig : [(Text, Text)];
  var seasonTeamAssignments : [Types.SeasonTeamAssignment];
  var clubKinds : [(Text, Text)];
  var classEnrolments : [Types.ClassEnrolment];
  var clubThemeJson : [(Text, Text)];
  var guardianMeta : [Types.GuardianMeta];
  var teamPlayerPositionAssignments : [Types.TeamPlayerPositionAssignment];
  var pendingInviteEmailHashes : [Types.PendingInviteEmailHash];
  var clubGeneralSettings : [Types.ClubGeneralSettings];

  // Global app-wide config key/value store (app_settings parity for values
  // that must be readable pre-auth, e.g. the backend routing config). Values
  // are plain text (JSON for structured payloads), capped small; writes are
  // governor-only, reads are public so an unauthenticated boot can fetch the
  // routing config. Never store secrets here — state is replica-visible.
  var appConfig : [(Text, Text)];

  // Per-club home country (ISO two-letter code), mirroring the Supabase
  // clubs.home_country column. Fixed at creation: club admins can set it
  // once, and only the governor can change it afterwards (a deliberate
  // migration, never a toggle). Kept out of ClubProfile so the record type
  // — and every migration mentioning it — stays stable.
  var clubHomeCountries : [(Text, Text)];



  public shared ({ caller }) func transfer_governorship(new_governor : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Only governor can transfer governorship");
    if (new_governor.equal(Principal.anonymous())) return #Err("New governor cannot be anonymous");
    governor := new_governor;
    #Ok
  };


  /// Governor-only: moves every stored reference of one user's sign-in ID (old) to a new one.
  /// Any NEW stored principal / principal-text field added to this canister must be added here.
  public shared ({ caller }) func rekey_principal(old : Principal, new : Principal, dry_run : Bool) : async { #ok : Nat; #err : Text } {
    rekeyImpl(caller, old, new, dry_run, false)
  };

  // Same as rekey_principal, but allowed when the new sign-in ID already has data:
  // both IDs' records end up under the new one (keyed duplicates keep the new row).
  public shared ({ caller }) func merge_principal(old : Principal, new : Principal, dry_run : Bool) : async { #ok : Nat; #err : Text } {
    rekeyImpl(caller, old, new, dry_run, true)
  };

  func rekeyImpl(caller : Principal, old : Principal, new : Principal, dry_run : Bool, allowMerge : Bool) : { #ok : Nat; #err : Text } {
    if (not isGovernor(caller)) return #err("Forbidden");
    if (removalReceiver.denied(old) or removalReceiver.denied(new)) return #err("Removed identity cannot be rekeyed or merged");
    if (old.equal(Principal.anonymous()) or new.equal(Principal.anonymous())) return #err("Anonymous principal not allowed");
    if (old.equal(new)) return #err("old and new must differ");
    if (old.equal(governor)) return #err("Cannot rekey the governor");

    let oldText = Principal.toText(old);
    let newText = Principal.toText(new);
    let oldTag = "principal:" # oldText;
    let newTag = "principal:" # newText;

    func pEq(p : Principal) : Bool { p.equal(old) };
    func tEq(t : Text) : Bool { t == oldText or t == oldTag };
    func tSwap(t : Text) : Text {
      if (t == oldText) newText else if (t == oldTag) newTag else t;
    };

    // ---- conflict guard: count NON-EPHEMERAL records already referencing `new` ----
    var conflicts = 0;
    func newTxt(t : Text) : Bool { t == newText or t == newTag };
    conflicts += acl.roles.filter(func(g) = g.user.equal(new)).size();
    conflicts += acl.guardians.filter(func(g) = g.user.equal(new)).size();
    conflicts += acl.exclusions.filter(func(e) = e.user.equal(new)).size();
    conflicts += acl.children.filter(func(c) = switch (c.parent) { case (?p) p.equal(new); case null false }).size();
    conflicts += accounts.filter(func(a) = a.legacy_subject.equal(new) or a.principals.any(func(p) = p.equal(new))).size();
    conflicts += accountExclusions.filter(func(e) = newTxt(e.account_id)).size();
    conflicts += accountRoles.filter(func(r) = newTxt(r.account_id)).size();
    conflicts += accountFamilies.filter(func(f) = newTxt(f.account_id)).size();
    conflicts += accountChallenges.filter(func(c) = newTxt(c.account_id) or c.issuer.equal(new) or c.target.equal(new)).size();
    conflicts += teamFolders.filter(func(f) = f.created_by.equal(new)).size();
    conflicts += teams.filter(func(t) = t.shell_claimed_by == ?new or t.shell_invited_by == ?new).size();
    conflicts += newsPosts.filter(func(p) = p.created_by.equal(new)).size();
    conflicts += parentInvites.filter(func(i) = i.invited_by.equal(new) or i.accepted_by == ?new).size();
    conflicts += roleRequests.filter(func(r) = newTxt(r.account_id) or r.user.equal(new) or r.decided_by == ?new).size();
    conflicts += teamInvites.filter(func(i) = i.invited_by.equal(new) or i.accepted_by == ?new).size();
    conflicts += teamInviteLinks.filter(func(l) = l.created_by.equal(new)).size();
    conflicts += pendingInvites.filter(func(i) = i.invited_by.equal(new) or i.accepted_by == ?new).size();
    conflicts += teamCreationRequests.filter(func(r) = r.requested_by.equal(new) or r.decided_by == ?new).size();
    conflicts += teamCaptains.filter(func(c) = c.user.equal(new)).size();
    conflicts += clubJoinRequests.filter(func(r) = r.user.equal(new) or r.decided_by == ?new).size();
    conflicts += removedMembers.filter(func(r) = r.user.equal(new) or r.removed_by.equal(new)).size();
    conflicts += memberPayments.filter(func(p) = p.marked_by.equal(new) or newTxt(p.user_id)).size();
    conflicts += teamPlayerPositions.filter(func(p) = newTxt(p.member_id)).size();
    conflicts += themePrefs.filter(func(e) = e.0.equal(new)).size();

    if (conflicts > 0 and not allowMerge) return #err("New sign-in ID already has " # Nat.toText(conflicts) # " record(s) in club_domain");

    var changed = 0;

    // ---- acl ----
    let newRoles = acl.roles.map(func(g : Types.RoleGrant) : Types.RoleGrant = if (pEq(g.user)) { changed += 1; { g with user = new } } else g);
    let newGuardians = acl.guardians.map(func(g : Types.Guardian) : Types.Guardian = if (pEq(g.user)) { changed += 1; { g with user = new } } else g);
    let newExclusions = acl.exclusions.map(func(e : Types.Exclusion) : Types.Exclusion = if (pEq(e.user)) { changed += 1; { e with user = new } } else e);
    let newChildren = acl.children.map(func(c : Types.Child) : Types.Child = switch (c.parent) { case (?p) if (pEq(p)) { changed += 1; { c with parent = ?new } } else c; case null c });

    // ---- accounts ----
    let newAccounts = accounts.map(func(a : Types.Account) : Types.Account {
      var touched = false;
      let legacy = if (pEq(a.legacy_subject)) { touched := true; new } else a.legacy_subject;
      let hasOld = a.principals.any(pEq);
      let hasNew = a.principals.any(func(p) = p.equal(new));
      let principals = if (hasOld) {
        touched := true;
        if (hasNew) a.principals.filter(func(p) = not pEq(p))
        else a.principals.map(func(p) = if (pEq(p)) new else p);
      } else a.principals;
      if (touched) { changed += 1 };
      { a with legacy_subject = legacy; principals };
    });

    let newAccountExclusions = accountExclusions.map(func(e : Types.AccountExclusion) : Types.AccountExclusion = if (tEq(e.account_id)) { changed += 1; { e with account_id = tSwap(e.account_id) } } else e);
    let newAccountRoles = accountRoles.map(func(r : Types.AccountRole) : Types.AccountRole = if (tEq(r.account_id)) { changed += 1; { r with account_id = tSwap(r.account_id) } } else r);
    let newAccountFamilies = accountFamilies.map(func(f : Types.Family) : Types.Family = if (tEq(f.account_id)) { changed += 1; { f with account_id = tSwap(f.account_id) } } else f);
    let newAccountChallenges = accountChallenges.map(func(c : Types.Challenge) : Types.Challenge {
      var touched = false;
      let account_id = if (tEq(c.account_id)) { touched := true; tSwap(c.account_id) } else c.account_id;
      let issuer = if (pEq(c.issuer)) { touched := true; new } else c.issuer;
      let target = if (pEq(c.target)) { touched := true; new } else c.target;
      if (touched) { changed += 1 };
      { c with account_id; issuer; target };
    });

    let newTeamFolders = teamFolders.map(func(f : Types.TeamFolder) : Types.TeamFolder = if (pEq(f.created_by)) { changed += 1; { f with created_by = new } } else f);
    let newTeams = teams.map(func(t : Types.ClubTeam) : Types.ClubTeam {
      var touched = false;
      let claimed = if (t.shell_claimed_by == ?old) { touched := true; ?new } else t.shell_claimed_by;
      let invited = if (t.shell_invited_by == ?old) { touched := true; ?new } else t.shell_invited_by;
      if (touched) { changed += 1 };
      { t with shell_claimed_by = claimed; shell_invited_by = invited };
    });
    let newNewsPosts = newsPosts.map(func(p : Types.NewsPost) : Types.NewsPost = if (pEq(p.created_by)) { changed += 1; { p with created_by = new } } else p);
    let newParentInvites = parentInvites.map(func(i : Types.ParentInvite) : Types.ParentInvite {
      var touched = false;
      let invited_by = if (pEq(i.invited_by)) { touched := true; new } else i.invited_by;
      let accepted_by = if (i.accepted_by == ?old) { touched := true; ?new } else i.accepted_by;
      if (touched) { changed += 1 };
      { i with invited_by; accepted_by };
    });
    let newRoleRequests = roleRequests.map(func(r : Types.RoleRequest) : Types.RoleRequest {
      var touched = false;
      let account_id = if (tEq(r.account_id)) { touched := true; tSwap(r.account_id) } else r.account_id;
      let user = if (pEq(r.user)) { touched := true; new } else r.user;
      let decided_by = if (r.decided_by == ?old) { touched := true; ?new } else r.decided_by;
      if (touched) { changed += 1 };
      { r with account_id; user; decided_by };
    });
    let newTeamInvites = teamInvites.map(func(i : Types.TeamInvite) : Types.TeamInvite {
      var touched = false;
      let invited_by = if (pEq(i.invited_by)) { touched := true; new } else i.invited_by;
      let accepted_by = if (i.accepted_by == ?old) { touched := true; ?new } else i.accepted_by;
      if (touched) { changed += 1 };
      { i with invited_by; accepted_by };
    });
    let newTeamInviteLinks = teamInviteLinks.map(func(l : Types.TeamInviteLink) : Types.TeamInviteLink = if (pEq(l.created_by)) { changed += 1; { l with created_by = new } } else l);
    let newPendingInvites = pendingInvites.map(func(i : Types.PendingInvite) : Types.PendingInvite {
      var touched = false;
      let invited_by = if (pEq(i.invited_by)) { touched := true; new } else i.invited_by;
      let accepted_by = if (i.accepted_by == ?old) { touched := true; ?new } else i.accepted_by;
      if (touched) { changed += 1 };
      { i with invited_by; accepted_by };
    });
    let newTeamCreationRequests = teamCreationRequests.map(func(r : Types.TeamCreationRequest) : Types.TeamCreationRequest {
      var touched = false;
      let requested_by = if (pEq(r.requested_by)) { touched := true; new } else r.requested_by;
      let decided_by = if (r.decided_by == ?old) { touched := true; ?new } else r.decided_by;
      if (touched) { changed += 1 };
      { r with requested_by; decided_by };
    });
    let hasCaptainNew = teamCaptains.any(func(c) = c.user.equal(new));
    let newTeamCaptains = if (hasCaptainNew) teamCaptains.filter(func(c) = not pEq(c.user)) else teamCaptains.map(func(c : Types.TeamCaptain) : Types.TeamCaptain = if (pEq(c.user)) { { c with user = new } } else c);
    for (c in teamCaptains.values()) { if (pEq(c.user)) { changed += 1 } };

    let newClubJoinRequests = clubJoinRequests.map(func(r : Types.ClubJoinRequest) : Types.ClubJoinRequest {
      var touched = false;
      let user = if (pEq(r.user)) { touched := true; new } else r.user;
      let decided_by = if (r.decided_by == ?old) { touched := true; ?new } else r.decided_by;
      if (touched) { changed += 1 };
      { r with user; decided_by };
    });
    let newRemovedMembers = removedMembers.map(func(r : Types.RemovedMember) : Types.RemovedMember {
      var touched = false;
      let user = if (pEq(r.user)) { touched := true; new } else r.user;
      let removed_by = if (pEq(r.removed_by)) { touched := true; new } else r.removed_by;
      if (touched) { changed += 1 };
      { r with user; removed_by };
    });
    let newMemberPayments = memberPayments.map(func(p : Types.MemberPayment) : Types.MemberPayment {
      var touched = false;
      let marked_by = if (pEq(p.marked_by)) { touched := true; new } else p.marked_by;
      let user_id = if (tEq(p.user_id)) { touched := true; tSwap(p.user_id) } else p.user_id;
      if (touched) { changed += 1 };
      { p with marked_by; user_id };
    });
    let newTeamPlayerPositions = teamPlayerPositions.map(func(p : Types.TeamPlayerPosition) : Types.TeamPlayerPosition = if (tEq(p.member_id)) { changed += 1; { p with member_id = tSwap(p.member_id) } } else p);
    let hasThemeNew = themePrefs.any(func(e) = e.0.equal(new));
    var themeChanged = false;
    let newThemePrefs = if (themePrefs.any(func(e) = e.0.equal(old))) {
      themeChanged := true;
      if (hasThemeNew) themePrefs.filter(func(e) = not e.0.equal(old))
      else themePrefs.map(func(e) = if (e.0.equal(old)) (new, e.1) else e);
    } else themePrefs;
    if (themeChanged) { changed += 1 };

    if (not dry_run) {
      membershipEpoch += 1;
      acl := { acl with roles = newRoles; guardians = newGuardians; exclusions = newExclusions; children = newChildren };
      membershipEpoch += 1;
      accounts := newAccounts;
      membershipEpoch += 1;
      accountExclusions := newAccountExclusions;
      accountRoles := newAccountRoles;
      membershipEpoch += 1;
      accountFamilies := newAccountFamilies;
      accountChallenges := newAccountChallenges;
      teamFolders := newTeamFolders;
      membershipEpoch += 1;
      teams := newTeams;
      mediaEvidenceRevision += 1;
      newsPosts := newNewsPosts;
      parentInvites := newParentInvites;
      roleRequests := newRoleRequests;
      teamInvites := newTeamInvites;
      teamInviteLinks := newTeamInviteLinks;
      pendingInvites := newPendingInvites;
      teamCreationRequests := newTeamCreationRequests;
      teamCaptains := newTeamCaptains;
      clubJoinRequests := newClubJoinRequests;
      removedMembers := newRemovedMembers;
      memberPayments := newMemberPayments;
      teamPlayerPositions := newTeamPlayerPositions;
      themePrefs := newThemePrefs;
    };

    #ok(changed)
  };

  func auth(caller : Principal) {
    if (caller.equal(Principal.anonymous())) Runtime.trap("Authenticated user required");
  };

  func isGovernor(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and governor.equal(caller)
  };

  func isExcluded(caller : Principal, club : Text) : Bool {
    acl.exclusions.any(func(exclusion) = exclusion.user.equal(caller) and exclusion.club == club)
    or removedMembers.any(func(member) = member.user == caller and member.club == club)
  };

  // A parent or guardian of a child assigned to one of the club's teams is
  // a member of that club, even without an explicit role grant.
  func isFamilyMember(caller : Principal, club : Text) : Bool {
    acl.children.any(func(c) {
      let isParent = switch (c.parent) { case (?p) p.equal(caller); case null false };
      let isGuardian = acl.guardians.any(func(g) = g.child == c.id and g.user.equal(caller));
      (isParent or isGuardian) and c.teams.any(func(teamId) = teamInClub(teamId, club))
    })
  };

  // Transient candidate index (account principal -> clubs). Every write to
  // membership-bearing state bumps membershipEpoch; a stale index is rebuilt
  // on the next read. Candidates are always re-verified with isMember, so the
  // index can only accelerate, never grant. Rebuilt after upgrade (transient).
  transient var membershipEpoch : Nat = 0;
  transient var memberIndexEpoch : ?Nat = null;
  transient var memberIndex : MembershipIndex.Index = MembershipIndex.empty();
  transient let APP_WIDE = "\u{1F}*";

  func currentMemberIndex() : MembershipIndex.Index {
    if (memberIndexEpoch == ?membershipEpoch) return memberIndex;
    let ix = MembershipIndex.empty();
    for (g in acl.roles.values()) {
      MembershipIndex.add(ix, g.user.toText(), switch (g.club) { case (?c) c; case null APP_WIDE });
    };
    for (c in acl.children.values()) {
      let parents = switch (c.parent) { case (?p) [p]; case null [] };
      let guardians = acl.guardians.filter(func(g) = g.child == c.id).map(func(g) = g.user);
      for (teamId in c.teams.values()) {
        for (t in acl.teams.values()) if (t.id == teamId) for (u in parents.concat(guardians).values()) MembershipIndex.add(ix, u.toText(), t.club);
        for (t in teams.values()) if (t.id == teamId and t.deleted_at_ms == null) for (u in parents.concat(guardians).values()) MembershipIndex.add(ix, u.toText(), t.club_id);
      };
    };
    memberIndex := ix; memberIndexEpoch := ?membershipEpoch; ix
  };

  func isMember(caller : Principal, club : Text) : Bool {
    not isExcluded(caller, club) and (
      acl.roles.any(func(grant) = grant.user.equal(caller) and (grant.club == ?club or grant.club == null))
      or isFamilyMember(caller, club)
    )
  };

  func isAdmin(caller : Principal, club : Text) : Bool {
    isGovernor(caller) or (not isExcluded(caller, club) and acl.roles.any(func(grant) = grant.user.equal(caller) and (grant.role == "club_admin" or grant.role == "app_admin") and (grant.club == ?club or grant.club == null)))
  };

  func nowNs() : Nat64 { Nat.toNat64(Int.abs(Time.now())) };

  func nowMs() : Nat64 { nowNs() / 1_000_000 };

  // Club admin, or a team admin/coach of the specific team.
  func canManageTeam(caller : Principal, club : Text, team_id : ?Text) : Bool {
    if (isAdmin(caller, club)) return true;
    switch (team_id) {
      case null { false };
      case (?team) {
        acl.roles.any(func(grant) =
          grant.user.equal(caller) and
          (grant.role == "team_admin" or grant.role == "coach") and
          (grant.club == ?club or grant.club == null) and
          (grant.team == ?team or grant.team == null))
      };
    }
  };

  func canInviteEntrantTeamPlayers(caller : Principal, club_id : Text, team_id : Text) : async Bool {
    if (not acl.teams.any(func(team) = team.id == team_id and team.club == club_id)) return false;
    switch (competitionDomainCanister) {
      case null { false };
      case (?canister) {
        let competitionDomain : actor {
          is_competition_invite_manager : shared query (Text, Principal) -> async Bool;
        } = actor (Principal.toText(canister));
        try {
          await competitionDomain.is_competition_invite_manager(team_id, caller)
        } catch (_) {
          false
        }
      };
    }
  };

  func canCreateTeamRosterInvite(caller : Principal, club_id : Text, team_id : Text, role : Text) : async Bool {
    if (canManageTeam(caller, club_id, ?team_id)) return true;
    if (role != "player" and role != "parent") return false;
    await canInviteEntrantTeamPlayers(caller, club_id, team_id)
  };

  func validateDraft(draft : Types.Draft) : ?Text {
    let title = Text.trim(draft.title, #char ' ');
    if (title.size() == 0 or draft.title.size() > 160) return ?"Title must be 1-160 characters";
    if (draft.url.size() > 2048 or not (Text.startsWith(draft.url, #text "http://") or Text.startsWith(draft.url, #text "https://"))) return ?"Invalid URL";
    if (draft.open_mode != "embed" and draft.open_mode != "browser") return ?"Invalid open mode";
    null
  };

  func accountFor(principal : Principal) : ?Types.Account {
    for (account in accounts.values()) {
      if (account.principals.any(func(item) = item.equal(principal))) return ?account;
    };
    null
  };

  public shared ({ caller }) func set_identity_access_canister(id : Principal) : async { #Ok; #Err : Text } {
    if (not isGovernor(caller) or Principal.isAnonymous(id)) return #Err("Governor and valid identity authority required");
    if (Runtime.envVar<system>("IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL") != ?"1") return #Err("Cross-group account lifecycle not released");
    if (identityUnlinkReceipts.size() > 0 and identityAccessCanister != ?id) return #Err("Cannot replace identity authority after unlink");
    identityAccessCanister := ?id; membershipEpoch += 1; #Ok
  };
  /// Independent deletion-only configuration for an empty owner-test group.
  /// Does not release linked-account sync or register lifecycle receivers.
  public shared ({ caller }) func set_owner_test_deletion_identity(id : Principal) : async { #Ok; #Err : Text } {
    if (not isGovernor(caller) or Principal.isAnonymous(id)) return #Err("Governor and valid identity required");
    if (newClubGroup != ?"g2" or newClubRouter == null or newClubTarget == null) return #Err("Complete Group 2 placement binding required");
    if (profiles.size() != 0 or identityUnlinkReceipts.size() != 0) return #Err("Empty owner-test group required");
    if (identityAccessCanister != null and identityAccessCanister != ?id) return #Err("Deletion identity already bound");
    identityAccessCanister := ?id;
    #Ok
  };
  type LinkedAccount = { id : Text; principals : [Principal]; version : Nat64; status : { #Active; #Suspended } };
  public shared ({ caller }) func sync_my_linked_account() : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    let authority = switch (identityAccessCanister) { case null return #Err("Identity authority not configured"); case (?id) id };
    let epoch = membershipEpoch;
    let service : actor { read_linked_account : shared (Principal) -> async { #Ok : LinkedAccount; #Err : Text } } = actor(authority.toText());
    let reply = try { await (with timeout = 10) service.read_linked_account(caller) } catch (_) { return #Err("Identity authority unavailable") };
    if (identityAccessCanister != ?authority or epoch != membershipEpoch) return #Err("Account authority changed; retry");
    let account = switch (reply) { case (#Err(e)) return #Err(e); case (#Ok(a)) a };
    if (account.status != #Active or account.principals.size() == 0 or account.principals.size() > 8 or not account.principals.any(func(p) = p == caller)
        or account.principals.any(Principal.isAnonymous)) return #Err("Invalid linked account");
    if (AccountUnlinkFence.rejects(account.id, account.version, account.principals, identityUnlinkReceipts)) return #Err("Revoked linked account snapshot");
    if (accounts.any(func(a) = a.id == account.id and a.version > account.version)) return #Err("Stale linked account");
    if (accounts.any(func(a) = a.id == account.id and a.version == account.version and
        (a.principals.size() != account.principals.size() or a.principals.any(func(p) = not account.principals.any(func(q) = p == q))))) return #Err("Conflicting linked account snapshot");
    // A linked identity cannot bypass a removal recorded for another alias.
    var exclusions = acl.exclusions.concat(removedMembers.map(func(m) = { club = m.club; user = m.user }));
    for (e in exclusions.values()) if (account.principals.any(func(p) = p == e.user)) {
      for (p in account.principals.values()) if (not exclusions.any(func(x) = x.club == e.club and x.user == p)) exclusions := exclusions.concat([{ club = e.club; user = p }]);
    };
    acl := { acl with exclusions };
    // Drop obsolete local aliases instead of trusting old local link challenges.
    accounts := accounts.filter(func(a) = a.id != account.id and not a.principals.any(func(p) = account.principals.any(func(q) = p == q)))
      .concat([{ id = account.id; version = account.version; principals = account.principals; legacy_subject = caller }]);
    membershipEpoch += 1; #Ok
  
    } finally { removalReceiver.leave(caller) };
  };
  public shared ({ caller }) func revoke_linked_principal(account_id : Text, user : Principal, version : Nat64) : async { #Ok; #Err : Text } {
    if (identityAccessCanister != ?caller or Principal.isAnonymous(caller)) return #Err("Identity authority required");
    if (Principal.isAnonymous(user) or user == governor) return #Err("Cannot revoke identity");
    if (identityUnlinkReceipts.any(func(r) = r.0 == account_id and r.1 == user and r.2 >= version)) return #Ok;
    switch (accounts.find(func(a) = a.id == account_id)) {
      case (?a) { if (a.version > version) return #Err("Account version conflict") };
      case null {};
    };
    if (identityUnlinkReceipts.size() >= 100000) return #Err("Identity unlink ledger full");
    // Unlink is NOT permanent account erasure. Remove this principal's
    // authority, preserving account-owned rows and other people's roles.
    acl := { acl with roles = acl.roles.filter(func(r) = r.user != user);
      guardians = acl.guardians.filter(func(g) = g.user != user);
      children = acl.children.map(func(c) = if (c.parent == ?user) ({ c with parent = null }) else c) };
    accounts := accounts.map(func(a) = { a with principals = a.principals.filter(func(p) = p != user) });
    identityUnlinkReceipts := identityUnlinkReceipts.filter(func(r) = not (r.0 == account_id and r.1 == user)).concat([(account_id, user, version)]);
    membershipEpoch += 1; #Ok
  };

  func getListing(club : Text) : Types.Listing {
    for (entry in clubListings.values()) {
      if (entry.0 == club) return entry.1;
    };
    { links = []; revision = 0 }
  };

  func updateListing(club : Text, listing : Types.Listing) {
    clubListings := clubListings.filter(func(entry) = entry.0 != club);
    clubListings := clubListings.concat([(club, listing)]);
  };

  func requestFingerprint(req : Types.Request) : Text {
    debug_show ({ club = req.club; operation = req.operation; expected_revision = req.expected_revision })
  };

  func findLoggedMutation(request_id : Text) : ?(Text, Types.Mutation) {
    for (entry in mutationLog.values()) {
      if (entry.0 == request_id) return ?(entry.1, entry.2);
    };
    null
  };

  func logMutation(request_id : Text, fingerprint : Text, mutation : Types.Mutation) {
    mutationLog := mutationLog.filter(func(entry) = entry.0 != request_id);
    mutationLog := mutationLog.concat([(request_id, fingerprint, mutation)]);
    let logLimit = 500;
    if (mutationLog.size() > logLimit) {
      let overflow = mutationLog.size() - logLimit;
      mutationLog := Array.tabulate<(Text, Text, Types.Mutation)>(logLimit, func(i) { mutationLog[overflow + i] });
    };
  };

  public shared ({ caller }) func save_club_profile(profile : Types.ClubProfile) : async { #Ok : Types.ClubProfile; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isAdmin(caller, profile.id)) return #Err("Club admin required");
    membershipEpoch += 1;
    profiles := profiles.filter(func(p) = p.id != profile.id);
    membershipEpoch += 1;
    profiles := profiles.concat([profile]);
    #Ok(profile)
  
    } finally { removalReceiver.leave(caller) };
  };

  public query func get_club_profile(id : Text) : async { #Ok : ?Types.ClubProfile; #Err : Text } {
    for (p in profiles.values()) {
      if (p.id == id) return #Ok(?p);
    };
    #Ok(null)
  };

  public query func list_clubs(start_after : ?Text, limit : Nat16) : async { #Ok : [Types.ClubProfile]; #Err : Text } {
    if (limit == 0 or limit > 100) return #Err("Invalid page size");
    var res : [Types.ClubProfile] = [];
    var started = start_after == null;
    for (p in profiles.values()) {
      if (not started and start_after == ?p.id) {
        started := true;
      } else if (started and res.size() < Nat16.toNat(limit)) {
        res := res.concat([p]);
      };
    };
    #Ok(res)
  };

  public shared ({ caller }) func save_club_settings(item : Types.ClubSettings) : async { #Ok : Types.ClubSettings; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isAdmin(caller, item.club_id)) return #Err("Club admin required");
    settings := settings.filter(func(s) = s.club_id != item.club_id);
    settings := settings.concat([item]);
    #Ok(item)
  
    } finally { removalReceiver.leave(caller) };
  };

  public query func get_club_settings(club_id : Text) : async { #Ok : ?Types.ClubSettings; #Err : Text } {
    for (s in settings.values()) {
      if (s.club_id == club_id) return #Ok(?s);
    };
    #Ok(null)
  };

  public query ({ caller }) func get_club_invite_message_default(club_id : Text) : async { #Ok : ?Types.InviteMessageDefault; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    #Ok(inviteMessageDefaults.find(func(item) = item.club_id == club_id))
  };

  func welcomeEmailLimitsOk(subject : Text, message : Text) : Bool {
    let trimmed = Text.trim(subject, #char ' ');
    trimmed.size() > 0 and subject.size() <= 160 and message.size() <= 4000
  };

  public query ({ caller }) func get_team_welcome_email(team_id : Text) : async { #Ok : ?Types.TeamWelcomeEmail; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    switch (teams.find(func(t) = t.id == team_id)) {
      case null { #Ok(null) };
      case (?team) {
        if (not canManageTeam(caller, team.club_id, ?team_id)) return #Err("Team or club admin required");
        #Ok(teamWelcomeEmails.find(func(item) = item.team_id == team_id))
      };
    }
  };

  public shared ({ caller }) func set_team_welcome_email(team_id : Text, enabled : Bool, subject : Text, message : Text) : async { #Ok : Types.TeamWelcomeEmail; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not welcomeEmailLimitsOk(subject, message)) return #Err("Invalid welcome email");
    switch (teams.find(func(t) = t.id == team_id)) {
      case null { #Err("Team not found") };
      case (?team) {
        if (not canManageTeam(caller, team.club_id, ?team_id)) return #Err("Team or club admin required");
        let value : Types.TeamWelcomeEmail = { team_id; club_id = team.club_id; enabled; subject; message };
        teamWelcomeEmails := teamWelcomeEmails.filter(func(item) = item.team_id != team_id).concat([value]);
        #Ok(value)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // Read by the welcome-email edge function with no session. The invite id is
  // the bearer secret (same trust as get_pending_invite); the job exists only
  // for a recently accepted, team-scoped invite whose team enabled the email.
  public query func get_welcome_email_job(invite_id : Text) : async { #Ok : Types.WelcomeEmailJob; #Err : Text } {
    let invite = switch (pendingInvites.find(func(i) = i.id == invite_id)) {
      case null { return #Err("Invite not found") };
      case (?value) value;
    };
    if (invite.status != "accepted") return #Err("Invite not accepted");
    let acceptedAt = switch (invite.accepted_at_ms) { case (?ms) ms; case null { return #Err("Invite not accepted") } };
    if (nowMs() > acceptedAt + 3_600_000) return #Err("Welcome email window has passed");
    let teamId = switch (invite.team_id) { case (?id) id; case null { return #Err("Invite has no team") } };
    if (invite.email == "") return #Err("Invite has no email");
    let team = switch (teams.find(func(t) = t.id == teamId)) { case (?value) value; case null { return #Err("Team not found") } };
    let setting = switch (teamWelcomeEmails.find(func(item) = item.team_id == teamId and item.enabled)) {
      case (?value) value;
      case null { return #Err("Welcome email disabled") };
    };
    let clubName = switch (profiles.find(func(p) = p.id == team.club_id)) { case (?club) club.name; case null "your club" };
    #Ok({
      invite_id;
      to = invite.email;
      subject = setting.subject;
      message = setting.message;
      team_name = team.name;
      club_name = clubName;
    })
  };

  public shared ({ caller }) func set_club_invite_message_default(club_id : Text, message : Text) : async { #Ok : Types.InviteMessageDefault; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    if (club_id == "" or club_id.size() > 128 or message.size() > 2000) return #Err("Invalid invite message");
    let value : Types.InviteMessageDefault = { club_id; message };
    inviteMessageDefaults := inviteMessageDefaults.filter(func(item) = item.club_id != club_id).concat([value]);
    #Ok(value)
  
    } finally { removalReceiver.leave(caller) };
  };

  // Caller-owned clubless ("personal") team: club_id "" marks it personal,
  // authorized via personalTeamOwners instead of club acl roles.
  func isPersonalTeamOwner(caller : Principal, team_id : Text) : Bool {
    personalTeamOwners.any(func(pair) = pair.0 == team_id and pair.1.equal(caller))
  };

  public shared ({ caller }) func save_team(team : Types.ClubTeam) : async { #Ok : Types.ClubTeam; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    let isNew = not teams.any(func(t) = t.id == team.id);
    if (team.club_id == "") {
      if (not (isGovernor(caller) or isNew or isPersonalTeamOwner(caller, team.id))) return #Err("Team owner required");
    } else if (not isAdmin(caller, team.club_id)) {
      return #Err("Club admin required");
    };
    membershipEpoch += 1;
    teams := teams.filter(func(t) = t.id != team.id);
    membershipEpoch += 1;
    teams := teams.concat([team]);
    if (team.club_id == "") {
      if (isNew and not isPersonalTeamOwner(caller, team.id)) {
        personalTeamOwners := personalTeamOwners.concat([(team.id, caller)]);
      };
    } else if (isNew) {
      // Provision the team chat on the messaging canister (best-effort).
      ignore fanOutEnsureConversation(team.club_id, ?team.id, teamChatParticipants(team.club_id, team.id));
    };
    #Ok(team)
  
    } finally { removalReceiver.leave(caller) };
  };

  // Lists the caller's own clubless teams (owner-only; not reachable via
  // list_teams/list_teams_multi, which are club-scoped).
  public query ({ caller }) func list_my_personal_teams() : async { #Ok : [Types.ClubTeam]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    let mine = personalTeamOwners.filter(func(pair) = pair.1.equal(caller)).map(func(pair) = pair.0);
    #Ok(teams.filter(func(t) = mine.any(func(id) = id == t.id)))
  };

  public query func get_team(id : Text) : async { #Ok : ?Types.ClubTeam; #Err : Text } {
    for (t in teams.values()) {
      if (t.id == id) return #Ok(?t);
    };
    #Ok(null)
  };

  public query func list_teams(club_id : Text) : async { #Ok : [Types.ClubTeam]; #Err : Text } {
    var res : [Types.ClubTeam] = [];
    for (t in teams.values()) {
      if (t.club_id == club_id) res := res.concat([t]);
    };
    #Ok(res)
  };

  // ---- Batched reads (one round trip per page instead of one per id) ----
  // Same visibility as the single-id queries above; capped to keep replies small.
  public query func get_club_profiles(ids : [Text]) : async { #Ok : [Types.ClubProfile]; #Err : Text } {
    if (ids.size() > 200) return #Err("Too many ids");
    #Ok(profiles.filter(func(p) = ids.any(func(i) = i == p.id)))
  };

  public query func get_teams(ids : [Text]) : async { #Ok : [Types.ClubTeam]; #Err : Text } {
    if (ids.size() > 500) return #Err("Too many ids");
    #Ok(teams.filter(func(t) = ids.any(func(i) = i == t.id)))
  };

  public query func list_teams_multi(club_ids : [Text]) : async { #Ok : [Types.ClubTeam]; #Err : Text } {
    if (club_ids.size() > 200) return #Err("Too many ids");
    #Ok(teams.filter(func(t) = club_ids.any(func(i) = i == t.club_id)))
  };

  // Team folders (Supabase team_folders counterpart): club-admin-managed
  // groupings for the club's teams list. Folder metadata is website-safe
  // (name/description/color only), so the read is unauthenticated like
  // list_teams; writes are club-admin gated via the folder's owning club.
  var teamFolders : [Types.TeamFolder];
  var personalTeamOwners : [(Text, Principal)];
  var clubParentOrgs : [(Text, Text)];

  func clubKindOf(club_id : Text) : Text {
    switch (clubKinds.find(func((k, _)) = k == club_id)) { case (?(_, v)) v; case null "full" }
  };

  func parentOrgOf(club_id : Text) : ?Text {
    switch (clubParentOrgs.find(func((k, _)) = k == club_id)) { case (?(_, v)) ?v; case null null }
  };

  // Link (parent = ?assoc) or unlink (parent = null) a club and an
  // association. Only an admin of the association involved may do either.
  public shared ({ caller }) func set_club_parent_org(club_id : Text, parent_id : ?Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (profiles.find(func(p) = p.id == club_id) == null) return #Err("Club not found");
    switch (parent_id) {
      case (?assoc) {
        if (assoc == club_id) return #Err("A club can't be its own association");
        if (clubKindOf(assoc) != "association") return #Err("Target is not an association");
        if (clubKindOf(club_id) == "association") return #Err("Associations can't be linked");
        if (not isAdmin(caller, assoc)) return #Err("Association admin required");
        if (parentOrgOf(club_id) != null) return #Err("Club already belongs to an association");
        clubParentOrgs := clubParentOrgs.concat([(club_id, assoc)]);
      };
      case null {
        switch (parentOrgOf(club_id)) {
          case null {};
          case (?assoc) {
            if (not isAdmin(caller, assoc)) return #Err("Association admin required");
            clubParentOrgs := clubParentOrgs.filter(func((k, _)) = k != club_id);
          };
        };
      };
    };
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  public query func list_association_clubs(association_id : Text) : async { #Ok : [Types.ClubProfile]; #Err : Text } {
    #Ok(profiles.filter(func(p) = parentOrgOf(p.id) == ?association_id))
  };

  // Full (non-association) active clubs with no association, name-filtered.
  public query func list_unaffiliated_clubs(search : Text, limit : Nat16) : async { #Ok : [Types.ClubProfile]; #Err : Text } {
    if (limit == 0 or limit > 100) return #Err("Invalid page size");
    let needle = search.trim(#char ' ').toLower();
    var res : [Types.ClubProfile] = [];
    for (p in profiles.values()) {
      if (res.size() < Nat16.toNat(limit) and p.is_active and clubKindOf(p.id) != "association" and parentOrgOf(p.id) == null
          and (needle == "" or p.name.toLower().contains(#text needle))) {
        res := res.concat([p]);
      };
    };
    #Ok(res)
  };

  public shared ({ caller }) func save_team_folder(folder : Types.TeamFolder) : async { #Ok : Types.TeamFolder; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isAdmin(caller, folder.club_id)) return #Err("Club admin required");
    let name = Text.trim(folder.name, #char ' ');
    if (name.size() == 0 or name.size() > 80) return #Err("Folder name must be 1-80 characters");
    let saved = { folder with name = name };
    teamFolders := teamFolders.filter(func(f) = f.id != folder.id).concat([saved]);
    #Ok(saved)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func delete_team_folder(folder_id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (teamFolders.find(func(f) = f.id == folder_id)) {
      case null { #Err("Folder not found") };
      case (?folder) {
        if (not isAdmin(caller, folder.club_id)) return #Err("Club admin required");
        teamFolders := teamFolders.filter(func(f) = f.id != folder_id);
        // Teams in the deleted folder fall back to the unfiled group.
        membershipEpoch += 1;
        teams := teams.map(func(t) = if (t.folder_id == ?folder_id) ({ t with folder_id = null }) else t);
        #Ok
      };
    };
  
    } finally { removalReceiver.leave(caller) };
  };

  public query func list_team_folders(club_id : Text) : async { #Ok : [Types.TeamFolder]; #Err : Text } {
    var res : [Types.TeamFolder] = [];
    for (f in teamFolders.values()) {
      if (f.club_id == club_id) res := res.concat([f]);
    };
    #Ok(res)
  };

  public shared ({ caller }) func set_team_folder(team_id : Text, folder_id : ?Text) : async { #Ok : Types.ClubTeam; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (teams.find(func(t) = t.id == team_id)) {
      case null { #Err("Team not found") };
      case (?team) {
        if (not isAdmin(caller, team.club_id)) return #Err("Club admin required");
        switch (folder_id) {
          case (?fid) {
            switch (teamFolders.find(func(f) = f.id == fid)) {
              case null { return #Err("Folder not found") };
              case (?f) { if (f.club_id != team.club_id) return #Err("Folder belongs to a different club") };
            };
          };
          case null {};
        };
        let updated = { team with folder_id = folder_id };
        membershipEpoch += 1;
        teams := teams.map(func(t) = if (t.id == team_id) updated else t);
        #Ok(updated)
      };
    };
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func save_sponsor(sponsor : Types.ClubSponsor) : async { #Ok : Types.ClubSponsor; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isAdmin(caller, sponsor.club_id)) return #Err("Club admin required");
    sponsors := sponsors.filter(func(s) = s.id != sponsor.id);
    sponsors := sponsors.concat([sponsor]);
    #Ok(sponsor)
  
    } finally { removalReceiver.leave(caller) };
  };

  public query func get_sponsor(id : Text) : async { #Ok : ?Types.ClubSponsor; #Err : Text } {
    for (s in sponsors.values()) {
      if (s.id == id) return #Ok(?s);
    };
    #Ok(null)
  };

  public query func list_sponsors(club_id : Text) : async { #Ok : [Types.ClubSponsor]; #Err : Text } {
    var res : [Types.ClubSponsor] = [];
    for (s in sponsors.values()) {
      if (s.club_id == club_id) res := res.concat([s]);
    };
    #Ok(res)
  };

  // Team sponsor allocations (Supabase team_sponsor_allocations counterpart).
  // Read stance matches list_sponsors: sponsor strips render for every
  // member, so the read is unauthenticated; writes are club-admin gated via
  // the sponsor's owning club.
  public query func list_sponsors_multi(club_ids : [Text]) : async { #Ok : [Types.ClubSponsor]; #Err : Text } {
    if (club_ids.size() > 200) return #Err("Too many ids");
    #Ok(sponsors.filter(func(s) = club_ids.any(func(c) = c == s.club_id)))
  };

  public query func list_team_sponsor_allocations(club_id : Text) : async { #Ok : [Types.TeamSponsorAllocation]; #Err : Text } {
    var res : [Types.TeamSponsorAllocation] = [];
    for (a in teamSponsorAllocations.values()) {
      switch (sponsors.find(func(s) = s.id == a.sponsor_id)) {
        case (?sponsor) { if (sponsor.club_id == club_id) res := res.concat([a]) };
        case null {};
      };
    };
    #Ok(res)
  };

  public shared ({ caller }) func set_team_sponsor_allocation(sponsor_id : Text, team_id : Text, allocated : Bool) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (sponsors.find(func(s) = s.id == sponsor_id)) {
      case null { #Err("Sponsor not found") };
      case (?sponsor) {
        if (not isAdmin(caller, sponsor.club_id)) return #Err("Club admin required");
        if (allocated) {
          let exists = teamSponsorAllocations.find(func(a) = a.sponsor_id == sponsor_id and a.team_id == team_id) != null;
          if (not exists) {
            teamSponsorAllocations := teamSponsorAllocations.concat([{ sponsor_id = sponsor_id; team_id = team_id }]);
          };
        } else {
          teamSponsorAllocations := teamSponsorAllocations.filter(func(a) = not (a.sponsor_id == sponsor_id and a.team_id == team_id));
        };
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // Hard delete — the Supabase sponsor manager deletes rows outright, so
  // the canister matches (is_active remains available for soft hiding).
  public shared ({ caller }) func delete_sponsor(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (sponsors.find(func(s) = s.id == id)) {
      case null { #Err("Sponsor not found") };
      case (?sponsor) {
        if (not isAdmin(caller, sponsor.club_id)) return #Err("Club admin required");
        sponsors := sponsors.filter(func(s) = s.id != id);
        teamSponsorAllocations := teamSponsorAllocations.filter(func(a) = a.sponsor_id != id);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  func validNewsStatus(status : Text) : Bool { status == "draft" or status == "published" };

  // A team belongs to a club if either the ACL mirror or the team records
  // say so — teams created via save_team only exist in the records store.
  func teamInClub(teamId : Text, club : Text) : Bool {
    acl.teams.any(func(t) = t.id == teamId and t.club == club)
    or teams.any(func(t) = t.id == teamId and t.club_id == club and t.deleted_at_ms == null)
  };

  // Caller belongs to (or parents a child on) the given team.
  func isOnTeam(caller : Principal, teamId : Text) : Bool {
    acl.roles.any(func(grant) = grant.user.equal(caller) and grant.team == ?teamId)
    or acl.children.any(func(c) {
      let isParent = switch (c.parent) { case (?p) p.equal(caller); case null false };
      let isGuardian = acl.guardians.any(func(g) = g.child == c.id and g.user.equal(caller));
      (isParent or isGuardian) and c.teams.any(func(t) = t == teamId)
    })
  };

  func trustedCompetition(caller : Principal) : Bool {
    competitionAuthorities.any(func(p) = p.equal(caller)) or (switch (competitionDomainCanister) { case (?p) p.equal(caller); case null false })
  };
  public shared ({ caller }) func set_competition_authorities(ids : [Principal]) : async { #Ok; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor only");
    if (ids.size() > 64 or ids.any(func(p) = p.equal(Principal.anonymous()))) return #Err("Invalid authorities");
    competitionAuthorities := ids; #Ok
  };
  func liveTeamClub(teamId : Text) : ?Text {
    switch (teams.find(func(t) = t.id == teamId and t.deleted_at_ms == null)) {
      case (?t) ?t.club_id;
      case null switch (acl.teams.find(func(t) = t.id == teamId)) { case (?t) ?t.club; case null null };
    }
  };
  public shared query ({ caller }) func read_competition_team_access(team_id : Text, user : Principal) : async { club_id : ?Text; is_member : Bool; can_manage : Bool } {
    denyLegacyAccountQuery();
    if (not trustedCompetition(caller) or user.equal(Principal.anonymous()) or team_id.size() > 128) return { club_id = null; is_member = false; can_manage = false };
    switch (liveTeamClub(team_id)) {
      case null ({ club_id = null; is_member = false; can_manage = false });
      case (?club) {
        let allowed = not isExcluded(user, club);
        { club_id = ?club; is_member = allowed and (isOnTeam(user, team_id) or isAdmin(user, club));
          can_manage = allowed and (isAdmin(user, club) or acl.roles.any(func(g) = g.user.equal(user) and g.club == ?club and g.team == ?team_id and (g.role == "team_admin" or g.role == "coach"))) }
      };
    }
  };
  public shared query ({ caller }) func is_user_on_any_team(team_ids : [Text], user : Principal) : async Bool {
    denyLegacyAccountQuery();
    if (user.equal(Principal.anonymous()) or team_ids.size() > 500) return false;
    let trusted = trustedCompetition(caller) or (switch (messagingDomainCanister) { case (?p) p.equal(caller); case null false });
    trusted and team_ids.any(func(teamId) = switch (liveTeamClub(teamId)) {
      case null false;
      case (?club) not isExcluded(user, club) and isOnTeam(user, teamId);
    })
  };

  func addNewsPrincipal(recipients : [Principal], user : Principal) : [Principal] {
    if (user.equal(Principal.anonymous()) or recipients.any(func(existing) = existing.equal(user))) recipients
    else recipients.concat([user])
  };

  func competitionNewsRecipients(audience : { club_id : Text; competition_id : Text; team_ids : [Text]; recipients : [Principal]; can_publish : Bool }) : [Principal] {
    var recipients = audience.recipients;
    for (grant in acl.roles.values()) {
      if (switch (grant.team) { case (?teamId) audience.team_ids.any(func(id) = id == teamId); case null false }) {
        recipients := addNewsPrincipal(recipients, grant.user);
      };
    };
    for (child in acl.children.values()) {
      if (child.teams.any(func(teamId) = audience.team_ids.any(func(id) = id == teamId))) {
        switch (child.parent) { case (?parent) recipients := addNewsPrincipal(recipients, parent); case null {} };
        for (guardian in acl.guardians.values()) {
          if (guardian.child == child.id) recipients := addNewsPrincipal(recipients, guardian.user);
        };
      };
    };
    recipients
  };

  // Club admins see every post; members see published posts, and
  // team-targeted posts only when they belong to one of the target teams.
  func canSeeNewsPost(caller : Principal, post : Types.NewsPost) : Bool {
    if (isAdmin(caller, post.club_id)) return true;
    if (post.status != "published") return false;
    switch (post.target_mini_league_id) {
      // Mini-league visibility is revalidated through mini_league_domain by
      // list_news_authorized; never trust the creation-time notification snapshot.
      case (?_) { return false };
      case null {};
    };
    if (post.target_competition_id != null) return false;
    if (not isMember(caller, post.club_id)) return false;
    switch (post.target_team_ids) {
      case null { true };
      case (?teamIds) { teamIds.any(func(teamId) = isOnTeam(caller, teamId)) };
    }
  };

  func resolveNewsAudience(caller : Principal, club_id : Text, target_team_ids : ?[Text], target_mini_league_id : ?Text, target_competition_id : ?Text) : async { #Ok : [Principal]; #Err : Text } {
    let teamTargeted = switch (target_team_ids) { case (?ids) ids.size() > 0; case null false };
    let audienceCount = (if (teamTargeted) 1 else 0) + (if (target_mini_league_id != null) 1 else 0) + (if (target_competition_id != null) 1 else 0);
    if (audienceCount > 1) return #Err("Choose one news audience");
    switch (target_competition_id) {
      case (?competition_id) {
        let canister = switch (competitionDomainCanister) {
          case (?id) id;
          case null return #Err("Competition domain not configured");
        };
        let competitionDomain : actor {
          get_news_audience : shared (Text, Principal) -> async { #Ok : { competition_id : Text; club_id : Text; team_ids : [Text]; recipients : [Principal]; can_publish : Bool }; #Err : Text };
        } = actor (Principal.toText(canister));
        let result = try {
          await competitionDomain.get_news_audience(competition_id, caller)
        } catch (_) {
          return #Err("Competition audience lookup failed");
        };
        switch (result) {
          case (#Err(err)) return #Err(err);
          case (#Ok(audience)) {
            if (audience.club_id != club_id or audience.competition_id != competition_id) return #Err("Competition does not belong to this club");
            if (not audience.can_publish) return #Err("Competition admin required");
            if (audience.team_ids.size() > 100) return #Err("Competition audience exceeds 100 teams");
            let recipients = competitionNewsRecipients(audience);
            if (recipients.size() > 500) return #Err("Competition audience exceeds 500 members");
            return #Ok(recipients);
          };
        }
      };
      case null {};
    };
    switch (target_mini_league_id) {
      case null { #Ok([]) };
      case (?mini_league_id) {
        let canister = switch (miniLeagueDomainCanister) {
          case (?id) id;
          case null return #Err("Mini-league domain not configured");
        };
        let miniLeague : actor {
          get_news_audience : shared query (Text, Principal) -> async { #Ok : { club_id : Text; recipients : [Principal] }; #Err : Text };
        } = actor (Principal.toText(canister));
        let result = try {
          await miniLeague.get_news_audience(mini_league_id, caller)
        } catch (_) {
          return #Err("Mini-league audience lookup failed");
        };
        switch (result) {
          case (#Err(e)) { #Err(e) };
          case (#Ok(audience)) {
            if (audience.club_id != club_id) return #Err("Mini league does not belong to this club");
            if (audience.recipients.size() > 500) return #Err("Mini-league audience exceeds 500 members");
            #Ok(audience.recipients)
          };
        }
      };
    }
  };

  func fanOutTargetedNews(post : Types.NewsPost, send_push : Bool) : async () {
    if (not send_push or post.status != "published" or (post.target_mini_league_id == null and post.target_competition_id == null)) return;
    switch (notificationQueueCanister) {
      case null {};
      case (?queueId) {
        let recipients = newsAudienceRecipients
          .filter(func(item) = item.news_id == post.id and not item.user.equal(post.created_by))
          .map(func(item) = Principal.toText(item.user));
        if (recipients.size() == 0) return;
        let queue : actor {
          fan_out : shared ([Text], Text, Text, Text, Text, ?Text) -> async { #Ok : Nat16; #Err : Text };
        } = actor (Principal.toText(queueId));
        let keyPrefix = "club_news:" # post.id;
        try {
          ignore await queue.fan_out(recipients, post.club_id, "club_news", "New news: " # post.title, keyPrefix, ?post.id)
        } catch (_) {};
      };
    }
  };

  func validateNewsExtras(club_id : Text, target_team_ids : ?[Text], target_mini_league_id : ?Text, target_competition_id : ?Text, image_url : ?Text, attachments : [Types.NewsAttachment]) : ?Text {
    let teamTargeted = switch (target_team_ids) { case (?ids) ids.size() > 0; case null false };
    let audienceCount = (if (teamTargeted) 1 else 0) + (if (target_mini_league_id != null) 1 else 0) + (if (target_competition_id != null) 1 else 0);
    if (audienceCount > 1) return ?"Choose one news audience";
    switch (target_team_ids) {
      case null {};
      case (?teamIds) {
        if (teamIds.size() > 100) return ?"Too many target teams";
        for (teamId in teamIds.values()) {
          if (not teamInClub(teamId, club_id)) return ?"Target team not in club";
        };
      };
    };
    switch (image_url) {
      case null {};
      case (?url) { if (url.size() > 2048) return ?"Invalid image" };
    };
    if (attachments.size() > 12) return ?"Too many attachments";
    for (a in attachments.values()) {
      if (a.kind != "image" and a.kind != "file") return ?"Invalid attachment kind";
      if (a.url == "" or a.url.size() > 2048) return ?"Invalid attachment";
      if (a.name.size() > 256) return ?"Invalid attachment name";
    };
    null
  };

  public shared ({ caller }) func create_news_post(club_id : Text, title : Text, body : Text, status : Text, target_team_ids : ?[Text], target_mini_league_id : ?Text, target_competition_id : ?Text, send_push : Bool, is_important : Bool, image_url : ?Text, attachments : [Types.NewsAttachment]) : async { #Ok : Types.NewsPost; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (target_competition_id == null and not isAdmin(caller, club_id)) return #Err("Club admin required");
    if (club_id == "" or club_id.size() > 128) return #Err("Invalid club");
    if (title == "" or title.size() > 200) return #Err("Invalid title");
    if (body.size() > 8000) return #Err("Invalid body");
    if (not validNewsStatus(status)) return #Err("Invalid status");
    switch (validateNewsExtras(club_id, target_team_ids, target_mini_league_id, target_competition_id, image_url, attachments)) {
      case (?err) return #Err(err);
      case null {};
    };
    let audienceRecipients = switch (await resolveNewsAudience(caller, club_id, target_team_ids, target_mini_league_id, target_competition_id)) {
      case (#Err(err)) return #Err(err);
      case (#Ok(recipients)) recipients;
    };
    if (target_competition_id == null and not isAdmin(caller, club_id)) return #Err("Club admin required");
    let now = nowMs();
    let post : Types.NewsPost = {
      id = "news-" # club_id # "-" # Nat64.toText(nowNs());
      club_id; title; body; status;
      created_by = caller;
      created_at_ms = now;
      updated_at_ms = now;
      revision = 1;
      target_team_ids; target_mini_league_id; target_competition_id; is_important; image_url; attachments;
    };
    mediaEvidenceRevision += 1;
    newsPosts := newsPosts.concat([post]);
    if (target_mini_league_id != null or target_competition_id != null) {
      newsAudienceRecipients := newsAudienceRecipients.concat(audienceRecipients.map(func(user) = { news_id = post.id; user }));
    };
    await fanOutTargetedNews(post, send_push);
    #Ok(post)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func update_news_post(id : Text, title : Text, body : Text, status : Text, target_team_ids : ?[Text], target_mini_league_id : ?Text, target_competition_id : ?Text, send_push : Bool, is_important : Bool, image_url : ?Text, attachments : [Types.NewsAttachment], expected_revision : Nat64) : async { #Ok : Types.NewsPost; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (title == "" or title.size() > 200) return #Err("Invalid title");
    if (body.size() > 8000) return #Err("Invalid body");
    if (not validNewsStatus(status)) return #Err("Invalid status");
    switch (newsPosts.find(func(p) = p.id == id)) {
      case null { #Err("News post not found") };
      case (?current) {
        if (not isAdmin(caller, current.club_id) and current.target_competition_id == null) return #Err("Club admin required");
        if (current.revision != expected_revision) return #Err("News post revision conflict");
        switch (validateNewsExtras(current.club_id, target_team_ids, target_mini_league_id, target_competition_id, image_url, attachments)) {
          case (?err) return #Err(err);
          case null {};
        };
        let audienceRecipients = switch (await resolveNewsAudience(caller, current.club_id, target_team_ids, target_mini_league_id, target_competition_id)) {
          case (#Err(err)) return #Err(err);
          case (#Ok(recipients)) recipients;
        };
        if (target_competition_id == null and not isAdmin(caller, current.club_id)) return #Err("Club admin required");
        let updated : Types.NewsPost = { current with title; body; status; target_team_ids; target_mini_league_id; target_competition_id; is_important; image_url; attachments; updated_at_ms = nowMs(); revision = current.revision + 1 };
        mediaEvidenceRevision += 1;
        newsPosts := newsPosts.map(func(p) = if (p.id == id) updated else p);
        newsAudienceRecipients := newsAudienceRecipients.filter(func(item) = item.news_id != id);
        if (target_mini_league_id != null or target_competition_id != null) {
          newsAudienceRecipients := newsAudienceRecipients.concat(audienceRecipients.map(func(user) = { news_id = id; user }));
        };
        await fanOutTargetedNews(updated, send_push);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func delete_news_post(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (newsPosts.find(func(p) = p.id == id)) {
      case null { #Err("News post not found") };
      case (?current) {
        if (current.target_competition_id == null) {
          if (not isAdmin(caller, current.club_id)) return #Err("Club admin required");
        } else {
          switch (await resolveNewsAudience(caller, current.club_id, null, null, current.target_competition_id)) {
            case (#Err(err)) return #Err(err);
            case (#Ok(_)) {};
          };
        };
        mediaEvidenceRevision += 1;
        newsPosts := newsPosts.filter(func(p) = p.id != id);
        newsAudienceRecipients := newsAudienceRecipients.filter(func(item) = item.news_id != id);
        newsTargets := newsTargets.filter(func(t) = t.0 != id);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // Competition / mini-league audience for a news post (null clears it).
  // Membership of those audiences lives on other canisters, so on ICP the
  // target is recorded for display; visibility still follows club/team rules.
  public shared ({ caller }) func set_news_post_target(post_id : Text, kind : Text, target_id : ?Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (newsPosts.find(func(p) = p.id == post_id)) {
      case null { #Err("News post not found") };
      case (?post) {
        if (not isAdmin(caller, post.club_id)) return #Err("Club admin required");
        newsTargets := newsTargets.filter(func(t) = t.0 != post_id);
        switch (target_id) {
          case null {};
          case (?tid) {
            if (kind != "competition" and kind != "mini_league") return #Err("Invalid target kind");
            if (tid == "" or tid.size() > 128) return #Err("Invalid target");
            newsTargets := newsTargets.concat([(post_id, kind, tid)]);
          };
        };
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func list_news_targets(club_ids : [Text]) : async { #Ok : [(Text, Text, Text)]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    if (club_ids.size() > 50) return #Err("Too many clubs");
    let visible = club_ids.filter(func(club) = isMember(caller, club) or isAdmin(caller, club));
    #Ok(newsTargets.filter(func(t) = newsPosts.any(func(p) =
      p.id == t.0 and visible.any(func(club) = club == p.club_id) and canSeeNewsPost(caller, p))))
  };

  // Admins see every post (including drafts); members see published posts
  // visible to them (whole-club, or team-targeted to a team they belong to).
  public query ({ caller }) func list_news(club_id : Text) : async { #Ok : [Types.NewsPost]; #Err : Text } {
    denyLegacyAccountQuery();
    if (not isMember(caller, club_id) and not isAdmin(caller, club_id) and not newsAudienceRecipients.any(func(item) = item.user.equal(caller) and newsPosts.any(func(post) = post.id == item.news_id and post.club_id == club_id))) return #Err("Forbidden");
    #Ok(newsPosts.filter(func(p) = p.club_id == club_id and canSeeNewsPost(caller, p)))
  };

  // Cross-club feed: visible posts from the clubs the caller belongs to.
  // Clubs the caller is not a member of are silently skipped.
  public query ({ caller }) func list_news_multi(club_ids : [Text]) : async { #Ok : [Types.NewsPost]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    if (club_ids.size() > 50) return #Err("Too many clubs");
    let visible = club_ids.filter(func(club) = isMember(caller, club) or isAdmin(caller, club) or newsAudienceRecipients.any(func(item) = item.user.equal(caller) and newsPosts.any(func(post) = post.id == item.news_id and post.club_id == club)));
    #Ok(newsPosts.filter(func(p) =
      visible.any(func(club) = club == p.club_id) and canSeeNewsPost(caller, p)))
  };

  func currentNewsAudienceAccess(caller : Principal, post : Types.NewsPost) : async Bool {
    if (isAdmin(caller, post.club_id)) return true;
    if (caller.equal(Principal.anonymous())) return false;
    if (post.target_competition_id != null) {
      let competition_id = switch (post.target_competition_id) { case (?id) id; case null "" };
      let canister = switch (competitionDomainCanister) {
        case (?id) id;
        case null return false;
      };
      let competitionDomain : actor {
        get_news_audience : shared (Text, Principal) -> async { #Ok : { competition_id : Text; club_id : Text; team_ids : [Text]; recipients : [Principal]; can_publish : Bool }; #Err : Text };
      } = actor (Principal.toText(canister));
      let result = try {
        await competitionDomain.get_news_audience(competition_id, caller)
      } catch (_) {
        return false;
      };
      return switch (result) {
        case (#Err(_)) false;
        case (#Ok(audience)) {
          audience.club_id == post.club_id and (
            audience.can_publish or
            (post.status == "published" and (
              audience.recipients.any(func(user) = user.equal(caller)) or
              audience.team_ids.any(func(teamId) = isOnTeam(caller, teamId))
            ))
          )
        };
      };
    };
    if (post.status != "published") return false;
    switch (post.target_mini_league_id) {
      case null { canSeeNewsPost(caller, post) };
      case (?mini_league_id) {
        let canister = switch (miniLeagueDomainCanister) {
          case (?id) id;
          case null return false;
        };
        let miniLeague : actor {
          get_news_audience : shared query (Text, Principal) -> async { #Ok : { club_id : Text; recipients : [Principal] }; #Err : Text };
        } = actor (Principal.toText(canister));
        let result = try {
          await miniLeague.get_news_audience(mini_league_id, caller)
        } catch (_) {
          return false;
        };
        switch (result) {
          case (#Err(_)) false;
          case (#Ok(audience)) {
            audience.club_id == post.club_id and audience.recipients.any(func(user) = user.equal(caller))
          };
        }
      };
    }
  };

  // Update call because current mini-league membership is verified by a
  // trusted inter-canister query; query methods cannot make that call.
  public shared ({ caller }) func list_news_authorized(club_ids : [Text]) : async { #Ok : [Types.NewsPost]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (club_ids.size() > 50) return #Err("Too many clubs");
    let candidatePosts = newsPosts.filter(func(post) =
      club_ids.any(func(club) = club == post.club_id) or post.target_competition_id != null
    );
    let targetedPosts = candidatePosts.filter(func(post) = post.target_mini_league_id != null or post.target_competition_id != null);
    if (targetedPosts.size() > 100) return #Err("Too many targeted news posts; narrow the feed scope");
    var visiblePosts : [Types.NewsPost] = [];
    for (post in candidatePosts.values()) {
      if (await currentNewsAudienceAccess(caller, post)) {
        visiblePosts := visiblePosts.concat([post]);
      };
    };
    #Ok(visiblePosts)
  
    } finally { removalReceiver.leave(caller) };
  };

  // Parent invites: a club/team admin mints a token for a child; the
  // accepting parent links themselves as guardian (and family member, when
  // their identity is linked to an account) in one atomic call — the
  // canister equivalent of the Supabase parent-invite RPCs. NOTE: this
  // trusts an unguessable admin-issued token for the specific existing child,
  // but revalidates child/team scope and issuer authority at acceptance.
  func parentInviteScopeValid(club_id : Text, team_id : ?Text, child_id : Text) : Bool {
    switch (acl.children.find(func(c) = c.id == child_id)) {
      case null false;
      case (?child) {
        let inClub = child.club_id == ?club_id or child.teams.any(func(t) = teamInClub(t, club_id));
        if (not inClub) return false;
        switch (team_id) {
          case null true;
          case (?team) teamInClub(team, club_id) and child.teams.any(func(t) = t == team);
        }
      };
    }
  };

  public shared ({ caller }) func create_parent_invite(club_id : Text, team_id : ?Text, child_id : Text) : async { #Ok : Types.ParentInvite; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not canManageTeam(caller, club_id, team_id)) return #Err("Team or club admin required");
    if (child_id == "" or child_id.size() > 128) return #Err("Invalid child");
    switch (team_id) {
      case (?team) {
        if (not teamInClub(team, club_id)) return #Err("Team not found in club");
      };
      case null {};
    };
    if (not parentInviteScopeValid(club_id, team_id, child_id)) return #Err("Referenced child not in invite scope");
    let token = "inv-" # (await randomHex(16));
    // Randomness is an async boundary: do not publish a token after removal,
    // a transfer fence or a child/team change during that call.
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    if (isExcluded(caller, club_id) or not canManageTeam(caller, club_id, team_id)) return #Err("Team or club admin required");
    if (not parentInviteScopeValid(club_id, team_id, child_id)) return #Err("Referenced child not in invite scope");
    let now = nowMs();
    let invite : Types.ParentInvite = {
      id = token;
      club_id; team_id; child_id;
      invited_by = caller;
      created_at_ms = now;
      expires_at_ms = now + 7 * 24 * 60 * 60 * 1000;
      accepted_by = null;
    };
    parentInvites := parentInvites.concat([invite]);
    #Ok(invite)
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func get_parent_invite(token : Text) : async { #Ok : Types.ParentInvite; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    switch (parentInvites.find(func(i) = i.id == token)) {
      case null { #Err("Invite not found") };
      case (?invite) {
        if (invite.expires_at_ms <= nowMs()) return #Err("Invite expired");
        if (isExcluded(caller, invite.club_id)) return #Err("Forbidden");
        if (isExcluded(invite.invited_by, invite.club_id) or not canManageTeam(invite.invited_by, invite.club_id, invite.team_id)) return #Err("Invite authorization changed");
        if (not parentInviteScopeValid(invite.club_id, invite.team_id, invite.child_id)) return #Err("Referenced child not in invite scope");
        switch (invite.accepted_by) {
          case (?user) {
            if (not user.equal(caller)) return #Err("Invite already accepted");
            if (not acl.guardians.any(func(g) = g.child == invite.child_id and g.user.equal(caller))) return #Err("Guardian authorization changed");
          };
          case null {};
        };
        #Ok(invite)
      };
    }
  };

  public shared ({ caller }) func accept_parent_invite(token : Text) : async { #Ok : Types.ParentInvite; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (parentInvites.find(func(i) = i.id == token)) {
      case null { #Err("Invite not found") };
      case (?invite) {
        if (isTransferFenced(invite.club_id)) return #Err("Club is temporarily locked for a transfer");
        if (isExcluded(caller, invite.club_id)) return #Err("Forbidden");
        if (isExcluded(invite.invited_by, invite.club_id) or not canManageTeam(invite.invited_by, invite.club_id, invite.team_id)) return #Err("Invite authorization changed");
        if (not parentInviteScopeValid(invite.club_id, invite.team_id, invite.child_id)) return #Err("Referenced child not in invite scope");
        switch (invite.accepted_by) {
          case (?user) {
            if (not user.equal(caller)) return #Err("Invite already accepted");
            if (not acl.guardians.any(func(g) = g.child == invite.child_id and g.user.equal(caller))) return #Err("Guardian authorization changed");
            return #Ok(invite)
          };
          case null {};
        };
        if (invite.expires_at_ms <= nowMs()) return #Err("Invite expired");
        // Ensure the child record exists and carries the invited team.
        switch (invite.team_id) {
          case (?team) {
            switch (acl.children.find(func(c) = c.id == invite.child_id)) {
              case null {
                let child : Types.Child = { id = invite.child_id; teams = [team]; parent = null; club_id = ?invite.club_id };
                membershipEpoch += 1;
                acl := { acl with children = acl.children.concat([child]) };
              };
              case (?child) {
                if (not child.teams.any(func(t) = t == team)) {
                  let updated : Types.Child = { child with teams = child.teams.concat([team]) };
                  membershipEpoch += 1;
                  acl := { acl with children = acl.children.map(func(c) = if (c.id == invite.child_id) updated else c) };
                };
              };
            };
          };
          case null {};
        };
        if (not acl.guardians.any(func(g) = g.child == invite.child_id and g.user.equal(caller))) {
          membershipEpoch += 1;
          acl := { acl with guardians = acl.guardians.concat([{ child = invite.child_id; user = caller }]) };
        };
        switch (accountFor(caller)) {
          case (?account) {
            if (not accountFamilies.any(func(f) = f.account_id == account.id and f.child_id == invite.child_id)) {
              membershipEpoch += 1;
              accountFamilies := accountFamilies.concat([{ account_id = account.id; child_id = invite.child_id }]);
            };
          };
          case null {};
        };
        let accepted : Types.ParentInvite = { invite with accepted_by = ?caller };
        parentInvites := parentInvites.map(func(i) = if (i.id == token) accepted else i);
        #Ok(accepted)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Pending-invite labels / role / team moves (added 20261015_000000) ----
  // Free-form admin-set label for an invite row (e.g. a nickname shown in the
  // invites table) — purely cosmetic, stored separately so PendingInvite
  // itself (and every migration mentioning it) stays untouched.

  public query func get_pending_invite_label(id : Text) : async ?Text {
    switch (pendingInviteLabels.find(func((k, _)) = k == id)) {
      case (?(_, v)) ?v;
      case null null;
    }
  };

  public shared ({ caller }) func set_pending_invite_label(id : Text, label_ : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (pendingInvites.find(func(i) = i.id == id)) {
      case null { #Err("Invite not found") };
      case (?invite) {
        if (not isAdmin(caller, invite.club_id)) return #Err("Club admin required");
        if (label_.size() > 200) return #Err("Label too long");
        pendingInviteLabels := pendingInviteLabels.filter(func((k, _)) = k != id).concat([(id, label_)]);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func update_pending_invite_role(id : Text, role : ?Text) : async { #Ok : Types.PendingInvite; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (pendingInvites.find(func(i) = i.id == id)) {
      case null { #Err("Invite not found") };
      case (?invite) {
        if (not isAdmin(caller, invite.club_id)) return #Err("Club admin required");
        if (invite.status == "accepted" or invite.status == "revoked") return #Err("Invite no longer pending");
        let updated : Types.PendingInvite = { invite with role };
        pendingInvites := pendingInvites.map(func(i) = if (i.id == id) updated else i);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func move_pending_invite_team(id : Text, team_id : ?Text) : async { #Ok : Types.PendingInvite; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (pendingInvites.find(func(i) = i.id == id)) {
      case null { #Err("Invite not found") };
      case (?invite) {
        if (not canManageTeam(caller, invite.club_id, invite.team_id)) return #Err("Team or club admin required");
        if (not canManageTeam(caller, invite.club_id, team_id)) return #Err("Team or club admin required");
        if (invite.status == "accepted" or invite.status == "revoked") return #Err("Invite no longer pending");
        let updated : Types.PendingInvite = { invite with team_id };
        pendingInvites := pendingInvites.map(func(i) = if (i.id == id) updated else i);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Season lifecycle: draft -> active (published) -> closed/archived.
  // publish_season closes any other currently-active season in the same
  // club so get_current_season stays unique. ----

  public shared ({ caller }) func publish_season(season_id : Text) : async { #Ok : Types.Season; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (seasons.find(func(s) = s.id == season_id)) {
      case null { #Err("Season not found") };
      case (?season) {
        if (not isAdmin(caller, season.club_id)) return #Err("Club admin required");
        let now = nowMs();
        seasons := seasons.map(func(s : Types.Season) : Types.Season {
          if (s.id == season_id) { { s with status = "active"; updated_at_ms = now } }
          else if (s.club_id == season.club_id and s.status == "active") { { s with status = "closed"; updated_at_ms = now } }
          else s;
        });
        switch (seasons.find(func(s) = s.id == season_id)) {
          case (?updated) #Ok(updated);
          case null #Err("Season not found");
        };
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func archive_season(season_id : Text) : async { #Ok : Types.Season; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (seasons.find(func(s) = s.id == season_id)) {
      case null { #Err("Season not found") };
      case (?season) {
        if (not isAdmin(caller, season.club_id)) return #Err("Club admin required");
        let updated : Types.Season = { season with status = "archived"; updated_at_ms = nowMs() };
        seasons := seasons.map(func(s) = if (s.id == season_id) updated else s);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // Season rollover: closes the source season and creates a new draft season
  // for the same club, copying its team assignments over as a starting point
  // for the new season's draft rosters (live ACL roles are untouched).
  public shared ({ caller }) func rollover_season(from_season_id : Text, new_name : Text, start_date : Text, end_date : Text) : async { #Ok : Types.Season; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (seasons.find(func(s) = s.id == from_season_id)) {
      case null { #Err("Season not found") };
      case (?fromSeason) {
        if (not isAdmin(caller, fromSeason.club_id)) return #Err("Club admin required");
        if (new_name == "" or new_name.size() > 200) return #Err("Invalid name");
        let now = nowMs();
        let newSeason : Types.Season = {
          id = "season-" # fromSeason.club_id # "-" # Nat.toText(seasons.size() + 1) # "-" # Nat64.toText(nowNs() % 1_000_000_000);
          club_id = fromSeason.club_id;
          name = new_name;
          status = "draft";
          start_date;
          end_date;
          created_at_ms = now;
          updated_at_ms = now;
        };
        let closedFrom : Types.Season = { fromSeason with status = if (fromSeason.status == "active") "closed" else fromSeason.status; updated_at_ms = now };
        seasons := seasons.map(func(s) = if (s.id == from_season_id) closedFrom else s).concat([newSeason]);
        let carried = seasonTeamAssignments.filter(func(a) = a.season_id == from_season_id).map(func(a : Types.SeasonTeamAssignment) : Types.SeasonTeamAssignment = { a with season_id = newSeason.id });
        seasonTeamAssignments := seasonTeamAssignments.concat(carried);
        #Ok(newSeason)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Season expression-of-interest (EOI) config: a free-form JSON blob
  // per season (form schema / open-close dates for the public EOI page). ----

  public query ({ caller }) func get_season_eoi_config(season_id : Text) : async { #Ok : ?Text; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    switch (seasons.find(func(s) = s.id == season_id)) {
      case null { #Err("Season not found") };
      case (?season) {
        if (not isMember(caller, season.club_id)) return #Err("Club membership required");
        #Ok(switch (seasonEoiConfig.find(func((k, _)) = k == season_id)) { case (?(_, v)) ?v; case null null });
      };
    }
  };

  func eoiSlug(t : Text) : Text {
    var out = "";
    var dash = false;
    for (c in t.toLower().chars()) {
      if ((c >= 'a' and c <= 'z') or (c >= '0' and c <= '9')) { out #= Text.fromChar(c); dash := false }
      else if (not dash and out.size() > 0) { out #= "-"; dash := true };
    };
    if (dash) Text.fromIter(out.chars().take(out.size() - 1)) else out
  };

  // Public (anonymous) EOI form config. Only the website-safe copy written
  // via set_season_public_eoi_config is returned — never the private config
  // blob (it holds the webhook token). Season matches by id, stored public
  // slug, or slugified name.
  func eoiPublicKey(id : Text) : Text { id # "\u{1F}public" };
  func eoiSlugKey(id : Text) : Text { id # "\u{1F}slug" };
  func eoiLookup(k : Text) : ?Text {
    switch (seasonEoiConfig.find(func((kk, _)) = kk == k)) { case (?(_, v)) ?v; case null null }
  };

  public query func get_public_eoi_config(club_slug : Text, season_slug : Text) : async { #Ok : ?{ season_id : Text; season_name : Text; club_id : Text; club_name : Text; club_logo_url : ?Text; config_json : ?Text }; #Err : Text } {
    switch (profiles.find(func(p) = (p.slug == club_slug or p.id == club_slug) and p.deleted_at_ms == null)) {
      case null #Ok(null);
      case (?club) {
        switch (seasons.find(func(s) = s.club_id == club.id and (s.id == season_slug or eoiLookup(eoiSlugKey(s.id)) == ?season_slug or eoiSlug(s.name) == season_slug))) {
          case null #Ok(null);
          case (?season) {
            #Ok(?{
              season_id = season.id; season_name = season.name; club_id = club.id; club_name = club.name;
              club_logo_url = club.logo_url;
              config_json = eoiLookup(eoiPublicKey(season.id));
            })
          };
        }
      };
    }
  };

  public shared ({ caller }) func set_season_public_eoi_config(season_id : Text, slug : ?Text, public_json : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (seasons.find(func(s) = s.id == season_id)) {
      case null { #Err("Season not found") };
      case (?season) {
        if (not isAdmin(caller, season.club_id)) return #Err("Club admin required");
        if (public_json.size() > 16_384) return #Err("Config too large");
        let pk = eoiPublicKey(season_id);
        let sk = eoiSlugKey(season_id);
        seasonEoiConfig := seasonEoiConfig.filter(func((k, _)) = k != pk and k != sk).concat([(pk, public_json)]);
        switch (slug) {
          case (?sl) { if (sl.size() > 0 and sl.size() <= 120) seasonEoiConfig := seasonEoiConfig.concat([(sk, sl)]) };
          case null {};
        };
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func set_season_eoi_config(season_id : Text, config_json : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (seasons.find(func(s) = s.id == season_id)) {
      case null { #Err("Season not found") };
      case (?season) {
        if (not isAdmin(caller, season.club_id)) return #Err("Club admin required");
        if (config_json.size() > 65_536) return #Err("Config too large");
        seasonEoiConfig := seasonEoiConfig.filter(func((k, _)) = k != season_id).concat([(season_id, config_json)]);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Season team assignments: draft per-season rosters, independent of
  // live ACL role grants. One assignment per (season_id, member_id) — adding
  // to a new team implicitly moves the member off any other team in the
  // same season. ----

  public query ({ caller }) func list_season_team_assignment(season_id : Text) : async { #Ok : [Types.SeasonTeamAssignment]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    switch (seasons.find(func(s) = s.id == season_id)) {
      case null { #Err("Season not found") };
      case (?season) {
        if (not isMember(caller, season.club_id)) return #Err("Club membership required");
        #Ok(seasonTeamAssignments.filter(func(a) = a.season_id == season_id));
      };
    }
  };

  public shared ({ caller }) func add_season_team_assignment(season_id : Text, team_id : Text, member_id : Text) : async { #Ok : Types.SeasonTeamAssignment; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (seasons.find(func(s) = s.id == season_id)) {
      case null { #Err("Season not found") };
      case (?season) {
        if (not canManageTeam(caller, season.club_id, ?team_id)) return #Err("Team or club admin required");
        let now = nowMs();
        let entry : Types.SeasonTeamAssignment = { season_id; team_id; member_id; added_at_ms = now };
        seasonTeamAssignments := seasonTeamAssignments.filter(func(a) = not (a.season_id == season_id and a.member_id == member_id)).concat([entry]);
        #Ok(entry)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func move_season_team_assignment(season_id : Text, member_id : Text, new_team_id : Text) : async { #Ok : Types.SeasonTeamAssignment; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (seasons.find(func(s) = s.id == season_id)) {
      case null { #Err("Season not found") };
      case (?season) {
        if (not isAdmin(caller, season.club_id) and not canManageTeam(caller, season.club_id, ?new_team_id)) return #Err("Team or club admin required");
        switch (seasonTeamAssignments.find(func(a) = a.season_id == season_id and a.member_id == member_id)) {
          case null { #Err("Assignment not found") };
          case (?existing) {
            let updated : Types.SeasonTeamAssignment = { existing with team_id = new_team_id; added_at_ms = nowMs() };
            seasonTeamAssignments := seasonTeamAssignments.map(func(a) = if (a.season_id == season_id and a.member_id == member_id) updated else a);
            #Ok(updated)
          };
        };
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func remove_season_team_assignment(season_id : Text, member_id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (seasons.find(func(s) = s.id == season_id)) {
      case null { #Err("Season not found") };
      case (?season) {
        if (not isAdmin(caller, season.club_id)) return #Err("Club admin required");
        seasonTeamAssignments := seasonTeamAssignments.filter(func(a) = not (a.season_id == season_id and a.member_id == member_id));
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Club "kind" (association flag): distinguishes e.g. "club" vs
  // "school"/"academy" for UI copy and feature gating. Free-text, governor
  // or club admin gated. ----

  public query ({ caller }) func get_club_kind(club_id : Text) : async { #Ok : ?Text; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    #Ok(switch (clubKinds.find(func((k, _)) = k == club_id)) { case (?(_, v)) ?v; case null null })
  };

  public shared ({ caller }) func set_club_kind(club_id : Text, kind : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    if (kind.size() == 0 or kind.size() > 64) return #Err("Invalid kind");
    clubKinds := clubKinds.filter(func((k, _)) = k != club_id).concat([(club_id, kind)]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Class/term enrolments: a member's enrolment status in a class
  // within a ClubTerm. Self-service (the member enrolling/withdrawing
  // themselves, member_id == caller's principal text) or club-admin-managed
  // (enrolling/withdrawing someone else). ----

  func isSelfOrAdmin(caller : Principal, club_id : Text, member_id : Text) : Bool {
    isAdmin(caller, club_id) or member_id == Principal.toText(caller)
  };

  public shared ({ caller }) func enrol_in_class(club_id : Text, term_id : Text, class_id : Text, member_id : Text) : async { #Ok : Types.ClassEnrolment; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    if (not isSelfOrAdmin(caller, club_id, member_id)) return #Err("Club admin required to enrol another member");
    if (class_id == "" or term_id == "") return #Err("Invalid class or term");
    let now = nowMs();
    let existing = classEnrolments.find(func(e) = e.club_id == club_id and e.term_id == term_id and e.class_id == class_id and e.member_id == member_id);
    let entry : Types.ClassEnrolment = {
      id = switch (existing) { case (?e) e.id; case null "cenr-" # (await randomHex(16)) };
      club_id; term_id; class_id; member_id;
      status = "enrolled";
      created_at_ms = switch (existing) { case (?e) e.created_at_ms; case null now };
      updated_at_ms = now;
    };
    classEnrolments := classEnrolments.filter(func(e) = e.id != entry.id).concat([entry]);
    #Ok(entry)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func withdraw_from_class(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (classEnrolments.find(func(e) = e.id == id)) {
      case null { #Err("Enrolment not found") };
      case (?entry) {
        if (not isSelfOrAdmin(caller, entry.club_id, entry.member_id)) return #Err("Club admin required to withdraw another member");
        let updated : Types.ClassEnrolment = { entry with status = "withdrawn"; updated_at_ms = nowMs() };
        classEnrolments := classEnrolments.map(func(e) = if (e.id == id) updated else e);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func list_class_enrolments(club_id : Text, term_id : ?Text, class_id : ?Text) : async { #Ok : [Types.ClassEnrolment]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    #Ok(classEnrolments.filter(func(e) =
      e.club_id == club_id
      and (switch (term_id) { case (?t) e.term_id == t; case null true })
      and (switch (class_id) { case (?c) e.class_id == c; case null true })
    ))
  };

  // ---- Per-club theme JSON (colors/logo/typography for the club website) —
  // readable anonymously so the public club site can render it pre-auth;
  // writes are club-admin gated. ----

  public query func get_club_theme_json(club_id : Text) : async ?Text {
    switch (clubThemeJson.find(func((k, _)) = k == club_id)) {
      case (?(_, v)) ?v;
      case null null;
    }
  };

  public shared ({ caller }) func set_club_theme_json(club_id : Text, theme_json : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    if (theme_json.size() > 65_536) return #Err("Theme JSON too large");
    clubThemeJson := clubThemeJson.filter(func((k, _)) = k != club_id).concat([(club_id, theme_json)]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Per-club general settings (class/term mode, default guest policy,
  // events sponsor strip) — readable by club members, writable by club
  // staff/admin. ----

  public query ({ caller }) func get_club_general_settings(club_id : Text) : async { #Ok : Types.ClubGeneralSettings; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    switch (clubGeneralSettings.find(func(s) = s.club_id == club_id)) {
      case (?s) #Ok(s);
      case null #Ok({
        club_id;
        class_mode_enabled = false;
        allow_guests_default = false;
        max_guests_per_member_default = 0;
        events_sponsor_strip_enabled = true;
      });
    }
  };

  public shared ({ caller }) func set_club_general_settings(
    club_id : Text,
    class_mode_enabled : Bool,
    allow_guests_default : Bool,
    max_guests_per_member_default : Nat,
    events_sponsor_strip_enabled : Bool,
  ) : async { #Ok : Types.ClubGeneralSettings; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not acl.roles.any(func(grant) = grant.user.equal(caller) and grant.club == ?club_id)) return #Err("Club staff required");
    let updated : Types.ClubGeneralSettings = { club_id; class_mode_enabled; allow_guests_default; max_guests_per_member_default; events_sponsor_strip_enabled };
    clubGeneralSettings := clubGeneralSettings.filter(func(s) = s.club_id != club_id).concat([updated]);
    #Ok(updated)
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Free-tier usage counters: cheap counts an admin UI can compare
  // against free-plan limits (teams / distinct members / news posts /
  // open pending invites) without pulling full record arrays client-side. ----

  public query ({ caller }) func free_usage_counters(club_id : Text) : async { #Ok : { teams : Nat; members : Nat; news_posts : Nat; pending_invites : Nat }; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    var memberIds : [Text] = [];
    for (g in acl.roles.values()) {
      if (g.club == ?club_id) {
        let txt = Principal.toText(g.user);
        if (not memberIds.any(func(m) = m == txt)) { memberIds := memberIds.concat([txt]) };
      };
    };
    #Ok({
      teams = teams.filter(func(t) = t.club_id == club_id and t.deleted_at_ms == null).size();
      members = memberIds.size();
      news_posts = newsPosts.filter(func(p) = p.club_id == club_id).size();
      pending_invites = pendingInvites.filter(func(i) = i.club_id == club_id and i.status != "revoked" and i.status != "accepted").size();
    })
  };


  public query ({ caller }) func list_links(club : Text, admin_view : Bool) : async { #Ok : Types.Listing; #Err : Text } {
    denyLegacyAccountQuery();
    let listing = getListing(club);
    if (admin_view) {
      if (not isAdmin(caller, club)) return #Err("Forbidden");
      #Ok(listing)
    } else {
      if (not isMember(caller, club)) return #Err("Forbidden");
      let filtered = listing.links.filter(func(link) = link.draft.is_active);
      #Ok({ links = filtered; revision = listing.revision })
    }
  };

  func findLinkAnyClub(id : Text) : ?Types.Link {
    for ((_, listing) in clubListings.values()) {
      for (link in listing.links.values()) {
        if (link.id == id) return ?link;
      };
    };
    null
  };

  public query ({ caller }) func get_link(id : Text) : async { #Ok : Types.Listing; #Err : Text } {
    denyLegacyAccountQuery();
    switch (findLinkAnyClub(id)) {
      case null { #Err("Link not found") };
      case (?link) {
        let admin = isAdmin(caller, link.club_id);
        if (not admin and not isMember(caller, link.club_id)) return #Err("Forbidden");
        if (not link.draft.is_active and not admin) return #Err("Forbidden");
        let listing = getListing(link.club_id);
        #Ok({ links = [link]; revision = listing.revision })
      };
    }
  };

  public shared ({ caller }) func mutate(req : Types.Request) : async { #Ok : Types.Mutation; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(req.club)) return #Err("Club is temporarily locked for a transfer");
    if (not isAdmin(caller, req.club)) return #Err("Club admin required");
    let fingerprint = requestFingerprint(req);
    switch (findLoggedMutation(req.request_id)) {
      case (?(loggedFingerprint, loggedMutation)) {
        if (loggedFingerprint == fingerprint) return #Ok(loggedMutation);
        return #Err("Request already used with different parameters");
      };
      case null {};
    };
    let current_listing = getListing(req.club);
    if (current_listing.revision != req.expected_revision) return #Err("Revision conflict");
    let next_rev = current_listing.revision + 1;

    let result : { #Ok : Types.Mutation; #Err : Text } = switch (req.operation) {
      case (#Save({ id = ?link_id; draft })) {
        switch (validateDraft(draft)) {
          case (?err) { #Err(err) };
          case null {
        var links = current_listing.links;
        var found_idx : ?Nat = null;
        var idx = 0;
        for (l in links.values()) {
          if (l.id == link_id) { found_idx := ?idx };
          idx += 1;
        };
        switch (found_idx) {
          case null { #Err("Link not found") };
          case (?i) {
            let updated_link : Types.Link = { id = link_id; sort_order = links[i].sort_order; created_at_ms = links[i].created_at_ms; draft; club_id = req.club };
            let updated_links = Array.tabulate<Types.Link>(links.size(), func(pos) {
              if (pos == i) updated_link else links[pos]
            });
            updateListing(req.club, { links = updated_links; revision = next_rev });
            #Ok({ link = ?updated_link; revision = next_rev })
          };
        }
          };
        }
      };
      case (#Save({ id = null; draft })) {
        switch (validateDraft(draft)) {
          case (?err) { #Err(err) };
          case null {
        let new_id = "link-" # req.club # "-" # Nat.toText(current_listing.links.size() + 1);
        let new_link : Types.Link = { id = new_id; sort_order = Nat.toNat32(current_listing.links.size()); created_at_ms = 0; draft; club_id = req.club };
        let updated_links = current_listing.links.concat([new_link]);
        updateListing(req.club, { links = updated_links; revision = next_rev });
        #Ok({ link = ?new_link; revision = next_rev })
          };
        }
      };
      case (#Remove({ id })) {
        let updated_links = current_listing.links.filter(func(l) = l.id != id);
        updateListing(req.club, { links = updated_links; revision = next_rev });
        #Ok({ link = null; revision = next_rev })
      };
      case (#SetActive({ id; active })) {
        var links = current_listing.links;
        var found_idx : ?Nat = null;
        var idx = 0;
        for (l in links.values()) {
          if (l.id == id) { found_idx := ?idx };
          idx += 1;
        };
        switch (found_idx) {
          case null { #Err("Link not found") };
          case (?i) {
            let link = links[i];
            let updated_draft : Types.Draft = { link.draft with is_active = active };
            let updated_link : Types.Link = { link with draft = updated_draft };
            let updated_links = Array.tabulate<Types.Link>(links.size(), func(pos) {
              if (pos == i) updated_link else links[pos]
            });
            updateListing(req.club, { links = updated_links; revision = next_rev });
            #Ok({ link = ?updated_link; revision = next_rev })
          };
        }
      };
      case (#Reorder({ first; second })) {
        var links = current_listing.links;
        var idx_a : ?Nat = null;
        var idx_b : ?Nat = null;
        var idx = 0;
        for (l in links.values()) {
          if (l.id == first) idx_a := ?idx;
          if (l.id == second) idx_b := ?idx;
          idx += 1;
        };
        switch (idx_a, idx_b) {
          case (?ia, ?ib) {
            let order_a = links[ia].sort_order;
            let order_b = links[ib].sort_order;
            let link_a : Types.Link = { links[ia] with sort_order = order_b };
            let link_b : Types.Link = { links[ib] with sort_order = order_a };
            let updated_links = Array.tabulate<Types.Link>(links.size(), func(pos) {
              if (pos == ia) link_a else if (pos == ib) link_b else links[pos]
            });
            updateListing(req.club, { links = updated_links; revision = next_rev });
            #Ok({ link = ?link_a; revision = next_rev })
          };
          case _ { #Err("Reorder target not found") };
        }
      };
    };
    switch (result) {
      case (#Ok(mutation)) logMutation(req.request_id, fingerprint, mutation);
      case (#Err(_)) {};
    };
    result
  
    } finally { removalReceiver.leave(caller) };
  };


  // ---- Club transfer fence + snapshot (governor-only operator tooling) ----
  // A frozen club is fenced for transfer: `mutate` refuses it and the ingress
  // inspect hook drops update calls naming it. Inspect is advisory only (not a
  // security boundary), so the transfer runner re-digests the source snapshot
  // right before cutover; any write that slipped through aborts the move.
  func isTransferFenced(club : Text) : Bool = frozenClubs.any(func(e) = e.0 == club);

  type ClubSnapshot = {
    profiles : [Types.ClubProfile]; settings : [Types.ClubSettings]; teams : [Types.ClubTeam];
    sponsors : [Types.ClubSponsor]; listing : Types.Listing; roles : [Types.RoleGrant];
    acl_teams : [Types.Team]; member : Bool; exclusions : [Types.Exclusion]; children : [Types.Child]; guardians : [Types.Guardian];
    account_roles : [Types.AccountRole]; team_folders : [Types.TeamFolder]; news : [Types.NewsPost];
    news_audience : [Types.NewsAudienceRecipient]; parent_invites : [Types.ParentInvite]; role_requests : [Types.RoleRequest];
    team_invites : [Types.TeamInvite]; team_invite_links : [Types.TeamInviteLink];
  };

  func clubTeamIds(club : Text) : [Text] = teams.filter(func(t) = t.club_id == club).map(func(t) = t.id);
  func inTeams(ids : [Text], team : ?Text) : Bool = switch (team) { case (?t) ids.any(func(i) = i == t); case null false };
  func clubChild(club : Text, ids : [Text], c : Types.Child) : Bool = c.club_id == ?club or c.teams.any(func(t) = ids.any(func(i) = i == t));

  func clubSnapshot(club : Text) : ClubSnapshot {
    let ids = clubTeamIds(club);
    let kids = acl.children.filter(func(c) = clubChild(club, ids, c));
    let news = newsPosts.filter(func(n) = n.club_id == club);
    {
      profiles = profiles.filter(func(p) = p.id == club);
      settings = settings.filter(func(x) = x.club_id == club);
      teams = teams.filter(func(t) = t.club_id == club);
      sponsors = sponsors.filter(func(x) = x.club_id == club);
      listing = getListing(club);
      roles = acl.roles.filter(func(g) = g.club == ?club or (g.club == null and inTeams(ids, g.team)));
      acl_teams = acl.teams.filter(func(t) = t.club == club);
      member = acl.clubs.any(func(c) = c == club);
      exclusions = acl.exclusions.filter(func(e) = e.club == club);
      children = kids;
      guardians = acl.guardians.filter(func(g) = kids.any(func(k) = k.id == g.child));
      account_roles = accountRoles.filter(func(r) = r.club == ?club or (r.club == null and inTeams(ids, r.team)));
      team_folders = teamFolders.filter(func(f) = f.club_id == club);
      news;
      news_audience = newsAudienceRecipients.filter(func(r) = news.any(func(n) = n.id == r.news_id));
      parent_invites = parentInvites.filter(func(i) = i.club_id == club);
      role_requests = roleRequests.filter(func(r) = r.club == club);
      team_invites = teamInvites.filter(func(i) = i.club_id == club);
      team_invite_links = teamInviteLinks.filter(func(l) = l.club_id == club);
    }
  };

  // Removes the club-owned scope. Children/guardians are family records kept
  // on the source, matching permanent club deletion.
  func dropClubScope(club : Text) {
    let ids = clubTeamIds(club);
    let newsIds = newsPosts.filter(func(n) = n.club_id == club).map(func(n) = n.id);
    membershipEpoch += 1;
    profiles := profiles.filter(func(p) = p.id != club);
    settings := settings.filter(func(x) = x.club_id != club);
    teams := teams.filter(func(t) = t.club_id != club);
    sponsors := sponsors.filter(func(x) = x.club_id != club);
    clubListings := clubListings.filter(func(e) = e.0 != club);
    acl := { acl with
      roles = acl.roles.filter(func(g) = not (g.club == ?club or (g.club == null and inTeams(ids, g.team))));
      teams = acl.teams.filter(func(t) = t.club != club);
      clubs = acl.clubs.filter(func(c) = c != club);
      exclusions = acl.exclusions.filter(func(e) = e.club != club) };
    accountRoles := accountRoles.filter(func(r) = not (r.club == ?club or (r.club == null and inTeams(ids, r.team))));
    teamFolders := teamFolders.filter(func(f) = f.club_id != club);
    newsAudienceRecipients := newsAudienceRecipients.filter(func(r) = not newsIds.any(func(i) = i == r.news_id));
    mediaEvidenceRevision += 1;
    newsPosts := newsPosts.filter(func(n) = n.club_id != club);
    parentInvites := parentInvites.filter(func(i) = i.club_id != club);
    roleRequests := roleRequests.filter(func(r) = r.club != club);
    teamInvites := teamInvites.filter(func(i) = i.club_id != club);
    teamInviteLinks := teamInviteLinks.filter(func(l) = l.club_id != club);
  };

  public query ({ caller }) func export_club_snapshot(club : Text) : async { #Ok : Blob; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    if (not isTransferFenced(club)) return #Err("Club must be fenced before export");
    #Ok(to_candid (clubSnapshot(club)))
  };

  public shared ({ caller }) func import_club_snapshot(club : Text, snapshot : Blob) : async { #Ok; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    if (not isTransferFenced(club)) return #Err("Club must be fenced before import");
    let decoded : ?ClubSnapshot = from_candid (snapshot);
    let snap = switch (decoded) { case (?x) x; case null return #Err("Invalid snapshot") };
    if (snap.profiles.size() > 1 or snap.profiles.any(func(p) = p.id != club)) return #Err("Snapshot club mismatch");
    let ids = snap.teams.map(func(t) = t.id);
    let newsIds = snap.news.map(func(n) = n.id);
    if (snap.teams.any(func(t) = t.club_id != club) or snap.settings.any(func(x) = x.club_id != club)
        or snap.sponsors.any(func(x) = x.club_id != club)
        or snap.roles.any(func(g) = not (g.club == ?club or (g.club == null and inTeams(ids, g.team))))
        or snap.account_roles.any(func(r) = not (r.club == ?club or (r.club == null and inTeams(ids, r.team))))
        or snap.acl_teams.any(func(t) = t.club != club) or snap.exclusions.any(func(e) = e.club != club)
        or snap.children.any(func(c) = not clubChild(club, ids, c)) or snap.guardians.any(func(g) = not snap.children.any(func(k) = k.id == g.child))
        or snap.team_folders.any(func(x) = x.club_id != club) or snap.news.any(func(x) = x.club_id != club)
        or snap.news_audience.any(func(r) = not newsIds.any(func(i) = i == r.news_id))
        or snap.parent_invites.any(func(x) = x.club_id != club) or snap.role_requests.any(func(x) = x.club != club)
        or snap.team_invites.any(func(x) = x.club_id != club) or snap.team_invite_links.any(func(x) = x.club_id != club)) return #Err("Snapshot contains foreign records");
    if (snap.teams.any(func(t) = teams.any(func(x) = x.id == t.id and x.club_id != club))
        or snap.news.any(func(n) = newsPosts.any(func(x) = x.id == n.id and x.club_id != club))) return #Err("Snapshot id collides with another club");
    // Idempotent replace: re-running an import converges to the same state.
    dropClubScope(club);
    profiles := profiles.concat(snap.profiles);
    settings := settings.concat(snap.settings);
    teams := teams.concat(snap.teams);
    sponsors := sponsors.concat(snap.sponsors);
    updateListing(club, snap.listing);
    acl := { acl with
      roles = acl.roles.concat(snap.roles);
      teams = acl.teams.concat(snap.acl_teams);
      clubs = if (snap.member) acl.clubs.concat([club]) else acl.clubs;
      exclusions = acl.exclusions.concat(snap.exclusions);
      children = acl.children.filter(func(c) = not snap.children.any(func(k) = k.id == c.id)).concat(snap.children);
      guardians = acl.guardians.filter(func(g) = not snap.guardians.any(func(y) = y.child == g.child and y.user.equal(g.user))).concat(snap.guardians) };
    accountRoles := accountRoles.concat(snap.account_roles);
    teamFolders := teamFolders.concat(snap.team_folders);
    mediaEvidenceRevision += 1;
    newsPosts := newsPosts.concat(snap.news);
    newsAudienceRecipients := newsAudienceRecipients.concat(snap.news_audience);
    parentInvites := parentInvites.concat(snap.parent_invites);
    roleRequests := roleRequests.concat(snap.role_requests);
    teamInvites := teamInvites.concat(snap.team_invites);
    teamInviteLinks := teamInviteLinks.concat(snap.team_invite_links);
    #Ok
  };

  // Removes exactly the snapshot scope from the source after a verified cutover.
  public shared ({ caller }) func purge_club_snapshot(club : Text) : async { #Ok : Nat; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    if (not isTransferFenced(club)) return #Err("Club must be fenced before purge");
    let before = profiles.size() + teams.size() + newsPosts.size();
    dropClubScope(club);
    #Ok(before - (profiles.size() + teams.size() + newsPosts.size()))
  };

  func blobContains(hay : Blob, needle : Blob) : Bool {
    let h = Blob.toArray(hay); let n = Blob.toArray(needle);
    if (n.size() == 0 or n.size() > h.size()) return false;
    var i = 0;
    while (i + n.size() <= h.size()) {
      var j = 0;
      while (j < n.size() and h[i + j] == n[j]) j += 1;
      if (j == n.size()) return true;
      i += 1;
    };
    false
  };

  system func inspect({ caller : Principal; arg : Blob }) : Bool {
    if (frozenClubs.size() == 0 or isGovernor(caller)) return true;
    not frozenClubs.any(func(e) = blobContains(arg, e.0.encodeUtf8()))
  };

  public shared ({ caller }) func freeze_club(club : Text, rev : Nat64) : async { #Ok : Nat64; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor required");
    mediaEvidenceRevision += 1;
    frozenClubs := frozenClubs.filter(func(e) = e.0 != club);
    mediaEvidenceRevision += 1;
    frozenClubs := frozenClubs.concat([(club, rev)]);
    #Ok(rev)
  };

  public shared ({ caller }) func unfreeze_club(club : Text, rev : Nat64) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor required");
    mediaEvidenceRevision += 1;
    frozenClubs := frozenClubs.filter(func(e) = e.0 != club);
    #Ok
  };

  public query ({ caller }) func export_frozen_club(club : Text) : async { #Ok : Types.Listing; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    #Ok(getListing(club))
  };

  public shared ({ caller }) func import_frozen_club(club : Text, listing : Types.Listing) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor required");
    updateListing(club, listing);
    #Ok
  };

  public query ({ caller }) func export_links() : async { #Ok : Types.Snapshot; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    #Ok({ schema = 1; clubs = clubListings })
  };

  public shared ({ caller }) func import_links(snap : Types.Snapshot) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor required");
    clubListings := snap.clubs;
    #Ok
  };

  public query ({ caller }) func export_acl() : async { #Ok : Types.Config; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    #Ok({ acl; schema = 1; governor; acl_version = aclVersion })
  };

  public shared ({ caller }) func replace_acl(rev : Nat64, new_acl : Types.Acl) : async { #Ok : Nat64; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor required");
    membershipEpoch += 1;
    acl := new_acl;
    aclVersion := rev;
    #Ok(rev)
  };

  // ICP MCP Layer 3: behavioral guide for AI agents (see
  // docs.internetcomputer.org/guides/frontends/service-discoverability).
  public query func getApiDoc() : async Text {
    "# club_domain — clubs, teams, memberships, roles\n\n" #
    "## Authentication\n" #
    "Directory reads (`list_clubs`, `get_club_profile`, `list_teams`, `get_team`) are anonymously callable and return only public directory data. Everything account- or role-related requires a signed principal; the caller's principal is resolved to an app account (`whoami` returns `#Err(\"Unlinked identity\")` until the account is registered via identity_access).\n\n" #
    "## Key reads (queries)\n" #
    "- `whoami()`: the caller's account record.\n" #
    "- `list_role_grants(club)`: role roster for a club — requires club admin.\n" #
    "- `schema()` describes read-only clubs/teams OQL; `execute(json)` requires Internet Identity and returns only non-deleted clubs/teams where the caller is a member or administrator. Filters, projection, ordering, count/groupBy and paging are documented in schema. No contacts, tokens or principal fields.\n" #
    "- `list_clubs(start_after:?text, limit:nat16)` / `get_club_profile(id)` / `list_teams(club)` / `get_team(id)`: existing directory methods, not caller-scoped.\n\n" #
    "## Permissions model\n" #
    "Roles (club admin, team admin, coach, member, guardian) are stored on-chain and re-checked on every call — a caller can never act on a club or team they have no role in, and can never see another club's private data. Role changes take effect immediately.\n\n" #
    "## Gotchas\n" #
    "- Club and team ids are opaque text ids, not principals.\n" #
    "- Denied calls return `#Err(\"...\")`; anonymous calls to authenticated methods trap."
  };

  public query func schema() : async Text {
    Oql.schema(OqlClubs.entities, "{\"entity\":\"clubs\",\"select\":[\"id\",\"name\"],\"limit\":50}")
  };
  public query ({ caller }) func execute(input : Text) : async Oql.Result {
    denyLegacyAccountQuery();
    auth(caller);
    let request = Oql.parse(input, OqlClubs.entities);
    if (request.entity == "clubs") {
      Oql.run<Types.ClubProfile>(request, profiles, func(club) = club.deleted_at_ms == null and (isMember(caller, club.id) or isAdmin(caller, club.id)), OqlClubs.clubRow)
    } else {
      Oql.run<Types.ClubTeam>(request, teams, func(team) = team.deleted_at_ms == null and (isMember(caller, team.club_id) or isAdmin(caller, team.club_id)), OqlClubs.teamRow)
    }
  };

  public query ({ caller }) func whoami() : async { #Ok : Types.Account; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    switch (accountFor(caller)) {
      case (?account) { #Ok(account) };
      case null { #Err("Unlinked identity") };
    }
  };

  // Self-service erasure revokes all linked principals' club authority.
  // Keep shared club/team records and parent-owned children intact.
  public shared ({ caller }) func erase_my_membership() : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    let account = accountFor(caller);
    eraseMembership(switch (account) { case (?a) { a.principals }; case null { [caller] } },
      switch (account) { case (?a) { a.id }; case null { "principal:" # Principal.toText(caller) } })
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func erase_account_membership(account_id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not (isGovernor(caller) or isAppAdmin(caller))) return #Err("App admin required");
    switch (accounts.find(func(a) = a.id == account_id or a.principals.any(func(p) = Principal.toText(p) == account_id or "principal:" # Principal.toText(p) == account_id))) {
      case (?a) { eraseMembership(a.principals, a.id) };
      case null {
        // Unlinked accounts use the canonical principal:<text> key.
        let text = switch (Text.stripStart(account_id, #text "principal:")) { case (?t) { t }; case null { account_id } };
        // Match authoritative stored principals; malformed user input must not trap.
        switch (acl.roles.find(func(g) = Principal.toText(g.user) == text)) {
          case (?g) { eraseMembership([g.user], "principal:" # text) };
          case null { #Err("Unknown club account; cannot safely revoke membership") };
        }
      };
    }
  };

  // Exact configured identity only; consensus verification of all captured aliases.
  // This is club authority evidence, not an all-service drain receipt.
  public shared ({ caller }) func read_account_membership_erased(principals : [Principal]) : async Bool {
    if (?caller != identityAccessCanister) return false;
    if (principals.size() == 0 or principals.size() > 8) return false;
    not principals.any(func(p) = acl.roles.any(func(g) = g.user == p)) and
      not profiles.any(func(c) = principals.any(func(p) = isMember(p, c.id)))
  };

  func eraseMembership(principals : [Principal], accountId : Text) : { #Ok; #Err : Text } {
    if (principals.any(func(p) = p.equal(governor))) return #Err("Governor account cannot be erased");
    var exclusions = acl.exclusions;
    // Explicitly exclude every club, including family-derived membership.
    for (club in acl.clubs.values()) {
      for (user in principals.values()) {
        if (not exclusions.any(func(e) = e.user.equal(user) and e.club == club)) {
          exclusions := exclusions.concat([{ club; user }]);
        };
      };
    };
    membershipEpoch += 1;
    acl := { acl with roles = acl.roles.filter(func(g) = AccountErasure.keepRole(g, principals)); exclusions };
    accountRoles := accountRoles.filter(func(g) = g.account_id != accountId);
    #Ok
  };

  // Browser roster surface for the membership feature. Reads only; role
  // mutations stay behind `mutate`/`replace_acl` governance. Roster reads
  // require club admin — the roster includes every member's role grants.
  public query ({ caller }) func list_role_grants(club : Text) : async { #Ok : [Types.AccountRole]; #Err : Text } {
    denyLegacyAccountQuery();
    if (not isAdmin(caller, club)) return #Err("Club admin required");
    #Ok(accountRoles.filter(func(grant) = grant.club == ?club or grant.club == null))
  };

  // Team-scoped roster read for the team page member list: any member of the
  // team's club (club admins included) may read that team's role grants. The
  // full club roster stays club-admin-only (list_role_grants above).
  public query ({ caller }) func list_team_role_grants(team : Text) : async { #Ok : [Types.AccountRole]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    var club : ?Text = null;
    label search {
      for (t in teams.vals()) {
        if (t.id == team) { club := ?t.club_id; break search };
      };
      for (t in acl.teams.vals()) {
        if (t.id == team) { club := ?t.club; break search };
      };
    };
    switch (club) {
      case null { #Err("Unknown team") };
      case (?clubId) {
        if (not isMember(caller, clubId)) return #Err("Club membership required");
        #Ok(accountRoles.filter(func(grant) = grant.team == ?team))
      };
    };
  };

  // Caller-scoped: every role grant the caller holds across ALL clubs,
  // from the authorization-source `acl.roles` (not the `accountRoles`
  // roster mirror). No club-admin gate — callers may always see their own
  // grants, matching whoami()/list_children()'s self-scoped read stance.
  public query ({ caller }) func my_role_grants() : async [Types.RoleGrant] {
    denyLegacyAccountQuery();
    auth(caller);
    acl.roles.filter(func(grant) = grant.user.equal(caller))
  };

  // Caller-only consensus read; linked principals come from this canister's
  // verified account, never a browser-supplied account/principal list.
  // At most 200 profile slots scanned per call. Cursor is not a snapshot:
  // consumers revalidate discovered memberships against current authority.
  public shared ({ caller }) func read_my_club_memberships(offset : Nat, limit : Nat16) : async {
    #Ok : { clubs : [Text]; next : ?Nat; acl_revision : Nat64 }; #Err : Text
  } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (caller.equal(Principal.anonymous())) return #Err("Authentication required");
    if (limit == 0 or limit > 100 or offset > profiles.size()) return #Err("Invalid membership page");
    let principals = switch (accountFor(caller)) { case (?a) a.principals; case null [caller] };
    let page = MembershipPage.read<Types.ClubProfile>(profiles, offset, Nat16.toNat(limit), func(club) {
      club.deleted_at_ms == null and principals.any(func(p) = isMember(p, club.id))
    });
    #Ok({ clubs = page.rows.map(func(club) = club.id); next = page.next; acl_revision = aclVersion })
  
    } finally { removalReceiver.leave(caller) };
  };

  // Indexed, cursor-paged successor of read_my_club_memberships: cost scales
  // with the caller's own memberships, not the number of clubs on the canister.
  public shared ({ caller }) func read_my_club_memberships_indexed(after : ?Text, limit : Nat16) : async {
    #Ok : { clubs : [Text]; next : ?Text; acl_revision : Nat64 }; #Err : Text
  } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (caller.equal(Principal.anonymous())) return #Err("Authentication required");
    if (limit == 0 or limit > 100) return #Err("Invalid membership page");
    let principals = switch (accountFor(caller)) { case (?a) a.principals; case null [caller] };
    let ix = currentMemberIndex();
    if (principals.any(func(p) = MembershipIndex.has(ix, p.toText(), APP_WIDE))) {
      // App-wide roles cover every club: fall back to the bounded scan pager.
      return #Err("Use read_my_club_memberships for app-wide accounts");
    };
    let candidates = MembershipIndex.empty();
    for (p in principals.values()) {
      var cursor : ?Text = null;
      label pages loop {
        let page = MembershipIndex.page(ix, p.toText(), cursor, 100);
        for (club in page.clubs.values()) MembershipIndex.add(candidates, "c", club);
        switch (page.next) { case null break pages; case (?n) cursor := ?n };
      };
    };
    var out : [Text] = []; var cursor = after; var more = false;
    label scan loop {
      let page = MembershipIndex.page(candidates, "c", cursor, 100);
      for (club in page.clubs.values()) {
        if (out.size() == Nat16.toNat(limit)) { more := true; break scan };
        let live = profiles.any(func(pr) = pr.id == club and pr.deleted_at_ms == null);
        if (live and principals.any(func(p) = isMember(p, club))) out := out.concat([club]);
        cursor := ?club;
      };
      switch (page.next) { case null break scan; case (?_) {} };
    };
    #Ok({ clubs = out; next = if (more and out.size() > 0) ?out[out.size() - 1] else null; acl_revision = aclVersion })
  
    } finally { removalReceiver.leave(caller) };
  };

  // Cross-canister membership check used by pii_access_control's
  // club-scoped read grants: true when `user` holds any role grant in
  // `club_id`. Public query — club membership is already visible to club
  // members under the roster-read rules (canView), so this reveals nothing
  // new. Not caller-gated so a first-party canister (whose principal is the
  // caller here) can check on behalf of the end user it is serving.
  public query func has_club_staff_role(user : Principal, club_id : Text) : async Bool {
    denyLegacyAccountQuery();
    if (user.equal(Principal.anonymous())) return false;
    acl.roles.any(func(grant) = grant.user.equal(user) and grant.club == ?club_id)
  };

  // True when `user` belongs to `club_id` (any role in the club, an app-wide
  // role, or parent/guardian of a child on one of its teams; removed members
  // excluded). pii_access_control gates the per-club photo key on this.
  public query func is_club_member(user : Principal, club_id : Text) : async Bool {
    denyLegacyAccountQuery();
    if (user.equal(Principal.anonymous())) return false;
    isMember(user, club_id)
  };

  // Same public boolean scope as is_club_member, through consensus and with
  // locally verified linked identities. No roster, names or account IDs.
  public shared func read_has_club_membership(user : Principal, club_id : Text) : async Bool {
    if (not removalReceiver.enter(user)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(user);
    if (user.equal(Principal.anonymous()) or isExcluded(user, club_id)) return false;
    let principals = switch (accountFor(user)) { case (?a) a.principals; case null [user] };
    principals.any(func(p) = isMember(p, club_id))
  
    } finally { removalReceiver.leave(user) };
  };

  // Consensus booleans only: no child names, guardian lists or stored grants.
  public shared func read_has_club_staff_role(user : Principal, club_id : Text) : async Bool {
    if (not removalReceiver.enter(user)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(user);
    if (user.equal(Principal.anonymous())) return false;
    acl.roles.any(func(grant) = grant.user.equal(user) and grant.club == ?club_id)
  
    } finally { removalReceiver.leave(user) };
  };

  func currentChildGuardian(user : Principal, child_id : Text) : Bool {
    if (Principal.isAnonymous(user)) return false;
    switch (acl.children.find(func(child) = child.id == child_id)) {
      case null false;
      case (?child) {
        (switch (child.club_id) { case (?club) not isExcluded(user, club); case null true }) and
        ((switch (child.parent) { case (?p) p.equal(user); case null false })
        or acl.guardians.any(func(g) = g.child == child_id and g.user.equal(user)))
      };
    }
  };
  public query func has_child_guardian(user : Principal, child_id : Text) : async Bool {
    denyLegacyAccountQuery(); currentChildGuardian(user, child_id) };
  public shared func read_has_child_guardian(user : Principal, child_id : Text) : async Bool {
    if (not removalReceiver.enter(user)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(user); currentChildGuardian(user, child_id) 
    } finally { removalReceiver.leave(user) };
  };

  // The user's role grants in one club as (role, team) pairs. events_domain
  // mirrors these on create/update so club and team admins set up here can
  // schedule events without a separate grant there. Public query, same
  // visibility rationale as has_club_staff_role.
  public query func list_user_club_roles(user : Principal, club_id : Text) : async [(Text, ?Text)] {
    denyLegacyAccountQuery();
    if (user.equal(Principal.anonymous())) return [];
    acl.roles.filter(func(grant) = grant.user.equal(user) and grant.club == ?club_id).map(func(grant) = (grant.role, grant.team))
  };

  // Platform (app) admin check exposed for sibling canisters — mirrors the
  // private isAppAdmin. messaging_domain gates posting to the global broadcast
  // chat on this (every signed-in member may read the feed).
  public query func is_app_admin(user : Principal) : async Bool {
    denyLegacyAccountQuery();
    if (user.equal(Principal.anonymous())) return false;
    acl.roles.any(func(grant) = grant.user.equal(user) and grant.role == "app_admin")
  };

  // Principals holding club_admin for this club — the membership of that
  // club's admin chat room. App-wide app_admins are excluded on purpose: a
  // platform admin supervises clubs through their own tools, not by sitting in
  // every club's admin room.
  public query func list_club_admins(club_id : Text) : async [Principal] {
    var out : [Principal] = [];
    for (grant in acl.roles.values()) {
      if (grant.role == "club_admin" and grant.club == ?club_id) {
        out := out.concat([grant.user]);
      };
    };
    out
  };


  // Club-staff roster read: children and role grants for one club, gated on
  // the caller holding a staff role there (same check as has_club_staff_role).
  // Names/PII are not resolved here — callers fetch PII separately via the
  // vetKey-gated pii_access_control relay.
  public query ({ caller }) func get_club_roster(club_id : Text) : async { #Ok : { children : [Types.Child]; roles : [Types.RoleGrant] }; #Err : Text } {
    denyLegacyAccountQuery();
    if (not acl.roles.any(func(grant) = grant.user.equal(caller) and grant.club == ?club_id)) {
      return #Err("Club staff role required");
    };
    #Ok({
      children = acl.children.filter(func(c) = c.club_id == ?club_id);
      roles = acl.roles.filter(func(g) = g.club == ?club_id);
    })
  };

  // Caller-scoped: returns only the children linked to the caller's own
  // account via family links. Children without a matching record in
  // acl.children are skipped.
  public query ({ caller }) func list_children() : async { #Ok : [Types.Child]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    switch (accountFor(caller)) {
      case null { #Err("Unlinked identity") };
      case (?account) {
        let childIds = accountFamilies.filter(func(link) = link.account_id == account.id).map(func(link) = link.child_id);
        #Ok(acl.children.filter(func(child) = childIds.any(func(id) = id == child.id) and currentChildGuardian(caller, child.id)))
      };
    }
  };

  public shared ({ caller }) func begin_identity_link(target : Principal) : async { #Ok : Types.Challenge; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (identityAccessCanister != null) return #Err("Use shared identity authority");
    if (target.equal(Principal.anonymous())) return #Err("Invalid target identity");
    switch (accountFor(caller), accountFor(target)) {
      case (null, _) { #Err("Unlinked identity") };
      case (_, ?_) { #Err("Target identity already linked") };
      case (?account, null) {
        nextChallengeId += 1;
        let challenge : Types.Challenge = {
          id = nextChallengeId;
          account_id = account.id;
          issuer = caller;
          target;
          accepted = false;
          expires_at_ns = nowNs() + challengeTtlNs;
          expected_version = account.version;
        };
        accountChallenges := accountChallenges.concat([challenge]);
        #Ok(challenge)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func accept_identity_link(id : Nat64) : async { #Ok : Types.Account; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (identityAccessCanister != null) return #Err("Use shared identity authority");
    let now = nowNs();
    switch (Array.findIndex(accountChallenges, func(challenge) = challenge.id == id)) {
      case null { #Err("Unknown challenge") };
      case (?index) {
        let challenge = accountChallenges[index];
        if (challenge.target != caller or challenge.accepted or challenge.expires_at_ns <= now) return #Err("Invalid or expired challenge");
        if (accountFor(caller) != null) return #Err("Identity already linked");
        switch (Array.findIndex(accounts, func(account) = account.id == challenge.account_id)) {
          case null { #Err("Account unavailable") };
          case (?accountIndex) {
            let account = accounts[accountIndex];
            if (account.version != challenge.expected_version or not account.principals.any(func(item) = item.equal(challenge.issuer))) return #Err("Link authorization changed");
            let updated : Types.Account = { account with version = account.version + 1; principals = account.principals.concat([caller]) };
            membershipEpoch += 1;
            accounts := Array.tabulate<Types.Account>(accounts.size(), func(position) { if (position == accountIndex) updated else accounts[position] });
            let accepted : Types.Challenge = { challenge with accepted = true };
            accountChallenges := Array.tabulate<Types.Challenge>(accountChallenges.size(), func(position) { if (position == index) accepted else accountChallenges[position] });
            #Ok(updated)
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func revoke_identity(target : Principal, expected_version : Nat64) : async { #Ok : Types.Account; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (identityAccessCanister != null) return #Err("Use shared identity authority");
    switch (accountFor(caller)) {
      case null { #Err("Unlinked identity") };
      case (?current) {
        if (not current.principals.any(func(item) = item.equal(target)) or current.principals.size() <= 1) return #Err("Cannot revoke missing or last identity");
        if (current.version != expected_version) return #Err("Account version conflict");
        let updated : Types.Account = {
          current with
          version = current.version + 1;
          principals = current.principals.filter(func(item) = not item.equal(target));
        };
        switch (Array.findIndex(accounts, func(account) = account.id == current.id)) {
          case null { #Err("Account unavailable") };
          case (?index) {
            membershipEpoch += 1;
            accounts := Array.tabulate<Types.Account>(accounts.size(), func(position) { if (position == index) updated else accounts[position] });
            #Ok(updated)
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };
  // ---- Role management: grants, requests, and member removal ----
  // Provisional: `add_role_grant`/`remove_role_grant` mutate both the
  // Principal-keyed `acl.roles` (the actual authorization source used by
  // `isAdmin`/`isMember`/`canManageTeam`) and the Text-account-keyed
  // `accountRoles` roster mirror returned by `list_role_grants`, so the
  // roster the browser renders always matches live permissions.

  func accountIdFor(caller : Principal) : Text {
    switch (accountFor(caller)) {
      case (?account) account.id;
      case null "principal:" # Principal.toText(caller);
    }
  };

  public shared ({ caller }) func add_role_grant(user : Principal, club : Text, role : Text, team : ?Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isAdmin(caller, club)) return #Err("Club admin required");
    if (role == "") return #Err("Invalid role");
    membershipEpoch += 1;
    acl := { acl with roles = acl.roles.concat([{ user; role; club = ?club; team }]) };
    let accountId = accountIdFor(user);
    accountRoles := accountRoles.concat([{ account_id = accountId; club = ?club; role; team }]);
    // Refresh chat participants so the member sees their chats immediately.
    ignore fanOutEnsureConversation(club, null, clubChatParticipants(club));
    switch (team) {
      case (?t) { ignore fanOutEnsureConversation(club, ?t, teamChatParticipants(club, t)) };
      case null {};
    };
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func remove_role_grant(user : Principal, club : Text, role : Text, team : ?Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isAdmin(caller, club)) return #Err("Club admin required");
    membershipEpoch += 1;
    acl := { acl with roles = acl.roles.filter(func(g) = not (g.user.equal(user) and g.role == role and g.club == ?club and g.team == team)) };
    let accountId = accountIdFor(user);
    accountRoles := accountRoles.filter(func(g) = not (g.account_id == accountId and g.role == role and g.club == ?club and g.team == team));
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  // SOFT delete: revokes every role a member holds in a club (club-level
  // roles only, not global roles) -- access must still be revoked -- and
  // records a RemovedMember marker so the member is hidden from active
  // rosters while keeping their history (guardian/child/points/attendance
  // records untouched). Idempotent: removing an already-removed member is
  // a no-op #Ok.
  public shared ({ caller }) func remove_member(club : Text, user : Principal) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isAdmin(caller, club)) return #Err("Club admin required");
    membershipEpoch += 1;
    acl := { acl with roles = acl.roles.filter(func(g) = not (g.user.equal(user) and g.club == ?club)) };
    let accountId = accountIdFor(user);
    accountRoles := accountRoles.filter(func(g) = not (g.account_id == accountId and g.club == ?club));
    if (not removedMembers.any(func(m) = m.club == club and m.user.equal(user))) {
      removedMembers := removedMembers.concat([{ club; user; removed_at_ms = nowMs(); removed_by = caller }]);
    };
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  // Clears the soft-delete marker. Does NOT restore previously revoked
  // role grants -- the admin must re-grant roles explicitly via
  // add_role_grant.
  public shared ({ caller }) func restore_member(club : Text, user : Principal) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isAdmin(caller, club)) return #Err("Club admin required");
    removedMembers := removedMembers.filter(func(m) = not (m.club == club and m.user.equal(user)));
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func list_removed_members(club : Text) : async { #Ok : [Types.RemovedMember]; #Err : Text } {
    denyLegacyAccountQuery();
    if (not isAdmin(caller, club)) return #Err("Club admin required");
    #Ok(removedMembers.filter(func(m) = m.club == club))
  };

  public query func is_member_removed(club : Text, user : Principal) : async Bool {
    removedMembers.any(func(m) = m.club == club and m.user.equal(user))
  };

  public shared ({ caller }) func request_role(club : Text, role : Text, team : ?Text) : async { #Ok : Types.RoleRequest; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (role == "") return #Err("Invalid role");
    if (isExcluded(caller, club)) return #Err("Forbidden");
    let now = nowMs();
    let request : Types.RoleRequest = {
      id = "rreq-" # club # "-" # Nat.toText(roleRequests.size() + 1) # "-" # Nat64.toText(now);
      account_id = accountIdFor(caller);
      user = caller;
      club; role; team;
      status = "pending";
      created_at_ms = now;
      decided_at_ms = null;
      decided_by = null;
    };
    roleRequests := roleRequests.concat([request]);
    #Ok(request)
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func list_role_requests(club : Text) : async { #Ok : [Types.RoleRequest]; #Err : Text } {
    denyLegacyAccountQuery();
    if (not isAdmin(caller, club)) return #Err("Club admin required");
    #Ok(roleRequests.filter(func(r) = r.club == club))
  };

  public shared ({ caller }) func approve_role_request(id : Text) : async { #Ok : Types.RoleRequest; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (roleRequests.find(func(r) = r.id == id)) {
      case null { #Err("Request not found") };
      case (?req) {
        if (not isAdmin(caller, req.club)) return #Err("Club admin required");
        if (req.status != "pending") return #Err("Request already processed");
        membershipEpoch += 1;
        acl := { acl with roles = acl.roles.concat([{ user = req.user; role = req.role; club = ?req.club; team = req.team }]) };
        accountRoles := accountRoles.concat([{ account_id = req.account_id; club = ?req.club; role = req.role; team = req.team }]);
        ignore fanOutEnsureConversation(req.club, null, clubChatParticipants(req.club));
        switch (req.team) {
          case (?t) { ignore fanOutEnsureConversation(req.club, ?t, teamChatParticipants(req.club, t)) };
          case null {};
        };
        let updated : Types.RoleRequest = { req with status = "approved"; decided_at_ms = ?nowMs(); decided_by = ?caller };
        roleRequests := roleRequests.map(func(r) = if (r.id == id) updated else r);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func reject_role_request(id : Text) : async { #Ok : Types.RoleRequest; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (roleRequests.find(func(r) = r.id == id)) {
      case null { #Err("Request not found") };
      case (?req) {
        if (not isAdmin(caller, req.club)) return #Err("Club admin required");
        if (req.status != "pending") return #Err("Request already processed");
        let updated : Types.RoleRequest = { req with status = "rejected"; decided_at_ms = ?nowMs(); decided_by = ?caller };
        roleRequests := roleRequests.map(func(r) = if (r.id == id) updated else r);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Team/club soft-delete, restore, and permanent delete ----

  public shared ({ caller }) func soft_delete_team(id : Text) : async { #Ok : Types.ClubTeam; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (teams.find(func(t) = t.id == id)) {
      case null { #Err("Team not found") };
      case (?team) {
        if (not isAdmin(caller, team.club_id)) return #Err("Club admin required");
        let updated : Types.ClubTeam = { team with deleted_at_ms = ?nowMs() };
        membershipEpoch += 1;
        teams := teams.map(func(t) = if (t.id == id) updated else t);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func restore_team(id : Text) : async { #Ok : Types.ClubTeam; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (teams.find(func(t) = t.id == id)) {
      case null { #Err("Team not found") };
      case (?team) {
        if (not isAdmin(caller, team.club_id)) return #Err("Club admin required");
        let updated : Types.ClubTeam = { team with deleted_at_ms = null };
        membershipEpoch += 1;
        teams := teams.map(func(t) = if (t.id == id) updated else t);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func delete_team_permanent(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (teams.find(func(t) = t.id == id)) {
      case null { #Err("Team not found") };
      case (?team) {
        if (not isAdmin(caller, team.club_id)) return #Err("Club admin required");
        if (team.deleted_at_ms == null) return #Err("Team must be soft-deleted first");
        purgeTeamLocal(id);
        await fanOutTeamPurged(id);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // cascade_teams mirrors the Supabase `cascade_club_soft_delete` RPC:
  // soft-deleting a club also soft-deletes every team still active under
  // it, so browse/roster surfaces stop listing them consistently with the
  // club. Teams already soft-deleted independently are left untouched
  // (their own deleted_at_ms is preserved rather than overwritten).
  // Clubs the caller administers that were soft-deleted within 30 days.
  public query ({ caller }) func list_my_removed_clubs() : async { #Ok : [Types.ClubProfile]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    let cutoff : Nat64 = nowMs() - 30 * 24 * 60 * 60 * 1000;
    #Ok(profiles.filter(func(p) = switch (p.deleted_at_ms) { case (?d) d >= cutoff and isAdmin(caller, p.id); case null false }))
  };

  public shared ({ caller }) func soft_delete_club(id : Text, cascade_teams : Bool) : async { #Ok : Types.ClubProfile; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isAdmin(caller, id)) return #Err("Club admin required");
    switch (profiles.find(func(p) = p.id == id)) {
      case null { #Err("Club not found") };
      case (?club) {
        let now = nowMs();
        let updated : Types.ClubProfile = { club with deleted_at_ms = ?now };
        membershipEpoch += 1;
        profiles := profiles.map(func(p) = if (p.id == id) updated else p);
        if (cascade_teams) {
          membershipEpoch += 1;
          teams := teams.map(func(t) = if (t.club_id == id and t.deleted_at_ms == null) ({ t with deleted_at_ms = ?now }) else t);
        };
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // cascade_teams mirrors `cascade_team_soft_delete` in reverse: restoring
  // a club can optionally restore every team that was soft-deleted at (or
  // after) the club's own deletion — an approximation of "deleted together
  // with the club" since the canister does not track a cascade batch id.
  public shared ({ caller }) func restore_club(id : Text, cascade_teams : Bool) : async { #Ok : Types.ClubProfile; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isAdmin(caller, id)) return #Err("Club admin required");
    switch (profiles.find(func(p) = p.id == id)) {
      case null { #Err("Club not found") };
      case (?club) {
        let deletedAt = club.deleted_at_ms;
        let updated : Types.ClubProfile = { club with deleted_at_ms = null };
        membershipEpoch += 1;
        profiles := profiles.map(func(p) = if (p.id == id) updated else p);
        if (cascade_teams) {
          switch (deletedAt) {
            case (?ts) {
              membershipEpoch += 1;
              teams := teams.map(func(t) = if (t.club_id == id and t.deleted_at_ms == ?ts) ({ t with deleted_at_ms = null }) else t);
            };
            case null {};
          };
        };
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func delete_club_permanent(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isAdmin(caller, id)) return #Err("Club admin required");
    switch (profiles.find(func(p) = p.id == id)) {
      case null { #Err("Club not found") };
      case (?club) {
        if (club.deleted_at_ms == null) return #Err("Club must be soft-deleted first");
        purgeClubLocal(id);
        await fanOutClubPurged(id);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Team invites (email delivery stays with Supabase; this stores the
  // invite record and its accept/revoke state) ----

  public shared ({ caller }) func create_team_invite(club_id : Text, team_id : Text, email : Text, role : Text) : async { #Ok : Types.TeamInvite; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not (await canCreateTeamRosterInvite(caller, club_id, team_id, role))) return #Err("Team or competition admin required for player/parent invites");
    if (email == "" or email.size() > 320) return #Err("Invalid email");
    if (role == "") return #Err("Invalid role");
    let now = nowMs();
    let invite : Types.TeamInvite = {
      id = "tinv-" # team_id # "-" # Nat.toText(teamInvites.size() + 1) # "-" # Nat64.toText(nowNs() % 1_000_000_000);
      club_id; team_id; email; role;
      invited_by = caller;
      created_at_ms = now;
      expires_at_ms = now + 7 * 24 * 60 * 60 * 1000;
      accepted_by = null;
      revoked = false;
    };
    teamInvites := teamInvites.concat([invite]);
    #Ok(invite)
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func list_team_invites(club_id : Text, team_id : ?Text) : async { #Ok : [Types.TeamInvite]; #Err : Text } {
    denyLegacyAccountQuery();
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    #Ok(teamInvites.filter(func(i) = i.club_id == club_id and (team_id == null or team_id == ?i.team_id)))
  };

  public query ({ caller }) func get_team_invite(id : Text) : async { #Ok : Types.TeamInvite; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    switch (teamInvites.find(func(i) = i.id == id)) {
      case null { #Err("Invite not found") };
      case (?invite) {
        if (invite.expires_at_ms <= nowMs()) return #Err("Invite expired");
        #Ok(invite)
      };
    }
  };

  public shared ({ caller }) func accept_team_invite(id : Text) : async { #Ok : Types.TeamInvite; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (teamInvites.find(func(i) = i.id == id)) {
      case null { #Err("Invite not found") };
      case (?invite) {
        if (invite.revoked) return #Err("Invite revoked");
        if (invite.accepted_by != null) return #Err("Invite already accepted");
        if (invite.expires_at_ms <= nowMs()) return #Err("Invite expired");
        if (isExcluded(caller, invite.club_id)) return #Err("Forbidden");
        membershipEpoch += 1;
        acl := { acl with roles = acl.roles.concat([{ user = caller; role = invite.role; club = ?invite.club_id; team = ?invite.team_id }]) };
        accountRoles := accountRoles.concat([{ account_id = accountIdFor(caller); club = ?invite.club_id; role = invite.role; team = ?invite.team_id }]);
        let accepted : Types.TeamInvite = { invite with accepted_by = ?caller };
        teamInvites := teamInvites.map(func(i) = if (i.id == id) accepted else i);
        #Ok(accepted)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func revoke_team_invite(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (teamInvites.find(func(i) = i.id == id)) {
      case null { #Err("Invite not found") };
      case (?invite) {
        if (not isAdmin(caller, invite.club_id)) return #Err("Club admin required");
        let updated : Types.TeamInvite = { invite with revoked = true };
        teamInvites := teamInvites.map(func(i) = if (i.id == id) updated else i);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Shell teams: a club admin pre-creates a team for a coach/manager
  // who has not signed up yet, mints a claim token, and the invited
  // person redeems it via `claim_shell_team` — the canister equivalent of
  // the Supabase `teams.shell_*` columns and `claim_shell_team` RPC. ----

  public shared ({ caller }) func create_shell_team_invite(club_id : Text, name : Text, contact_email : ?Text, contact_name : ?Text) : async { #Ok : Types.ClubTeam; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    if (name == "" or name.size() > 160) return #Err("Invalid team name");
    let now = nowMs();
    let token = "shell-" # club_id # "-" # Nat.toText(teams.size() + 1) # "-" # Nat64.toText(nowNs() % 1_000_000_000);
    let team : Types.ClubTeam = {
      id = "team-" # club_id # "-" # Nat.toText(teams.size() + 1) # "-" # Nat64.toText(now);
      name; division = null; gender = null; is_active = true; club_id;
      age_group = null; description = null; logo_url = null; team_type = null;
      deleted_at_ms = null;
      archived = false;
      is_shell = true;
      shell_claim_token = ?token;
      shell_claimed_at_ms = null;
      shell_claimed_by = null;
      shell_contact_email = contact_email;
      shell_contact_name = contact_name;
      shell_invited_by = ?caller;
      playhq_team_id = null; playhq_competition_id = null; playhq_auto_create_events = false;
      folder_id = null;
    };
    membershipEpoch += 1;
    teams := teams.concat([team]);
    #Ok(team)
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func get_shell_team_by_token(token : Text) : async { #Ok : Types.ClubTeam; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    switch (teams.find(func(t) = t.shell_claim_token == ?token)) {
      case null { #Err("Shell invite not found") };
      case (?team) {
        if (team.shell_claimed_by != null) return #Err("Shell team already claimed");
        #Ok(team)
      };
    }
  };

  // Claiming grants the caller team_admin over the shell team and marks
  // it claimed; the token is left on the record as an audit trail
  // (claimed_by/claimed_at gate re-claiming, matching claim_shell_team).
  public shared ({ caller }) func claim_shell_team(token : Text) : async { #Ok : Types.ClubTeam; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (teams.find(func(t) = t.shell_claim_token == ?token)) {
      case null { #Err("Shell invite not found") };
      case (?team) {
        if (team.shell_claimed_by != null) return #Err("Shell team already claimed");
        if (team.deleted_at_ms != null) return #Err("Team no longer available");
        let updated : Types.ClubTeam = { team with shell_claimed_at_ms = ?nowMs(); shell_claimed_by = ?caller };
        membershipEpoch += 1;
        teams := teams.map(func(t) = if (t.id == team.id) updated else t);
        membershipEpoch += 1;
        acl := { acl with roles = acl.roles.concat([{ user = caller; role = "team_admin"; club = ?team.club_id; team = ?team.id }]) };
        accountRoles := accountRoles.concat([{ account_id = accountIdFor(caller); club = ?team.club_id; role = "team_admin"; team = ?team.id }]);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func export_identity_state() : async { #Ok : Types.State; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    #Ok({ schema = 1; accounts; exclusions = accountExclusions; families = accountFamilies; challenges = accountChallenges; roles = accountRoles; next_challenge = nextChallengeId })
  };
  // ---- Team-invite shareable links: a single rotating token redeemable
  // by anyone who holds it (role fixed at creation), distinct from the
  // per-email TeamInvite records above. ----

  transient let hexDigits : [Text] = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"];

  // 128 bits of raw_rand entropy, hex-encoded. Bearer tokens (invite ids,
  // share-link tokens) must be unguessable — never derive them from
  // counters or timestamps. raw_rand is an async management-canister call,
  // so this is only usable from update methods.
  func randomHex(bytes : Nat) : async Text {
    let blob = await Random.blob();
    var out = "";
    var i = 0;
    label fill for (b in blob.values()) {
      if (i >= bytes) break fill;
      let n = Nat8.toNat(b);
      out #= hexDigits[n / 16] # hexDigits[n % 16];
      i += 1;
    };
    out
  };

  func genToken(prefix : Text) : async Text {
    prefix # "-" # (await randomHex(16))
  };

  public shared ({ caller }) func create_team_invite_link(club_id : Text, team_id : Text, role : Text) : async { #Ok : Types.TeamInviteLink; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not (await canCreateTeamRosterInvite(caller, club_id, team_id, role))) return #Err("Team or competition admin required for player/parent invites");
    if (role == "") return #Err("Invalid role");
    let now = nowMs();
    let link : Types.TeamInviteLink = {
      id = "tlink-" # team_id # "-" # Nat.toText(teamInviteLinks.size() + 1);
      club_id; team_id; role;
      token = await genToken("tok");
      created_by = caller;
      created_at_ms = now;
      rotated_at_ms = null;
      revoked = false;
    };
    teamInviteLinks := teamInviteLinks.concat([link]);
    #Ok(link)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func list_team_invite_links(team_id : Text) : async { #Ok : [Types.TeamInviteLink]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (teams.find(func(team) = team.id == team_id)) {
      case null { #Err("Team not found") };
      case (?team) {
        if (canManageTeam(caller, team.club_id, ?team_id)) {
          #Ok(teamInviteLinks.filter(func(link) = link.team_id == team_id))
        } else if (await canInviteEntrantTeamPlayers(caller, team.club_id, team_id)) {
          #Ok(teamInviteLinks.filter(func(link) = link.team_id == team_id and (link.role == "player" or link.role == "parent")))
        } else {
          #Err("Team or competition admin required")
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func rotate_team_invite_link(id : Text) : async { #Ok : Types.TeamInviteLink; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (teamInviteLinks.find(func(l) = l.id == id)) {
      case null { #Err("Invite link not found") };
      case (?link) {
        if (not (await canCreateTeamRosterInvite(caller, link.club_id, link.team_id, link.role))) return #Err("Team or competition admin required for player/parent invites");
        let updated : Types.TeamInviteLink = { link with token = await genToken("tok"); rotated_at_ms = ?nowMs() };
        teamInviteLinks := teamInviteLinks.map(func(l) = if (l.id == id) updated else l);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func revoke_team_invite_link(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (teamInviteLinks.find(func(l) = l.id == id)) {
      case null { #Err("Invite link not found") };
      case (?link) {
        if (not (await canCreateTeamRosterInvite(caller, link.club_id, link.team_id, link.role))) return #Err("Team or competition admin required for player/parent invites");
        let updated : Types.TeamInviteLink = { link with revoked = true };
        teamInviteLinks := teamInviteLinks.map(func(l) = if (l.id == id) updated else l);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func get_team_invite_link_by_token(token : Text) : async { #Ok : Types.TeamInviteLink; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    switch (teamInviteLinks.find(func(l) = l.token == token)) {
      case null { #Err("Invite link not found") };
      case (?link) {
        if (link.revoked) return #Err("Invite link revoked");
        #Ok(link)
      };
    }
  };

  // Redeem a shareable team-invite link: the token itself is the
  // capability (unrevoked links only), and redemption is idempotent —
  // accepting the same link twice changes nothing.
  public shared ({ caller }) func accept_team_invite_link(token : Text) : async { #Ok : Types.TeamInviteLink; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (teamInviteLinks.find(func(l) = l.token == token)) {
      case null { #Err("Invite link not found") };
      case (?link) {
        if (link.revoked) return #Err("Invite link revoked");
        if (isExcluded(caller, link.club_id)) return #Err("Forbidden");
        if (not acl.roles.any(func(g) = g.user.equal(caller) and g.role == link.role and g.club == ?link.club_id and g.team == ?link.team_id)) {
          let grant : Types.RoleGrant = { user = caller; role = link.role; club = ?link.club_id; team = ?link.team_id };
          membershipEpoch += 1;
          acl := { acl with roles = acl.roles.concat([grant]) };
        };
        #Ok(link)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Pending invites: generalized team/club/guardian invite flow.
  // Email delivery stays with a server job; create/resend return the
  // payload that job would send instead of sending it. ----

  func invitePayloadFor(invite : Types.PendingInvite) : Types.InvitePayload {
    let subjectKind = switch (invite.kind) {
      case "club" "You're invited to join a club";
      case "guardian" "You're invited as a guardian";
      case _ "You're invited to join a team";
    };
    {
      to = invite.email;
      subject = subjectKind;
      body = "Invite id " # invite.id # " for club " # invite.club_id # (switch (invite.team_id) { case (?t) " team " # t; case null "" });
    }
  };

  public shared ({ caller }) func create_pending_invite(kind : Text, club_id : Text, team_id : ?Text, child_id : ?Text, email : Text, role : ?Text) : async { #Ok : { invite : Types.PendingInvite; payload : Types.InvitePayload }; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    if (isExcluded(caller, club_id)) return #Err("Forbidden");
    if (kind != "team" and kind != "club" and kind != "guardian") return #Err("Invalid invite kind");
    if (email == "" or email.size() > 320) return #Err("Invalid email");
    if (kind == "guardian") {
      switch (child_id) {
        case null return #Err("Referenced child required");
        case (?child) { if (not parentInviteScopeValid(club_id, team_id, child)) return #Err("Referenced child not in invite scope") };
      }
    };
    switch (team_id) {
      case (?team) {
        let directAccess = canManageTeam(caller, club_id, ?team);
        let compRoleAllowed = switch (role) {
          case (?value) { value == "player" or value == "parent" };
          case null false;
        };
        let compInvite = if (kind == "team" and compRoleAllowed) {
          await canInviteEntrantTeamPlayers(caller, club_id, team)
        } else {
          false
        };
        if (not directAccess and not compInvite) return #Err("Team or competition admin required for player/parent invites");
      };
      case null { if (not isAdmin(caller, club_id)) return #Err("Club admin required") };
    };
    let token = "pinv-" # (await randomHex(16));
    if (kind == "guardian") {
      if (not canManageTeam(caller, club_id, team_id)) return #Err("Invite authorization changed");
      switch (child_id) {
        case null return #Err("Referenced child required");
        case (?child) { if (not parentInviteScopeValid(club_id, team_id, child)) return #Err("Referenced child not in invite scope") };
      }
    };
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    if (isExcluded(caller, club_id)) return #Err("Forbidden");
    let now = nowMs();
    let invite : Types.PendingInvite = {
      id = token;
      kind; club_id; team_id; child_id; email; role;
      invited_by = caller;
      created_at_ms = now;
      status = "pending";
      resent_at_ms = null;
      accepted_at_ms = null;
      accepted_by = null;
    };
    pendingInvites := pendingInvites.concat([invite]);
    #Ok({ invite; payload = invitePayloadFor(invite) })
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func list_pending_invites_by_club(club_id : Text) : async { #Ok : [Types.PendingInvite]; #Err : Text } {
    denyLegacyAccountQuery();
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    #Ok(pendingInvites.filter(func(i) = i.club_id == club_id))
  };

  // Short invite links: an 8-char hex code resolving to a PendingInvite id,
  // so share links can be short (e.g. example.com/i/AB12CD34) instead of
  // embedding the full invite id. Idempotent per invite_id.
  public shared ({ caller }) func create_invite_short_code(invite_id : Text) : async { #Ok : Text; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (pendingInvites.find(func(i) = i.id == invite_id)) {
      case null { return #Err("Invite not found") };
      case (?invite) { if (not isAdmin(caller, invite.club_id)) return #Err("Club admin required") };
    };
    switch (inviteShortCodes.find(func(e) = e.1 == invite_id)) {
      case (?existing) { return #Ok(existing.0) };
      case null {};
    };
    let code = Text.toUpper(await randomHex(4));
    inviteShortCodes := inviteShortCodes.concat([(code, invite_id)]);
    #Ok(code)
  
    } finally { removalReceiver.leave(caller) };
  };

  public query func resolve_invite_short_code(code : Text) : async { #Ok : Text; #Err : Text } {
    let wanted = Text.toUpper(code);
    switch (inviteShortCodes.find(func(e) = e.0 == wanted)) {
      case (?entry) { #Ok(entry.1) };
      case null { #Err("Short code not found") };
    }
  };

  // ---- Pending invite email-hash dedupe index ----
  // The frontend hashes the invite email (salt + lowercase email, SHA-256)
  // client-side; the canister never sees plaintext. Staff of the invite's
  // own club may record/query the hash to detect duplicate invites.

  public shared ({ caller }) func set_pending_invite_email_hash(invite_id : Text, club_id : Text, hash : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not acl.roles.any(func(grant) = grant.user.equal(caller) and grant.club == ?club_id)) return #Err("Club staff required");
    pendingInviteEmailHashes := pendingInviteEmailHashes.filter(func(h) = h.invite_id != invite_id).concat([{ invite_id; club_id; hash }]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func find_pending_invite_by_email_hash(club_id : Text, hash : Text) : async { #Ok : ?Types.PendingInviteEmailHash; #Err : Text } {
    denyLegacyAccountQuery();
    if (not acl.roles.any(func(grant) = grant.user.equal(caller) and grant.club == ?club_id)) return #Err("Club staff required");
    #Ok(pendingInviteEmailHashes.find(func(h) = h.club_id == club_id and h.hash == hash))
  };

  // Invite preview for the join page: the invite id itself is the bearer
  // token (random 128-bit ids, sent only to the invited email address /
  // share channel), so this is intentionally anonymous — the same trust
  // model as accept_pending_invite, which redeems by id alone.
  public query func get_pending_invite(id : Text) : async { #Ok : Types.PendingInvite; #Err : Text } {
    switch (pendingInvites.find(func(i) = i.id == id)) {
      case null { #Err("Invite not found") };
      case (?invite) {
        if (invite.status == "revoked") return #Err("Invite revoked");
        #Ok(invite)
      };
    }
  };

  public shared ({ caller }) func resend_pending_invite(id : Text) : async { #Ok : { invite : Types.PendingInvite; payload : Types.InvitePayload }; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (pendingInvites.find(func(i) = i.id == id)) {
      case null { #Err("Invite not found") };
      case (?invite) {
        if (not isAdmin(caller, invite.club_id)) return #Err("Club admin required");
        if (invite.status == "revoked") return #Err("Invite revoked");
        let updated : Types.PendingInvite = { invite with status = "resent"; resent_at_ms = ?nowMs() };
        pendingInvites := pendingInvites.map(func(i) = if (i.id == id) updated else i);
        #Ok({ invite = updated; payload = invitePayloadFor(updated) })
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func revoke_pending_invite(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (pendingInvites.find(func(i) = i.id == id)) {
      case null { #Err("Invite not found") };
      case (?invite) {
        if (not isAdmin(caller, invite.club_id)) return #Err("Club admin required");
        let updated : Types.PendingInvite = { invite with status = "revoked" };
        pendingInvites := pendingInvites.map(func(i) = if (i.id == id) updated else i);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // Self-accept: the invited principal redeems a PendingInvite directly
  // (no admin-issued share token flow like ParentInvite — PendingInvite
  // kind "team"/"club"/"guardian" is looked up by id). Grants the role
  // (team/club scoped per the invite), and for "guardian" invites also
  // links the guardian/child the same way accept_parent_invite does.
  public shared ({ caller }) func accept_pending_invite(id : Text) : async { #Ok : Types.PendingInvite; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (pendingInvites.find(func(i) = i.id == id)) {
      case null { #Err("Invite not found") };
      case (?invite) {
        if (isTransferFenced(invite.club_id)) return #Err("Club is temporarily locked for a transfer");
        if (invite.status == "accepted") return #Err("Invite already accepted");
        if (invite.status == "revoked") return #Err("Invite revoked");
        if (isExcluded(caller, invite.club_id)) return #Err("Forbidden");
        if (invite.kind == "guardian") {
          if (isExcluded(invite.invited_by, invite.club_id) or not canManageTeam(invite.invited_by, invite.club_id, invite.team_id)) return #Err("Invite authorization changed");
          switch (invite.child_id) {
            case null return #Err("Referenced child required");
            case (?child) { if (not parentInviteScopeValid(invite.club_id, invite.team_id, child)) return #Err("Referenced child not in invite scope") };
          };
          switch (invite.child_id) {
            case (?childId) {
              switch (invite.team_id) {
                case (?team) {
                  switch (acl.children.find(func(c) = c.id == childId)) {
                    case null {
                      let child : Types.Child = { id = childId; teams = [team]; parent = null; club_id = ?invite.club_id };
                      membershipEpoch += 1;
                      acl := { acl with children = acl.children.concat([child]) };
                    };
                    case (?child) {
                      if (not child.teams.any(func(t) = t == team)) {
                        let updatedChild : Types.Child = { child with teams = child.teams.concat([team]) };
                        membershipEpoch += 1;
                        acl := { acl with children = acl.children.map(func(c) = if (c.id == childId) updatedChild else c) };
                      };
                    };
                  };
                };
                case null {};
              };
              if (not acl.guardians.any(func(g) = g.child == childId and g.user.equal(caller))) {
                membershipEpoch += 1;
                acl := { acl with guardians = acl.guardians.concat([{ child = childId; user = caller }]) };
              };
              switch (accountFor(caller)) {
                case (?account) {
                  if (not accountFamilies.any(func(fam) = fam.account_id == account.id and fam.child_id == childId)) {
                    membershipEpoch += 1;
                    accountFamilies := accountFamilies.concat([{ account_id = account.id; child_id = childId }]);
                  };
                };
                case null {};
              };
            };
            case null {};
          };
        } else {
          // "team" / "club" invites grant the stated role, scoped to the
          // team when present, else club-wide.
          switch (invite.role) {
            case (?role) {
              if (not acl.roles.any(func(g) = g.user.equal(caller) and g.role == role and g.club == ?invite.club_id and g.team == invite.team_id)) {
                let grant : Types.RoleGrant = { user = caller; role; club = ?invite.club_id; team = invite.team_id };
                membershipEpoch += 1;
                acl := { acl with roles = acl.roles.concat([grant]) };
              };
            };
            case null {};
          };
        };
        let accepted : Types.PendingInvite = { invite with status = "accepted"; accepted_at_ms = ?nowMs(); accepted_by = ?caller };
        pendingInvites := pendingInvites.map(func(i) = if (i.id == id) accepted else i);
        #Ok(accepted)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Guardian link/unlink + admin-assisted child/parent linking ----

  func childClubIds(child_id : Text) : [Text] {
    switch (acl.children.find(func(c) = c.id == child_id)) {
      case null { [] };
      case (?child) {
        var clubs : [Text] = [];
        switch (child.club_id) {
          case (?club) { if (not clubs.any(func(c) = c == club)) clubs := clubs.concat([club]) };
          case null {};
        };
        for (teamId in child.teams.values()) {
          switch (acl.teams.find(func(t) = t.id == teamId)) {
            case (?t) { if (not clubs.any(func(c) = c == t.club)) clubs := clubs.concat([t.club]) };
            case null {};
          };
        };
        clubs
      };
    }
  };

  func canManageChild(caller : Principal, child_id : Text) : Bool {
    isGovernor(caller) or childClubIds(child_id).any(func(club) = isAdmin(caller, club))
  };

  public shared ({ caller }) func link_guardian(child_id : Text, user : Principal) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not canManageChild(caller, child_id)) return #Err("Club admin required");
    if (not acl.guardians.any(func(g) = g.child == child_id and g.user.equal(user))) {
      membershipEpoch += 1;
      acl := { acl with guardians = acl.guardians.concat([{ child = child_id; user }]) };
    };
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func unlink_guardian(child_id : Text, user : Principal) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not (canManageChild(caller, child_id) or caller.equal(user))) return #Err("Forbidden");
    membershipEpoch += 1;
    acl := { acl with guardians = acl.guardians.filter(func(g) = not (g.child == child_id and g.user.equal(user))) };
    guardianMeta := guardianMeta.filter(func(m) = not (m.child_id == child_id and m.user.equal(user)));
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Guardian relationship metadata (relationship_type/is_primary), layered
  // on top of the core acl.guardians (child, user) link. Settable by the
  // guardian themselves or club staff managing the child; unlink_guardian
  // prunes the matching entry so it never outlives the underlying link.
  public shared ({ caller }) func set_guardian_relationship(child_id : Text, user : Principal, relationship_type : Text, is_primary : Bool) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not (caller.equal(user) or canManageChild(caller, child_id))) return #Err("Forbidden");
    if (not acl.guardians.any(func(g) = g.child == child_id and g.user.equal(user))) return #Err("Not a guardian of this child");
    let entry : Types.GuardianMeta = { child_id; user; relationship_type; is_primary };
    guardianMeta := guardianMeta.filter(func(m) = not (m.child_id == child_id and m.user.equal(user))).concat([entry]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func get_guardian_relationships(child_id : Text) : async { #Ok : [Types.GuardianMeta]; #Err : Text } {
    denyLegacyAccountQuery();
    if (not (acl.guardians.any(func(g) = g.child == child_id and g.user.equal(caller)) or canManageChild(caller, child_id))) return #Err("Forbidden");
    #Ok(guardianMeta.filter(func(m) = m.child_id == child_id))
  };

  public shared ({ caller }) func admin_link_child_to_parent(child_id : Text, parent : Principal) : async { #Ok : Types.Child; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not canManageChild(caller, child_id)) return #Err("Club admin required");
    switch (acl.children.find(func(c) = c.id == child_id)) {
      case null { #Err("Child not found") };
      case (?child) {
        let updated : Types.Child = { child with parent = ?parent };
        membershipEpoch += 1;
        acl := { acl with children = acl.children.map(func(c) = if (c.id == child_id) updated else c) };
        if (not acl.guardians.any(func(g) = g.child == child_id and g.user.equal(parent))) {
          membershipEpoch += 1;
          acl := { acl with guardians = acl.guardians.concat([{ child = child_id; user = parent }]) };
        };
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func create_child_for_parent_on_team(club_id : Text, team_id : Text, parent : Principal) : async { #Ok : Types.Child; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not canManageTeam(caller, club_id, ?team_id)) return #Err("Team or club admin required");
    if (not teamInClub(team_id, club_id)) return #Err("Team not found in club");
    let child : Types.Child = {
      id = "child-" # club_id # "-" # Nat.toText(acl.children.size() + 1) # "-" # Nat64.toText(nowNs() % 1_000_000_000);
      teams = [team_id];
      parent = ?parent;
      club_id = ?club_id;
    };
    membershipEpoch += 1;
    acl := { acl with children = acl.children.concat([child]) };
    membershipEpoch += 1;
    acl := { acl with guardians = acl.guardians.concat([{ child = child.id; user = parent }]) };
    #Ok(child)
  
    } finally { removalReceiver.leave(caller) };
  };

  // Mini-league-scope link: a club admin can create a child record scoped
  // only to the club (no team assignment yet), mirroring
  // create_child_for_parent_on_team but without requiring a team id.
  public shared ({ caller }) func create_child_for_parent_in_club(club_id : Text, parent : Principal) : async { #Ok : Types.Child; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not (isAdmin(caller, club_id) or isGovernor(caller))) return #Err("Club admin required");
    if (not acl.clubs.any(func(c) = c == club_id)) return #Err("Club not found");
    let child : Types.Child = {
      id = "child-" # club_id # "-" # Nat.toText(acl.children.size() + 1) # "-" # Nat64.toText(nowNs() % 1_000_000_000);
      teams = [];
      parent = ?parent;
      club_id = ?club_id;
    };
    membershipEpoch += 1;
    acl := { acl with children = acl.children.concat([child]) };
    membershipEpoch += 1;
    acl := { acl with guardians = acl.guardians.concat([{ child = child.id; user = parent }]) };
    #Ok(child)
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Parent self-service children (Children page) ----
  // Parents manage their own children without a club admin. Names are never
  // stored here — they live encrypted on pii_access_control (pii_id = child id).

  func isChildGuardian(caller : Principal, child : Types.Child) : Bool {
    (switch (child.parent) { case (?p) p.equal(caller); case null false })
    or acl.guardians.any(func(g) = g.child == child.id and g.user.equal(caller))
  };

  func isChildPrimary(caller : Principal, child : Types.Child) : Bool {
    switch (child.parent) { case (?p) p.equal(caller); case null false }
  };

  public query ({ caller }) func list_my_children() : async [Types.Child] {
    denyLegacyAccountQuery();
    auth(caller);
    acl.children.filter(func(c) = isChildGuardian(caller, c))
  };

  public query ({ caller }) func list_child_guardians(child_id : Text) : async { #Ok : [Principal]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    switch (acl.children.find(func(c) = c.id == child_id)) {
      case null { #Err("Child not found") };
      case (?child) {
        if (not (isChildGuardian(caller, child) or canManageChild(caller, child_id))) return #Err("Forbidden");
        #Ok(acl.guardians.filter(func(g) = g.child == child_id).map(func(g) = g.user))
      };
    }
  };

  public shared ({ caller }) func create_own_child() : async { #Ok : Types.Child; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (acl.children.filter(func(c) = isChildPrimary(caller, c)).size() >= 20) return #Err("Too many children");
    let child : Types.Child = {
      id = "child-own-" # Nat.toText(acl.children.size() + 1) # "-" # Nat64.toText(nowNs() % 1_000_000_000_000);
      teams = [];
      parent = ?caller;
      club_id = null;
    };
    membershipEpoch += 1;
    acl := { acl with children = acl.children.concat([child]) };
    membershipEpoch += 1;
    acl := { acl with guardians = acl.guardians.concat([{ child = child.id; user = caller }]) };
    switch (accountFor(caller)) {
      case (?account) { membershipEpoch += 1; accountFamilies := accountFamilies.concat([{ account_id = account.id; child_id = child.id }]) };
      case null {};
    };
    #Ok(child)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func delete_own_child(child_id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (acl.children.find(func(c) = c.id == child_id)) {
      case null { #Err("Child not found") };
      case (?child) {
        if (not isChildPrimary(caller, child)) return #Err("Only the primary parent can remove this child");
        membershipEpoch += 1;
        acl := { acl with
          children = acl.children.filter(func(c) = c.id != child_id);
          guardians = acl.guardians.filter(func(g) = g.child != child_id);
        };
        membershipEpoch += 1;
        accountFamilies := accountFamilies.filter(func(f) = f.child_id != child_id);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // A guardian may place their child on any team in a club they belong to.
  public shared ({ caller }) func set_own_child_team(child_id : Text, team_id : Text, assigned : Bool) : async { #Ok : Types.Child; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (acl.children.find(func(c) = c.id == child_id), acl.teams.find(func(t) = t.id == team_id)) {
      case (null, _) { #Err("Child not found") };
      case (_, null) { #Err("Team not found") };
      case (?child, ?team) {
        if (not isChildGuardian(caller, child)) return #Err("Forbidden");
        if (assigned and not isMember(caller, team.club)) return #Err("Club membership required");
        let teams = if (assigned) {
          if (child.teams.any(func(t) = t == team_id)) child.teams else child.teams.concat([team_id])
        } else child.teams.filter(func(t) = t != team_id);
        let updated : Types.Child = { child with teams };
        membershipEpoch += 1;
        acl := { acl with children = acl.children.map(func(c) = if (c.id == child_id) updated else c) };
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // Primary parent adds/removes another guardian; a guardian may remove themselves.
  public shared ({ caller }) func set_own_child_guardian(child_id : Text, user : Principal, linked : Bool) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (acl.children.find(func(c) = c.id == child_id)) {
      case null { #Err("Child not found") };
      case (?child) {
        let selfRemoval = (not linked) and caller.equal(user) and not isChildPrimary(caller, child);
        if (not (isChildPrimary(caller, child) or selfRemoval)) return #Err("Only the primary parent can change guardians");
        if (isChildPrimary(user, child) and not linked) return #Err("Cannot remove the primary parent");
        if (linked) {
          if (not acl.guardians.any(func(g) = g.child == child_id and g.user.equal(user))) {
            membershipEpoch += 1;
            acl := { acl with guardians = acl.guardians.concat([{ child = child_id; user }]) };
          };
        } else {
          membershipEpoch += 1;
          acl := { acl with guardians = acl.guardians.filter(func(g) = not (g.child == child_id and g.user.equal(user))) };
        };
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Move member / child between teams ----

  public shared ({ caller }) func move_member_to_team(club_id : Text, user : Principal, from_team : ?Text, to_team : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    if (not teamInClub(to_team, club_id)) return #Err("Target team not found in club");
    membershipEpoch += 1;
    acl := { acl with roles = acl.roles.map(func(g) = if (g.user.equal(user) and g.club == ?club_id and g.team == from_team) ({ g with team = ?to_team }) else g) };
    accountRoles := accountRoles.map(func(g) = if (g.account_id == accountIdFor(user) and g.club == ?club_id and g.team == from_team) ({ g with team = ?to_team }) else g);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func move_child_to_team(child_id : Text, from_team : ?Text, to_team : Text) : async { #Ok : Types.Child; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (acl.teams.find(func(t) = t.id == to_team)) {
      case null { #Err("Target team not found") };
      case (?team) {
        if (not canManageTeam(caller, team.club, ?to_team)) return #Err("Team or club admin required");
        switch (acl.children.find(func(c) = c.id == child_id)) {
          case null { #Err("Child not found") };
          case (?child) {
            let keptTeams = switch (from_team) {
              case (?ft) child.teams.filter(func(t) = t != ft);
              case null child.teams;
            };
            let newTeams = if (keptTeams.any(func(t) = t == to_team)) keptTeams else keptTeams.concat([to_team]);
            let updated : Types.Child = { child with teams = newTeams };
            membershipEpoch += 1;
            acl := { acl with children = acl.children.map(func(c) = if (c.id == child_id) updated else c) };
            #Ok(updated)
          };
        }
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Bulk team-member add ----

  public shared ({ caller }) func bulk_add_team_members(club_id : Text, team_id : Text, role : Text, users : [Principal]) : async { #Ok : Nat; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not canManageTeam(caller, club_id, ?team_id)) return #Err("Team or club admin required");
    if (role == "") return #Err("Invalid role");
    if (users.size() > 200) return #Err("Too many members");
    for (user in users.values()) {
      membershipEpoch += 1;
      acl := { acl with roles = acl.roles.concat([{ user; role; club = ?club_id; team = ?team_id }]) };
      accountRoles := accountRoles.concat([{ account_id = accountIdFor(user); club = ?club_id; role; team = ?team_id }]);
    };
    ignore fanOutEnsureConversation(club_id, null, clubChatParticipants(club_id));
    ignore fanOutEnsureConversation(club_id, ?team_id, teamChatParticipants(club_id, team_id));
    #Ok(users.size())
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Team archive ----

  public shared ({ caller }) func archive_team(id : Text) : async { #Ok : Types.ClubTeam; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (teams.find(func(t) = t.id == id)) {
      case null { #Err("Team not found") };
      case (?team) {
        if (not isAdmin(caller, team.club_id)) return #Err("Club admin required");
        let updated : Types.ClubTeam = { team with archived = true };
        membershipEpoch += 1;
        teams := teams.map(func(t) = if (t.id == id) updated else t);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func unarchive_team(id : Text) : async { #Ok : Types.ClubTeam; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (teams.find(func(t) = t.id == id)) {
      case null { #Err("Team not found") };
      case (?team) {
        if (not isAdmin(caller, team.club_id)) return #Err("Club admin required");
        let updated : Types.ClubTeam = { team with archived = false };
        membershipEpoch += 1;
        teams := teams.map(func(t) = if (t.id == id) updated else t);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Team-creation requests ----

  public shared ({ caller }) func request_team_creation(club_id : Text, name : Text, division : ?Text, age_group : ?Text) : async { #Ok : Types.TeamCreationRequest; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Forbidden");
    if (name == "" or name.size() > 160) return #Err("Invalid team name");
    let now = nowMs();
    let req : Types.TeamCreationRequest = {
      id = "treq-" # club_id # "-" # Nat.toText(teamCreationRequests.size() + 1) # "-" # Nat64.toText(now);
      club_id; name; division; age_group;
      requested_by = caller;
      status = "pending";
      created_at_ms = now;
      decided_at_ms = null;
      decided_by = null;
      team_id = null;
    };
    teamCreationRequests := teamCreationRequests.concat([req]);
    #Ok(req)
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func list_team_creation_requests(club_id : Text) : async { #Ok : [Types.TeamCreationRequest]; #Err : Text } {
    denyLegacyAccountQuery();
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    #Ok(teamCreationRequests.filter(func(r) = r.club_id == club_id))
  };

  public shared ({ caller }) func approve_team_creation_request(id : Text) : async { #Ok : Types.TeamCreationRequest; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (teamCreationRequests.find(func(r) = r.id == id)) {
      case null { #Err("Request not found") };
      case (?req) {
        if (not isAdmin(caller, req.club_id)) return #Err("Club admin required");
        if (req.status != "pending") return #Err("Request already processed");
        let now = nowMs();
        let team : Types.ClubTeam = {
          id = "team-" # req.club_id # "-" # Nat.toText(teams.size() + 1) # "-" # Nat64.toText(now);
          name = req.name; division = req.division; gender = null; is_active = true; club_id = req.club_id;
          age_group = req.age_group; description = null; logo_url = null; team_type = null;
          deleted_at_ms = null;
          is_shell = false;
          shell_claim_token = null;
          shell_claimed_at_ms = null;
          shell_claimed_by = null;
          shell_contact_email = null;
          shell_contact_name = null;
          shell_invited_by = null;
          archived = false;
          playhq_team_id = null; playhq_competition_id = null; playhq_auto_create_events = false;
          folder_id = null;
        };
        membershipEpoch += 1;
        teams := teams.concat([team]);
        let updated : Types.TeamCreationRequest = { req with status = "approved"; decided_at_ms = ?now; decided_by = ?caller; team_id = ?team.id };
        teamCreationRequests := teamCreationRequests.map(func(r) = if (r.id == id) updated else r);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func reject_team_creation_request(id : Text) : async { #Ok : Types.TeamCreationRequest; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (teamCreationRequests.find(func(r) = r.id == id)) {
      case null { #Err("Request not found") };
      case (?req) {
        if (not isAdmin(caller, req.club_id)) return #Err("Club admin required");
        if (req.status != "pending") return #Err("Request already processed");
        let updated : Types.TeamCreationRequest = { req with status = "rejected"; decided_at_ms = ?nowMs(); decided_by = ?caller };
        teamCreationRequests := teamCreationRequests.map(func(r) = if (r.id == id) updated else r);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Team player positions ----

  public query ({ caller }) func get_team_player_positions(team_id : Text) : async { #Ok : [Types.TeamPlayerPosition]; #Err : Text } {
    denyLegacyAccountQuery();
    switch (acl.teams.find(func(t) = t.id == team_id)) {
      case null { #Err("Team not found") };
      case (?team) {
        if (not isMember(caller, team.club)) return #Err("Forbidden");
        #Ok(teamPlayerPositions.filter(func(p) = p.team_id == team_id))
      };
    }
  };

  public shared ({ caller }) func set_team_player_position(team_id : Text, member_id : Text, position : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (acl.teams.find(func(t) = t.id == team_id)) {
      case null { #Err("Team not found") };
      case (?team) {
        if (not canManageTeam(caller, team.club, ?team_id)) return #Err("Team or club admin required");
        teamPlayerPositions := teamPlayerPositions.filter(func(p) = not (p.team_id == team_id and p.member_id == member_id));
        teamPlayerPositions := teamPlayerPositions.concat([{ team_id; member_id; position }]);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Team player positions v2 (multi-position + jersey number) ----

  public query ({ caller }) func get_team_player_positions_v2(team_id : Text) : async { #Ok : [Types.TeamPlayerPositionAssignment]; #Err : Text } {
    denyLegacyAccountQuery();
    switch (acl.teams.find(func(t) = t.id == team_id)) {
      case null { #Err("Team not found") };
      case (?team) {
        if (not isMember(caller, team.club)) return #Err("Forbidden");
        #Ok(teamPlayerPositionAssignments.filter(func(a) = a.team_id == team_id))
      };
    }
  };

  public shared ({ caller }) func set_team_player_positions_v2(team_id : Text, member_id : Text, positions : [Text], jersey_number : ?Nat16) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (acl.teams.find(func(t) = t.id == team_id)) {
      case null { #Err("Team not found") };
      case (?team) {
        if (not canManageTeam(caller, team.club, ?team_id)) return #Err("Team or club admin required");
        teamPlayerPositionAssignments := teamPlayerPositionAssignments.filter(func(a) = not (a.team_id == team_id and a.member_id == member_id));
        teamPlayerPositionAssignments := teamPlayerPositionAssignments.concat([{ team_id; member_id; positions; jersey_number }]);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Team captains ----

  public shared ({ caller }) func add_team_captain(club_id : Text, team_id : Text, user : Principal) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not canManageTeam(caller, club_id, ?team_id)) return #Err("Team or club admin required");
    if (not teamCaptains.any(func(c) = c.team_id == team_id and c.user.equal(user))) {
      teamCaptains := teamCaptains.concat([{ team_id; user }]);
    };
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func remove_team_captain(club_id : Text, team_id : Text, user : Principal) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not canManageTeam(caller, club_id, ?team_id)) return #Err("Team or club admin required");
    teamCaptains := teamCaptains.filter(func(c) = not (c.team_id == team_id and c.user.equal(user)));
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func list_team_captains(team_id : Text) : async { #Ok : [Types.TeamCaptain]; #Err : Text } {
    denyLegacyAccountQuery();
    switch (acl.teams.find(func(t) = t.id == team_id)) {
      case null { #Err("Team not found") };
      case (?team) {
        if (not isMember(caller, team.club)) return #Err("Forbidden");
        #Ok(teamCaptains.filter(func(c) = c.team_id == team_id))
      };
    }
  };

  // ---- Club creation + club join requests ----

  public shared ({ caller }) func create_club(id : Text, name : Text, slug : Text, description : ?Text, sport : ?Text) : async { #Ok : Types.ClubProfile; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (id == "" or id.size() > 128) return #Err("Invalid club id");
    if (name == "" or name.size() > 160) return #Err("Invalid club name");
    if (profiles.any(func(p) = p.id == id)) return #Err("Club already exists");
    if (not (await creatorPlacementAllowed(caller, id))) return #Err("Original creator placement required");
    auth(caller);
    if (removalReceiver.denied(caller) or profiles.any(func(p) = p.id == id)) return #Err("Club creation changed during placement check");
    if (growthRehearsal and not MediaGrowthReservations.reserve(mediaGrowthState, mediaRetainedState.ledger, id, mediaGrowthState.freeBytes)) return #Err("Verified group growth capacity required");
    if (routerGrowthRehearsal and not (await reserveRouterGrowth(id))) return #Err("Group-wide growth reservation required");
    // The router call can interleave creation/removal; recheck before publish.
    auth(caller);
    if (removalReceiver.denied(caller) or profiles.any(func(p) = p.id == id)) return #Err("Club creation changed during reservation");
    let profile : Types.ClubProfile = {
      id; name; slug; description; sport;
      created_at_ms = nowMs();
      logo_url = null;
      is_active = true;
      primary_color = null;
      secondary_color = null;
      deleted_at_ms = null;
      playhq_tenant = null; playhq_org_id = null;
    };
    membershipEpoch += 1;
    profiles := profiles.concat([profile]);
    membershipEpoch += 1;
    acl := { acl with roles = acl.roles.concat([{ user = caller; role = "club_admin"; club = ?id; team = null }]) };
    accountRoles := accountRoles.concat([{ account_id = accountIdFor(caller); club = ?id; role = "club_admin"; team = null }]);
    // Provision the club chat on the messaging canister (best-effort).
    ignore fanOutEnsureConversation(id, null, [caller]);
    #Ok(profile)
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Club home country (jurisdiction routing metadata) ----

  func homeCountryOf(club_id : Text) : ?Text {
    for (entry in clubHomeCountries.values()) {
      if (entry.0 == club_id) return ?entry.1;
    };
    null
  };

  // Records the club's home country. Club admins can set it once (right
  // after creation); afterwards only the governor can change it, since a
  // country move is a deliberate data migration, never a toggle.
  public shared ({ caller }) func set_club_home_country(club_id : Text, country : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    if (country.size() != 2) return #Err("Invalid country code");
    for (c in country.chars()) {
      if (c < 'A' or c > 'Z') return #Err("Invalid country code");
    };
    switch (homeCountryOf(club_id)) {
      case (?_) {
        if (not isGovernor(caller)) return #Err("Home country already set");
      };
      case null {};
    };
    clubHomeCountries := clubHomeCountries.filter(func(entry) = entry.0 != club_id);
    clubHomeCountries := clubHomeCountries.concat([(club_id, country)]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  // Batched read matching get_club_profiles; public like the club profile
  // itself — a country code is not sensitive.
  public query func get_club_home_countries(ids : [Text]) : async { #Ok : [(Text, Text)]; #Err : Text } {
    #Ok(clubHomeCountries.filter(func(entry) = ids.any(func(id) = id == entry.0)))
  };

  public shared ({ caller }) func request_club_join(club_id : Text) : async { #Ok : Types.ClubJoinRequest; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (isExcluded(caller, club_id)) return #Err("Forbidden");
    if (isMember(caller, club_id)) return #Err("Already a member");
    let now = nowMs();
    let req : Types.ClubJoinRequest = {
      id = "cjreq-" # club_id # "-" # Nat.toText(clubJoinRequests.size() + 1) # "-" # Nat64.toText(now);
      club_id; user = caller;
      status = "pending";
      created_at_ms = now;
      decided_at_ms = null;
      decided_by = null;
    };
    clubJoinRequests := clubJoinRequests.concat([req]);
    #Ok(req)
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func list_club_join_requests(club_id : Text) : async { #Ok : [Types.ClubJoinRequest]; #Err : Text } {
    denyLegacyAccountQuery();
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    #Ok(clubJoinRequests.filter(func(r) = r.club_id == club_id))
  };

  public shared ({ caller }) func approve_club_join_request(id : Text) : async { #Ok : Types.ClubJoinRequest; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (clubJoinRequests.find(func(r) = r.id == id)) {
      case null { #Err("Request not found") };
      case (?req) {
        if (not isAdmin(caller, req.club_id)) return #Err("Club admin required");
        if (req.status != "pending") return #Err("Request already processed");
        membershipEpoch += 1;
        acl := { acl with roles = acl.roles.concat([{ user = req.user; role = "member"; club = ?req.club_id; team = null }]) };
        accountRoles := accountRoles.concat([{ account_id = accountIdFor(req.user); club = ?req.club_id; role = "member"; team = null }]);
        ignore fanOutEnsureConversation(req.club_id, null, clubChatParticipants(req.club_id));
        let updated : Types.ClubJoinRequest = { req with status = "approved"; decided_at_ms = ?nowMs(); decided_by = ?caller };
        clubJoinRequests := clubJoinRequests.map(func(r) = if (r.id == id) updated else r);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func reject_club_join_request(id : Text) : async { #Ok : Types.ClubJoinRequest; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (clubJoinRequests.find(func(r) = r.id == id)) {
      case null { #Err("Request not found") };
      case (?req) {
        if (not isAdmin(caller, req.club_id)) return #Err("Club admin required");
        if (req.status != "pending") return #Err("Request already processed");
        let updated : Types.ClubJoinRequest = { req with status = "rejected"; decided_at_ms = ?nowMs(); decided_by = ?caller };
        clubJoinRequests := clubJoinRequests.map(func(r) = if (r.id == id) updated else r);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Club settings: theme palette, header toggles, invite style, hint.
  // save_club_settings/get_club_settings above already cover the whole
  // record; these are convenience patch-style setters over the same
  // fields added in this migration. ----

  func defaultSettingsFor(club_id : Text) : Types.ClubSettings {
    {
      club_id; contact_email = null; membership_open = false; announcement = null; public_directory = false;
      media_sponsors_enabled = false; media_header_sponsors_enabled = false; events_sponsor_strip_enabled = false; chat_thread_ads_enabled = false;
      theme_primary_color = null; theme_secondary_color = null; theme_accent_color = null;
      header_logo_enabled = true; header_club_name_enabled = true; invite_email_style = null; club_switcher_hint = null;
      theme_enabled = true; logo_only_mode = false;
      theme_dark_primary_color = null; theme_dark_secondary_color = null; theme_dark_accent_color = null;
    }
  };

  func currentSettingsFor(club_id : Text) : Types.ClubSettings {
    switch (settings.find(func(s) = s.club_id == club_id)) {
      case (?s) s;
      case null defaultSettingsFor(club_id);
    }
  };

  func putSettings(updated : Types.ClubSettings) {
    settings := settings.filter(func(s) = s.club_id != updated.club_id);
    settings := settings.concat([updated]);
  };

  public shared ({ caller }) func set_club_theme_palette(club_id : Text, primary : ?Text, secondary : ?Text, accent : ?Text, dark_primary : ?Text, dark_secondary : ?Text, dark_accent : ?Text) : async { #Ok : Types.ClubSettings; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    let updated : Types.ClubSettings = {
      currentSettingsFor(club_id) with
      theme_primary_color = primary; theme_secondary_color = secondary; theme_accent_color = accent;
      theme_dark_primary_color = dark_primary; theme_dark_secondary_color = dark_secondary; theme_dark_accent_color = dark_accent;
    };
    putSettings(updated);
    #Ok(updated)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func set_club_theme_enabled(club_id : Text, enabled : Bool) : async { #Ok : Types.ClubSettings; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    let updated : Types.ClubSettings = { currentSettingsFor(club_id) with theme_enabled = enabled };
    putSettings(updated);
    #Ok(updated)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func set_club_logo_only_mode(club_id : Text, enabled : Bool) : async { #Ok : Types.ClubSettings; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    let updated : Types.ClubSettings = { currentSettingsFor(club_id) with logo_only_mode = enabled };
    putSettings(updated);
    #Ok(updated)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func clear_club_theme(club_id : Text) : async { #Ok : Types.ClubSettings; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    let updated : Types.ClubSettings = {
      currentSettingsFor(club_id) with
      theme_primary_color = null; theme_secondary_color = null; theme_accent_color = null;
      theme_dark_primary_color = null; theme_dark_secondary_color = null; theme_dark_accent_color = null;
    };
    putSettings(updated);
    #Ok(updated)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func set_club_header_toggles(club_id : Text, header_logo_enabled : Bool, header_club_name_enabled : Bool) : async { #Ok : Types.ClubSettings; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    let updated : Types.ClubSettings = { currentSettingsFor(club_id) with header_logo_enabled; header_club_name_enabled };
    putSettings(updated);
    #Ok(updated)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func set_club_invite_email_style(club_id : Text, style : ?Text) : async { #Ok : Types.ClubSettings; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    let updated : Types.ClubSettings = { currentSettingsFor(club_id) with invite_email_style = style };
    putSettings(updated);
    #Ok(updated)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func set_club_switcher_hint(club_id : Text, hint : ?Text) : async { #Ok : Types.ClubSettings; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    let updated : Types.ClubSettings = { currentSettingsFor(club_id) with club_switcher_hint = hint };
    putSettings(updated);
    #Ok(updated)
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Per-user theme preference (light/dark/system or a club theme id).
  // Lives here rather than identity_access since it is club-switcher UI
  // state, closest to the club settings this canister already owns. ----

  public shared ({ caller }) func set_theme_preference(preference : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    themePrefs := themePrefs.filter(func(entry) = not entry.0.equal(caller));
    themePrefs := themePrefs.concat([(caller, preference)]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func get_my_theme_preference() : async { #Ok : ?Text; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    switch (themePrefs.find(func(entry) = entry.0.equal(caller))) {
      case (?entry) #Ok(?entry.1);
      case null #Ok(null);
    }
  };

  // ---- Per-user accessibility preferences (JSON blob: textScale/
  // highContrast/reduceMotion/boldText). Same shape as theme preference. ----

  public shared ({ caller }) func set_accessibility_prefs(prefs_json : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    accessibilityPrefs := accessibilityPrefs.filter(func(entry) = not entry.0.equal(caller));
    accessibilityPrefs := accessibilityPrefs.concat([(caller, prefs_json)]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  public query ({ caller }) func get_my_accessibility_prefs() : async { #Ok : ?Text; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    switch (accessibilityPrefs.find(func(entry) = entry.0.equal(caller))) {
      case (?entry) #Ok(?entry.1);
      case null #Ok(null);
    }
  };

  // ---- Presence heartbeat (Online Users admin page, ICP) ----
  // Caller records their own last-seen timestamp; any authenticated
  // principal may call this for themselves (self-reported, like
  // set_theme_preference). Pruned lazily on write to bound growth.
  public shared ({ caller }) func record_presence_heartbeat() : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    let callerText = Principal.toText(caller);
    let nowMs : Int = Time.now() / 1_000_000;
    // Prune entries older than 24h on every write so the list can't grow
    // unbounded across the lifetime of the canister.
    let cutoff : Int = nowMs - 86_400_000;
    presenceLastSeen := presenceLastSeen.filter(func(entry) = entry.1 >= cutoff and entry.0 != callerText);
    presenceLastSeen := presenceLastSeen.concat([(callerText, nowMs)]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  // Governor or app_admin only. Returns (principal_text, last_seen_ms) for
  // everyone seen within the last `window_seconds`.
  public query ({ caller }) func list_online_presence(window_seconds : Nat) : async { #Ok : [(Text, Int)]; #Err : Text } {
    denyLegacyAccountQuery();
    if (not (isGovernor(caller) or isAppAdmin(caller))) return #Err("App admin required");
    let nowMs : Int = Time.now() / 1_000_000;
    let cutoff : Int = nowMs - (window_seconds * 1000);
    #Ok(presenceLastSeen.filter(func(entry) = entry.1 >= cutoff));
  };

  // ---- Club branding + PlayHQ config (Phase 2 of the NEEDS-CANISTER
  // completion plan). Branding is a compact read combining the club
  // profile's name/logo with the settings contact email — the invite and
  // admin surfaces only need these three fields. ----

  public query ({ caller }) func get_club_branding(club_id : Text) : async { #Ok : Types.ClubBranding; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    let profile = switch (profiles.find(func(c) = c.id == club_id)) {
      case (?c) c;
      case null return #Err("Club not found");
    };
    let s = currentSettingsFor(club_id);
    #Ok({ name = profile.name; logo_url = profile.logo_url; contact_email = s.contact_email })
  };

  // ---- Club terms (class/season enrolment periods) — canister counterpart
  // of the Supabase `terms` table. save_club_term creates when the id is not
  // found, otherwise updates in place; an empty id creates with a fresh id.
  // Overlap rule matches the frontend validation: two active terms for the
  // same club may not share a date range. ----

  func validTermStatus(status : Text) : Bool { status == "active" or status == "archived" or status == "completed" };

  func termsOverlap(a : Types.ClubTerm, b : Types.ClubTerm) : Bool {
    a.club_id == b.club_id and a.id != b.id and a.is_active and b.is_active and
    a.start_date <= b.end_date and b.start_date <= a.end_date
  };

  public query ({ caller }) func list_club_terms(club_id : Text) : async { #Ok : [Types.ClubTerm]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    #Ok(clubTerms.filter(func(t) = t.club_id == club_id))
  };

  public shared ({ caller }) func save_club_term(term : Types.ClubTerm) : async { #Ok : Types.ClubTerm; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isAdmin(caller, term.club_id)) return #Err("Club admin required");
    if (term.name == "" or term.name.size() > 200) return #Err("Invalid name");
    if (term.start_date == "" or term.end_date == "") return #Err("Start and end dates are required");
    if (term.start_date > term.end_date) return #Err("Start date must be on or before end date");
    if (not validTermStatus(term.status)) return #Err("Invalid status");
    let stored : Types.ClubTerm = {
      id = if (term.id == "") "term-" # term.club_id # "-" # Nat.toText(clubTerms.size() + 1) # "-" # Nat64.toText(nowNs() % 1_000_000_000) else term.id;
      club_id = term.club_id;
      name = term.name;
      start_date = term.start_date;
      end_date = term.end_date;
      is_active = term.status == "active";
      status = term.status;
      created_at_ms = switch (clubTerms.find(func(t) = t.id == term.id and term.id != "")) {
        case (?existing) existing.created_at_ms;
        case null nowMs();
      };
    };
    if (stored.is_active and clubTerms.find(func(t) = termsOverlap(stored, t)) != null) {
      return #Err("Another active term overlaps these dates");
    };
    clubTerms := clubTerms.filter(func(t) = t.id != stored.id).concat([stored]);
    #Ok(stored)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func set_club_term_status(id : Text, status : Text) : async { #Ok : Types.ClubTerm; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not validTermStatus(status)) return #Err("Invalid status");
    switch (clubTerms.find(func(t) = t.id == id)) {
      case null { #Err("Term not found") };
      case (?current) {
        if (not isAdmin(caller, current.club_id)) return #Err("Club admin required");
        let updated : Types.ClubTerm = { current with status = status; is_active = status == "active" };
        if (updated.is_active and clubTerms.find(func(t) = termsOverlap(updated, t)) != null) {
          return #Err("Another active term overlaps these dates");
        };
        clubTerms := clubTerms.map(func(t) = if (t.id == id) updated else t);
        #Ok(updated)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func delete_club_term(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (clubTerms.find(func(t) = t.id == id)) {
      case null { #Err("Term not found") };
      case (?current) {
        if (not isAdmin(caller, current.club_id)) return #Err("Club admin required");
        clubTerms := clubTerms.filter(func(t) = t.id != id);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Seasons (draft|active|closed|archived) — distinct from ClubTerm.
  // save_season creates when id is "", else updates in place. get_current_season
  // returns the first season with status "active" for the club. ----

  func validSeasonStatus(status : Text) : Bool {
    status == "draft" or status == "active" or status == "closed" or status == "archived"
  };

  public query ({ caller }) func read_season_club(id : Text) : async { #Ok : ?Text; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    #Ok(switch (seasons.find(func(s) = s.id == id)) {
      case null null;
      case (?s) if (isAdmin(caller, s.club_id)) ?s.club_id else null;
    })
  };
  public query ({ caller }) func list_seasons(club_id : Text) : async { #Ok : [Types.Season]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    #Ok(seasons.filter(func(s) = s.club_id == club_id))
  };

  public query ({ caller }) func get_current_season(club_id : Text) : async { #Ok : ?Types.Season; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    #Ok(seasons.find(func(s) = s.club_id == club_id and s.status == "active"))
  };

  public shared ({ caller }) func save_season(season : Types.Season) : async { #Ok : Types.Season; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isAdmin(caller, season.club_id)) return #Err("Club admin required");
    if (season.name == "" or season.name.size() > 200) return #Err("Invalid name");
    if (not validSeasonStatus(season.status)) return #Err("Invalid status");
    let now = nowMs();
    let existing = if (season.id == "") null else seasons.find(func(s) = s.id == season.id);
    let stored : Types.Season = {
      id = if (season.id == "") "season-" # season.club_id # "-" # Nat.toText(seasons.size() + 1) # "-" # Nat64.toText(nowNs() % 1_000_000_000) else season.id;
      club_id = season.club_id;
      name = season.name;
      status = season.status;
      start_date = season.start_date;
      end_date = season.end_date;
      created_at_ms = switch (existing) { case (?e) e.created_at_ms; case null now };
      updated_at_ms = now;
    };
    seasons := seasons.filter(func(s) = s.id != stored.id).concat([stored]);
    #Ok(stored)
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Season analytics — canister counterpart of the Supabase
  // season_team_summary / season_player_stats RPCs. club_domain has no
  // events/attendance data model to derive these from, so values are
  // precomputed and kept fresh via admin-gated upsert calls, keyed by
  // (season_id, team_id) and (season_id, team_id, club_player_id). ----

  public query ({ caller }) func list_season_team_summary(season_id : Text) : async { #Ok : [Types.SeasonTeamSummary]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    let season = seasons.find(func(s) = s.id == season_id);
    switch (season) {
      case null #Err("Season not found");
      case (?s) {
        if (not isMember(caller, s.club_id)) return #Err("Club membership required");
        #Ok(seasonTeamSummaries.filter(func(r) = r.season_id == season_id));
      };
    };
  };

  public query ({ caller }) func list_season_player_stats(season_id : Text, team_id : Text) : async { #Ok : [Types.SeasonPlayerStat]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    let season = seasons.find(func(s) = s.id == season_id);
    switch (season) {
      case null #Err("Season not found");
      case (?s) {
        if (not isMember(caller, s.club_id)) return #Err("Club membership required");
        #Ok(seasonPlayerStats.filter(func(r) = r.season_id == season_id and r.team_id == team_id));
      };
    };
  };

  public shared ({ caller }) func save_season_team_summary(entry : Types.SeasonTeamSummary) : async { #Ok : Types.SeasonTeamSummary; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isAdmin(caller, entry.club_id)) return #Err("Club admin required");
    let stored : Types.SeasonTeamSummary = { entry with updated_at_ms = nowMs() };
    seasonTeamSummaries := seasonTeamSummaries.filter(func(r) = not (r.season_id == stored.season_id and r.team_id == stored.team_id)).concat([stored]);
    #Ok(stored);
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func save_season_player_stat(entry : Types.SeasonPlayerStat) : async { #Ok : Types.SeasonPlayerStat; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isAdmin(caller, entry.club_id)) return #Err("Club admin required");
    let stored : Types.SeasonPlayerStat = { entry with updated_at_ms = nowMs() };
    seasonPlayerStats := seasonPlayerStats.filter(func(r) = not (r.season_id == stored.season_id and r.team_id == stored.team_id and r.club_player_id == stored.club_player_id)).concat([stored]);
    #Ok(stored);
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- profile_team_history: join accountRoles (team-scoped grants) with
  // teams/profiles/seasons for a given profile (account) id. membership_id is
  // synthesized as account_id#team_id since accountRoles has no own id.
  // joined_at_ms is 0 when no membership timestamp exists. ----
  public query ({ caller }) func profile_team_history(profile_id : Text) : async [Types.ProfileTeamHistoryEntry] {
    denyLegacyAccountQuery();
    auth(caller);
    let grants = accountRoles.filter(func(g) = g.account_id == profile_id and g.team != null);
    grants.map(func(g) : Types.ProfileTeamHistoryEntry {
      let teamId = switch (g.team) { case (?t) t; case null "" };
      let team = teams.find(func(t) = t.id == teamId);
      let clubId = switch (team) { case (?t) t.club_id; case null (switch (g.club) { case (?c) c; case null "" }) };
      let club = profiles.find(func(p) = p.id == clubId);
      let season = seasons.find(func(s) = s.club_id == clubId and s.status == "active");
      {
        membership_id = profile_id # "-" # teamId;
        team_id = teamId;
        team_name = switch (team) { case (?t) t.name; case null "" };
        team_level_age = switch (team) { case (?t) t.age_group; case null null };
        club_id = clubId;
        club_name = switch (club) { case (?c) c.name; case null "" };
        season_id = switch (season) { case (?s) s.id; case null "" };
        season_name = switch (season) { case (?s) s.name; case null "" };
        season_status = switch (season) { case (?s) s.status; case null "" };
        season_start_date = switch (season) { case (?s) s.start_date; case null "" };
        season_end_date = switch (season) { case (?s) s.end_date; case null "" };
        joined_at_ms = 0;
      }
    })
  };

  // ---- Invite-acceptance analytics over pendingInvites, admin gated. ----

  public query ({ caller }) func list_accepted_invites(club_id : Text, since_ms : Nat64, until_ms : Nat64) : async { #Ok : [Types.AcceptedInvite]; #Err : Text } {
    denyLegacyAccountQuery();
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    let rows = pendingInvites.filter(func(i) =
      i.club_id == club_id and i.status == "accepted" and
      (switch (i.accepted_at_ms) { case (?ts) ts >= since_ms and ts <= until_ms; case null false }));
    #Ok(rows.map(func(i) : Types.AcceptedInvite {
      {
        id = i.id;
        invited_user_id = switch (i.accepted_by) { case (?p) Principal.toText(p); case null "" };
        accepted_at_ms = switch (i.accepted_at_ms) { case (?ts) ts; case null 0 };
      }
    }))
  };

  public query ({ caller }) func invite_stats(club_id : Text, since_ms : Nat64, until_ms : Nat64) : async { #Ok : Types.InviteStats; #Err : Text } {
    denyLegacyAccountQuery();
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    let inRange = pendingInvites.filter(func(i) = i.club_id == club_id and i.created_at_ms >= since_ms and i.created_at_ms <= until_ms);
    let accepted = inRange.filter(func(i) = i.accepted_at_ms != null).size();
    #Ok({ total = inRange.size(); accepted })
  };

  // ---- Manual member payment ledger (Phase 3, F6) ----
  // Bookkeeping only — "mark paid" records for member subscription/uniform
  // fees, mirroring the Supabase member_subscription_payments table. No
  // money moves through the canister; online payments stay Supabase-gated.
  public query ({ caller }) func list_member_payments(club_id : Text, payment_period : Text, payment_type : Text) : async { #Ok : [Types.MemberPayment]; #Err : Text } {
    denyLegacyAccountQuery();
    auth(caller);
    let scoped = memberPayments.filter(func(p) = p.club_id == club_id and p.payment_period == payment_period and p.payment_type == payment_type);
    if (isAdmin(caller, club_id)) return #Ok(scoped);
    let callerId = Principal.toText(caller);
    #Ok(scoped.filter(func(p) = p.user_id == callerId))
  };

  public shared ({ caller }) func mark_member_paid(club_id : Text, user_id : Text, child_id : ?Text, payment_period : Text, payment_type : Text, amount : Float, notes : ?Text) : async { #Ok : Types.MemberPayment; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    if (user_id == "" or payment_period == "" or payment_type == "" or amount < 0) return #Err("Invalid payment");
    let duplicate = memberPayments.any(func(p) = p.club_id == club_id and p.payment_period == payment_period and p.payment_type == payment_type and p.user_id == user_id and p.child_id == child_id);
    if (duplicate) return #Err("Already marked as paid for this period");
    let stored : Types.MemberPayment = {
      id = "pay-" # club_id # "-" # Nat.toText(memberPayments.size() + 1) # "-" # Nat64.toText(nowNs() % 1_000_000_000);
      club_id; user_id; child_id; payment_period; payment_type; amount; notes;
      marked_by = caller;
      created_at_ms = nowMs();
    };
    memberPayments := memberPayments.concat([stored]);
    #Ok(stored)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func unmark_member_paid(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (memberPayments.find(func(p) = p.id == id)) {
      case null { #Err("Payment not found") };
      case (?current) {
        if (not isAdmin(caller, current.club_id)) return #Err("Club admin required");
        memberPayments := memberPayments.filter(func(p) = p.id != id);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };


  // ---- Notification queue wiring + fee-reminder fan-out (Phase 3, F6) ----
  public shared ({ caller }) func set_notification_queue_canister(id : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (id.equal(Principal.anonymous())) return #Err("Invalid canister id");
    notificationQueueCanister := ?id;
    #Ok
  };

  public shared ({ caller }) func set_mini_league_domain_canister(id : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (id.equal(Principal.anonymous())) return #Err("Invalid mini_league_domain canister id");
    miniLeagueDomainCanister := ?id;
    #Ok
  };

  public shared ({ caller }) func set_competition_domain_canister(id : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (id.equal(Principal.anonymous())) return #Err("Invalid competition_domain canister id");
    competitionDomainCanister := ?id;
    #Ok
  };

  // ---- Permanent-delete fan-out + 30-day auto-purge ----
  // Soft-deleted clubs/teams stay restorable for 30 days; a daily timer then
  // purges them permanently (same window as the Supabase purge job).
  // Permanent delete — manual or automatic — also fans out to events_domain
  // (events, RSVPs, duties, game data), messaging_domain (conversations,
  // messages, polls), and pii_access_control (club read grants) so no
  // club-scoped data is orphaned on other canisters. Cross-canister calls
  // are best-effort: a failed fan-out never blocks the local purge.
  transient let purgeWindowMs : Nat64 = 2_592_000_000; // 30 days in milliseconds

  public shared ({ caller }) func set_events_domain_canister(id : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (id.equal(Principal.anonymous())) return #Err("Invalid canister id");
    eventsDomainCanister := ?id;
    #Ok
  };

  public shared ({ caller }) func set_messaging_domain_canister(id : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (id.equal(Principal.anonymous())) return #Err("Invalid canister id");
    messagingDomainCanister := ?id;
    #Ok
  };

  public shared ({ caller }) func set_pii_canister(id : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (id.equal(Principal.anonymous())) return #Err("Invalid canister id");
    piiCanister := ?id;
    #Ok
  };

  // Removes every club_domain record scoped to one team. Callers must have
  // already verified the team is soft-deleted and the caller may delete it.
  func purgeTeamLocal(teamId : Text) {
    membershipEpoch += 1;
    teams := teams.filter(func(t) = t.id != teamId);
    membershipEpoch += 1;
    acl := {
      teams = acl.teams.filter(func(t) = t.id != teamId);
      guardians = acl.guardians;
      clubs = acl.clubs;
      children = acl.children;
      exclusions = acl.exclusions;
      roles = acl.roles.filter(func(r) = r.team != ?teamId);
    };
    accountRoles := accountRoles.filter(func(r) = r.team != ?teamId);
    parentInvites := parentInvites.filter(func(i) = i.team_id != ?teamId);
    roleRequests := roleRequests.filter(func(r) = r.team != ?teamId);
    teamInvites := teamInvites.filter(func(i) = i.team_id != teamId);
    teamInviteLinks := teamInviteLinks.filter(func(l) = l.team_id != teamId);
    pendingInvites := pendingInvites.filter(func(i) = i.team_id != ?teamId);
    teamPlayerPositions := teamPlayerPositions.filter(func(p) = p.team_id != teamId);
    teamCaptains := teamCaptains.filter(func(c) = c.team_id != teamId);
    teamSponsorAllocations := teamSponsorAllocations.filter(func(a) = a.team_id != teamId);
    seasonTeamSummaries := seasonTeamSummaries.filter(func(s) = s.team_id != teamId);
    seasonPlayerStats := seasonPlayerStats.filter(func(s) = s.team_id != teamId);
    teamSubscriptions := teamSubscriptions.filter(func(s) = s.team_id != teamId);
  };

  // Removes every club_domain record scoped to one club, including its
  // teams. Children/guardian/family records are parent-owned (shared with
  // events_domain) and are deliberately kept; global account records,
  // theme preferences, and app config are not club-scoped.
  func purgeClubLocal(id : Text) {
    let clubTeamIds = teams.filter(func(t) = t.club_id == id).map(func(t) = t.id);
    let clubNewsIds = newsPosts.filter(func(post) = post.club_id == id).map(func(post) = post.id);
    func isClubTeam(teamId : Text) : Bool { clubTeamIds.any(func(t) = t == teamId) };
    membershipEpoch += 1;
    profiles := profiles.filter(func(p) = p.id != id);
    settings := settings.filter(func(s) = s.club_id != id);
    membershipEpoch += 1;
    teams := teams.filter(func(t) = t.club_id != id);
    teamFolders := teamFolders.filter(func(f) = f.club_id != id);
    sponsors := sponsors.filter(func(s) = s.club_id != id);
    clubListings := clubListings.filter(func(e) = e.0 != id);
    mediaEvidenceRevision += 1;
    frozenClubs := frozenClubs.filter(func(e) = e.0 != id);
    membershipEpoch += 1;
    acl := {
      teams = acl.teams.filter(func(t) = t.club != id);
      guardians = acl.guardians;
      clubs = acl.clubs.filter(func(c) = c != id);
      children = acl.children;
      exclusions = acl.exclusions.filter(func(e) = e.club != id);
      roles = acl.roles.filter(func(r) = r.club != ?id and (switch (r.team) { case (?t) { not isClubTeam(t) }; case null { true } }));
    };
    accountRoles := accountRoles.filter(func(r) = r.club != ?id and (switch (r.team) { case (?t) { not isClubTeam(t) }; case null { true } }));
    newsAudienceRecipients := newsAudienceRecipients.filter(func(item) = not clubNewsIds.any(func(newsId) = newsId == item.news_id));
    mediaEvidenceRevision += 1;
    newsPosts := newsPosts.filter(func(n) = n.club_id != id);
    parentInvites := parentInvites.filter(func(i) = i.club_id != id);
    roleRequests := roleRequests.filter(func(r) = r.club != id);
    teamInvites := teamInvites.filter(func(i) = i.club_id != id);
    teamInviteLinks := teamInviteLinks.filter(func(l) = l.club_id != id);
    pendingInvites := pendingInvites.filter(func(i) = i.club_id != id);
    teamCreationRequests := teamCreationRequests.filter(func(r) = r.club_id != id);
    teamPlayerPositions := teamPlayerPositions.filter(func(p) = not isClubTeam(p.team_id));
    teamCaptains := teamCaptains.filter(func(c) = not isClubTeam(c.team_id));
    clubJoinRequests := clubJoinRequests.filter(func(r) = r.club_id != id);
    clubTerms := clubTerms.filter(func(t) = t.club_id != id);
    removedMembers := removedMembers.filter(func(r) = r.club != id);
    memberPayments := memberPayments.filter(func(p) = p.club_id != id);
    teamSponsorAllocations := teamSponsorAllocations.filter(func(a) = not isClubTeam(a.team_id));
    seasons := seasons.filter(func(s) = s.club_id != id);
    seasonTeamSummaries := seasonTeamSummaries.filter(func(s) = s.club_id != id);
    seasonPlayerStats := seasonPlayerStats.filter(func(s) = s.club_id != id);
    clubSubscriptions := clubSubscriptions.filter(func(s) = s.club_id != id);
  };

  // ---- Chat conversation provisioning (messaging_domain fan-out) ----
  // The messaging canister keys club/team chats by deterministic id (club
  // id / team id); these helpers keep those conversations and their
  // participant lists in sync with this canister's authoritative roles.

  // Club-chat participants: every principal holding any grant scoped to the
  // club. App-wide grants (club == null, e.g. app_admin) are excluded —
  // they are not club members.
  func clubChatParticipants(clubId : Text) : [Principal] {
    var result : [Principal] = [];
    for (grant in acl.roles.values()) {
      if (grant.club == ?clubId and result.size() < 500 and not result.any(func(p) = p.equal(grant.user))) {
        result := result.concat([grant.user]);
      };
    };
    result
  };

  // Team-chat participants: principals with a grant for this team plus club
  // admins (club staff can read and post in every team chat, matching the
  // Supabase client behaviour).
  func teamChatParticipants(clubId : Text, teamId : Text) : [Principal] {
    var result : [Principal] = [];
    for (grant in acl.roles.values()) {
      let inScope = grant.club == ?clubId and (grant.team == ?teamId or grant.role == "club_admin");
      if (inScope and result.size() < 500 and not result.any(func(p) = p.equal(grant.user))) {
        result := result.concat([grant.user]);
      };
    };
    result
  };

  // Best-effort: a missing/unconfigured messaging canister never blocks
  // club or membership writes.
  func fanOutEnsureConversation(clubId : Text, teamId : ?Text, participants : [Principal]) : async () {
    if (participants.size() == 0) return;
    switch (messagingDomainCanister) {
      case null {};
      case (?c) {
        let target : actor { ensure_conversation : shared (Text, ?Text, [Principal]) -> async { #Ok : { id : Text }; #Err : Text } } = actor (Principal.toText(c));
        try { ignore await target.ensure_conversation(clubId, teamId, participants) } catch (_) {};
      };
    };
  };

  // Ensures the club chat and every live team chat of the club exist with
  // current membership. Idempotent; returns conversations ensured.
  func fanOutEnsureClubConversations(clubId : Text) : async Nat32 {
    var ensured : Nat32 = 0;
    await fanOutEnsureConversation(clubId, null, clubChatParticipants(clubId));
    ensured += 1;
    for (team in teams.values()) {
      if (team.club_id == clubId and team.deleted_at_ms == null) {
        await fanOutEnsureConversation(clubId, ?team.id, teamChatParticipants(clubId, team.id));
        ensured += 1;
      };
    };
    ensured
  };

  // Lazy catch-up any club member may call — provisions chats for clubs
  // and teams created before this wiring existed. The chat pages call this
  // before first read/send so a missing conversation self-heals.
  public shared ({ caller }) func ensure_club_conversations(club_id : Text) : async { #Ok : Nat32; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    if (messagingDomainCanister == null) return #Err("Messaging domain not configured");
    #Ok(await fanOutEnsureClubConversations(club_id))
  
    } finally { removalReceiver.leave(caller) };
  };

  func fanOutTeamPurged(teamId : Text) : async () {
    switch (eventsDomainCanister) {
      case null {};
      case (?c) {
        let target : actor { delete_team_data : shared (Text) -> async { #Ok : Nat32; #Err : Text } } = actor (Principal.toText(c));
        try { ignore await target.delete_team_data(teamId) } catch (_) {};
      };
    };
    switch (messagingDomainCanister) {
      case null {};
      case (?c) {
        let target : actor { delete_team_data : shared (Text) -> async { #Ok : Nat32; #Err : Text } } = actor (Principal.toText(c));
        try { ignore await target.delete_team_data(teamId) } catch (_) {};
      };
    };
  };

  func fanOutClubPurged(clubId : Text) : async () {
    switch (eventsDomainCanister) {
      case null {};
      case (?c) {
        let target : actor { delete_club_data : shared (Text) -> async { #Ok : Nat32; #Err : Text } } = actor (Principal.toText(c));
        try { ignore await target.delete_club_data(clubId) } catch (_) {};
      };
    };
    switch (messagingDomainCanister) {
      case null {};
      case (?c) {
        let target : actor { delete_club_data : shared (Text) -> async { #Ok : Nat32; #Err : Text } } = actor (Principal.toText(c));
        try { ignore await target.delete_club_data(clubId) } catch (_) {};
      };
    };
    switch (piiCanister) {
      case null {};
      case (?c) {
        let target : actor { purge_club_grants : shared (Text) -> async { #Ok : Nat32; #Err : Text } } = actor (Principal.toText(c));
        try { ignore await target.purge_club_grants(clubId) } catch (_) {};
      };
    };
  };

  // Purges every club/team whose soft-delete is older than the retention
  // window. Returns the number of records purged (clubs + teams).
  func purgeExpiredDeletions() : async Nat32 {
    let now = nowMs();
    var purged : Nat32 = 0;
    let doomedClubs = profiles.filter(func(p) = switch (p.deleted_at_ms) { case (?ts) { ts + purgeWindowMs < now }; case null { false } });
    for (club in doomedClubs.values()) {
      purgeClubLocal(club.id);
      await fanOutClubPurged(club.id);
      purged += 1;
    };
    // Teams of a purged club are already gone from `teams` at this point, so
    // this only catches teams soft-deleted independently of their club.
    let doomedTeams = teams.filter(func(t) = switch (t.deleted_at_ms) { case (?ts) { ts + purgeWindowMs < now }; case null { false } });
    for (team in doomedTeams.values()) {
      purgeTeamLocal(team.id);
      await fanOutTeamPurged(team.id);
      purged += 1;
    };
    purged
  };

  // Governor-triggerable manual sweep; the daily timer runs the same path.
  public shared ({ caller }) func purge_expired_deletions() : async { #Ok : Nat32; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    #Ok(await purgeExpiredDeletions())
  };

  // Daily auto-purge sweep. The timer id is intentionally discarded — the
  // sweep runs for the lifetime of the canister and never needs cancelling.
  // Transient: timers are not persisted across upgrades, so the initializer
  // re-arms the sweep on every upgrade.
  transient let _purgeTimer = Timer.recurringTimer<system>(#seconds(86_400), func() : async () { ignore await purgeExpiredDeletions() });

  // Reminds every club member who has no `mark_member_paid` record for the
  // given period/type — i.e. everyone still "pending" for that fee. Fails
  // closed with a clear error while no notification_queue canister is
  // configured, mirroring messaging_domain's fan-out hook.
  public shared ({ caller }) func send_fee_reminders(club_id : Text, payment_period : Text, payment_type : Text, message : Text) : async { #Ok : Nat16; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (isTransferFenced(club_id)) return #Err("Club is temporarily locked for a transfer");
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    if (payment_period == "" or payment_type == "" or message == "") return #Err("Invalid reminder fields");
    switch (notificationQueueCanister) {
      case null { #Err("Notification queue not configured") };
      case (?nq) {
        var members : [Text] = [];
        for (r in accountRoles.values()) {
          switch (r.club) {
            case (?c) {
              if (c == club_id and members.size() < 500 and members.find(func(m) = m == r.account_id) == null) {
                members := members.concat([r.account_id]);
              };
            };
            case null {};
          };
        };
        let pending = members.filter(func(m) = not memberPayments.any(func(p) = p.club_id == club_id and p.payment_period == payment_period and p.payment_type == payment_type and p.user_id == m));
        if (pending.size() == 0) return #Ok(0);
        let queue : actor {
          fan_out : shared ([Text], Text, Text, Text, Text, ?Text) -> async { #Ok : Nat16; #Err : Text };
        } = actor (Principal.toText(nq));
        let keyPrefix = "fee-reminder-" # club_id # "-" # payment_period # "-" # payment_type # "-" # Nat64.toText(nowMs());
        try {
          await queue.fan_out(pending, club_id, "payment_reminder", message, keyPrefix, null)
        } catch (_) { #Err("Notification queue call failed") }
      };
    };
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Cross-club sponsor/strip lookup (Phase 5, F9) ----
  // Same unauthenticated read stance as list_sponsors (sponsor strips render
  // for every member) but without a club filter, for carousels that rotate
  // sponsors across every club (e.g. SponsorOrAdCarousel).
  public query func list_all_sponsors() : async { #Ok : [Types.ClubSponsor]; #Err : Text } {
    #Ok(sponsors)
  };

  // ---- Club subscription status (club_subscriptions parity) ----
  // Reads are member-visible (Pro gates render for every member); writes are
  // platform-only — governor or app_admin, never a club admin, so a club
  // cannot grant itself Pro.
  func isAppAdmin(caller : Principal) : Bool {
    acl.roles.any(func(grant) = grant.user.equal(caller) and grant.role == "app_admin")
  };

  public query func get_club_subscription(club_id : Text) : async { #Ok : ?Types.ClubSubscription; #Err : Text } {
    for (s in clubSubscriptions.values()) {
      if (s.club_id == club_id) return #Ok(?s);
    };
    #Ok(null)
  };

  // Retained activation is intentionally local-only, independent of monthly quotas.
  public shared ({ caller }) func start_media_retained_cutover() : async { #Ok; #Err : Text } {
    if (not isGovernor(caller) or not retainedRehearsal) return #Err("Local retained rehearsal governor required");
    if (not mediaQuotaCutover.started or mediaQuotaCutover.active) return #Err("Start monthly cutover before retained baseline");
    if (not MediaRetainedCutover.start(mediaRetainedState, mediaQuotaStores)) return #Err("Complete immutable store registry required");
    #Ok
  };
  public shared ({ caller }) func import_media_retained_store(store : Principal) : async { #Ok; #Err : Text } {
    if (not isGovernor(caller) or not retainedRehearsal) return #Err("Local retained rehearsal governor required");
    if (not mediaRetainedState.started or not mediaRetainedState.stores.any(func(p) = p == store)) return #Err("Sealed registered store required");
    let progress = MediaRetainedCutover.progress(mediaRetainedState, store);
    if (progress.done) return #Ok;
    let source : actor { retained_snapshot_page : shared MediaRetainedCutover.Cursor -> async MediaRetainedCutover.Page } = actor(store.toText());
    try {
      let page = await (with timeout = 10) source.retained_snapshot_page(progress.cursor);
      MediaRetainedCutover.apply(mediaRetainedState, Principal.fromActor(this), store, page)
    } catch (_) { #Err("Retained snapshot read failed; retry same cursor") }
  };
  public shared ({ caller }) func activate_media_retained_quota() : async { #Ok; #Err : Text } {
    if (not isGovernor(caller) or not retainedRehearsal) return #Err("Local retained rehearsal governor required");
    if (not MediaRetainedCutover.complete(mediaRetainedState) or mediaRetainedState.stores != mediaQuotaStores or not mediaQuotaCutover.active) return #Err("Every store and both baselines required");
    mediaRetainedState.active := true; #Ok
  };
  public shared ({ caller }) func read_media_retained_ready() : async Bool {
    retainedRehearsal and MediaRetainedCutover.ready(mediaRetainedState, caller)
  };
  public shared ({ caller }) func read_club_retained_media_bytes(club_id : Text) : async { #Ok : { finalized : Nat; pending : Nat }; #Err : Text } {
    if (not retainedRehearsal or not mediaRetainedState.active) return #Err("Retained quota inactive");
    if (not isGovernor(caller) and not mediaRetainedState.stores.any(func(p) = p == caller) and not isMember(caller, club_id)) return #Err("Club member required");
    #Ok(MediaRetainedQuota.usage(mediaRetainedState.ledger, club_id))
  };
  public shared ({ caller }) func reserve_retained_media(token : Text, path : Text, bytes : Nat) : async MediaRetainedQuota.Result {
    if (not retainedRehearsal or not MediaRetainedCutover.ready(mediaRetainedState, caller)) return #Err("Registered retained store required");
    if (mediaRetainedState.ledger.operations.get(caller.toText() # "\u{1f}" # token) == null and MediaJournalToken.expired(token, Int.abs(Time.now()) / MediaQuota.cycleNs)) return #Err("Expired retained token absent");
    let segments = Iter.toArray(path.split(#char '/'));
    if (segments.size() < 3 or segments[0] != "clubs") return #Err("Club path required");
    let club = segments[1];
    if (not profiles.any(func(p) = p.id == club) or not path.startsWith(#text("clubs/" # club # "/"))) return #Err("Unknown club path");
    let pro = clubSubscriptions.any(func(s) = s.club_id == club and (s.is_pro or s.admin_pro_override or s.is_pro_football or s.admin_pro_football_override or s.is_trial));
    if (growthRehearsal and mediaRetainedState.ledger.operations.get(caller.toText() # "\u{1f}" # token) == null) {
      let usage = MediaRetainedQuota.usage(mediaRetainedState.ledger, club);
      let commitment = mediaGrowthState.commitments.get(club) ?? 0;
      if (not mediaGrowthState.configured or (usage.finalized + usage.pending + bytes) * 2 > commitment) return #Err("Reserved club growth exhausted")
    };
    MediaRetainedQuota.reserve(mediaRetainedState.ledger, caller, token, club, path, bytes, pro, clubStorageGb(club).toNat())
  };
  public shared ({ caller }) func commit_retained_media(token : Text) : async MediaRetainedQuota.Result {
    if (not retainedRehearsal or not MediaRetainedCutover.ready(mediaRetainedState, caller)) return #Err("Registered retained store required");
    MediaRetainedQuota.settle(mediaRetainedState.ledger, caller, token, true)
  };
  public shared ({ caller }) func cancel_retained_media(token : Text, club : Text, path : Text, bytes : Nat) : async MediaRetainedQuota.Result {
    if (not retainedRehearsal or not MediaRetainedCutover.ready(mediaRetainedState, caller)) return #Err("Registered retained store required");
    if (mediaRetainedState.ledger.operations.get(caller.toText() # "\u{1f}" # token) == null and MediaJournalToken.expired(token, Int.abs(Time.now()) / MediaQuota.cycleNs)) return #Ok({store=caller;token;path;club;bytes;previous=null;state=#released});
    MediaRetainedQuota.cancel(mediaRetainedState.ledger, caller, token, club, path, bytes)
  };
  public shared ({ caller }) func credit_deleted_retained_media(token : Text, entry : MediaRetainedQuota.Object) : async MediaRetainedQuota.Result {
    if (not retainedRehearsal or not MediaRetainedCutover.ready(mediaRetainedState, caller)) return #Err("Registered retained store required");
    if (mediaRetainedState.ledger.operations.get(caller.toText() # "\u{1f}" # token) == null and MediaJournalToken.expired(token, Int.abs(Time.now()) / MediaQuota.cycleNs)) return #Err("Expired retained token absent");
    MediaRetainedQuota.deleted(mediaRetainedState.ledger, caller, token, entry)
  };
  public shared ({ caller }) func prepare_deleted_retained_media(token : Text, entry : MediaRetainedQuota.Object) : async MediaRetainedQuota.Result {
    if (not retainedRehearsal or not MediaRetainedCutover.ready(mediaRetainedState, caller)) return #Err("Registered retained store required");
    if (mediaRetainedState.ledger.operations.get(caller.toText() # "\u{1f}" # token) == null and MediaJournalToken.expired(token, Int.abs(Time.now()) / MediaQuota.cycleNs)) return #Err("Expired retained token absent");
    MediaRetainedQuota.prepareDeleted(mediaRetainedState.ledger, caller, token, entry)
  };
  public shared ({ caller }) func acknowledge_retained_media(token : Text) : async { #Ok; #Err : Text } {
    if (not retainedRehearsal or not MediaRetainedCutover.ready(mediaRetainedState, caller)) return #Err("Registered retained store required");
    // An already retired token can acknowledge local cleanup again, but its
    // expired epoch can never create a new authority operation.
    if (mediaRetainedState.ledger.operations.get(caller.toText() # "\u{1f}" # token) == null and MediaJournalToken.expired(token, Int.abs(Time.now()) / MediaQuota.cycleNs)) return #Ok;
    if (MediaJournalRetirement.acknowledge(mediaJournalState, mediaRetainedState.ledger, mediaQuotaCutover.ledger, caller, token)) #Ok else #Err("Both ledgers must be settled")
  };
  public shared ({ caller }) func retire_retained_media_records(cursor : Text) : async { #Ok : { removed : Nat; cursor : Text }; #Err : Text } {
    if (not retainedRehearsal or not isGovernor(caller) or not mediaRetainedState.active) return #Err("Local retained governor required");
    #Ok(MediaJournalRetirement.retire(mediaJournalState, mediaRetainedState.ledger, mediaQuotaCutover.ledger, Int.abs(Time.now()) / MediaQuota.cycleNs, cursor))
  };
  // Local operator attestation only: exact club list, all-store baseline and
  // conservative global allocator overhead; never a production capacity flag.
  public shared ({ caller }) func configure_media_growth_router(router : Principal, group : Text, target : Text) : async { #Ok; #Err : Text } {
    if (not routerGrowthRehearsal or not growthRehearsal or not isGovernor(caller)) return #Err("Local growth governor required");
    if (router.isAnonymous() or router.toText() == "aaaaa-aa" or group.size() == 0 or group.size() > 64 or target.size() == 0 or target.size() > 64) return #Err("Invalid router binding");
    let binding = { router; group; target };
    switch (mediaGrowthRouter) { case (?saved) { if (saved != binding) return #Err("Growth router immutable") }; case null { mediaGrowthRouter := ?binding } };
    #Ok
  };
  func reserveRouterGrowth(club : Text) : async Bool {
    if (not routerGrowthRehearsal) return true;
    if (not growthRehearsal or not retainedRehearsal or not mediaRetainedState.active) return false;
    let ?binding = mediaGrowthRouter else return false;
    let ?bytes = mediaGrowthState.commitments.get(club) else return false;
    if (bytes == 0 or bytes > 18_446_744_073_709_551_615) return false;
    let router : actor { reserve_group_media_growth : shared (Text, Text, Text, Nat64) -> async { #Ok : Nat64; #Err : Text } } = actor(binding.router.toText());
    // The commitment itself is the monotonic idempotency key: no cancellation
    // or refund on lost replies, rejection, downgrade, or local publication loss.
    try {
      switch (await router.reserve_group_media_growth(binding.group, binding.target, club, Nat64.fromNat(bytes))) {
        case (#Ok(held)) held.toNat() >= bytes and mediaGrowthRouter == ?binding;
        case (#Err(_)) false
      }
    } catch (_) { false }
  };
  public shared ({ caller }) func configure_media_growth(usable : Nat, unassigned : Nat, free_bytes : Nat, clubs : [Text]) : async { #Ok; #Err : Text } {
    if (not growthRehearsal or not retainedRehearsal or not isGovernor(caller) or not mediaRetainedState.active) return #Err("Local active retained governor required");
    if (mediaGrowthState.configured or usable == 0 or free_bytes == 0 or clubs.size() != profiles.size() or clubs.size() > 100_000) return #Err("Immutable complete growth baseline required");
    let candidate = MediaGrowthReservations.empty(); candidate.configured := true; candidate.usable := usable; candidate.unassigned := unassigned; candidate.freeBytes := free_bytes;
    for (club in clubs.values()) {
      if (not profiles.any(func(p) = p.id == club) or candidate.commitments.get(club) != null) return #Err("Exact club inventory required");
      let pro = clubSubscriptions.any(func(s) = s.club_id == club and (s.is_pro or s.admin_pro_override or s.is_pro_football or s.admin_pro_football_override or s.is_trial));
      let allowance = if (pro) MediaRetainedQuota.baseBytes + clubStorageGb(club).toNat() * MediaRetainedQuota.gib else free_bytes;
      if (not MediaGrowthReservations.reserve(candidate, mediaRetainedState.ledger, club, allowance)) return #Err("Insufficient physical growth capacity")
    };
    if (MediaGrowthReservations.committed(candidate) > usable) return #Err("Allocator overhead exceeds capacity");
    mediaGrowthState := candidate; #Ok
  };

  public shared ({ caller }) func register_media_quota_store(store : Principal) : async { #Ok; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    if (store.equal(Principal.anonymous()) or store.equal(Principal.fromText("aaaaa-aa"))) return #Err("Invalid store");
    if (mediaQuotaStores.any(func(p) { p.equal(store) })) return #Ok;
    if (mediaRetainedState.started) return #Err("Retained store registry sealed");
    if (mediaQuotaCutover.started and not mediaQuotaCutover.active) return #Err("Store registry sealed for initial cutover");
    if (mediaQuotaStores.size() >= 64) return #Err("Store registry full");
    mediaQuotaStores := mediaQuotaStores.concat([store]);
    #Ok
  };

  // Deliberately governor-only preparation tests: registered stores cannot
  // consume production quota until a later, verified baseline cutover.
  public shared ({ caller }) func prepare_media_quota_reservation(store : Principal, token : Text, club_id : Text, category : Text, bytes : Nat) : async MediaQuota.Result {
    if (not MediaQuota.authorizedPreparation(governor, caller, store, mediaQuotaStores)) return #Err("Governor and registered store required");
    if (not profiles.any(func(p) { p.id == club_id })) return #Err("Unknown club");
    let pro = clubSubscriptions.any(func(s) {
      s.club_id == club_id and (s.is_pro or s.admin_pro_override or s.is_pro_football or s.admin_pro_football_override or s.is_trial)
    });
    MediaQuota.reserve(mediaQuotaLedger, store, token, club_id, category, bytes, Int.abs(Time.now()) / MediaQuota.cycleNs, pro)
  };

  public shared ({ caller }) func settle_prepared_media_quota(store : Principal, token : Text, commit : Bool) : async MediaQuota.Result {
    if (not MediaQuota.authorizedPreparation(governor, caller, store, mediaQuotaStores)) return #Err("Governor and registered store required");
    MediaQuota.settle(mediaQuotaLedger, store, token, commit)
  };

  public query ({ caller }) func get_prepared_media_quota(store : Principal, token : Text) : async { #Ok : ?MediaQuota.Reservation; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    #Ok(MediaQuota.status(mediaQuotaLedger, store, token))
  };

  // Registry sealing precedes store freezing. The ledger imports responses
  // directly from each registered store, not governor-supplied row payloads.
  public shared ({ caller }) func start_media_quota_cutover() : async { #Ok; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    if (mediaQuotaStores.size() == 0) return #Err("Register every media store first");
    mediaQuotaCutover.started := true;
    #Ok
  };
  public shared ({ caller }) func import_media_quota_store(store : Principal) : async { #Ok; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    if (not mediaQuotaCutover.started or not mediaQuotaStores.any(func(p) = p.equal(store))) return #Err("Sealed registered store required");
    let progress = MediaQuotaCutover.progress(mediaQuotaCutover, store);
    if (progress.done) return #Ok;
    let source : actor { quota_snapshot_page : shared Nat -> async MediaQuotaCutover.Page } = actor(store.toText());
    try {
      let page = await source.quota_snapshot_page(progress.offset);
      MediaQuotaCutover.applyPage(mediaQuotaCutover, store, page)
    } catch (_) { #Err("Snapshot read failed; retry same cursor") }
  };
  public shared ({ caller }) func activate_media_quota() : async { #Ok; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    MediaQuotaCutover.activate(mediaQuotaCutover, mediaQuotaStores)
  };
  public query ({ caller }) func media_quota_ready() : async Bool {
    MediaQuotaCutover.ready(mediaQuotaCutover, caller, mediaQuotaStores)
  };
  public query ({ caller }) func media_quota_cutover_status() : async { active : Bool; started : Bool; stores : [(Principal, MediaQuotaCutover.Progress)] } {
    if (not isGovernor(caller)) Runtime.trap("Governor required");
    { active = mediaQuotaCutover.active; started = mediaQuotaCutover.started; stores = mediaQuotaStores.map(func(p) = (p, MediaQuotaCutover.progress(mediaQuotaCutover, p))) }
  };
  // Complete operator inventory through consensus, not an uncertified query
  // or the browser's configured primary blob store. Bounded by 64 stores.
  public shared ({ caller }) func read_media_quota_store_registry() : async { #Ok : { active : Bool; stores : [Principal] }; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    #Ok({ active = mediaQuotaCutover.active; stores = mediaQuotaStores })
  };
  // Separate, read-only identity inventory relay. Never broadens the existing
  // operator endpoint and remains absent from ordinary deployment authority.
  public shared ({ caller }) func read_removal_media_registry() : async { #Ok : { active : Bool; stores : [Principal] }; #Err : Text } {
    if (not accountAdmissionEnabled or accountAdmissionAuthority != ?caller) return #Err("Configured rehearsal identity required");
    #Ok({ active = mediaQuotaCutover.active; stores = mediaQuotaStores })
  };
  public shared ({ caller }) func reserve_media_quota(token : Text, club_id : Text, category : Text, bytes : Nat, cycle : Nat) : async MediaQuota.Result {
    switch (MediaJournalToken.epoch(token)) { case (?epoch) { if (epoch != cycle) return #Err("Token cycle mismatch") }; case null {} };
    if (not MediaQuotaCutover.ready(mediaQuotaCutover, caller, mediaQuotaStores)) return #Err("Shared quota inactive or unregistered store");
    // Old-cycle retries are allowed only for an existing immutable token.
    // After terminal retirement, delayed old requests cannot allocate again.
    if (MediaQuota.status(mediaQuotaCutover.ledger, caller, token) == null and cycle != Int.abs(Time.now()) / MediaQuota.cycleNs) return #Err("Stale reservation cycle");
    if (not profiles.any(func(p) = p.id == club_id)) return #Err("Unknown club");
    let pro = clubSubscriptions.any(func(s) = s.club_id == club_id and (s.is_pro or s.admin_pro_override or s.is_pro_football or s.admin_pro_football_override or s.is_trial));
    MediaQuota.reserve(mediaQuotaCutover.ledger, caller, token, club_id, category, bytes, cycle, pro)
  };
  public shared ({ caller }) func commit_media_quota(token : Text) : async MediaQuota.Result {
    if (not MediaQuotaCutover.ready(mediaQuotaCutover, caller, mediaQuotaStores)) return #Err("Shared quota inactive or unregistered store");
    MediaQuota.settle(mediaQuotaCutover.ledger, caller, token, true)
  };
  public shared ({ caller }) func cancel_media_quota(token : Text, club_id : Text, category : Text, bytes : Nat, cycle : Nat) : async MediaQuota.Result {
    if (not MediaQuotaCutover.ready(mediaQuotaCutover, caller, mediaQuotaStores)) return #Err("Shared quota inactive or unregistered store");
    switch (MediaJournalToken.epoch(token)) {
      case (?epoch) {
        if (epoch != cycle) return #Err("Token cycle mismatch");
        if (MediaQuota.status(mediaQuotaCutover.ledger, caller, token) == null and MediaJournalToken.expired(token, Int.abs(Time.now()) / MediaQuota.cycleNs)) return #Ok({store=caller;token;club_id;category;bytes;cycle;status=#released})
      }; case null {}
    };
    if (MediaQuota.status(mediaQuotaCutover.ledger, caller, token) == null and cycle + 1 < Int.abs(Time.now()) / MediaQuota.cycleNs) return #Err("Expired operation");
    MediaQuota.cancel(mediaQuotaCutover.ledger, caller, token, club_id, category, bytes, cycle)
  };
  public shared ({ caller }) func retire_media_quota_records(reservation_cursor : Text, usage_cursor : Text) : async { #Ok : { removed : Nat; reservation_cursor : Text; usage_cursor : Text }; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    #Ok(MediaQuota.retireCoordinatedPage(mediaQuotaCutover.ledger, Int.abs(Time.now()) / MediaQuota.cycleNs, reservation_cursor, usage_cursor, not mediaRetainedState.active))
  };

  public shared ({ caller }) func save_club_subscription(item : Types.ClubSubscription) : async { #Ok : Types.ClubSubscription; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not (isGovernor(caller) or isAppAdmin(caller))) return #Err("Platform admin required");
    if (growthRehearsal) {
      let pro = item.is_pro or item.admin_pro_override or item.is_pro_football or item.admin_pro_football_override or item.is_trial;
      let allowance = if (pro) MediaRetainedQuota.baseBytes + clubStorageGb(item.club_id).toNat() * MediaRetainedQuota.gib else mediaGrowthState.freeBytes;
      if (not profiles.any(func(p) = p.id == item.club_id) or not MediaGrowthReservations.reserve(mediaGrowthState, mediaRetainedState.ledger, item.club_id, allowance)) return #Err("Verified group growth capacity required")
    };
    let priorSubscriptions = clubSubscriptions;
    if (routerGrowthRehearsal and not (await reserveRouterGrowth(item.club_id))) return #Err("Group-wide growth reservation required");
    auth(caller);
    if (removalReceiver.denied(caller) or not (isGovernor(caller) or isAppAdmin(caller)) or clubSubscriptions != priorSubscriptions) return #Err("Subscription changed during reservation");
    clubSubscriptions := clubSubscriptions.filter(func(s) = s.club_id != item.club_id);
    clubSubscriptions := clubSubscriptions.concat([item]);
    #Ok(item)
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Team subscription status (team_subscriptions parity) ----
  // Same trust model as club subscriptions: reads are member-visible (Pro
  // gates render for every member); Pro-flag writes are platform-only
  // (governor or app_admin) so a team cannot grant itself Pro. Pitch-board
  // settings are team-admin writable through save_team_pitch_settings,
  // which merges into the existing row and never touches the Pro flags.
  public query func get_team_subscription(team_id : Text) : async { #Ok : ?Types.TeamSubscription; #Err : Text } {
    for (s in teamSubscriptions.values()) {
      if (s.team_id == team_id) return #Ok(?effectiveTeamSub(s));
    };
    #Ok(null)
  };

  public query func get_club_subscriptions(club_ids : [Text]) : async { #Ok : [Types.ClubSubscription]; #Err : Text } {
    if (club_ids.size() > 200) return #Err("Too many ids");
    #Ok(clubSubscriptions.filter(func(s) = club_ids.any(func(i) = i == s.club_id)))
  };

  public query func get_team_subscriptions(team_ids : [Text]) : async { #Ok : [Types.TeamSubscription]; #Err : Text } {
    if (team_ids.size() > 500) return #Err("Too many ids");
    #Ok(teamSubscriptions.filter(func(s) = team_ids.any(func(i) = i == s.team_id)).map<Types.TeamSubscription, Types.TeamSubscription>(effectiveTeamSub))
  };

  public shared ({ caller }) func save_team_subscription(item : Types.TeamSubscription) : async { #Ok : Types.TeamSubscription; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not (isGovernor(caller) or isAppAdmin(caller))) return #Err("Platform admin required");
    teamSubscriptions := teamSubscriptions.filter(func(s) = s.team_id != item.team_id);
    teamSubscriptions := teamSubscriptions.concat([item]);
    #Ok(item)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func save_team_pitch_settings(
    team_id : Text,
    disable_auto_subs : Bool,
    rotation_speed : Nat32,
    disable_position_swaps : Bool,
    disable_batch_subs : Bool,
    rotate_gk_at_halftime : Bool,
    minutes_per_half : ?Nat32,
    max_spread_minutes : ?Nat32,
    team_size : ?Nat32,
    formation : ?Text,
    show_lineup_picker : Bool,
    disable_team_pom_rewards : Bool,
  ) : async { #Ok : Types.TeamSubscription; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    let team = switch (teams.find(func(t) = t.id == team_id and t.deleted_at_ms == null)) {
      case null return #Err("Team not found");
      case (?t) t;
    };
    if (not (canManageTeam(caller, team.club_id, ?team_id) or isAdmin(caller, team.club_id))) return #Err("Team admin required");
    let base : Types.TeamSubscription = switch (teamSubscriptions.find(func(s) = s.team_id == team_id)) {
      case (?s) s;
      case null ({
        team_id = team_id;
        is_pro = false; is_pro_football = false; is_trial = false;
        trial_ends_at_ms = null; cancelled_at_ms = null;
        admin_pro_override = false; admin_pro_football_override = false;
        disable_auto_subs = false; rotation_speed = (1 : Nat32);
        disable_position_swaps = false; disable_batch_subs = false;
        rotate_gk_at_halftime = true; minutes_per_half = null;
        max_spread_minutes = null; team_size = null;
        formation = null; show_lineup_picker = false;
        disable_team_pom_rewards = false;
      });
    };
    let merged : Types.TeamSubscription = {
      base with
      disable_auto_subs;
      rotation_speed;
      disable_position_swaps;
      disable_batch_subs;
      rotate_gk_at_halftime;
      minutes_per_half;
      max_spread_minutes;
      team_size;
      formation;
      show_lineup_picker;
      disable_team_pom_rewards;
    };
    teamSubscriptions := teamSubscriptions.filter(func(s) = s.team_id != team_id);
    teamSubscriptions := teamSubscriptions.concat([merged]);
    #Ok(merged)
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Promo codes (promo_codes parity) ----
  // Management is platform-only (governor or app_admin) so a club cannot mint
  // itself free Pro. Redemption is team-admin gated and is the only path that
  // lets a non-platform caller set a team's Pro flags. Promo-granted Pro
  // expires: get_team_subscription(s) mask the flags once the redemption's
  // expiry passes (admin overrides are never masked).
  var promoCodes : [Types.PromoCode];
  var promoRedemptions : [Types.PromoRedemption];

  func activePromoExpiry(team_id : Text) : ?Nat64 {
    var latest : ?Nat64 = null;
    for (r in promoRedemptions.values()) {
      if (r.target_id == team_id) {
        switch (latest) { case (?l) { if (r.expires_at_ms > l) latest := ?r.expires_at_ms }; case null { latest := ?r.expires_at_ms } };
      };
    };
    latest
  };

  func effectiveTeamSub(s : Types.TeamSubscription) : Types.TeamSubscription {
    switch (activePromoExpiry(s.team_id)) {
      case (?exp) { if (exp < nowMs()) { { s with is_pro = false; is_pro_football = false } } else s };
      case null s;
    }
  };

  public shared query ({ caller }) func list_promo_codes() : async { #Ok : [Types.PromoCode]; #Err : Text } {
    denyLegacyAccountQuery();
    if (not (isGovernor(caller) or isAppAdmin(caller))) return #Err("Platform admin required");
    #Ok(promoCodes)
  };

  public shared ({ caller }) func create_promo_code(
    code : Text, access_level : Text, scope_type : Text, club_id : ?Text, storage_gb : ?Nat32, expires_at_ms : ?Nat64,
  ) : async { #Ok : Types.PromoCode; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not (isGovernor(caller) or isAppAdmin(caller))) return #Err("Platform admin required");
    let normalized = Text.toUpper(Text.trim(code, #char ' '));
    if (normalized.size() < 3 or normalized.size() > 40) return #Err("Code must be 3-40 characters");
    if (not (access_level == "pro" or access_level == "pro_football" or access_level == "storage")) return #Err("Invalid access level");
    if (not (scope_type == "team" or scope_type == "club")) return #Err("Invalid scope");
    if (access_level == "storage" and storage_gb == null) return #Err("Storage amount required");
    if (promoCodes.any(func(p) = p.code == normalized)) return #Err("duplicate: Code already exists");
    if (promoCodes.size() >= 5000) return #Err("Too many promo codes");
    let item : Types.PromoCode = {
      id = "promo-" # Nat64.toText(nowNs());
      code = normalized; access_level; scope_type; club_id; storage_gb; expires_at_ms;
      is_active = true; uses_count = 0; created_by = caller; created_at_ms = nowMs();
    };
    promoCodes := promoCodes.concat([item]);
    #Ok(item)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func set_promo_code_active(id : Text, is_active : Bool) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not (isGovernor(caller) or isAppAdmin(caller))) return #Err("Platform admin required");
    if (not promoCodes.any(func(p) = p.id == id)) return #Err("Promo code not found");
    promoCodes := promoCodes.map<Types.PromoCode, Types.PromoCode>(func(p) = if (p.id == id) { { p with is_active } } else p);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func delete_promo_code(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not (isGovernor(caller) or isAppAdmin(caller))) return #Err("Platform admin required");
    promoCodes := promoCodes.filter(func(p) = p.id != id);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  /// Redeems a team promo code for `tier` ("pro" | "pro_football").
  /// Returns the grant's expiry (code expiry if set, else 1 month / 1 year).
  public shared ({ caller }) func redeem_team_promo_code(code : Text, team_id : Text, tier : Text, is_annual : Bool) : async { #Ok : Nat64; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    let team = switch (teams.find(func(t) = t.id == team_id and t.deleted_at_ms == null)) {
      case null return #Err("Team not found");
      case (?t) t;
    };
    if (not (canManageTeam(caller, team.club_id, ?team_id) or isAdmin(caller, team.club_id) or isGovernor(caller))) return #Err("Team admin required");
    let wanted = Text.toUpper(Text.trim(code, #char ' '));
    let promo = switch (promoCodes.find(func(p) = p.code == wanted and p.is_active)) {
      case null return #Err("Invalid or inactive promo code");
      case (?p) p;
    };
    let now = nowMs();
    switch (promo.expires_at_ms) { case (?e) { if (e < now) return #Err("This promo code has expired") }; case null {} };
    if (promo.scope_type != "team") return #Err("This promo code is for club subscriptions only. Please use a team promo code.");
    switch (promo.club_id) { case (?c) { if (c != team.club_id) return #Err("This promo code is restricted to a different club.") }; case null {} };
    if (tier == "pro_football" and promo.access_level == "pro") return #Err("This promo code is for Pro plan only. Please select the Pro plan or use a Pro Football code.");
    if (tier == "pro" and promo.access_level == "pro_football") return #Err("This promo code is for Pro Football plan only. Please select the Pro Football plan or use a Pro code.");
    if (not (tier == "pro" or tier == "pro_football")) return #Err("Invalid tier");
    if (promo.access_level == "storage") return #Err("This is a storage promo code");
    let day : Nat64 = 86_400_000;
    let expiry : Nat64 = switch (promo.expires_at_ms) { case (?e) e; case null now + (if is_annual 365 * day else 30 * day) };
    let base : Types.TeamSubscription = switch (teamSubscriptions.find(func(s) = s.team_id == team_id)) {
      case (?s) s;
      case null ({
        team_id; is_pro = false; is_pro_football = false; is_trial = false;
        trial_ends_at_ms = null; cancelled_at_ms = null;
        admin_pro_override = false; admin_pro_football_override = false;
        disable_auto_subs = false; rotation_speed = (1 : Nat32);
        disable_position_swaps = false; disable_batch_subs = false;
        rotate_gk_at_halftime = true; minutes_per_half = null;
        max_spread_minutes = null; team_size = null;
        formation = null; show_lineup_picker = false;
        disable_team_pom_rewards = false;
      });
    };
    let merged : Types.TeamSubscription = { base with is_pro = true; is_pro_football = tier == "pro_football" or base.is_pro_football; cancelled_at_ms = null };
    teamSubscriptions := teamSubscriptions.filter(func(s) = s.team_id != team_id).concat([merged]);
    promoRedemptions := promoRedemptions.filter(func(r) = r.target_id != team_id).concat([{
      promo_id = promo.id; target_id = team_id; redeemed_by = caller; redeemed_at_ms = now; expires_at_ms = expiry;
    }]);
    promoCodes := promoCodes.map<Types.PromoCode, Types.PromoCode>(func(p) = if (p.id == promo.id) { { p with uses_count = p.uses_count + 1 } } else p);
    #Ok(expiry)
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Club storage add-ons (club_subscriptions.storage_purchased_gb parity) ----
  // Only storage promo redemption writes here in ICP mode (money-backed
  // purchases stay off-chain). Read by the vault to raise the club's limit.
  var clubStorageAddons : [(Text, Nat32)];

  func clubStorageGb(club_id : Text) : Nat32 {
    switch (clubStorageAddons.find(func((c, _) : (Text, Nat32)) : Bool = c == club_id)) { case (?(_, g)) g; case null 0 }
  };

  public query func get_club_storage_purchased(club_id : Text) : async { #Ok : Nat32; #Err : Text } {
    #Ok(clubStorageGb(club_id))
  };

  /// Redeems a storage promo code for a club. Returns the new add-on total (GB).
  public shared ({ caller }) func redeem_club_storage_promo_code(code : Text, club_id : Text) : async { #Ok : Nat32; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not (isAdmin(caller, club_id) or isGovernor(caller))) return #Err("Club admin required");
    let wanted = Text.toUpper(Text.trim(code, #char ' '));
    let promo = switch (promoCodes.find(func(p) = p.code == wanted)) {
      case null return #Err("Invalid promo code");
      case (?p) p;
    };
    if (not promo.is_active) return #Err("This promo code is no longer active");
    switch (promo.expires_at_ms) { case (?e) { if (e < nowMs()) return #Err("This promo code has expired") }; case null {} };
    if (promo.access_level != "storage" and promo.storage_gb == null) return #Err("This promo code is not valid for storage");
    switch (promo.club_id) { case (?c) { if (c != club_id) return #Err("This promo code is not valid for this club") }; case null {} };
    let gb : Nat32 = switch (promo.storage_gb) { case (?g) g; case null 0 };
    if (gb == 0) return #Err("This promo code does not grant storage");
    let total = clubStorageGb(club_id) + gb;
    if (growthRehearsal and not MediaGrowthReservations.reserve(mediaGrowthState, mediaRetainedState.ledger, club_id, MediaRetainedQuota.baseBytes + total.toNat() * MediaRetainedQuota.gib)) return #Err("Verified group growth capacity required");
    let priorAddons = clubStorageGb(club_id);
    if (routerGrowthRehearsal and not (await reserveRouterGrowth(club_id))) return #Err("Group-wide growth reservation required");
    auth(caller);
    if (removalReceiver.denied(caller) or not (isAdmin(caller, club_id) or isGovernor(caller)) or clubStorageGb(club_id) != priorAddons or not promoCodes.any(func(p) = p == promo)) return #Err("Storage grant changed during reservation");
    switch (promo.expires_at_ms) { case (?e) { if (e < nowMs()) return #Err("This promo code has expired") }; case null {} };
    clubStorageAddons := clubStorageAddons.filter(func((c, _) : (Text, Nat32)) : Bool = c != club_id).concat([(club_id, total)]);
    promoRedemptions := promoRedemptions.concat([{
      promo_id = promo.id; target_id = "club-storage:" # club_id; redeemed_by = caller; redeemed_at_ms = nowMs(); expires_at_ms = (0 : Nat64);
    }]);
    promoCodes := promoCodes.map<Types.PromoCode, Types.PromoCode>(func(p) = if (p.id == promo.id) { { p with uses_count = p.uses_count + 1 } } else p);
    #Ok(total)
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Global app config (app_settings parity for pre-auth boot reads) ----
  // Public reads (anonymous allowed — the backend routing config must be
  // fetchable before sign-in); writes are governor-only. Values are plain
  // text; never store secrets here — canister state is replica-visible.
  public query func get_app_config(key : Text) : async ?Text {
    switch (appConfig.find(func((k, _)) = k == key)) {
      case (?(_, v)) ?v;
      case null null;
    }
  };

  public shared ({ caller }) func set_app_config(key : Text, value : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    if (not isGovernor(caller)) await admitAccount(caller);
    auth(caller);
    if (not (isGovernor(caller) or isAppAdmin(caller))) return #Err("Only governor or app admin can set app config");
    if (key.size() == 0 or key.size() > 128) return #Err("Key must be 1-128 chars");
    if (value.size() > 65_536) return #Err("Value must be at most 64KiB");
    if (appConfig.size() >= 64 and appConfig.find(func((k, _)) = k == key) == null) return #Err("At most 64 app config keys");
    appConfig := appConfig.filter(func((k, _)) = k != key).concat([(key, value)]);
    #Ok
  
    } finally { removalReceiver.leave(caller) };
  };

  // ---- Duplicate team-name check (CreateTeamPage parity) ----
  // Case-insensitive, ignores soft-deleted teams, scoped to the club.
  public query func check_team_name_unique(club_id : Text, name : Text) : async { #Ok : Bool; #Err : Text } {
    let wanted = Text.toLower(Text.trim(name, #char ' '));
    for (t in teams.values()) {
      if (t.club_id == club_id and t.deleted_at_ms == null and Text.toLower(Text.trim(t.name, #char ' ')) == wanted) {
        return #Ok(false);
      };
    };
    #Ok(true)
  };

  // ---- Single club-link lookup (ClubLinkEmbedPage parity) ----
  public query func get_club_link(link_id : Text) : async { #Ok : ?Types.Link; #Err : Text } {
    for ((_, listing) in clubListings.values()) {
      for (link in listing.links.values()) {
        if (link.id == link_id) return #Ok(?link);
      };
    };
    #Ok(null)
  };

  // ---- Public club-website read endpoint ----
  // Serves GET /club?id=<clubId>&scope=<club|subscription|teams|sponsors|all>
  // as JSON for the club website's backend (server-to-server, no auth — this
  // is the same data the public query calls above already expose
  // anonymously). Only website-facing fields are serialized: shell-team
  // contact name/email, PlayHQ link ids, principals and other internal or
  // PII fields never leave the canister through this endpoint.

  func jsonEscape(t : Text) : Text {
    var out = "";
    for (c in t.chars()) {
      switch (c) {
        case ('\"') { out #= "\\\"" };
        case ('\\') { out #= "\\\\" };
        case ('\n') { out #= "\\n" };
        case ('\r') { out #= "\\r" };
        case ('\t') { out #= "\\t" };
        case (ch) {
          // Strip other control characters (invalid raw in JSON strings).
          if (ch >= ' ') out #= Char.toText(ch);
        };
      };
    };
    out
  };

  func jStr(t : Text) : Text { "\"" # jsonEscape(t) # "\"" };

  func jOptStr(value : ?Text) : Text {
    switch (value) { case null "null"; case (?t) jStr(t) }
  };

  func jBool(b : Bool) : Text { if (b) "true" else "false" };

  func jOptNat64(value : ?Nat64) : Text {
    switch (value) { case null "null"; case (?n) Nat64.toText(n) }
  };

  func clubJson(p : Types.ClubProfile) : Text {
    "{\"id\":" # jStr(p.id)
    # ",\"name\":" # jStr(p.name)
    # ",\"slug\":" # jStr(p.slug)
    # ",\"description\":" # jOptStr(p.description)
    # ",\"logo_url\":" # jOptStr(p.logo_url)
    # ",\"primary_color\":" # jOptStr(p.primary_color)
    # ",\"secondary_color\":" # jOptStr(p.secondary_color)
    # ",\"sport\":" # jOptStr(p.sport)
    # ",\"is_active\":" # jBool(p.is_active)
    # "}"
  };

  func subscriptionJson(s : Types.ClubSubscription) : Text {
    "{\"club_id\":" # jStr(s.club_id)
    # ",\"plan\":" # jStr(s.plan)
    # ",\"is_pro\":" # jBool(s.is_pro)
    # ",\"is_pro_football\":" # jBool(s.is_pro_football)
    # ",\"is_trial\":" # jBool(s.is_trial)
    # ",\"team_limit\":" # (switch (s.team_limit) { case null "null"; case (?n) Nat32.toText(n) })
    # ",\"expires_at_ms\":" # jOptNat64(s.expires_at_ms)
    # ",\"trial_ends_at_ms\":" # jOptNat64(s.trial_ends_at_ms)
    # ",\"cancelled_at_ms\":" # jOptNat64(s.cancelled_at_ms)
    # ",\"activated_at_ms\":" # jOptNat64(s.activated_at_ms)
    # "}"
  };

  func teamJson(t : Types.ClubTeam) : Text {
    "{\"id\":" # jStr(t.id)
    # ",\"name\":" # jStr(t.name)
    # ",\"division\":" # jOptStr(t.division)
    # ",\"gender\":" # jOptStr(t.gender)
    # ",\"age_group\":" # jOptStr(t.age_group)
    # ",\"description\":" # jOptStr(t.description)
    # ",\"logo_url\":" # jOptStr(t.logo_url)
    # ",\"team_type\":" # jOptStr(t.team_type)
    # ",\"is_active\":" # jBool(t.is_active)
    # ",\"archived\":" # jBool(t.archived)
    # "}"
  };

  func sponsorJson(s : Types.ClubSponsor) : Text {
    "{\"id\":" # jStr(s.id)
    # ",\"name\":" # jStr(s.name)
    # ",\"tier\":" # jStr(s.tier)
    # ",\"website_url\":" # jOptStr(s.website_url)
    # ",\"logo_url\":" # jOptStr(s.logo_url)
    # ",\"description\":" # jOptStr(s.description)
    # ",\"sort_order\":" # Nat32.toText(s.sort_order)
    # ",\"is_team_only\":" # jBool(s.is_team_only)
    # ",\"exposure_percentage\":" # (switch (s.exposure_percentage) { case null "null"; case (?n) Nat8.toText(n) })
    # ",\"is_active\":" # jBool(s.is_active)
    # "}"
  };

  func queryParam(url : Text, name : Text) : ?Text {
    let parts = Iter.toArray(Text.split(url, #char '?'));
    if (parts.size() < 2) return null;
    for (pair in Text.split(parts[1], #char '&')) {
      let kv = Iter.toArray(Text.split(pair, #char '='));
      if (kv.size() > 0 and kv[0] == name) {
        if (kv.size() > 1) return ?kv[1];
        return ?"";
      };
    };
    null
  };

  func jsonResponse(status : Nat16, body : Text) : HttpResponse {
    {
      status_code = status;
      headers = [
        ("content-type", "application/json"),
        // The website backend caches its side; never serve stale club data.
        ("cache-control", "no-cache"),
      ];
      body = Text.encodeUtf8(body);
    }
  };

  public query func http_request(request : HttpRequest) : async HttpResponse {
    if (request.method != "GET") {
      return jsonResponse(405, "{\"error\":\"method not allowed\"}");
    };
    let path = switch (Text.split(request.url, #char '?').next()) {
      case (?head) head;
      case null request.url;
    };
    if (path != "/club" and path != "club") {
      return jsonResponse(404, "{\"error\":\"not found\"}");
    };
    let clubId = switch (queryParam(request.url, "id")) {
      case (?id) id;
      case null { return jsonResponse(400, "{\"error\":\"missing id\"}") };
    };
    let scope = switch (queryParam(request.url, "scope")) {
      case (?s) s;
      case null "all";
    };
    if (scope != "club" and scope != "subscription" and scope != "teams" and scope != "sponsors" and scope != "all") {
      return jsonResponse(400, "{\"error\":\"invalid scope\"}");
    };
    var profile : ?Types.ClubProfile = null;
    for (p in profiles.values()) {
      if (p.id == clubId) profile := ?p;
    };
    let club = switch (profile) {
      case null { return jsonResponse(404, "{\"error\":\"unknown club\"}") };
      case (?p) {
        if (p.deleted_at_ms != null) {
          return jsonResponse(404, "{\"error\":\"unknown club\"}");
        };
        p
      };
    };

    var body = "{";
    var first = true;
    if (scope == "all" or scope == "club") {
      body #= "\"club\":" # clubJson(club);
      first := false;
    };
    if (scope == "all" or scope == "subscription") {
      if (not first) body #= ",";
      var sub : ?Types.ClubSubscription = null;
      for (s in clubSubscriptions.values()) {
        if (s.club_id == clubId) sub := ?s;
      };
      body #= "\"subscription\":" # (switch (sub) { case null "null"; case (?s) subscriptionJson(s) });
      first := false;
    };
    if (scope == "all" or scope == "teams") {
      if (not first) body #= ",";
      body #= "\"teams\":[";
      var firstTeam = true;
      for (t in teams.values()) {
        if (t.club_id == clubId and t.deleted_at_ms == null) {
          if (not firstTeam) body #= ",";
          body #= teamJson(t);
          firstTeam := false;
        };
      };
      body #= "]";
      first := false;
    };
    if (scope == "all" or scope == "sponsors") {
      if (not first) body #= ",";
      body #= "\"sponsors\":[";
      var firstSponsor = true;
      for (s in sponsors.values()) {
        if (s.club_id == clubId) {
          if (not firstSponsor) body #= ",";
          body #= sponsorJson(s);
          firstSponsor := false;
        };
      };
      body #= "]";
    };
    body #= "}";
    jsonResponse(200, body)
  };

  // ---- Pitch board: named formation library + alert role switches ----
  type PitchFormation = {
    id : Text;
    team_id : Text;
    club_id : Text;
    name : Text;
    team_size : Nat32;
    formation_json : Text;
    drawing_json : ?Text;
    created_by : Principal;
    created_at_ms : Nat64;
  };
  type PitchNotifyFlags = { team_id : Text; coach : Bool; team_admin : Bool; subs_manager : Bool };
  var pitchFormations : [PitchFormation];
  var pitchNotifyFlags : [PitchNotifyFlags];

  func teamClub(team_id : Text) : ?Text {
    switch (teams.find(func(t) = t.id == team_id)) { case (?t) ?t.club_id; case null null }
  };

  public shared query ({ caller }) func list_pitch_formations(team_id : Text) : async { #Ok : [PitchFormation]; #Err : Text } {
    denyLegacyAccountQuery();
    let club = switch (teamClub(team_id)) { case (?c) c; case null return #Err("Team not found") };
    if (not (isMember(caller, club) or isGovernor(caller))) return #Err("Team member required");
    #Ok(pitchFormations.filter(func(f) = f.team_id == team_id))
  };

  public shared ({ caller }) func save_pitch_formation(team_id : Text, name : Text, team_size : Nat32, formation_json : Text, drawing_json : ?Text) : async { #Ok : PitchFormation; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    let club = switch (teamClub(team_id)) { case (?c) c; case null return #Err("Team not found") };
    if (not canManageTeam(caller, club, ?team_id)) return #Err("Coach or team admin required");
    let trimmed = Text.trim(name, #char ' ');
    if (trimmed.size() == 0 or name.size() > 120) return #Err("Name must be 1-120 characters");
    let drawingSize = switch (drawing_json) { case (?d) d.size(); case null 0 };
    if (formation_json.size() + drawingSize > 1_500_000) return #Err("Formation is too large to save");
    let now = nowNs();
    let f : PitchFormation = {
      id = "pf-" # team_id # "-" # Nat.toText(pitchFormations.size() + 1) # "-" # Nat64.toText(now % 1_000_000_000);
      team_id; club_id = club; name = trimmed; team_size; formation_json; drawing_json;
      created_by = caller; created_at_ms = now / 1_000_000;
    };
    pitchFormations := pitchFormations.concat([f]);
    #Ok(f)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func delete_pitch_formation(id : Text) : async { #Ok; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (pitchFormations.find(func(f) = f.id == id)) {
      case null { #Err("Formation not found") };
      case (?f) {
        if (not (f.created_by.equal(caller) or canManageTeam(caller, f.club_id, ?f.team_id))) return #Err("Not allowed");
        pitchFormations := pitchFormations.filter(func(x) = x.id != id);
        #Ok
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared query ({ caller }) func get_team_pitch_notify(team_id : Text) : async { #Ok : PitchNotifyFlags; #Err : Text } {
    denyLegacyAccountQuery();
    let club = switch (teamClub(team_id)) { case (?c) c; case null return #Err("Team not found") };
    if (not (isMember(caller, club) or isGovernor(caller))) return #Err("Team member required");
    switch (pitchNotifyFlags.find(func(f) = f.team_id == team_id)) {
      case (?f) #Ok(f);
      case null #Ok({ team_id; coach = true; team_admin = true; subs_manager = true });
    }
  };

  public shared ({ caller }) func set_team_pitch_notify(team_id : Text, coach : Bool, team_admin : Bool, subs_manager : Bool) : async { #Ok : PitchNotifyFlags; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    let club = switch (teamClub(team_id)) { case (?c) c; case null return #Err("Team not found") };
    if (not canManageTeam(caller, club, ?team_id)) return #Err("Coach or team admin required");
    let f : PitchNotifyFlags = { team_id; coach; team_admin; subs_manager };
    pitchNotifyFlags := pitchNotifyFlags.filter(func(x) = x.team_id != team_id).concat([f]);
    #Ok(f)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_club_media_references(club : Text, offset : Nat, expected : ?Nat) : async { #Ok : MediaEvidence.Page; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    if (not isTransferFenced(club)) return #Err("Club must be fenced before media inventory");
    switch (expected) { case (?r) { if (r != mediaEvidenceRevision) return #Err("Media inventory revision changed") }; case null { if (offset != 0) return #Err("Revision required after first page") } };
    let (start, end) = MediaEvidence.bounds(offset, newsPosts.size());
    var refs : [MediaEvidence.Reference] = [];
    for (i in Nat.range(start, end)) { let n = newsPosts[i]; if (n.club_id == club) {
      switch (n.image_url) { case (?url) { refs := refs.concat([{ resource_id = n.id # ":image"; url; store = null; path = null; content_hash = null }]) }; case null {} };
      var j = 0; for (a in n.attachments.values()) { refs := refs.concat([{ resource_id = n.id # ":attachment:" # Nat.toText(j); url = a.url; store = null; path = null; content_hash = null }]); j += 1 };
    } };
    #Ok({ revision = mediaEvidenceRevision; scanned = end - start; next = if (end < newsPosts.size()) ?end else null; references = refs })
  };


  // Additive protected consensus reads; live UI rollout is a separate release gate.
  public shared ({ caller }) func read_account_get_club_invite_message_default(club_id : Text) : async { #Ok : ?Types.InviteMessageDefault; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    #Ok(inviteMessageDefaults.find(func(item) = item.club_id == club_id))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_team_welcome_email(team_id : Text) : async { #Ok : ?Types.TeamWelcomeEmail; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (teams.find(func(t) = t.id == team_id)) {
      case null { #Ok(null) };
      case (?team) {
        if (not canManageTeam(caller, team.club_id, ?team_id)) return #Err("Team or club admin required");
        #Ok(teamWelcomeEmails.find(func(item) = item.team_id == team_id))
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_my_personal_teams() : async { #Ok : [Types.ClubTeam]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    let mine = personalTeamOwners.filter(func(pair) = pair.1.equal(caller)).map(func(pair) = pair.0);
    #Ok(teams.filter(func(t) = mine.any(func(id) = id == t.id)))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_read_competition_team_access(team_id : Text, user : Principal) : async { club_id : ?Text; is_member : Bool; can_manage : Bool } {
    if (not removalReceiver.enter(user)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(user);
    if (not trustedCompetition(caller) or user.equal(Principal.anonymous()) or team_id.size() > 128) return { club_id = null; is_member = false; can_manage = false };
    switch (liveTeamClub(team_id)) {
      case null ({ club_id = null; is_member = false; can_manage = false });
      case (?club) {
        let allowed = not isExcluded(user, club);
        { club_id = ?club; is_member = allowed and (isOnTeam(user, team_id) or isAdmin(user, club));
          can_manage = allowed and (isAdmin(user, club) or acl.roles.any(func(g) = g.user.equal(user) and g.club == ?club and g.team == ?team_id and (g.role == "team_admin" or g.role == "coach"))) }
      };
    }
  
    } finally { removalReceiver.leave(user) };
  };

  public shared ({ caller }) func read_account_is_user_on_any_team(team_ids : [Text], user : Principal) : async Bool {
    if (not removalReceiver.enter(user)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(user);
    if (user.equal(Principal.anonymous()) or team_ids.size() > 500) return false;
    let trusted = trustedCompetition(caller) or (switch (messagingDomainCanister) { case (?p) p.equal(caller); case null false });
    trusted and team_ids.any(func(teamId) = switch (liveTeamClub(teamId)) {
      case null false;
      case (?club) not isExcluded(user, club) and isOnTeam(user, teamId);
    })
  
    } finally { removalReceiver.leave(user) };
  };

  public shared ({ caller }) func read_account_list_news_targets(club_ids : [Text]) : async { #Ok : [(Text, Text, Text)]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (club_ids.size() > 50) return #Err("Too many clubs");
    let visible = club_ids.filter(func(club) = isMember(caller, club) or isAdmin(caller, club));
    #Ok(newsTargets.filter(func(t) = newsPosts.any(func(p) =
      p.id == t.0 and visible.any(func(club) = club == p.club_id) and canSeeNewsPost(caller, p))))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_news(club_id : Text) : async { #Ok : [Types.NewsPost]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (not isMember(caller, club_id) and not isAdmin(caller, club_id) and not newsAudienceRecipients.any(func(item) = item.user.equal(caller) and newsPosts.any(func(post) = post.id == item.news_id and post.club_id == club_id))) return #Err("Forbidden");
    #Ok(newsPosts.filter(func(p) = p.club_id == club_id and canSeeNewsPost(caller, p)))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_news_multi(club_ids : [Text]) : async { #Ok : [Types.NewsPost]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (club_ids.size() > 50) return #Err("Too many clubs");
    let visible = club_ids.filter(func(club) = isMember(caller, club) or isAdmin(caller, club) or newsAudienceRecipients.any(func(item) = item.user.equal(caller) and newsPosts.any(func(post) = post.id == item.news_id and post.club_id == club)));
    #Ok(newsPosts.filter(func(p) =
      visible.any(func(club) = club == p.club_id) and canSeeNewsPost(caller, p)))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_parent_invite(token : Text) : async { #Ok : Types.ParentInvite; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (parentInvites.find(func(i) = i.id == token)) {
      case null { #Err("Invite not found") };
      case (?invite) {
        if (invite.expires_at_ms <= nowMs()) return #Err("Invite expired");
        if (isExcluded(caller, invite.club_id)) return #Err("Forbidden");
        if (isExcluded(invite.invited_by, invite.club_id) or not canManageTeam(invite.invited_by, invite.club_id, invite.team_id)) return #Err("Invite authorization changed");
        if (not parentInviteScopeValid(invite.club_id, invite.team_id, invite.child_id)) return #Err("Referenced child not in invite scope");
        switch (invite.accepted_by) {
          case (?user) {
            if (not user.equal(caller)) return #Err("Invite already accepted");
            if (not acl.guardians.any(func(g) = g.child == invite.child_id and g.user.equal(caller))) return #Err("Guardian authorization changed");
          };
          case null {};
        };
        #Ok(invite)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_season_eoi_config(season_id : Text) : async { #Ok : ?Text; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (seasons.find(func(s) = s.id == season_id)) {
      case null { #Err("Season not found") };
      case (?season) {
        if (not isMember(caller, season.club_id)) return #Err("Club membership required");
        #Ok(switch (seasonEoiConfig.find(func((k, _)) = k == season_id)) { case (?(_, v)) ?v; case null null });
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_season_team_assignment(season_id : Text) : async { #Ok : [Types.SeasonTeamAssignment]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (seasons.find(func(s) = s.id == season_id)) {
      case null { #Err("Season not found") };
      case (?season) {
        if (not isMember(caller, season.club_id)) return #Err("Club membership required");
        #Ok(seasonTeamAssignments.filter(func(a) = a.season_id == season_id));
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_club_kind(club_id : Text) : async { #Ok : ?Text; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    #Ok(switch (clubKinds.find(func((k, _)) = k == club_id)) { case (?(_, v)) ?v; case null null })
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_class_enrolments(club_id : Text, term_id : ?Text, class_id : ?Text) : async { #Ok : [Types.ClassEnrolment]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    #Ok(classEnrolments.filter(func(e) =
      e.club_id == club_id
      and (switch (term_id) { case (?t) e.term_id == t; case null true })
      and (switch (class_id) { case (?c) e.class_id == c; case null true })
    ))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_club_general_settings(club_id : Text) : async { #Ok : Types.ClubGeneralSettings; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    switch (clubGeneralSettings.find(func(s) = s.club_id == club_id)) {
      case (?s) #Ok(s);
      case null #Ok({
        club_id;
        class_mode_enabled = false;
        allow_guests_default = false;
        max_guests_per_member_default = 0;
        events_sponsor_strip_enabled = true;
      });
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_free_usage_counters(club_id : Text) : async { #Ok : { teams : Nat; members : Nat; news_posts : Nat; pending_invites : Nat }; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    var memberIds : [Text] = [];
    for (g in acl.roles.values()) {
      if (g.club == ?club_id) {
        let txt = Principal.toText(g.user);
        if (not memberIds.any(func(m) = m == txt)) { memberIds := memberIds.concat([txt]) };
      };
    };
    #Ok({
      teams = teams.filter(func(t) = t.club_id == club_id and t.deleted_at_ms == null).size();
      members = memberIds.size();
      news_posts = newsPosts.filter(func(p) = p.club_id == club_id).size();
      pending_invites = pendingInvites.filter(func(i) = i.club_id == club_id and i.status != "revoked" and i.status != "accepted").size();
    })
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_links(club : Text, admin_view : Bool) : async { #Ok : Types.Listing; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    let listing = getListing(club);
    if (admin_view) {
      if (not isAdmin(caller, club)) return #Err("Forbidden");
      #Ok(listing)
    } else {
      if (not isMember(caller, club)) return #Err("Forbidden");
      let filtered = listing.links.filter(func(link) = link.draft.is_active);
      #Ok({ links = filtered; revision = listing.revision })
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_link(id : Text) : async { #Ok : Types.Listing; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    switch (findLinkAnyClub(id)) {
      case null { #Err("Link not found") };
      case (?link) {
        let admin = isAdmin(caller, link.club_id);
        if (not admin and not isMember(caller, link.club_id)) return #Err("Forbidden");
        if (not link.draft.is_active and not admin) return #Err("Forbidden");
        let listing = getListing(link.club_id);
        #Ok({ links = [link]; revision = listing.revision })
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_execute(input : Text) : async Oql.Result {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    let request = Oql.parse(input, OqlClubs.entities);
    if (request.entity == "clubs") {
      Oql.run<Types.ClubProfile>(request, profiles, func(club) = club.deleted_at_ms == null and (isMember(caller, club.id) or isAdmin(caller, club.id)), OqlClubs.clubRow)
    } else {
      Oql.run<Types.ClubTeam>(request, teams, func(team) = team.deleted_at_ms == null and (isMember(caller, team.club_id) or isAdmin(caller, team.club_id)), OqlClubs.teamRow)
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_whoami() : async { #Ok : Types.Account; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (accountFor(caller)) {
      case (?account) { #Ok(account) };
      case null { #Err("Unlinked identity") };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_role_grants(club : Text) : async { #Ok : [Types.AccountRole]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (not isAdmin(caller, club)) return #Err("Club admin required");
    #Ok(accountRoles.filter(func(grant) = grant.club == ?club or grant.club == null))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_team_role_grants(team : Text) : async { #Ok : [Types.AccountRole]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    var club : ?Text = null;
    label search {
      for (t in teams.vals()) {
        if (t.id == team) { club := ?t.club_id; break search };
      };
      for (t in acl.teams.vals()) {
        if (t.id == team) { club := ?t.club; break search };
      };
    };
    switch (club) {
      case null { #Err("Unknown team") };
      case (?clubId) {
        if (not isMember(caller, clubId)) return #Err("Club membership required");
        #Ok(accountRoles.filter(func(grant) = grant.team == ?team))
      };
    };
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_my_role_grants() : async [Types.RoleGrant] {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    acl.roles.filter(func(grant) = grant.user.equal(caller))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared func read_account_has_club_staff_role(user : Principal, club_id : Text) : async Bool {
    if (not removalReceiver.enter(user)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(user);
    if (user.equal(Principal.anonymous())) return false;
    acl.roles.any(func(grant) = grant.user.equal(user) and grant.club == ?club_id)
  
    } finally { removalReceiver.leave(user) };
  };

  public shared func read_account_is_club_member(user : Principal, club_id : Text) : async Bool {
    if (not removalReceiver.enter(user)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(user);
    if (user.equal(Principal.anonymous())) return false;
    isMember(user, club_id)
  
    } finally { removalReceiver.leave(user) };
  };

  public shared func read_account_has_child_guardian(user : Principal, child_id : Text) : async Bool {
    if (not removalReceiver.enter(user)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(user); currentChildGuardian(user, child_id) 
    } finally { removalReceiver.leave(user) };
  };

  public shared func read_account_list_user_club_roles(user : Principal, club_id : Text) : async [(Text, ?Text)] {
    if (not removalReceiver.enter(user)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(user);
    if (user.equal(Principal.anonymous())) return [];
    acl.roles.filter(func(grant) = grant.user.equal(user) and grant.club == ?club_id).map(func(grant) = (grant.role, grant.team))
  
    } finally { removalReceiver.leave(user) };
  };

  public shared func read_account_is_app_admin(user : Principal) : async Bool {
    if (not removalReceiver.enter(user)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(user);
    if (user.equal(Principal.anonymous())) return false;
    acl.roles.any(func(grant) = grant.user.equal(user) and grant.role == "app_admin")
  
    } finally { removalReceiver.leave(user) };
  };

  public shared ({ caller }) func read_account_get_club_roster(club_id : Text) : async { #Ok : { children : [Types.Child]; roles : [Types.RoleGrant] }; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (not acl.roles.any(func(grant) = grant.user.equal(caller) and grant.club == ?club_id)) {
      return #Err("Club staff role required");
    };
    #Ok({
      children = acl.children.filter(func(c) = c.club_id == ?club_id);
      roles = acl.roles.filter(func(g) = g.club == ?club_id);
    })
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_children() : async { #Ok : [Types.Child]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (accountFor(caller)) {
      case null { #Err("Unlinked identity") };
      case (?account) {
        let childIds = accountFamilies.filter(func(link) = link.account_id == account.id).map(func(link) = link.child_id);
        #Ok(acl.children.filter(func(child) = childIds.any(func(id) = id == child.id) and currentChildGuardian(caller, child.id)))
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_removed_members(club : Text) : async { #Ok : [Types.RemovedMember]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (not isAdmin(caller, club)) return #Err("Club admin required");
    #Ok(removedMembers.filter(func(m) = m.club == club))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_role_requests(club : Text) : async { #Ok : [Types.RoleRequest]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (not isAdmin(caller, club)) return #Err("Club admin required");
    #Ok(roleRequests.filter(func(r) = r.club == club))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_my_removed_clubs() : async { #Ok : [Types.ClubProfile]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    let cutoff : Nat64 = nowMs() - 30 * 24 * 60 * 60 * 1000;
    #Ok(profiles.filter(func(p) = switch (p.deleted_at_ms) { case (?d) d >= cutoff and isAdmin(caller, p.id); case null false }))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_team_invites(club_id : Text, team_id : ?Text) : async { #Ok : [Types.TeamInvite]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    #Ok(teamInvites.filter(func(i) = i.club_id == club_id and (team_id == null or team_id == ?i.team_id)))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_team_invite(id : Text) : async { #Ok : Types.TeamInvite; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (teamInvites.find(func(i) = i.id == id)) {
      case null { #Err("Invite not found") };
      case (?invite) {
        if (invite.expires_at_ms <= nowMs()) return #Err("Invite expired");
        #Ok(invite)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_shell_team_by_token(token : Text) : async { #Ok : Types.ClubTeam; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (teams.find(func(t) = t.shell_claim_token == ?token)) {
      case null { #Err("Shell invite not found") };
      case (?team) {
        if (team.shell_claimed_by != null) return #Err("Shell team already claimed");
        #Ok(team)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_team_invite_link_by_token(token : Text) : async { #Ok : Types.TeamInviteLink; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (teamInviteLinks.find(func(l) = l.token == token)) {
      case null { #Err("Invite link not found") };
      case (?link) {
        if (link.revoked) return #Err("Invite link revoked");
        #Ok(link)
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_pending_invites_by_club(club_id : Text) : async { #Ok : [Types.PendingInvite]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    #Ok(pendingInvites.filter(func(i) = i.club_id == club_id))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_find_pending_invite_by_email_hash(club_id : Text, hash : Text) : async { #Ok : ?Types.PendingInviteEmailHash; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (not acl.roles.any(func(grant) = grant.user.equal(caller) and grant.club == ?club_id)) return #Err("Club staff required");
    #Ok(pendingInviteEmailHashes.find(func(h) = h.club_id == club_id and h.hash == hash))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_guardian_relationships(child_id : Text) : async { #Ok : [Types.GuardianMeta]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (not (acl.guardians.any(func(g) = g.child == child_id and g.user.equal(caller)) or canManageChild(caller, child_id))) return #Err("Forbidden");
    #Ok(guardianMeta.filter(func(m) = m.child_id == child_id))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_my_children() : async [Types.Child] {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    acl.children.filter(func(c) = isChildGuardian(caller, c))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_child_guardians(child_id : Text) : async { #Ok : [Principal]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (acl.children.find(func(c) = c.id == child_id)) {
      case null { #Err("Child not found") };
      case (?child) {
        if (not (isChildGuardian(caller, child) or canManageChild(caller, child_id))) return #Err("Forbidden");
        #Ok(acl.guardians.filter(func(g) = g.child == child_id).map(func(g) = g.user))
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_team_creation_requests(club_id : Text) : async { #Ok : [Types.TeamCreationRequest]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    #Ok(teamCreationRequests.filter(func(r) = r.club_id == club_id))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_team_player_positions(team_id : Text) : async { #Ok : [Types.TeamPlayerPosition]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    switch (acl.teams.find(func(t) = t.id == team_id)) {
      case null { #Err("Team not found") };
      case (?team) {
        if (not isMember(caller, team.club)) return #Err("Forbidden");
        #Ok(teamPlayerPositions.filter(func(p) = p.team_id == team_id))
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_team_player_positions_v2(team_id : Text) : async { #Ok : [Types.TeamPlayerPositionAssignment]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    switch (acl.teams.find(func(t) = t.id == team_id)) {
      case null { #Err("Team not found") };
      case (?team) {
        if (not isMember(caller, team.club)) return #Err("Forbidden");
        #Ok(teamPlayerPositionAssignments.filter(func(a) = a.team_id == team_id))
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_team_captains(team_id : Text) : async { #Ok : [Types.TeamCaptain]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    switch (acl.teams.find(func(t) = t.id == team_id)) {
      case null { #Err("Team not found") };
      case (?team) {
        if (not isMember(caller, team.club)) return #Err("Forbidden");
        #Ok(teamCaptains.filter(func(c) = c.team_id == team_id))
      };
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_club_join_requests(club_id : Text) : async { #Ok : [Types.ClubJoinRequest]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    #Ok(clubJoinRequests.filter(func(r) = r.club_id == club_id))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_my_theme_preference() : async { #Ok : ?Text; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (themePrefs.find(func(entry) = entry.0.equal(caller))) {
      case (?entry) #Ok(?entry.1);
      case null #Ok(null);
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_my_accessibility_prefs() : async { #Ok : ?Text; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    switch (accessibilityPrefs.find(func(entry) = entry.0.equal(caller))) {
      case (?entry) #Ok(?entry.1);
      case null #Ok(null);
    }
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_online_presence(window_seconds : Nat) : async { #Ok : [(Text, Int)]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (not (isGovernor(caller) or isAppAdmin(caller))) return #Err("App admin required");
    let nowMs : Int = Time.now() / 1_000_000;
    let cutoff : Int = nowMs - (window_seconds * 1000);
    #Ok(presenceLastSeen.filter(func(entry) = entry.1 >= cutoff));
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_club_branding(club_id : Text) : async { #Ok : Types.ClubBranding; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    let profile = switch (profiles.find(func(c) = c.id == club_id)) {
      case (?c) c;
      case null return #Err("Club not found");
    };
    let s = currentSettingsFor(club_id);
    #Ok({ name = profile.name; logo_url = profile.logo_url; contact_email = s.contact_email })
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_club_terms(club_id : Text) : async { #Ok : [Types.ClubTerm]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    #Ok(clubTerms.filter(func(t) = t.club_id == club_id))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_read_season_club(id : Text) : async { #Ok : ?Text; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    #Ok(switch (seasons.find(func(s) = s.id == id)) {
      case null null;
      case (?s) if (isAdmin(caller, s.club_id)) ?s.club_id else null;
    })
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_seasons(club_id : Text) : async { #Ok : [Types.Season]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    #Ok(seasons.filter(func(s) = s.club_id == club_id))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_current_season(club_id : Text) : async { #Ok : ?Types.Season; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    #Ok(seasons.find(func(s) = s.club_id == club_id and s.status == "active"))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_season_team_summary(season_id : Text) : async { #Ok : [Types.SeasonTeamSummary]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    let season = seasons.find(func(s) = s.id == season_id);
    switch (season) {
      case null #Err("Season not found");
      case (?s) {
        if (not isMember(caller, s.club_id)) return #Err("Club membership required");
        #Ok(seasonTeamSummaries.filter(func(r) = r.season_id == season_id));
      };
    };
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_season_player_stats(season_id : Text, team_id : Text) : async { #Ok : [Types.SeasonPlayerStat]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    let season = seasons.find(func(s) = s.id == season_id);
    switch (season) {
      case null #Err("Season not found");
      case (?s) {
        if (not isMember(caller, s.club_id)) return #Err("Club membership required");
        #Ok(seasonPlayerStats.filter(func(r) = r.season_id == season_id and r.team_id == team_id));
      };
    };
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_profile_team_history(profile_id : Text) : async [Types.ProfileTeamHistoryEntry] {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    let grants = accountRoles.filter(func(g) = g.account_id == profile_id and g.team != null);
    grants.map(func(g) : Types.ProfileTeamHistoryEntry {
      let teamId = switch (g.team) { case (?t) t; case null "" };
      let team = teams.find(func(t) = t.id == teamId);
      let clubId = switch (team) { case (?t) t.club_id; case null (switch (g.club) { case (?c) c; case null "" }) };
      let club = profiles.find(func(p) = p.id == clubId);
      let season = seasons.find(func(s) = s.club_id == clubId and s.status == "active");
      {
        membership_id = profile_id # "-" # teamId;
        team_id = teamId;
        team_name = switch (team) { case (?t) t.name; case null "" };
        team_level_age = switch (team) { case (?t) t.age_group; case null null };
        club_id = clubId;
        club_name = switch (club) { case (?c) c.name; case null "" };
        season_id = switch (season) { case (?s) s.id; case null "" };
        season_name = switch (season) { case (?s) s.name; case null "" };
        season_status = switch (season) { case (?s) s.status; case null "" };
        season_start_date = switch (season) { case (?s) s.start_date; case null "" };
        season_end_date = switch (season) { case (?s) s.end_date; case null "" };
        joined_at_ms = 0;
      }
    })
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_accepted_invites(club_id : Text, since_ms : Nat64, until_ms : Nat64) : async { #Ok : [Types.AcceptedInvite]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    let rows = pendingInvites.filter(func(i) =
      i.club_id == club_id and i.status == "accepted" and
      (switch (i.accepted_at_ms) { case (?ts) ts >= since_ms and ts <= until_ms; case null false }));
    #Ok(rows.map(func(i) : Types.AcceptedInvite {
      {
        id = i.id;
        invited_user_id = switch (i.accepted_by) { case (?p) Principal.toText(p); case null "" };
        accepted_at_ms = switch (i.accepted_at_ms) { case (?ts) ts; case null 0 };
      }
    }))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_invite_stats(club_id : Text, since_ms : Nat64, until_ms : Nat64) : async { #Ok : Types.InviteStats; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    let inRange = pendingInvites.filter(func(i) = i.club_id == club_id and i.created_at_ms >= since_ms and i.created_at_ms <= until_ms);
    let accepted = inRange.filter(func(i) = i.accepted_at_ms != null).size();
    #Ok({ total = inRange.size(); accepted })
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_member_payments(club_id : Text, payment_period : Text, payment_type : Text) : async { #Ok : [Types.MemberPayment]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    auth(caller);
    let scoped = memberPayments.filter(func(p) = p.club_id == club_id and p.payment_period == payment_period and p.payment_type == payment_type);
    if (isAdmin(caller, club_id)) return #Ok(scoped);
    let callerId = Principal.toText(caller);
    #Ok(scoped.filter(func(p) = p.user_id == callerId))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_promo_codes() : async { #Ok : [Types.PromoCode]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    if (not (isGovernor(caller) or isAppAdmin(caller))) return #Err("Platform admin required");
    #Ok(promoCodes)
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_list_pitch_formations(team_id : Text) : async { #Ok : [PitchFormation]; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    let club = switch (teamClub(team_id)) { case (?c) c; case null return #Err("Team not found") };
    if (not (isMember(caller, club) or isGovernor(caller))) return #Err("Team member required");
    #Ok(pitchFormations.filter(func(f) = f.team_id == team_id))
  
    } finally { removalReceiver.leave(caller) };
  };

  public shared ({ caller }) func read_account_get_team_pitch_notify(team_id : Text) : async { #Ok : PitchNotifyFlags; #Err : Text } {
    if (not removalReceiver.enter(caller)) throw Error.reject("Account removal fenced or operation capacity reached");
    try {
    await admitAccount(caller);
    let club = switch (teamClub(team_id)) { case (?c) c; case null return #Err("Team not found") };
    if (not (isMember(caller, club) or isGovernor(caller))) return #Err("Team member required");
    switch (pitchNotifyFlags.find(func(f) = f.team_id == team_id)) {
      case (?f) #Ok(f);
      case null #Ok({ team_id; coach = true; team_admin = true; subs_manager = true });
    }
  
    } finally { removalReceiver.leave(caller) };
  };
  public shared ({ caller }) func prepare_account_removal(request : RemovalReceiver.Request) : async { #Ok; #Err : Text } {
    removalReceiver.prepare(caller, request)
  };
  public shared ({ caller }) func read_account_removal_drain(request : RemovalReceiver.Request) : async { #Ok : RemovalReceiver.Receipt; #Err : Text } {
    removalReceiver.receipt(caller, request, Principal.fromActor(this), 0)
  };

  public shared ({ caller }) func seal_account_removal(request : RemovalReceiver.Request) : async { #Ok : RemovalReceiver.Receipt; #Err : Text } {
    removalReceiver.seal(caller, request, Principal.fromActor(this), 0)
  };
}
