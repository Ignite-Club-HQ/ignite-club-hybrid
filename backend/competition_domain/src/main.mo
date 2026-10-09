import Cycles "mo:core/Cycles";
import Array "mo:core/Array";
import Nat "mo:core/Nat";
import Nat16 "mo:core/Nat16";
import Int "mo:core/Int";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Types "types";

persistent actor class Main(governorInit : Principal) {
  /// Public: remaining cycles (shown in admin settings).
  public query func cycles_balance() : async Nat { Cycles.balance() };

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
  var bulkAccessPrincipals : [Principal];
  var chatSettings : [Types.ChatSettings];
  var competitionInvites : [Types.CompetitionInvite];
  var competitionJoinLinks : [Types.CompetitionJoinLink];
  var eoiSubmissions : [Types.EoiSubmission];
  var divisionSettings : [Types.DivisionSetting];
  var broadcasts : [Types.Broadcast];
  var clubDomainCanister : ?Principal;

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
      role.user.equal(caller) and (role.role == "competition_admin" or role.role == "admin" or role.role == "owner") and role.competition_id == competition_id
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
    auth(caller); await syncClubAdmin(caller, club_id);
    if (not valid(club_id) or not valid(name) or not valid(season)) return #Err("Invalid competition");
    let club_ok = isGovernor(caller) or roles.any(func(role) = role.user.equal(caller) and role.role == "club_admin" and role.competition_id == club_id);
    if (not club_ok) return #Err("Club admin required");
    let id = "cmp-" # club_id # "-" # Nat.toText(competitions.size() + 1);
    let competition : Types.Competition = { id; club_id; name; season; status = "open"; description = null; visibility = "private"; points_win = 3; points_draw = 1; points_loss = 0; revision = 1 };
    competitions := competitions.concat([competition]);
    #Ok(competition)
  };

  // Competition settings (name, description, status, visibility, ladder
  // scoring). Season stays create-only. Mirrors the Supabase
  // CompetitionSettingsPage update.
  public shared ({ caller }) func update_competition_settings(competition_id : Text, name : Text, description : ?Text, status : Text, visibility : Text, points_win : Nat16, points_draw : Nat16, points_loss : Nat16) : async { #Ok : Types.Competition; #Err : Text } {
    auth(caller); await syncForCompetition(caller, competition_id);
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
    #Ok({ schema = 4; governor; roles; competitions; entries; tokens; seasons; matches; chatSettings; competitionInvites; competitionJoinLinks; eoiSubmissions })
  };

  // ---------------- Competition roles (admin-managed, not governor-only) ----------------

  public shared ({ caller }) func add_competition_role(competition_id : Text, principal : Principal, role : Text, team_id : ?Text) : async { #Ok : Types.RoleGrant; #Err : Text } {
    auth(caller); await syncForCompetition(caller, competition_id);
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (principal.equal(Principal.anonymous()) or not valid(role)) return #Err("Invalid role assignment");
    let grant : Types.RoleGrant = { user = principal; role; competition_id; team_id };
    if (not roles.any(func(item) = item.user.equal(principal) and item.role == role and item.competition_id == competition_id and item.team_id == team_id)) {
      roles := roles.concat([grant]);
    };
    #Ok(grant)
  };

  public shared ({ caller }) func remove_competition_role(competition_id : Text, principal : Principal, role : Text, team_id : ?Text) : async { #Ok; #Err : Text } {
    auth(caller); await syncForCompetition(caller, competition_id);
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
    auth(caller); await syncForCompetition(caller, competition_id);
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

  public query ({ caller }) func list_competition_join_links(competition_id : Text) : async { #Ok : [Types.CompetitionJoinLink]; #Err : Text } {
    auth(caller);
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    #Ok(competitionJoinLinks.filter(func(item) = item.competition_id == competition_id))
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
    auth(caller);
    if (not valid(team_id)) return #Err("team_not_found");
    switch (competitionJoinLinks.find(func(item) = item.token == token)) {
      case null #Err("invalid_token");
      case (?link) {
        if (link.revoked) return #Err("invalid_token");
        let competition = switch (competitions.find(func(item) = item.id == link.competition_id)) {
          case (?c) c;
          case null return #Err("Competition not found");
        };
        if (competition.status == "archived") return #Err("Competition archived");
        if (not canManageEntryTeam(caller, competition.club_id, team_id)) return #Err("not_team_admin");
        if (entries.any(func(item) = item.competition_id == link.competition_id and item.team_id == team_id)) return #Err("Team already entered");
        switch (division_id) {
          case (?d) {
            if (d.size() > 128) return #Err("Invalid division");
            if (not seasons.any(func(s) = s.competition_id == link.competition_id and s.divisions.any(func(div) = div == d))) return #Err("Invalid division");
          };
          case null {};
        };
        let entry : Types.TeamEntry = { competition_id = link.competition_id; team_id; club_id = competition.club_id; status = "accepted"; division_id };
        entries := entries.concat([entry]);
        #Ok(entry)
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

  // ---------------- Expression-of-interest (EOI) submissions ----------------

  func canManageClub(caller : Principal, club_id : Text) : Bool {
    if (isGovernor(caller)) return true;
    roles.any(func(role) = role.user.equal(caller) and role.role == "club_admin" and role.competition_id == club_id)
  };

  func nowMs() : Nat64 { Nat64.fromIntWrap(Time.now() / 1_000_000) };

  public query ({ caller }) func list_eoi_submissions(club_id : Text, season_id : ?Text) : async { #Ok : [Types.EoiSubmission]; #Err : Text } {
    auth(caller);
    if (not canManageClub(caller, club_id)) return #Err("Club admin required");
    #Ok(eoiSubmissions.filter(func(item) {
      item.club_id == club_id and (switch (season_id) { case (?s) item.season_id == s; case null true })
    }))
  };

  public query ({ caller }) func get_eoi_stats(club_id : Text, season_id : ?Text) : async { #Ok : Types.EoiStats; #Err : Text } {
    auth(caller);
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
  };

  public query ({ caller }) func suggest_eoi_teams(season_id : Text) : async { #Ok : [Types.EoiTeamSuggestion]; #Err : Text } {
    auth(caller);
    let candidates = eoiSubmissions.filter(func(item) {
      item.season_id == season_id and item.assigned_team_id == null and
      (item.status == "submitted" or item.status == "preferences_completed")
    });
    switch (candidates.values().next()) {
      case (?first) { if (not canManageClub(caller, first.club_id)) return #Err("Club admin required") };
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
  };

  public query ({ caller }) func get_my_pending_eois() : async { #Ok : [Types.EoiSubmission]; #Err : Text } {
    auth(caller);
    #Ok(eoiSubmissions.filter(func(item) {
      item.parent_user_id == ?caller and (
        item.status == "submitted" or item.status == "preferences_completed" or item.status == "allocated"
      )
    }))
  };

  public shared ({ caller }) func confirm_eoi_placement(submission_id : Text) : async { #Ok : Types.EoiSubmission; #Err : Text } {
    auth(caller);
    switch (eoiSubmissions.find(func(item) = item.id == submission_id)) {
      case null #Err("EOI submission not found");
      case (?current) {
        if (current.parent_user_id != ?caller) return #Err("EOI submission does not belong to caller");
        let now = nowMs();
        let updated : Types.EoiSubmission = { current with status = "confirmed"; confirmed_at_ms = ?now; parent_confirmed_at_ms = ?now; updated_at_ms = now; revision = current.revision + 1 };
        eoiSubmissions := eoiSubmissions.map(func(item) = if (item.id == submission_id) updated else item);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func claim_eoi_by_token(token : Text) : async { #Ok : Types.EoiSubmission; #Err : Text } {
    auth(caller);
    switch (eoiSubmissions.find(func(item) = item.claim_token == token)) {
      case null #Err("EOI submission not found");
      case (?current) {
        if (current.parent_user_id != null and current.parent_user_id != ?caller) return #Err("EOI submission already claimed");
        let updated : Types.EoiSubmission = { current with parent_user_id = ?caller; claimed_at_ms = ?nowMs(); updated_at_ms = nowMs() };
        eoiSubmissions := eoiSubmissions.map(func(item) = if (item.id == current.id) updated else item);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func update_eoi_submission(id : Text, extra_notes : ?Text, preferred_teammates : ?Text, preferred_position : ?Text) : async { #Ok : Types.EoiSubmission; #Err : Text } {
    auth(caller);
    func optValid(value : ?Text, max : Nat) : Bool {
      switch (value) { case null true; case (?text) text.size() <= max }
    };
    if (not optValid(extra_notes, 2000) or not optValid(preferred_teammates, 500) or not optValid(preferred_position, 128)) return #Err("Invalid EOI update");
    switch (eoiSubmissions.find(func(item) = item.id == id)) {
      case null #Err("EOI submission not found");
      case (?current) {
        if (current.parent_user_id != ?caller) return #Err("EOI submission does not belong to caller");
        let updated : Types.EoiSubmission = { current with extra_notes; preferred_teammates; preferred_position; status = "preferences_completed"; updated_at_ms = nowMs(); revision = current.revision + 1 };
        eoiSubmissions := eoiSubmissions.map(func(item) = if (item.id == id) updated else item);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func update_eoi_status(id : Text, status : Text) : async { #Ok : Types.EoiSubmission; #Err : Text } {
    auth(caller);
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
    auth(caller);
    doAssignEoiTeam(caller, id, team_id)
  };

  public shared ({ caller }) func allocate_eoi_to_team(id : Text, team_id : ?Text) : async { #Ok : Types.EoiSubmission; #Err : Text } {
    auth(caller);
    doAssignEoiTeam(caller, id, team_id)
  };

  public shared ({ caller }) func delete_eoi(id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (eoiSubmissions.find(func(item) = item.id == id)) {
      case null #Err("EOI submission not found");
      case (?current) {
        if (not canManageClub(caller, current.club_id)) return #Err("Club admin required");
        eoiSubmissions := eoiSubmissions.filter(func(item) = item.id != id);
        #Ok
      };
    }
  };

  // Bookkeeping-only: tracks invite_sent_count / invite_sent_at_ms. Actual
  // email delivery stays Supabase (send-eoi-invite edge function) by design
  // — this just mirrors the counters for ICP-routed admin UIs.
  public shared ({ caller }) func resend_eoi_invite(id : Text) : async { #Ok : Types.EoiSubmission; #Err : Text } {
    auth(caller);
    switch (eoiSubmissions.find(func(item) = item.id == id)) {
      case null #Err("EOI submission not found");
      case (?current) {
        if (not canManageClub(caller, current.club_id)) return #Err("Club admin required");
        let updated : Types.EoiSubmission = { current with invite_sent_count = current.invite_sent_count + 1; invite_sent_at_ms = ?nowMs(); updated_at_ms = nowMs(); revision = current.revision + 1 };
        eoiSubmissions := eoiSubmissions.map(func(item) = if (item.id == id) updated else item);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func bulk_resend_eoi_invites(ids : [Text]) : async { #Ok : { ok : Nat; fail : Nat }; #Err : Text } {
    auth(caller);
    var ok = 0; var fail = 0;
    for (id in ids.values()) {
      switch (eoiSubmissions.find(func(item) = item.id == id)) {
        case null { fail += 1 };
        case (?current) {
          if (not canManageClub(caller, current.club_id)) { fail += 1 } else {
            let updated : Types.EoiSubmission = { current with invite_sent_count = current.invite_sent_count + 1; invite_sent_at_ms = ?nowMs(); updated_at_ms = nowMs(); revision = current.revision + 1 };
            eoiSubmissions := eoiSubmissions.map(func(item) = if (item.id == id) updated else item);
            ok += 1;
          };
        };
      };
    };
    #Ok({ ok; fail })
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
    ignore since_ms;
    ignore until_ms;
    #Ok(competition_ids.map(func(cid : Text) : Types.CompetitionEngagementSummary {
      let compEntries = entries.filter(func(item) = item.competition_id == cid and (item.status == "accepted" or item.status == "registered"));
      let compMatches = matches.filter(func(item) = item.competition_id == cid);
      let completed = compMatches.filter(func(item) = item.status == "completed");
      // broadcasts always reports 0 — competition_broadcasts stays in
      // Supabase by design (send-competition-broadcast edge function).
      { competition_id = cid; active_teams = compEntries.size(); total_matches = compMatches.size(); results_entered = completed.size(); broadcasts = 0 }
    }))
  };


  // ---------------- club_domain role mirror ----------------
  // Mirrors the caller's live club_admin grant for one club from club_domain
  // (source of truth). Errors or an unwired club_domain leave roles untouched.
  func syncClubAdmin(caller : Principal, club_id : Text) : async () {
    switch (clubDomainCanister) {
      case null {};
      case (?cid) {
        let cd : actor { list_user_club_roles : shared query (Principal, Text) -> async [(Text, ?Text)] } = actor (Principal.toText(cid));
        try {
          let fresh = await cd.list_user_club_roles(caller, club_id);
          let isAdmin = fresh.any(func((role, _)) = role == "club_admin");
          roles := roles.filter(func(item) = not (item.user.equal(caller) and item.role == "club_admin" and item.competition_id == club_id));
          if (isAdmin) roles := roles.concat([{ user = caller; role = "club_admin"; competition_id = club_id; team_id = null }]);
        } catch (_) {};
      };
    };
  };

  func syncForCompetition(caller : Principal, competition_id : Text) : async () {
    switch (competitions.find(func(item) = item.id == competition_id)) {
      case (?c) await syncClubAdmin(caller, c.club_id);
      case null {};
    };
  };

  public shared ({ caller }) func set_club_domain_canister(id : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (id.equal(Principal.anonymous())) return #Err("Invalid canister id");
    clubDomainCanister := ?id;
    #Ok
  };

  /// Refreshes the caller's mirrored club-admin role for a competition's
  /// organiser club so later management queries see it.
  public shared ({ caller }) func sync_my_competition_access(competition_id : Text) : async { #Ok : Bool; #Err : Text } {
    auth(caller);
    await syncForCompetition(caller, competition_id);
    #Ok(canManageCompetition(caller, competition_id))
  };

  // ---------------- Division ladder visibility ----------------
  public query ({ caller }) func list_division_settings(competition_id : Text) : async { #Ok : [Types.DivisionSetting]; #Err : Text } {
    ignore caller;
    #Ok(divisionSettings.filter(func(item) = item.competition_id == competition_id))
  };

  public shared ({ caller }) func set_division_hide_ladder(competition_id : Text, division : Text, hide_ladder : Bool) : async { #Ok : Types.DivisionSetting; #Err : Text } {
    auth(caller); await syncForCompetition(caller, competition_id);
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (not valid(division)) return #Err("Invalid division");
    let value : Types.DivisionSetting = { competition_id; division; hide_ladder };
    divisionSettings := divisionSettings.filter(func(item) = not (item.competition_id == competition_id and item.division == division)).concat([value]);
    #Ok(value)
  };

  // ---------------- Competition broadcasts ----------------
  // Stored log only; push delivery is fanned out by the sender's client
  // through notification_queue (same path as announcement broadcasts).
  public shared ({ caller }) func send_competition_broadcast(competition_id : Text, title : Text, body : Text) : async { #Ok : Types.Broadcast; #Err : Text } {
    auth(caller); await syncForCompetition(caller, competition_id);
    if (not canManageCompetition(caller, competition_id)) return #Err("Competition management forbidden");
    if (title.size() == 0 or title.size() > 200 or body.size() == 0 or body.size() > 4000) return #Err("Invalid broadcast");
    let value : Types.Broadcast = { id = "bc-" # competition_id # "-" # Nat.toText(broadcasts.size() + 1); competition_id; sender = caller; title; body; created_at_ms = Nat64.fromIntWrap(Time.now() / 1_000_000) };
    broadcasts := broadcasts.concat([value]);
    #Ok(value)
  };

  public query ({ caller }) func list_competition_broadcasts(competition_id : Text) : async { #Ok : [Types.Broadcast]; #Err : Text } {
    auth(caller);
    #Ok(broadcasts.filter(func(item) = item.competition_id == competition_id).reverse())
  };

  // Governor-only: moves every stored reference of one user's sign-in ID (old) to a new one.
  // Any NEW stored principal / principal-text field added to this canister must be added here.
  public shared ({ caller }) func rekey_principal(old : Principal, new : Principal, dry_run : Bool) : async { #ok : Nat; #err : Text } {
    if (not isGovernor(caller)) return #err("Forbidden");
    if (old.equal(Principal.anonymous()) or new.equal(Principal.anonymous())) return #err("Invalid principal");
    if (old.equal(new)) return #err("old and new must differ");
    if (old.equal(governor)) return #err("Cannot rekey the governor");

    var conflicts = 0;
    conflicts += roles.filter(func(item) = item.user.equal(new)).size();
    conflicts += tokens.filter(func(item) = item.issued_by.equal(new)).size();
    conflicts += competitionInvites.filter(func(item) = item.invitee.equal(new) or item.created_by.equal(new)).size();
    conflicts += competitionJoinLinks.filter(func(item) = item.created_by.equal(new)).size();
    conflicts += eoiSubmissions.filter(func(item) = item.parent_user_id == ?new).size();
    conflicts += broadcasts.filter(func(item) = item.sender.equal(new)).size();
    if (bulkAccessPrincipals.any(func(p) = p.equal(new))) { conflicts += 1 };

    if (conflicts > 0) return #err("New sign-in ID already has " # Nat.toText(conflicts) # " record(s) in competition_domain");

    var changed = 0;

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
    var newBulkAccessPrincipals = bulkAccessPrincipals;
    if (bulkAccessPrincipals.any(func(p) = p.equal(old))) {
      let hasNew = bulkAccessPrincipals.any(func(p) = p.equal(new));
      newBulkAccessPrincipals := bulkAccessPrincipals.filterMap(func(p) : ?Principal {
        if (p.equal(old)) { if (hasNew) null else ?new } else ?p
      });
      changed += 1;
    };

    if (not dry_run) {
      roles := newRoles;
      tokens := newTokens;
      competitionInvites := newCompetitionInvites;
      competitionJoinLinks := newCompetitionJoinLinks;
      eoiSubmissions := newEoiSubmissions;
      broadcasts := newBroadcasts;
      bulkAccessPrincipals := newBulkAccessPrincipals;
    };

    #ok(changed)
  };
};
