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
import Random "mo:core/Random";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Timer "mo:core/Timer";
import Types "types";

persistent actor class Main(governorInit : Principal) {
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

  if (governor.equal(Principal.anonymous()) and not governorInit.equal(Principal.anonymous())) {
    governor := governorInit;
  };
  var acl : Types.Acl;
  var aclVersion : Nat64;

  var profiles : [Types.ClubProfile];
  var settings : [Types.ClubSettings];
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
  var parentInvites : [Types.ParentInvite];
  var roleRequests : [Types.RoleRequest];
  var teamInvites : [Types.TeamInvite];
  var teamInviteLinks : [Types.TeamInviteLink];
  var pendingInvites : [Types.PendingInvite];
  var teamCreationRequests : [Types.TeamCreationRequest];
  var teamPlayerPositions : [Types.TeamPlayerPosition];
  var teamCaptains : [Types.TeamCaptain];
  var clubJoinRequests : [Types.ClubJoinRequest];
  var themePrefs : [(Principal, Text)];
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
  // Governor-set downstream canister ids for the permanent-delete fan-out.
  // While unset, that domain's cross-canister cleanup is skipped (the local
  // purge still completes) — mirrored by the deploy script's wiring calls.
  var eventsDomainCanister : ?Principal;
  var messagingDomainCanister : ?Principal;
  var piiCanister : ?Principal;
  var clubSubscriptions : [Types.ClubSubscription];
  var teamSubscriptions : [Types.TeamSubscription];

  // Global app-wide config key/value store (app_settings parity for values
  // that must be readable pre-auth, e.g. the backend routing config). Values
  // are plain text (JSON for structured payloads), capped small; writes are
  // governor-only, reads are public so an unauthenticated boot can fetch the
  // routing config. Never store secrets here — state is replica-visible.
  var appConfig : [(Text, Text)];


  public shared ({ caller }) func transfer_governorship(new_governor : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Only governor can transfer governorship");
    if (new_governor.equal(Principal.anonymous())) return #Err("New governor cannot be anonymous");
    governor := new_governor;
    #Ok
  };

  func auth(caller : Principal) {
    if (caller.equal(Principal.anonymous())) Runtime.trap("Authenticated user required");
  };

  func isGovernor(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and governor.equal(caller)
  };

  func isExcluded(caller : Principal, club : Text) : Bool {
    acl.exclusions.any(func(exclusion) = exclusion.user.equal(caller) and exclusion.club == club)
  };

  // A parent or guardian of a child assigned to one of the club's teams is
  // a member of that club, even without an explicit role grant.
  func isFamilyMember(caller : Principal, club : Text) : Bool {
    acl.children.any(func(c) {
      let isParent = switch (c.parent) { case (?p) p.equal(caller); case null false };
      let isGuardian = acl.guardians.any(func(g) = g.child == c.id and g.user.equal(caller));
      (isParent or isGuardian) and c.teams.any(func(teamId) = acl.teams.any(func(t) = t.id == teamId and t.club == club))
    })
  };

  func isMember(caller : Principal, club : Text) : Bool {
    not isExcluded(caller, club) and (
      acl.roles.any(func(grant) = grant.user.equal(caller) and (grant.club == ?club or grant.club == null))
      or isFamilyMember(caller, club)
    )
  };

  func isAdmin(caller : Principal, club : Text) : Bool {
    isGovernor(caller) or acl.roles.any(func(grant) = grant.user.equal(caller) and (grant.role == "club_admin" or grant.role == "app_admin") and (grant.club == ?club or grant.club == null))
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
    auth(caller);
    if (not isAdmin(caller, profile.id)) return #Err("Club admin required");
    profiles := profiles.filter(func(p) = p.id != profile.id);
    profiles := profiles.concat([profile]);
    #Ok(profile)
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
    auth(caller);
    if (not isAdmin(caller, item.club_id)) return #Err("Club admin required");
    settings := settings.filter(func(s) = s.club_id != item.club_id);
    settings := settings.concat([item]);
    #Ok(item)
  };

  public query func get_club_settings(club_id : Text) : async { #Ok : ?Types.ClubSettings; #Err : Text } {
    for (s in settings.values()) {
      if (s.club_id == club_id) return #Ok(?s);
    };
    #Ok(null)
  };

  public shared ({ caller }) func save_team(team : Types.ClubTeam) : async { #Ok : Types.ClubTeam; #Err : Text } {
    auth(caller);
    if (not isAdmin(caller, team.club_id)) return #Err("Club admin required");
    let isNew = not teams.any(func(t) = t.id == team.id);
    teams := teams.filter(func(t) = t.id != team.id);
    teams := teams.concat([team]);
    if (isNew) {
      // Provision the team chat on the messaging canister (best-effort).
      ignore fanOutEnsureConversation(team.club_id, ?team.id, teamChatParticipants(team.club_id, team.id));
    };
    #Ok(team)
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

  // Team folders (Supabase team_folders counterpart): club-admin-managed
  // groupings for the club's teams list. Folder metadata is website-safe
  // (name/description/color only), so the read is unauthenticated like
  // list_teams; writes are club-admin gated via the folder's owning club.
  var teamFolders : [Types.TeamFolder];

  public shared ({ caller }) func save_team_folder(folder : Types.TeamFolder) : async { #Ok : Types.TeamFolder; #Err : Text } {
    auth(caller);
    if (not isAdmin(caller, folder.club_id)) return #Err("Club admin required");
    let name = Text.trim(folder.name, #char ' ');
    if (name.size() == 0 or name.size() > 80) return #Err("Folder name must be 1-80 characters");
    let saved = { folder with name = name };
    teamFolders := teamFolders.filter(func(f) = f.id != folder.id).concat([saved]);
    #Ok(saved)
  };

  public shared ({ caller }) func delete_team_folder(folder_id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (teamFolders.find(func(f) = f.id == folder_id)) {
      case null { #Err("Folder not found") };
      case (?folder) {
        if (not isAdmin(caller, folder.club_id)) return #Err("Club admin required");
        teamFolders := teamFolders.filter(func(f) = f.id != folder_id);
        // Teams in the deleted folder fall back to the unfiled group.
        teams := teams.map(func(t) = if (t.folder_id == ?folder_id) ({ t with folder_id = null }) else t);
        #Ok
      };
    };
  };

  public query func list_team_folders(club_id : Text) : async { #Ok : [Types.TeamFolder]; #Err : Text } {
    var res : [Types.TeamFolder] = [];
    for (f in teamFolders.values()) {
      if (f.club_id == club_id) res := res.concat([f]);
    };
    #Ok(res)
  };

  public shared ({ caller }) func set_team_folder(team_id : Text, folder_id : ?Text) : async { #Ok : Types.ClubTeam; #Err : Text } {
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
        teams := teams.map(func(t) = if (t.id == team_id) updated else t);
        #Ok(updated)
      };
    };
  };

  public shared ({ caller }) func save_sponsor(sponsor : Types.ClubSponsor) : async { #Ok : Types.ClubSponsor; #Err : Text } {
    auth(caller);
    if (not isAdmin(caller, sponsor.club_id)) return #Err("Club admin required");
    sponsors := sponsors.filter(func(s) = s.id != sponsor.id);
    sponsors := sponsors.concat([sponsor]);
    #Ok(sponsor)
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
  };

  // Hard delete — the Supabase sponsor manager deletes rows outright, so
  // the canister matches (is_active remains available for soft hiding).
  public shared ({ caller }) func delete_sponsor(id : Text) : async { #Ok; #Err : Text } {
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
  };

  func validNewsStatus(status : Text) : Bool { status == "draft" or status == "published" };

  // Caller belongs to (or parents a child on) the given team.
  func isOnTeam(caller : Principal, teamId : Text) : Bool {
    acl.roles.any(func(grant) = grant.user.equal(caller) and grant.team == ?teamId)
    or acl.children.any(func(c) {
      let isParent = switch (c.parent) { case (?p) p.equal(caller); case null false };
      let isGuardian = acl.guardians.any(func(g) = g.child == c.id and g.user.equal(caller));
      (isParent or isGuardian) and c.teams.any(func(t) = t == teamId)
    })
  };

  // Club admins see every post; members see published posts, and
  // team-targeted posts only when they belong to one of the target teams.
  func canSeeNewsPost(caller : Principal, post : Types.NewsPost) : Bool {
    if (isAdmin(caller, post.club_id)) return true;
    if (not isMember(caller, post.club_id)) return false;
    if (post.status != "published") return false;
    switch (post.target_team_ids) {
      case null { true };
      case (?teamIds) { teamIds.any(func(teamId) = isOnTeam(caller, teamId)) };
    }
  };

  func validateNewsExtras(club_id : Text, target_team_ids : ?[Text], image_url : ?Text, attachments : [Types.NewsAttachment]) : ?Text {
    switch (target_team_ids) {
      case null {};
      case (?teamIds) {
        if (teamIds.size() > 100) return ?"Too many target teams";
        for (teamId in teamIds.values()) {
          if (not acl.teams.any(func(t) = t.id == teamId and t.club == club_id)) return ?"Target team not in club";
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

  public shared ({ caller }) func create_news_post(club_id : Text, title : Text, body : Text, status : Text, target_team_ids : ?[Text], is_important : Bool, image_url : ?Text, attachments : [Types.NewsAttachment]) : async { #Ok : Types.NewsPost; #Err : Text } {
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    if (club_id == "" or club_id.size() > 128) return #Err("Invalid club");
    if (title == "" or title.size() > 200) return #Err("Invalid title");
    if (body.size() > 8000) return #Err("Invalid body");
    if (not validNewsStatus(status)) return #Err("Invalid status");
    switch (validateNewsExtras(club_id, target_team_ids, image_url, attachments)) {
      case (?err) return #Err(err);
      case null {};
    };
    let now = nowMs();
    let post : Types.NewsPost = {
      id = "news-" # club_id # "-" # Nat.toText(newsPosts.size() + 1);
      club_id; title; body; status;
      created_by = caller;
      created_at_ms = now;
      updated_at_ms = now;
      revision = 1;
      target_team_ids; is_important; image_url; attachments;
    };
    newsPosts := newsPosts.concat([post]);
    #Ok(post)
  };

  public shared ({ caller }) func update_news_post(id : Text, title : Text, body : Text, status : Text, target_team_ids : ?[Text], is_important : Bool, image_url : ?Text, attachments : [Types.NewsAttachment], expected_revision : Nat64) : async { #Ok : Types.NewsPost; #Err : Text } {
    auth(caller);
    if (title == "" or title.size() > 200) return #Err("Invalid title");
    if (body.size() > 8000) return #Err("Invalid body");
    if (not validNewsStatus(status)) return #Err("Invalid status");
    switch (newsPosts.find(func(p) = p.id == id)) {
      case null { #Err("News post not found") };
      case (?current) {
        if (not isAdmin(caller, current.club_id)) return #Err("Club admin required");
        if (current.revision != expected_revision) return #Err("News post revision conflict");
        switch (validateNewsExtras(current.club_id, target_team_ids, image_url, attachments)) {
          case (?err) return #Err(err);
          case null {};
        };
        let updated : Types.NewsPost = { current with title; body; status; target_team_ids; is_important; image_url; attachments; updated_at_ms = nowMs(); revision = current.revision + 1 };
        newsPosts := newsPosts.map(func(p) = if (p.id == id) updated else p);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func delete_news_post(id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (newsPosts.find(func(p) = p.id == id)) {
      case null { #Err("News post not found") };
      case (?current) {
        if (not isAdmin(caller, current.club_id)) return #Err("Club admin required");
        newsPosts := newsPosts.filter(func(p) = p.id != id);
        #Ok
      };
    }
  };

  // Admins see every post (including drafts); members see published posts
  // visible to them (whole-club, or team-targeted to a team they belong to).
  public query ({ caller }) func list_news(club_id : Text) : async { #Ok : [Types.NewsPost]; #Err : Text } {
    if (not isMember(caller, club_id) and not isAdmin(caller, club_id)) return #Err("Forbidden");
    #Ok(newsPosts.filter(func(p) = p.club_id == club_id and canSeeNewsPost(caller, p)))
  };

  // Cross-club feed: visible posts from the clubs the caller belongs to.
  // Clubs the caller is not a member of are silently skipped.
  public query ({ caller }) func list_news_multi(club_ids : [Text]) : async { #Ok : [Types.NewsPost]; #Err : Text } {
    auth(caller);
    if (club_ids.size() > 50) return #Err("Too many clubs");
    let visible = club_ids.filter(func(club) = isMember(caller, club) or isAdmin(caller, club));
    #Ok(newsPosts.filter(func(p) =
      visible.any(func(club) = club == p.club_id) and canSeeNewsPost(caller, p)))
  };

  // Parent invites: a club/team admin mints a token for a child; the
  // accepting parent links themselves as guardian (and family member, when
  // their identity is linked to an account) in one atomic call — the
  // canister equivalent of the Supabase parent-invite RPCs. NOTE: this
  // trusts the admin-issued token as proof of the guardian relationship;
  // a verified guardian-relationship check is a post-deploy roadmap item,
  // matching the PII reader-grant stance.
  public shared ({ caller }) func create_parent_invite(club_id : Text, team_id : ?Text, child_id : Text) : async { #Ok : Types.ParentInvite; #Err : Text } {
    auth(caller);
    if (not canManageTeam(caller, club_id, team_id)) return #Err("Team or club admin required");
    if (child_id == "" or child_id.size() > 128) return #Err("Invalid child");
    switch (team_id) {
      case (?team) {
        if (not acl.teams.any(func(t) = t.id == team and t.club == club_id)) return #Err("Team not found in club");
      };
      case null {};
    };
    let now = nowMs();
    let invite : Types.ParentInvite = {
      id = "inv-" # club_id # "-" # Nat.toText(parentInvites.size() + 1) # "-" # Nat64.toText(nowNs() % 1_000_000_000);
      club_id; team_id; child_id;
      invited_by = caller;
      created_at_ms = now;
      expires_at_ms = now + 7 * 24 * 60 * 60 * 1000;
      accepted_by = null;
    };
    parentInvites := parentInvites.concat([invite]);
    #Ok(invite)
  };

  public query ({ caller }) func get_parent_invite(token : Text) : async { #Ok : Types.ParentInvite; #Err : Text } {
    auth(caller);
    switch (parentInvites.find(func(i) = i.id == token)) {
      case null { #Err("Invite not found") };
      case (?invite) {
        if (invite.expires_at_ms <= nowMs()) return #Err("Invite expired");
        #Ok(invite)
      };
    }
  };

  public shared ({ caller }) func accept_parent_invite(token : Text) : async { #Ok : Types.ParentInvite; #Err : Text } {
    auth(caller);
    switch (parentInvites.find(func(i) = i.id == token)) {
      case null { #Err("Invite not found") };
      case (?invite) {
        if (invite.accepted_by != null) return #Err("Invite already accepted");
        if (invite.expires_at_ms <= nowMs()) return #Err("Invite expired");
        if (isExcluded(caller, invite.club_id)) return #Err("Forbidden");
        // Ensure the child record exists and carries the invited team.
        switch (invite.team_id) {
          case (?team) {
            switch (acl.children.find(func(c) = c.id == invite.child_id)) {
              case null {
                let child : Types.Child = { id = invite.child_id; teams = [team]; parent = null; club_id = ?invite.club_id };
                acl := { acl with children = acl.children.concat([child]) };
              };
              case (?child) {
                if (not child.teams.any(func(t) = t == team)) {
                  let updated : Types.Child = { child with teams = child.teams.concat([team]) };
                  acl := { acl with children = acl.children.map(func(c) = if (c.id == invite.child_id) updated else c) };
                };
              };
            };
          };
          case null {};
        };
        if (not acl.guardians.any(func(g) = g.child == invite.child_id and g.user.equal(caller))) {
          acl := { acl with guardians = acl.guardians.concat([{ child = invite.child_id; user = caller }]) };
        };
        switch (accountFor(caller)) {
          case (?account) {
            if (not accountFamilies.any(func(f) = f.account_id == account.id and f.child_id == invite.child_id)) {
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
  };

  public query ({ caller }) func list_links(club : Text, admin_view : Bool) : async { #Ok : Types.Listing; #Err : Text } {
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
  };

  public shared ({ caller }) func freeze_club(club : Text, rev : Nat64) : async { #Ok : Nat64; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor required");
    frozenClubs := frozenClubs.filter(func(e) = e.0 != club);
    frozenClubs := frozenClubs.concat([(club, rev)]);
    #Ok(rev)
  };

  public shared ({ caller }) func unfreeze_club(club : Text, rev : Nat64) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor required");
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
    acl := new_acl;
    aclVersion := rev;
    #Ok(rev)
  };

  public query ({ caller }) func whoami() : async { #Ok : Types.Account; #Err : Text } {
    auth(caller);
    switch (accountFor(caller)) {
      case (?account) { #Ok(account) };
      case null { #Err("Unlinked identity") };
    }
  };

  // Browser roster surface for the membership feature. Reads only; role
  // mutations stay behind `mutate`/`replace_acl` governance. Roster reads
  // require club admin — the roster includes every member's role grants.
  public query ({ caller }) func list_role_grants(club : Text) : async { #Ok : [Types.AccountRole]; #Err : Text } {
    if (not isAdmin(caller, club)) return #Err("Club admin required");
    #Ok(accountRoles.filter(func(grant) = grant.club == ?club or grant.club == null))
  };

  // Team-scoped roster read for the team page member list: any member of the
  // team's club (club admins included) may read that team's role grants. The
  // full club roster stays club-admin-only (list_role_grants above).
  public query ({ caller }) func list_team_role_grants(team : Text) : async { #Ok : [Types.AccountRole]; #Err : Text } {
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
    auth(caller);
    acl.roles.filter(func(grant) = grant.user.equal(caller))
  };

  // Cross-canister membership check used by pii_access_control's
  // club-scoped read grants: true when `user` holds any role grant in
  // `club_id`. Public query — club membership is already visible to club
  // members under the roster-read rules (canView), so this reveals nothing
  // new. Not caller-gated so a first-party canister (whose principal is the
  // caller here) can check on behalf of the end user it is serving.
  public query func has_club_staff_role(user : Principal, club_id : Text) : async Bool {
    if (user.equal(Principal.anonymous())) return false;
    acl.roles.any(func(grant) = grant.user.equal(user) and grant.club == ?club_id)
  };

  // Caller-scoped: returns only the children linked to the caller's own
  // account via family links. Children without a matching record in
  // acl.children are skipped.
  public query ({ caller }) func list_children() : async { #Ok : [Types.Child]; #Err : Text } {
    auth(caller);
    switch (accountFor(caller)) {
      case null { #Err("Unlinked identity") };
      case (?account) {
        let childIds = accountFamilies.filter(func(link) = link.account_id == account.id).map(func(link) = link.child_id);
        #Ok(acl.children.filter(func(child) = childIds.any(func(id) = id == child.id)))
      };
    }
  };

  public shared ({ caller }) func begin_identity_link(target : Principal) : async { #Ok : Types.Challenge; #Err : Text } {
    auth(caller);
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
  };

  public shared ({ caller }) func accept_identity_link(id : Nat64) : async { #Ok : Types.Account; #Err : Text } {
    auth(caller);
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
            accounts := Array.tabulate<Types.Account>(accounts.size(), func(position) { if (position == accountIndex) updated else accounts[position] });
            let accepted : Types.Challenge = { challenge with accepted = true };
            accountChallenges := Array.tabulate<Types.Challenge>(accountChallenges.size(), func(position) { if (position == index) accepted else accountChallenges[position] });
            #Ok(updated)
          };
        }
      };
    }
  };

  public shared ({ caller }) func revoke_identity(target : Principal, expected_version : Nat64) : async { #Ok : Types.Account; #Err : Text } {
    auth(caller);
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
            accounts := Array.tabulate<Types.Account>(accounts.size(), func(position) { if (position == index) updated else accounts[position] });
            #Ok(updated)
          };
        }
      };
    }
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
    auth(caller);
    if (not isAdmin(caller, club)) return #Err("Club admin required");
    if (role == "") return #Err("Invalid role");
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
  };

  public shared ({ caller }) func remove_role_grant(user : Principal, club : Text, role : Text, team : ?Text) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isAdmin(caller, club)) return #Err("Club admin required");
    acl := { acl with roles = acl.roles.filter(func(g) = not (g.user.equal(user) and g.role == role and g.club == ?club and g.team == team)) };
    let accountId = accountIdFor(user);
    accountRoles := accountRoles.filter(func(g) = not (g.account_id == accountId and g.role == role and g.club == ?club and g.team == team));
    #Ok
  };

  // SOFT delete: revokes every role a member holds in a club (club-level
  // roles only, not global roles) -- access must still be revoked -- and
  // records a RemovedMember marker so the member is hidden from active
  // rosters while keeping their history (guardian/child/points/attendance
  // records untouched). Idempotent: removing an already-removed member is
  // a no-op #Ok.
  public shared ({ caller }) func remove_member(club : Text, user : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isAdmin(caller, club)) return #Err("Club admin required");
    acl := { acl with roles = acl.roles.filter(func(g) = not (g.user.equal(user) and g.club == ?club)) };
    let accountId = accountIdFor(user);
    accountRoles := accountRoles.filter(func(g) = not (g.account_id == accountId and g.club == ?club));
    if (not removedMembers.any(func(m) = m.club == club and m.user.equal(user))) {
      removedMembers := removedMembers.concat([{ club; user; removed_at_ms = nowMs(); removed_by = caller }]);
    };
    #Ok
  };

  // Clears the soft-delete marker. Does NOT restore previously revoked
  // role grants -- the admin must re-grant roles explicitly via
  // add_role_grant.
  public shared ({ caller }) func restore_member(club : Text, user : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isAdmin(caller, club)) return #Err("Club admin required");
    removedMembers := removedMembers.filter(func(m) = not (m.club == club and m.user.equal(user)));
    #Ok
  };

  public query ({ caller }) func list_removed_members(club : Text) : async { #Ok : [Types.RemovedMember]; #Err : Text } {
    if (not isAdmin(caller, club)) return #Err("Club admin required");
    #Ok(removedMembers.filter(func(m) = m.club == club))
  };

  public query func is_member_removed(club : Text, user : Principal) : async Bool {
    removedMembers.any(func(m) = m.club == club and m.user.equal(user))
  };

  public shared ({ caller }) func request_role(club : Text, role : Text, team : ?Text) : async { #Ok : Types.RoleRequest; #Err : Text } {
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
  };

  public query ({ caller }) func list_role_requests(club : Text) : async { #Ok : [Types.RoleRequest]; #Err : Text } {
    if (not isAdmin(caller, club)) return #Err("Club admin required");
    #Ok(roleRequests.filter(func(r) = r.club == club))
  };

  public shared ({ caller }) func approve_role_request(id : Text) : async { #Ok : Types.RoleRequest; #Err : Text } {
    auth(caller);
    switch (roleRequests.find(func(r) = r.id == id)) {
      case null { #Err("Request not found") };
      case (?req) {
        if (not isAdmin(caller, req.club)) return #Err("Club admin required");
        if (req.status != "pending") return #Err("Request already processed");
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
  };

  public shared ({ caller }) func reject_role_request(id : Text) : async { #Ok : Types.RoleRequest; #Err : Text } {
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
  };

  // ---- Team/club soft-delete, restore, and permanent delete ----

  public shared ({ caller }) func soft_delete_team(id : Text) : async { #Ok : Types.ClubTeam; #Err : Text } {
    auth(caller);
    switch (teams.find(func(t) = t.id == id)) {
      case null { #Err("Team not found") };
      case (?team) {
        if (not isAdmin(caller, team.club_id)) return #Err("Club admin required");
        let updated : Types.ClubTeam = { team with deleted_at_ms = ?nowMs() };
        teams := teams.map(func(t) = if (t.id == id) updated else t);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func restore_team(id : Text) : async { #Ok : Types.ClubTeam; #Err : Text } {
    auth(caller);
    switch (teams.find(func(t) = t.id == id)) {
      case null { #Err("Team not found") };
      case (?team) {
        if (not isAdmin(caller, team.club_id)) return #Err("Club admin required");
        let updated : Types.ClubTeam = { team with deleted_at_ms = null };
        teams := teams.map(func(t) = if (t.id == id) updated else t);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func delete_team_permanent(id : Text) : async { #Ok; #Err : Text } {
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
  };

  // cascade_teams mirrors the Supabase `cascade_club_soft_delete` RPC:
  // soft-deleting a club also soft-deletes every team still active under
  // it, so browse/roster surfaces stop listing them consistently with the
  // club. Teams already soft-deleted independently are left untouched
  // (their own deleted_at_ms is preserved rather than overwritten).
  public shared ({ caller }) func soft_delete_club(id : Text, cascade_teams : Bool) : async { #Ok : Types.ClubProfile; #Err : Text } {
    auth(caller);
    if (not isAdmin(caller, id)) return #Err("Club admin required");
    switch (profiles.find(func(p) = p.id == id)) {
      case null { #Err("Club not found") };
      case (?club) {
        let now = nowMs();
        let updated : Types.ClubProfile = { club with deleted_at_ms = ?now };
        profiles := profiles.map(func(p) = if (p.id == id) updated else p);
        if (cascade_teams) {
          teams := teams.map(func(t) = if (t.club_id == id and t.deleted_at_ms == null) ({ t with deleted_at_ms = ?now }) else t);
        };
        #Ok(updated)
      };
    }
  };

  // cascade_teams mirrors `cascade_team_soft_delete` in reverse: restoring
  // a club can optionally restore every team that was soft-deleted at (or
  // after) the club's own deletion — an approximation of "deleted together
  // with the club" since the canister does not track a cascade batch id.
  public shared ({ caller }) func restore_club(id : Text, cascade_teams : Bool) : async { #Ok : Types.ClubProfile; #Err : Text } {
    auth(caller);
    if (not isAdmin(caller, id)) return #Err("Club admin required");
    switch (profiles.find(func(p) = p.id == id)) {
      case null { #Err("Club not found") };
      case (?club) {
        let deletedAt = club.deleted_at_ms;
        let updated : Types.ClubProfile = { club with deleted_at_ms = null };
        profiles := profiles.map(func(p) = if (p.id == id) updated else p);
        if (cascade_teams) {
          switch (deletedAt) {
            case (?ts) {
              teams := teams.map(func(t) = if (t.club_id == id and t.deleted_at_ms == ?ts) ({ t with deleted_at_ms = null }) else t);
            };
            case null {};
          };
        };
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func delete_club_permanent(id : Text) : async { #Ok; #Err : Text } {
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
  };

  // ---- Team invites (email delivery stays with Supabase; this stores the
  // invite record and its accept/revoke state) ----

  public shared ({ caller }) func create_team_invite(club_id : Text, team_id : Text, email : Text, role : Text) : async { #Ok : Types.TeamInvite; #Err : Text } {
    auth(caller);
    if (not canManageTeam(caller, club_id, ?team_id)) return #Err("Team or club admin required");
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
  };

  public query ({ caller }) func list_team_invites(club_id : Text, team_id : ?Text) : async { #Ok : [Types.TeamInvite]; #Err : Text } {
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    #Ok(teamInvites.filter(func(i) = i.club_id == club_id and (team_id == null or team_id == ?i.team_id)))
  };

  public query ({ caller }) func get_team_invite(id : Text) : async { #Ok : Types.TeamInvite; #Err : Text } {
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
    auth(caller);
    switch (teamInvites.find(func(i) = i.id == id)) {
      case null { #Err("Invite not found") };
      case (?invite) {
        if (invite.revoked) return #Err("Invite revoked");
        if (invite.accepted_by != null) return #Err("Invite already accepted");
        if (invite.expires_at_ms <= nowMs()) return #Err("Invite expired");
        if (isExcluded(caller, invite.club_id)) return #Err("Forbidden");
        acl := { acl with roles = acl.roles.concat([{ user = caller; role = invite.role; club = ?invite.club_id; team = ?invite.team_id }]) };
        accountRoles := accountRoles.concat([{ account_id = accountIdFor(caller); club = ?invite.club_id; role = invite.role; team = ?invite.team_id }]);
        let accepted : Types.TeamInvite = { invite with accepted_by = ?caller };
        teamInvites := teamInvites.map(func(i) = if (i.id == id) accepted else i);
        #Ok(accepted)
      };
    }
  };

  public shared ({ caller }) func revoke_team_invite(id : Text) : async { #Ok; #Err : Text } {
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
  };

  // ---- Shell teams: a club admin pre-creates a team for a coach/manager
  // who has not signed up yet, mints a claim token, and the invited
  // person redeems it via `claim_shell_team` — the canister equivalent of
  // the Supabase `teams.shell_*` columns and `claim_shell_team` RPC. ----

  public shared ({ caller }) func create_shell_team_invite(club_id : Text, name : Text, contact_email : ?Text, contact_name : ?Text) : async { #Ok : Types.ClubTeam; #Err : Text } {
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
    teams := teams.concat([team]);
    #Ok(team)
  };

  public query ({ caller }) func get_shell_team_by_token(token : Text) : async { #Ok : Types.ClubTeam; #Err : Text } {
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
    auth(caller);
    switch (teams.find(func(t) = t.shell_claim_token == ?token)) {
      case null { #Err("Shell invite not found") };
      case (?team) {
        if (team.shell_claimed_by != null) return #Err("Shell team already claimed");
        if (team.deleted_at_ms != null) return #Err("Team no longer available");
        let updated : Types.ClubTeam = { team with shell_claimed_at_ms = ?nowMs(); shell_claimed_by = ?caller };
        teams := teams.map(func(t) = if (t.id == team.id) updated else t);
        acl := { acl with roles = acl.roles.concat([{ user = caller; role = "team_admin"; club = ?team.club_id; team = ?team.id }]) };
        accountRoles := accountRoles.concat([{ account_id = accountIdFor(caller); club = ?team.club_id; role = "team_admin"; team = ?team.id }]);
        #Ok(updated)
      };
    }
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
    auth(caller);
    if (not canManageTeam(caller, club_id, ?team_id)) return #Err("Team or club admin required");
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
  };

  public shared ({ caller }) func rotate_team_invite_link(id : Text) : async { #Ok : Types.TeamInviteLink; #Err : Text } {
    auth(caller);
    switch (teamInviteLinks.find(func(l) = l.id == id)) {
      case null { #Err("Invite link not found") };
      case (?link) {
        if (not canManageTeam(caller, link.club_id, ?link.team_id)) return #Err("Team or club admin required");
        let updated : Types.TeamInviteLink = { link with token = await genToken("tok"); rotated_at_ms = ?nowMs() };
        teamInviteLinks := teamInviteLinks.map(func(l) = if (l.id == id) updated else l);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func revoke_team_invite_link(id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (teamInviteLinks.find(func(l) = l.id == id)) {
      case null { #Err("Invite link not found") };
      case (?link) {
        if (not canManageTeam(caller, link.club_id, ?link.team_id)) return #Err("Team or club admin required");
        let updated : Types.TeamInviteLink = { link with revoked = true };
        teamInviteLinks := teamInviteLinks.map(func(l) = if (l.id == id) updated else l);
        #Ok
      };
    }
  };

  public query ({ caller }) func get_team_invite_link_by_token(token : Text) : async { #Ok : Types.TeamInviteLink; #Err : Text } {
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
    auth(caller);
    switch (teamInviteLinks.find(func(l) = l.token == token)) {
      case null { #Err("Invite link not found") };
      case (?link) {
        if (link.revoked) return #Err("Invite link revoked");
        if (isExcluded(caller, link.club_id)) return #Err("Forbidden");
        if (not acl.roles.any(func(g) = g.user.equal(caller) and g.role == link.role and g.club == ?link.club_id and g.team == ?link.team_id)) {
          let grant : Types.RoleGrant = { user = caller; role = link.role; club = ?link.club_id; team = ?link.team_id };
          acl := { acl with roles = acl.roles.concat([grant]) };
        };
        #Ok(link)
      };
    }
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
    auth(caller);
    if (kind != "team" and kind != "club" and kind != "guardian") return #Err("Invalid invite kind");
    if (email == "" or email.size() > 320) return #Err("Invalid email");
    switch (team_id) {
      case (?team) { if (not canManageTeam(caller, club_id, ?team)) return #Err("Team or club admin required") };
      case null { if (not isAdmin(caller, club_id)) return #Err("Club admin required") };
    };
    let now = nowMs();
    let invite : Types.PendingInvite = {
      id = "pinv-" # (await randomHex(16));
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
  };

  public query ({ caller }) func list_pending_invites_by_club(club_id : Text) : async { #Ok : [Types.PendingInvite]; #Err : Text } {
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    #Ok(pendingInvites.filter(func(i) = i.club_id == club_id))
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
  };

  public shared ({ caller }) func revoke_pending_invite(id : Text) : async { #Ok; #Err : Text } {
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
  };

  // Self-accept: the invited principal redeems a PendingInvite directly
  // (no admin-issued share token flow like ParentInvite — PendingInvite
  // kind "team"/"club"/"guardian" is looked up by id). Grants the role
  // (team/club scoped per the invite), and for "guardian" invites also
  // links the guardian/child the same way accept_parent_invite does.
  public shared ({ caller }) func accept_pending_invite(id : Text) : async { #Ok : Types.PendingInvite; #Err : Text } {
    auth(caller);
    switch (pendingInvites.find(func(i) = i.id == id)) {
      case null { #Err("Invite not found") };
      case (?invite) {
        if (invite.status == "accepted") return #Err("Invite already accepted");
        if (invite.status == "revoked") return #Err("Invite revoked");
        if (isExcluded(caller, invite.club_id)) return #Err("Forbidden");
        if (invite.kind == "guardian") {
          switch (invite.child_id) {
            case (?childId) {
              switch (invite.team_id) {
                case (?team) {
                  switch (acl.children.find(func(c) = c.id == childId)) {
                    case null {
                      let child : Types.Child = { id = childId; teams = [team]; parent = null; club_id = ?invite.club_id };
                      acl := { acl with children = acl.children.concat([child]) };
                    };
                    case (?child) {
                      if (not child.teams.any(func(t) = t == team)) {
                        let updatedChild : Types.Child = { child with teams = child.teams.concat([team]) };
                        acl := { acl with children = acl.children.map(func(c) = if (c.id == childId) updatedChild else c) };
                      };
                    };
                  };
                };
                case null {};
              };
              if (not acl.guardians.any(func(g) = g.child == childId and g.user.equal(caller))) {
                acl := { acl with guardians = acl.guardians.concat([{ child = childId; user = caller }]) };
              };
              switch (accountFor(caller)) {
                case (?account) {
                  if (not accountFamilies.any(func(fam) = fam.account_id == account.id and fam.child_id == childId)) {
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
    auth(caller);
    if (not canManageChild(caller, child_id)) return #Err("Club admin required");
    if (not acl.guardians.any(func(g) = g.child == child_id and g.user.equal(user))) {
      acl := { acl with guardians = acl.guardians.concat([{ child = child_id; user }]) };
    };
    #Ok
  };

  public shared ({ caller }) func unlink_guardian(child_id : Text, user : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not (canManageChild(caller, child_id) or caller.equal(user))) return #Err("Forbidden");
    acl := { acl with guardians = acl.guardians.filter(func(g) = not (g.child == child_id and g.user.equal(user))) };
    #Ok
  };

  public shared ({ caller }) func admin_link_child_to_parent(child_id : Text, parent : Principal) : async { #Ok : Types.Child; #Err : Text } {
    auth(caller);
    if (not canManageChild(caller, child_id)) return #Err("Club admin required");
    switch (acl.children.find(func(c) = c.id == child_id)) {
      case null { #Err("Child not found") };
      case (?child) {
        let updated : Types.Child = { child with parent = ?parent };
        acl := { acl with children = acl.children.map(func(c) = if (c.id == child_id) updated else c) };
        if (not acl.guardians.any(func(g) = g.child == child_id and g.user.equal(parent))) {
          acl := { acl with guardians = acl.guardians.concat([{ child = child_id; user = parent }]) };
        };
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func create_child_for_parent_on_team(club_id : Text, team_id : Text, parent : Principal) : async { #Ok : Types.Child; #Err : Text } {
    auth(caller);
    if (not canManageTeam(caller, club_id, ?team_id)) return #Err("Team or club admin required");
    if (not acl.teams.any(func(t) = t.id == team_id and t.club == club_id)) return #Err("Team not found in club");
    let child : Types.Child = {
      id = "child-" # club_id # "-" # Nat.toText(acl.children.size() + 1) # "-" # Nat64.toText(nowNs() % 1_000_000_000);
      teams = [team_id];
      parent = ?parent;
      club_id = ?club_id;
    };
    acl := { acl with children = acl.children.concat([child]) };
    acl := { acl with guardians = acl.guardians.concat([{ child = child.id; user = parent }]) };
    #Ok(child)
  };

  // Mini-league-scope link: a club admin can create a child record scoped
  // only to the club (no team assignment yet), mirroring
  // create_child_for_parent_on_team but without requiring a team id.
  public shared ({ caller }) func create_child_for_parent_in_club(club_id : Text, parent : Principal) : async { #Ok : Types.Child; #Err : Text } {
    auth(caller);
    if (not (isAdmin(caller, club_id) or isGovernor(caller))) return #Err("Club admin required");
    if (not acl.clubs.any(func(c) = c == club_id)) return #Err("Club not found");
    let child : Types.Child = {
      id = "child-" # club_id # "-" # Nat.toText(acl.children.size() + 1) # "-" # Nat64.toText(nowNs() % 1_000_000_000);
      teams = [];
      parent = ?parent;
      club_id = ?club_id;
    };
    acl := { acl with children = acl.children.concat([child]) };
    acl := { acl with guardians = acl.guardians.concat([{ child = child.id; user = parent }]) };
    #Ok(child)
  };

  // ---- Move member / child between teams ----

  public shared ({ caller }) func move_member_to_team(club_id : Text, user : Principal, from_team : ?Text, to_team : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    if (not acl.teams.any(func(t) = t.id == to_team and t.club == club_id)) return #Err("Target team not found in club");
    acl := { acl with roles = acl.roles.map(func(g) = if (g.user.equal(user) and g.club == ?club_id and g.team == from_team) ({ g with team = ?to_team }) else g) };
    accountRoles := accountRoles.map(func(g) = if (g.account_id == accountIdFor(user) and g.club == ?club_id and g.team == from_team) ({ g with team = ?to_team }) else g);
    #Ok
  };

  public shared ({ caller }) func move_child_to_team(child_id : Text, from_team : ?Text, to_team : Text) : async { #Ok : Types.Child; #Err : Text } {
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
            acl := { acl with children = acl.children.map(func(c) = if (c.id == child_id) updated else c) };
            #Ok(updated)
          };
        }
      };
    }
  };

  // ---- Bulk team-member add ----

  public shared ({ caller }) func bulk_add_team_members(club_id : Text, team_id : Text, role : Text, users : [Principal]) : async { #Ok : Nat; #Err : Text } {
    auth(caller);
    if (not canManageTeam(caller, club_id, ?team_id)) return #Err("Team or club admin required");
    if (role == "") return #Err("Invalid role");
    if (users.size() > 200) return #Err("Too many members");
    for (user in users.values()) {
      acl := { acl with roles = acl.roles.concat([{ user; role; club = ?club_id; team = ?team_id }]) };
      accountRoles := accountRoles.concat([{ account_id = accountIdFor(user); club = ?club_id; role; team = ?team_id }]);
    };
    ignore fanOutEnsureConversation(club_id, null, clubChatParticipants(club_id));
    ignore fanOutEnsureConversation(club_id, ?team_id, teamChatParticipants(club_id, team_id));
    #Ok(users.size())
  };

  // ---- Team archive ----

  public shared ({ caller }) func archive_team(id : Text) : async { #Ok : Types.ClubTeam; #Err : Text } {
    auth(caller);
    switch (teams.find(func(t) = t.id == id)) {
      case null { #Err("Team not found") };
      case (?team) {
        if (not isAdmin(caller, team.club_id)) return #Err("Club admin required");
        let updated : Types.ClubTeam = { team with archived = true };
        teams := teams.map(func(t) = if (t.id == id) updated else t);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func unarchive_team(id : Text) : async { #Ok : Types.ClubTeam; #Err : Text } {
    auth(caller);
    switch (teams.find(func(t) = t.id == id)) {
      case null { #Err("Team not found") };
      case (?team) {
        if (not isAdmin(caller, team.club_id)) return #Err("Club admin required");
        let updated : Types.ClubTeam = { team with archived = false };
        teams := teams.map(func(t) = if (t.id == id) updated else t);
        #Ok(updated)
      };
    }
  };

  // ---- Team-creation requests ----

  public shared ({ caller }) func request_team_creation(club_id : Text, name : Text, division : ?Text, age_group : ?Text) : async { #Ok : Types.TeamCreationRequest; #Err : Text } {
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
  };

  public query ({ caller }) func list_team_creation_requests(club_id : Text) : async { #Ok : [Types.TeamCreationRequest]; #Err : Text } {
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    #Ok(teamCreationRequests.filter(func(r) = r.club_id == club_id))
  };

  public shared ({ caller }) func approve_team_creation_request(id : Text) : async { #Ok : Types.TeamCreationRequest; #Err : Text } {
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
        teams := teams.concat([team]);
        let updated : Types.TeamCreationRequest = { req with status = "approved"; decided_at_ms = ?now; decided_by = ?caller; team_id = ?team.id };
        teamCreationRequests := teamCreationRequests.map(func(r) = if (r.id == id) updated else r);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func reject_team_creation_request(id : Text) : async { #Ok : Types.TeamCreationRequest; #Err : Text } {
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
  };

  // ---- Team player positions ----

  public query ({ caller }) func get_team_player_positions(team_id : Text) : async { #Ok : [Types.TeamPlayerPosition]; #Err : Text } {
    switch (acl.teams.find(func(t) = t.id == team_id)) {
      case null { #Err("Team not found") };
      case (?team) {
        if (not isMember(caller, team.club)) return #Err("Forbidden");
        #Ok(teamPlayerPositions.filter(func(p) = p.team_id == team_id))
      };
    }
  };

  public shared ({ caller }) func set_team_player_position(team_id : Text, member_id : Text, position : Text) : async { #Ok; #Err : Text } {
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
  };

  // ---- Team captains ----

  public shared ({ caller }) func add_team_captain(club_id : Text, team_id : Text, user : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not canManageTeam(caller, club_id, ?team_id)) return #Err("Team or club admin required");
    if (not teamCaptains.any(func(c) = c.team_id == team_id and c.user.equal(user))) {
      teamCaptains := teamCaptains.concat([{ team_id; user }]);
    };
    #Ok
  };

  public shared ({ caller }) func remove_team_captain(club_id : Text, team_id : Text, user : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not canManageTeam(caller, club_id, ?team_id)) return #Err("Team or club admin required");
    teamCaptains := teamCaptains.filter(func(c) = not (c.team_id == team_id and c.user.equal(user)));
    #Ok
  };

  public query ({ caller }) func list_team_captains(team_id : Text) : async { #Ok : [Types.TeamCaptain]; #Err : Text } {
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
    auth(caller);
    if (id == "" or id.size() > 128) return #Err("Invalid club id");
    if (name == "" or name.size() > 160) return #Err("Invalid club name");
    if (profiles.any(func(p) = p.id == id)) return #Err("Club already exists");
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
    profiles := profiles.concat([profile]);
    acl := { acl with roles = acl.roles.concat([{ user = caller; role = "club_admin"; club = ?id; team = null }]) };
    accountRoles := accountRoles.concat([{ account_id = accountIdFor(caller); club = ?id; role = "club_admin"; team = null }]);
    // Provision the club chat on the messaging canister (best-effort).
    ignore fanOutEnsureConversation(id, null, [caller]);
    #Ok(profile)
  };

  public shared ({ caller }) func request_club_join(club_id : Text) : async { #Ok : Types.ClubJoinRequest; #Err : Text } {
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
  };

  public query ({ caller }) func list_club_join_requests(club_id : Text) : async { #Ok : [Types.ClubJoinRequest]; #Err : Text } {
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    #Ok(clubJoinRequests.filter(func(r) = r.club_id == club_id))
  };

  public shared ({ caller }) func approve_club_join_request(id : Text) : async { #Ok : Types.ClubJoinRequest; #Err : Text } {
    auth(caller);
    switch (clubJoinRequests.find(func(r) = r.id == id)) {
      case null { #Err("Request not found") };
      case (?req) {
        if (not isAdmin(caller, req.club_id)) return #Err("Club admin required");
        if (req.status != "pending") return #Err("Request already processed");
        acl := { acl with roles = acl.roles.concat([{ user = req.user; role = "member"; club = ?req.club_id; team = null }]) };
        accountRoles := accountRoles.concat([{ account_id = accountIdFor(req.user); club = ?req.club_id; role = "member"; team = null }]);
        ignore fanOutEnsureConversation(req.club_id, null, clubChatParticipants(req.club_id));
        let updated : Types.ClubJoinRequest = { req with status = "approved"; decided_at_ms = ?nowMs(); decided_by = ?caller };
        clubJoinRequests := clubJoinRequests.map(func(r) = if (r.id == id) updated else r);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func reject_club_join_request(id : Text) : async { #Ok : Types.ClubJoinRequest; #Err : Text } {
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
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    let updated : Types.ClubSettings = {
      currentSettingsFor(club_id) with
      theme_primary_color = primary; theme_secondary_color = secondary; theme_accent_color = accent;
      theme_dark_primary_color = dark_primary; theme_dark_secondary_color = dark_secondary; theme_dark_accent_color = dark_accent;
    };
    putSettings(updated);
    #Ok(updated)
  };

  public shared ({ caller }) func set_club_theme_enabled(club_id : Text, enabled : Bool) : async { #Ok : Types.ClubSettings; #Err : Text } {
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    let updated : Types.ClubSettings = { currentSettingsFor(club_id) with theme_enabled = enabled };
    putSettings(updated);
    #Ok(updated)
  };

  public shared ({ caller }) func set_club_logo_only_mode(club_id : Text, enabled : Bool) : async { #Ok : Types.ClubSettings; #Err : Text } {
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    let updated : Types.ClubSettings = { currentSettingsFor(club_id) with logo_only_mode = enabled };
    putSettings(updated);
    #Ok(updated)
  };

  public shared ({ caller }) func clear_club_theme(club_id : Text) : async { #Ok : Types.ClubSettings; #Err : Text } {
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    let updated : Types.ClubSettings = {
      currentSettingsFor(club_id) with
      theme_primary_color = null; theme_secondary_color = null; theme_accent_color = null;
      theme_dark_primary_color = null; theme_dark_secondary_color = null; theme_dark_accent_color = null;
    };
    putSettings(updated);
    #Ok(updated)
  };

  public shared ({ caller }) func set_club_header_toggles(club_id : Text, header_logo_enabled : Bool, header_club_name_enabled : Bool) : async { #Ok : Types.ClubSettings; #Err : Text } {
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    let updated : Types.ClubSettings = { currentSettingsFor(club_id) with header_logo_enabled; header_club_name_enabled };
    putSettings(updated);
    #Ok(updated)
  };

  public shared ({ caller }) func set_club_invite_email_style(club_id : Text, style : ?Text) : async { #Ok : Types.ClubSettings; #Err : Text } {
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    let updated : Types.ClubSettings = { currentSettingsFor(club_id) with invite_email_style = style };
    putSettings(updated);
    #Ok(updated)
  };

  public shared ({ caller }) func set_club_switcher_hint(club_id : Text, hint : ?Text) : async { #Ok : Types.ClubSettings; #Err : Text } {
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    let updated : Types.ClubSettings = { currentSettingsFor(club_id) with club_switcher_hint = hint };
    putSettings(updated);
    #Ok(updated)
  };

  // ---- Per-user theme preference (light/dark/system or a club theme id).
  // Lives here rather than identity_access since it is club-switcher UI
  // state, closest to the club settings this canister already owns. ----

  public shared ({ caller }) func set_theme_preference(preference : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    themePrefs := themePrefs.filter(func(entry) = not entry.0.equal(caller));
    themePrefs := themePrefs.concat([(caller, preference)]);
    #Ok
  };

  public query ({ caller }) func get_my_theme_preference() : async { #Ok : ?Text; #Err : Text } {
    auth(caller);
    switch (themePrefs.find(func(entry) = entry.0.equal(caller))) {
      case (?entry) #Ok(?entry.1);
      case null #Ok(null);
    }
  };

  // ---- Club branding + PlayHQ config (Phase 2 of the NEEDS-CANISTER
  // completion plan). Branding is a compact read combining the club
  // profile's name/logo with the settings contact email — the invite and
  // admin surfaces only need these three fields. ----

  public query ({ caller }) func get_club_branding(club_id : Text) : async { #Ok : Types.ClubBranding; #Err : Text } {
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
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    #Ok(clubTerms.filter(func(t) = t.club_id == club_id))
  };

  public shared ({ caller }) func save_club_term(term : Types.ClubTerm) : async { #Ok : Types.ClubTerm; #Err : Text } {
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
  };

  public shared ({ caller }) func set_club_term_status(id : Text, status : Text) : async { #Ok : Types.ClubTerm; #Err : Text } {
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
  };

  public shared ({ caller }) func delete_club_term(id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (clubTerms.find(func(t) = t.id == id)) {
      case null { #Err("Term not found") };
      case (?current) {
        if (not isAdmin(caller, current.club_id)) return #Err("Club admin required");
        clubTerms := clubTerms.filter(func(t) = t.id != id);
        #Ok
      };
    }
  };

  // ---- Seasons (draft|active|closed|archived) — distinct from ClubTerm.
  // save_season creates when id is "", else updates in place. get_current_season
  // returns the first season with status "active" for the club. ----

  func validSeasonStatus(status : Text) : Bool {
    status == "draft" or status == "active" or status == "closed" or status == "archived"
  };

  public query ({ caller }) func list_seasons(club_id : Text) : async { #Ok : [Types.Season]; #Err : Text } {
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    #Ok(seasons.filter(func(s) = s.club_id == club_id))
  };

  public query ({ caller }) func get_current_season(club_id : Text) : async { #Ok : ?Types.Season; #Err : Text } {
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    #Ok(seasons.find(func(s) = s.club_id == club_id and s.status == "active"))
  };

  public shared ({ caller }) func save_season(season : Types.Season) : async { #Ok : Types.Season; #Err : Text } {
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
  };

  // ---- Season analytics — canister counterpart of the Supabase
  // season_team_summary / season_player_stats RPCs. club_domain has no
  // events/attendance data model to derive these from, so values are
  // precomputed and kept fresh via admin-gated upsert calls, keyed by
  // (season_id, team_id) and (season_id, team_id, club_player_id). ----

  public query ({ caller }) func list_season_team_summary(season_id : Text) : async { #Ok : [Types.SeasonTeamSummary]; #Err : Text } {
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
    auth(caller);
    if (not isAdmin(caller, entry.club_id)) return #Err("Club admin required");
    let stored : Types.SeasonTeamSummary = { entry with updated_at_ms = nowMs() };
    seasonTeamSummaries := seasonTeamSummaries.filter(func(r) = not (r.season_id == stored.season_id and r.team_id == stored.team_id)).concat([stored]);
    #Ok(stored);
  };

  public shared ({ caller }) func save_season_player_stat(entry : Types.SeasonPlayerStat) : async { #Ok : Types.SeasonPlayerStat; #Err : Text } {
    auth(caller);
    if (not isAdmin(caller, entry.club_id)) return #Err("Club admin required");
    let stored : Types.SeasonPlayerStat = { entry with updated_at_ms = nowMs() };
    seasonPlayerStats := seasonPlayerStats.filter(func(r) = not (r.season_id == stored.season_id and r.team_id == stored.team_id and r.club_player_id == stored.club_player_id)).concat([stored]);
    #Ok(stored);
  };

  // ---- profile_team_history: join accountRoles (team-scoped grants) with
  // teams/profiles/seasons for a given profile (account) id. membership_id is
  // synthesized as account_id#team_id since accountRoles has no own id.
  // joined_at_ms is 0 when no membership timestamp exists. ----
  public query ({ caller }) func profile_team_history(profile_id : Text) : async [Types.ProfileTeamHistoryEntry] {
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
    auth(caller);
    let scoped = memberPayments.filter(func(p) = p.club_id == club_id and p.payment_period == payment_period and p.payment_type == payment_type);
    if (isAdmin(caller, club_id)) return #Ok(scoped);
    let callerId = Principal.toText(caller);
    #Ok(scoped.filter(func(p) = p.user_id == callerId))
  };

  public shared ({ caller }) func mark_member_paid(club_id : Text, user_id : Text, child_id : ?Text, payment_period : Text, payment_type : Text, amount : Float, notes : ?Text) : async { #Ok : Types.MemberPayment; #Err : Text } {
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
  };

  public shared ({ caller }) func unmark_member_paid(id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (memberPayments.find(func(p) = p.id == id)) {
      case null { #Err("Payment not found") };
      case (?current) {
        if (not isAdmin(caller, current.club_id)) return #Err("Club admin required");
        memberPayments := memberPayments.filter(func(p) = p.id != id);
        #Ok
      };
    }
  };


  // ---- Notification queue wiring + fee-reminder fan-out (Phase 3, F6) ----
  public shared ({ caller }) func set_notification_queue_canister(id : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (id.equal(Principal.anonymous())) return #Err("Invalid canister id");
    notificationQueueCanister := ?id;
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
    teams := teams.filter(func(t) = t.id != teamId);
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
    func isClubTeam(teamId : Text) : Bool { clubTeamIds.any(func(t) = t == teamId) };
    profiles := profiles.filter(func(p) = p.id != id);
    settings := settings.filter(func(s) = s.club_id != id);
    teams := teams.filter(func(t) = t.club_id != id);
    teamFolders := teamFolders.filter(func(f) = f.club_id != id);
    sponsors := sponsors.filter(func(s) = s.club_id != id);
    clubListings := clubListings.filter(func(e) = e.0 != id);
    frozenClubs := frozenClubs.filter(func(e) = e.0 != id);
    acl := {
      teams = acl.teams.filter(func(t) = t.club != id);
      guardians = acl.guardians;
      clubs = acl.clubs.filter(func(c) = c != id);
      children = acl.children;
      exclusions = acl.exclusions.filter(func(e) = e.club != id);
      roles = acl.roles.filter(func(r) = r.club != ?id and (switch (r.team) { case (?t) { not isClubTeam(t) }; case null { true } }));
    };
    accountRoles := accountRoles.filter(func(r) = r.club != ?id and (switch (r.team) { case (?t) { not isClubTeam(t) }; case null { true } }));
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
    auth(caller);
    if (not isMember(caller, club_id)) return #Err("Club membership required");
    if (messagingDomainCanister == null) return #Err("Messaging domain not configured");
    #Ok(await fanOutEnsureClubConversations(club_id))
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

  public shared ({ caller }) func save_club_subscription(item : Types.ClubSubscription) : async { #Ok : Types.ClubSubscription; #Err : Text } {
    auth(caller);
    if (not (isGovernor(caller) or isAppAdmin(caller))) return #Err("Platform admin required");
    clubSubscriptions := clubSubscriptions.filter(func(s) = s.club_id != item.club_id);
    clubSubscriptions := clubSubscriptions.concat([item]);
    #Ok(item)
  };

  // ---- Team subscription status (team_subscriptions parity) ----
  // Same trust model as club subscriptions: reads are member-visible (Pro
  // gates render for every member); Pro-flag writes are platform-only
  // (governor or app_admin) so a team cannot grant itself Pro. Pitch-board
  // settings are team-admin writable through save_team_pitch_settings,
  // which merges into the existing row and never touches the Pro flags.
  public query func get_team_subscription(team_id : Text) : async { #Ok : ?Types.TeamSubscription; #Err : Text } {
    for (s in teamSubscriptions.values()) {
      if (s.team_id == team_id) return #Ok(?s);
    };
    #Ok(null)
  };

  public shared ({ caller }) func save_team_subscription(item : Types.TeamSubscription) : async { #Ok : Types.TeamSubscription; #Err : Text } {
    auth(caller);
    if (not (isGovernor(caller) or isAppAdmin(caller))) return #Err("Platform admin required");
    teamSubscriptions := teamSubscriptions.filter(func(s) = s.team_id != item.team_id);
    teamSubscriptions := teamSubscriptions.concat([item]);
    #Ok(item)
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
    auth(caller);
    if (not (isGovernor(caller) or isAppAdmin(caller))) return #Err("Only governor or app admin can set app config");
    if (key.size() == 0 or key.size() > 128) return #Err("Key must be 1-128 chars");
    if (value.size() > 65_536) return #Err("Value must be at most 64KiB");
    if (appConfig.size() >= 64 and appConfig.find(func((k, _)) = k == key) == null) return #Err("At most 64 app config keys");
    appConfig := appConfig.filter(func((k, _)) = k != key).concat([(key, value)]);
    #Ok
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
}
