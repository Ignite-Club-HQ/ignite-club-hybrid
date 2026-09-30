import Array "mo:core/Array";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Nat16 "mo:core/Nat16";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "types";

persistent actor {
  transient let challengeTtlNs : Nat64 = 600_000_000_000;

  var governor : Principal;
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

  public shared ({ caller }) func initialize() : async { #Ok; #Err : Text } {
    auth(caller);
    if (not governor.equal(Principal.anonymous())) return #Err("Already initialized");
    governor := caller;
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
    teams := teams.filter(func(t) = t.id != team.id);
    teams := teams.concat([team]);
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

  // Hard delete — the Supabase sponsor manager deletes rows outright, so
  // the canister matches (is_active remains available for soft hiding).
  public shared ({ caller }) func delete_sponsor(id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (sponsors.find(func(s) = s.id == id)) {
      case null { #Err("Sponsor not found") };
      case (?sponsor) {
        if (not isAdmin(caller, sponsor.club_id)) return #Err("Club admin required");
        sponsors := sponsors.filter(func(s) = s.id != id);
        #Ok
      };
    }
  };

  func validNewsStatus(status : Text) : Bool { status == "draft" or status == "published" };

  public shared ({ caller }) func create_news_post(club_id : Text, title : Text, body : Text, status : Text) : async { #Ok : Types.NewsPost; #Err : Text } {
    auth(caller);
    if (not isAdmin(caller, club_id)) return #Err("Club admin required");
    if (club_id == "" or club_id.size() > 128) return #Err("Invalid club");
    if (title == "" or title.size() > 200) return #Err("Invalid title");
    if (body.size() > 8000) return #Err("Invalid body");
    if (not validNewsStatus(status)) return #Err("Invalid status");
    let now = nowMs();
    let post : Types.NewsPost = {
      id = "news-" # club_id # "-" # Nat.toText(newsPosts.size() + 1);
      club_id; title; body; status;
      created_by = caller;
      created_at_ms = now;
      updated_at_ms = now;
      revision = 1;
    };
    newsPosts := newsPosts.concat([post]);
    #Ok(post)
  };

  public shared ({ caller }) func update_news_post(id : Text, title : Text, body : Text, status : Text, expected_revision : Nat64) : async { #Ok : Types.NewsPost; #Err : Text } {
    auth(caller);
    if (title == "" or title.size() > 200) return #Err("Invalid title");
    if (body.size() > 8000) return #Err("Invalid body");
    if (not validNewsStatus(status)) return #Err("Invalid status");
    switch (newsPosts.find(func(p) = p.id == id)) {
      case null { #Err("News post not found") };
      case (?current) {
        if (not isAdmin(caller, current.club_id)) return #Err("Club admin required");
        if (current.revision != expected_revision) return #Err("News post revision conflict");
        let updated : Types.NewsPost = { current with title; body; status; updated_at_ms = nowMs(); revision = current.revision + 1 };
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

  // Admins see every post (including drafts); members see published only.
  public query ({ caller }) func list_news(club_id : Text) : async { #Ok : [Types.NewsPost]; #Err : Text } {
    if (isAdmin(caller, club_id)) {
      #Ok(newsPosts.filter(func(p) = p.club_id == club_id))
    } else {
      if (not isMember(caller, club_id)) return #Err("Forbidden");
      #Ok(newsPosts.filter(func(p) = p.club_id == club_id and p.status == "published"))
    }
  };

  // Cross-club feed: published posts from the clubs the caller belongs to.
  // Clubs the caller is not a member of are silently skipped.
  public query ({ caller }) func list_news_multi(club_ids : [Text]) : async { #Ok : [Types.NewsPost]; #Err : Text } {
    auth(caller);
    if (club_ids.size() > 50) return #Err("Too many clubs");
    let visible = club_ids.filter(func(club) = isMember(caller, club) or isAdmin(caller, club));
    #Ok(newsPosts.filter(func(p) =
      visible.any(func(club) = club == p.club_id) and
      (p.status == "published" or isAdmin(caller, p.club_id))))
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
                let child : Types.Child = { id = invite.child_id; teams = [team]; parent = null };
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

  // Removes every role a member holds in a club (club-level roles only,
  // not global roles), the canister equivalent of the "remove member"
  // action on ClubDetailPage/TeamDetailPage.
  public shared ({ caller }) func remove_member(club : Text, user : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isAdmin(caller, club)) return #Err("Club admin required");
    acl := { acl with roles = acl.roles.filter(func(g) = not (g.user.equal(user) and g.club == ?club)) };
    let accountId = accountIdFor(user);
    accountRoles := accountRoles.filter(func(g) = not (g.account_id == accountId and g.club == ?club));
    #Ok
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
        teams := teams.filter(func(t) = t.id != id);
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
        profiles := profiles.filter(func(p) = p.id != id);
        settings := settings.filter(func(s) = s.club_id != id);
        teams := teams.filter(func(t) = t.club_id != id);
        sponsors := sponsors.filter(func(s) = s.club_id != id);
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
      is_shell = true;
      shell_claim_token = ?token;
      shell_claimed_at_ms = null;
      shell_claimed_by = null;
      shell_contact_email = contact_email;
      shell_contact_name = contact_name;
      shell_invited_by = ?caller;
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
};