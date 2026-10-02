import Array "mo:core/Array";
import Nat "mo:core/Nat";
import Nat16 "mo:core/Nat16";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Types "types";

persistent actor {
  var governor : Principal;
  var roles : [Types.RoleGrant];
  var competitions : [Types.Competition];
  var entries : [Types.TeamEntry];
  var tokens : [Types.JoinToken];
  var seasons : [Types.Season];
  var matches : [Types.Match];
  var bulkAccessPrincipals : [Principal];
  var chatSettings : [Types.ChatSettings];
  var competitionInvites : [Types.CompetitionInvite];
  var competitionJoinLinks : [Types.CompetitionJoinLink];

  public shared ({ caller }) func initialize() : async { #Ok; #Err : Text } {
    auth(caller);
    if (not governor.equal(Principal.anonymous())) return #Err("Already initialized");
    governor := caller;
    #Ok
  };

  public shared ({ caller }) func transfer_governorship(new_governor : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Only governor can transfer governorship");
    if (new_governor.equal(Principal.anonymous())) return #Err("New governor cannot be anonymous");
    governor := new_governor;
    #Ok
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
      role.user.equal(caller) and role.role == "competition_admin" and role.competition_id == competition_id
    });
    let club_admin = competition_club != "" and roles.any(func(role) {
      role.user.equal(caller) and role.role == "club_admin" and role.competition_id == competition_club
    });
    competition_admin or club_admin
  };

  public shared ({ caller }) func grant_role(principal : Principal, role : Text, competition_id : Text, team_id : ?Text) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (principal.equal(Principal.anonymous()) or not valid(role) or not valid(competition_id)) return #Err("Invalid role assignment");
    if (not roles.any(func(item) = item.user.equal(principal) and item.role == role and item.competition_id == competition_id and item.team_id == team_id)) {
      roles := roles.concat([{ user = principal; role; competition_id; team_id }]);
    };
    #Ok
  };

  public shared ({ caller }) func create_competition(club_id : Text, name : Text, season : Text) : async { #Ok : Types.Competition; #Err : Text } {
    auth(caller);
    if (not valid(club_id) or not valid(name) or not valid(season)) return #Err("Invalid competition");
    let club_ok = isGovernor(caller) or roles.any(func(role) = role.user.equal(caller) and role.role == "club_admin" and role.competition_id == club_id);
    if (not club_ok) return #Err("Club admin required");
    let id = "cmp-" # club_id # "-" # Nat.toText(competitions.size() + 1);
    let competition : Types.Competition = { id; club_id; name; season; status = "open"; revision = 1 };
    competitions := competitions.concat([competition]);
    #Ok(competition)
  };

  public shared ({ caller }) func register_team(competition_id : Text, team_id : Text, club_id : Text) : async { #Ok : Types.TeamEntry; #Err : Text } {
    auth(caller);
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    let competition_club = switch (competitions.find(func(item) = item.id == competition_id)) {
      case (?competition) competition.club_id;
      case null return #Err("Competition not found");
    };
    if (club_id != competition_club or not valid(team_id)) return #Err("Team club mismatch");
    if (entries.any(func(item) = item.competition_id == competition_id and item.team_id == team_id)) return #Err("Team already registered");
    let entry : Types.TeamEntry = { competition_id; team_id; club_id; status = "registered"; division_id = null };
    entries := entries.concat([entry]);
    #Ok(entry)
  };

  // Entry-invite flow: the competition manager invites a team (status
  // "invited"); an admin of that team accepts or declines. Mirrors the
  // Supabase competition_entries status transitions read by
  // TeamCompetitionsSection.
  func canManageEntryTeam(caller : Principal, club_id : Text, team_id : Text) : Bool {
    if (isGovernor(caller)) return true;
    roles.any(func(grant) {
      grant.user.equal(caller) and grant.competition_id == club_id and (
        grant.role == "club_admin" or
        ((grant.role == "team_admin" or grant.role == "coach") and grant.team_id == ?team_id)
      )
    })
  };

  public shared ({ caller }) func invite_team(competition_id : Text, team_id : Text) : async { #Ok : Types.TeamEntry; #Err : Text } {
    auth(caller);
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    let competition_club = switch (competitions.find(func(item) = item.id == competition_id)) {
      case (?competition) competition.club_id;
      case null return #Err("Competition not found");
    };
    if (not valid(team_id)) return #Err("Invalid team");
    if (entries.any(func(item) = item.competition_id == competition_id and item.team_id == team_id)) return #Err("Team already entered");
    let entry : Types.TeamEntry = { competition_id; team_id; club_id = competition_club; status = "invited"; division_id = null };
    entries := entries.concat([entry]);
    #Ok(entry)
  };

  public shared ({ caller }) func respond_to_entry_invite(competition_id : Text, team_id : Text, accept : Bool) : async { #Ok : Types.TeamEntry; #Err : Text } {
    auth(caller);
    switch (entries.find(func(item) = item.competition_id == competition_id and item.team_id == team_id)) {
      case null { #Err("Entry invite not found") };
      case (?current) {
        if (current.status != "invited") return #Err("Entry invite already answered");
        if (not canManageEntryTeam(caller, current.club_id, team_id)) return #Err("Team admin required");
        let updated : Types.TeamEntry = { current with status = if (accept) "accepted" else "declined" };
        entries := entries.map(func(item) = if (item.competition_id == competition_id and item.team_id == team_id) updated else item);
        #Ok(updated)
      };
    }
  };

  public query ({ caller }) func list_entries_by_team(team_id : Text) : async { #Ok : [Types.TeamEntry]; #Err : Text } {
    auth(caller);
    #Ok(entries.filter(func(item) {
      item.team_id == team_id and (
        canManageEntryTeam(caller, item.club_id, team_id) or canManageCompetition(caller, item.competition_id)
      )
    }))
  };

  // Assigns a registered team to a division (null clears the assignment).
  public shared ({ caller }) func assign_division(competition_id : Text, team_id : Text, division_id : ?Text) : async { #Ok : Types.TeamEntry; #Err : Text } {
    auth(caller);
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
  };

  public shared ({ caller }) func issue_join_token(competition_id : Text, team_id : Text, expires_at_ms : Nat64) : async { #Ok : Types.JoinToken; #Err : Text } {
    auth(caller);
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
  };

  public shared ({ caller }) func claim_join_token(token_id : Text) : async { #Ok : Text; #Err : Text } {
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
  };

  public shared ({ caller }) func create_season(competition_id : Text, name : Text) : async { #Ok : Types.Season; #Err : Text } {
    auth(caller);
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (not valid(name)) return #Err("Invalid season");
    if (seasons.any(func(item) = item.competition_id == competition_id and item.name == name)) return #Err("Season already exists");
    let season : Types.Season = { competition_id; name; status = "draft"; divisions = []; revision = 1 };
    seasons := seasons.concat([season]);
    #Ok(season)
  };

  // Duplicates a season's structure (division list) under a new name,
  // matching the Supabase duplicate_season_structure RPC. Entries and
  // matches are competition-scoped, so they carry over unchanged; the new
  // season starts as a draft.
  public shared ({ caller }) func duplicate_season(competition_id : Text, source_name : Text, new_name : Text) : async { #Ok : Types.Season; #Err : Text } {
    auth(caller);
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
  };

  // Replaces a season's division structure.
  public shared ({ caller }) func set_season_divisions(competition_id : Text, name : Text, divisions : [Text]) : async { #Ok : Types.Season; #Err : Text } {
    auth(caller);
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
  };

  public shared ({ caller }) func set_season_status(competition_id : Text, status : Text, expected_revision : Nat64) : async { #Ok : Types.Season; #Err : Text } {
    auth(caller);
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
  };

  public shared ({ caller }) func record_match(competition_id : Text, home_team : Text, away_team : Text) : async { #Ok : Types.Match; #Err : Text } {
    auth(caller);
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (home_team == away_team or not valid(home_team) or not valid(away_team)) return #Err("Invalid match teams");
    let home_ok = entries.any(func(entry) = entry.competition_id == competition_id and entry.team_id == home_team);
    let away_ok = entries.any(func(entry) = entry.competition_id == competition_id and entry.team_id == away_team);
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
  };

  public shared ({ caller }) func set_match_result(match_id : Text, home_score : Nat16, away_score : Nat16, expected_revision : Nat64) : async { #Ok : Types.Match; #Err : Text } {
    auth(caller);
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
  };

  // Edits fixture details (teams, schedule, venue, division, notes) without
  // touching the score — scores stay under set_match_result so result
  // recording keeps its own optimistic lock. Mirrors the Supabase
  // competition_matches columns the edit-match dialog writes.
  public shared ({ caller }) func update_match_details(match_id : Text, home_team : Text, away_team : Text, division_id : ?Text, scheduled_at_ms : ?Nat64, venue : ?Text, pitch_number : ?Text, round_number : ?Nat16, duration_minutes : ?Nat16, arrival_minutes_before : ?Nat16, notes : ?Text, expected_revision : Nat64) : async { #Ok : Types.Match; #Err : Text } {
    auth(caller);
    func optValid(value : ?Text, max : Nat) : Bool {
      switch (value) { case null true; case (?text) text.size() <= max }
    };
    if (home_team == away_team or not valid(home_team) or not valid(away_team) or not optValid(venue, 256) or not optValid(pitch_number, 64) or not optValid(notes, 2000)) return #Err("Invalid match details");
    switch (division_id) { case (?d) { if (d.size() > 128) return #Err("Invalid division") }; case null {} };
    switch (matches.find(func(item) = item.id == match_id)) {
      case null { #Err("Match not found") };
      case (?current) {
        if (not canManageCompetition(caller, current.competition_id)) return #Err("Competition management forbidden");
        if (current.revision != expected_revision) return #Err("Match revision conflict");
        let home_ok = entries.any(func(entry) = entry.competition_id == current.competition_id and entry.team_id == home_team);
        let away_ok = entries.any(func(entry) = entry.competition_id == current.competition_id and entry.team_id == away_team);
        if (not home_ok or not away_ok) return #Err("Both teams must be registered");
        let updated : Types.Match = { current with home_team; away_team; division_id; scheduled_at_ms; venue; pitch_number; round_number; duration_minutes; arrival_minutes_before; notes; revision = current.revision + 1 };
        matches := matches.map(func(item) = if (item.id == match_id) updated else item);
        #Ok(updated)
      };
    }
  };

  public query ({ caller }) func list_competitions(club_id : Text) : async { #Ok : [Types.Competition]; #Err : Text } {
    auth(caller);
    #Ok(competitions.filter(func(item) = item.club_id == club_id))
  };

  // Cross-club listing for the competitions page when no single club is
  // selected. Authenticated callers only; mirrors the Supabase query which
  // lists every visible competition.
  public query ({ caller }) func list_competitions_multi(club_ids : [Text]) : async { #Ok : [Types.Competition]; #Err : Text } {
    auth(caller);
    #Ok(competitions.filter(func(item) = club_ids.any(func(id) = id == item.club_id)))
  };

  public query ({ caller }) func list_entries(competition_id : Text) : async { #Ok : [Types.TeamEntry]; #Err : Text } {
    auth(caller);
    #Ok(entries.filter(func(item) = item.competition_id == competition_id))
  };

  public query ({ caller }) func list_seasons(competition_id : Text) : async { #Ok : [Types.Season]; #Err : Text } {
    auth(caller);
    #Ok(seasons.filter(func(item) = item.competition_id == competition_id))
  };

  public query ({ caller }) func list_matches(competition_id : Text) : async { #Ok : [Types.Match]; #Err : Text } {
    auth(caller);
    #Ok(matches.filter(func(item) = item.competition_id == competition_id))
  };

  public query ({ caller }) func is_competition_admin(competition_id : Text) : async { #Ok : Bool; #Err : Text } {
    auth(caller);
    #Ok(canManageCompetition(caller, competition_id))
  };

  public shared ({ caller }) func addBulkAccessPrincipal(principal : Principal) : async { #Ok; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor only");
    if (principal.equal(Principal.anonymous())) return #Err("Invalid principal");
    if (not bulkAccessPrincipals.any(func(p) = p.equal(principal))) { bulkAccessPrincipals := bulkAccessPrincipals.concat([principal]) };
    #Ok
  };

  public shared ({ caller }) func removeBulkAccessPrincipal(principal : Principal) : async { #Ok; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor only");
    bulkAccessPrincipals := bulkAccessPrincipals.filter(func(p) = not p.equal(principal));
    #Ok
  };

  public query ({ caller }) func listBulkAccessPrincipals() : async { #Ok : [Principal]; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor only");
    #Ok(bulkAccessPrincipals)
  };

  public query ({ caller }) func export_state() : async { #Ok : Types.State; #Err : Text } {
    if (not isGovernor(caller) and not hasBulkAccess(caller)) return #Err("Governor only");
    #Ok({ schema = 3; governor; roles; competitions; entries; tokens; seasons; matches; chatSettings; competitionInvites; competitionJoinLinks })
  };

  // ---------------- Competition roles (admin-managed, not governor-only) ----------------

  public shared ({ caller }) func add_competition_role(competition_id : Text, principal : Principal, role : Text, team_id : ?Text) : async { #Ok : Types.RoleGrant; #Err : Text } {
    auth(caller);
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (principal.equal(Principal.anonymous()) or not valid(role)) return #Err("Invalid role assignment");
    let grant : Types.RoleGrant = { user = principal; role; competition_id; team_id };
    if (not roles.any(func(item) = item.user.equal(principal) and item.role == role and item.competition_id == competition_id and item.team_id == team_id)) {
      roles := roles.concat([grant]);
    };
    #Ok(grant)
  };

  public shared ({ caller }) func remove_competition_role(competition_id : Text, principal : Principal, role : Text, team_id : ?Text) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    roles := roles.filter(func(item) = not (item.user.equal(principal) and item.role == role and item.competition_id == competition_id and item.team_id == team_id));
    #Ok
  };

  public query ({ caller }) func list_competition_roles(competition_id : Text) : async { #Ok : [Types.RoleGrant]; #Err : Text } {
    auth(caller);
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    #Ok(roles.filter(func(item) = item.competition_id == competition_id))
  };

  // ---------------- Chat settings ----------------

  func findChatSettings(competition_id : Text) : ?Types.ChatSettings {
    chatSettings.find(func(item) = item.competition_id == competition_id)
  };

  public query ({ caller }) func get_chat_settings(competition_id : Text) : async { #Ok : Types.ChatSettings; #Err : Text } {
    auth(caller);
    switch (findChatSettings(competition_id)) {
      case (?settings) #Ok(settings);
      case null #Ok({ competition_id; chat_enabled = true; admins_only = false; revision = 0 : Nat64 });
    }
  };

  public shared ({ caller }) func set_chat_settings(competition_id : Text, chat_enabled : Bool, admins_only : Bool, expected_revision : Nat64) : async { #Ok : Types.ChatSettings; #Err : Text } {
    auth(caller);
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    let current_revision : Nat64 = switch (findChatSettings(competition_id)) { case (?s) s.revision; case null 0 };
    if (current_revision != expected_revision) return #Err("Chat settings revision conflict");
    let updated : Types.ChatSettings = { competition_id; chat_enabled; admins_only; revision = current_revision + 1 };
    chatSettings := chatSettings.filter(func(item) = item.competition_id != competition_id);
    chatSettings := chatSettings.concat([updated]);
    #Ok(updated)
  };

  // ---------------- Competition invites (accept/decline) ----------------

  public shared ({ caller }) func create_competition_invite(competition_id : Text, invitee : Principal, role : Text, team_id : ?Text) : async { #Ok : Types.CompetitionInvite; #Err : Text } {
    auth(caller);
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
  };

  public shared ({ caller }) func accept_competition_invite(invite_id : Text) : async { #Ok : Types.CompetitionInvite; #Err : Text } {
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
  };

  public shared ({ caller }) func decline_competition_invite(invite_id : Text) : async { #Ok : Types.CompetitionInvite; #Err : Text } {
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
  };

  public query ({ caller }) func list_competition_invites(competition_id : Text) : async { #Ok : [Types.CompetitionInvite]; #Err : Text } {
    auth(caller);
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    #Ok(competitionInvites.filter(func(item) = item.competition_id == competition_id))
  };

  // Caller-scoped: invites addressed to the caller, across all competitions.
  public query ({ caller }) func list_invites_by_invitee() : async { #Ok : [Types.CompetitionInvite]; #Err : Text } {
    auth(caller);
    #Ok(competitionInvites.filter(func(item) = item.invitee.equal(caller)))
  };

  // ---------------- Competition-wide join links ----------------

  public shared ({ caller }) func create_competition_join_link(competition_id : Text, role : Text, team_id : ?Text) : async { #Ok : Types.CompetitionJoinLink; #Err : Text } {
    auth(caller);
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (not valid(role)) return #Err("Invalid role");
    if (competitionJoinLinks.any(func(item) = item.competition_id == competition_id and not item.revoked)) return #Err("Active join link already exists");
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
  };

  public shared ({ caller }) func rotate_competition_join_link(competition_id : Text) : async { #Ok : Types.CompetitionJoinLink; #Err : Text } {
    auth(caller);
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
  };

  public shared ({ caller }) func revoke_competition_join_link(competition_id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    competitionJoinLinks := competitionJoinLinks.map(func(item) = if (item.competition_id == competition_id and not item.revoked) { { item with revoked = true } } else item);
    #Ok
  };

  public shared ({ caller }) func join_competition_by_token(token : Text) : async { #Ok : Types.RoleGrant; #Err : Text } {
    auth(caller);
    switch (competitionJoinLinks.find(func(item) = item.token == token)) {
      case null #Err("Join link not found");
      case (?link) {
        if (link.revoked) return #Err("Join link revoked");
        let grant : Types.RoleGrant = { user = caller; role = link.role; competition_id = link.competition_id; team_id = link.team_id };
        if (not roles.any(func(item) = item.user.equal(caller) and item.role == link.role and item.competition_id == link.competition_id and item.team_id == link.team_id)) {
          roles := roles.concat([grant]);
        };
        #Ok(grant)
      };
    }
  };

  // ---------------- Match deletion / round trimming ----------------

  public shared ({ caller }) func delete_match(match_id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (matches.find(func(item) = item.id == match_id)) {
      case null #Err("Match not found");
      case (?current) {
        if (not canManageCompetition(caller, current.competition_id)) return #Err("Competition management forbidden");
        matches := matches.filter(func(item) = item.id != match_id);
        #Ok
      };
    }
  };

  // Removes matches scheduled beyond round `max_round` for a competition —
  // matches without a round number are left untouched. Returns the count of
  // matches removed.
  public shared ({ caller }) func trim_rounds(competition_id : Text, max_round : Nat16) : async { #Ok : Nat; #Err : Text } {
    auth(caller);
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    let before = matches.size();
    matches := matches.filter(func(item) = not (item.competition_id == competition_id and (switch (item.round_number) { case (?r) r > max_round; case null false })));
    #Ok(before - matches.size())
  };
};