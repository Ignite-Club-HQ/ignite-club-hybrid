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

  public shared ({ caller }) func initialize() : async { #Ok; #Err : Text } {
    auth(caller);
    if (not governor.equal(Principal.anonymous())) return #Err("Already initialized");
    governor := caller;
    #Ok
  };

  func auth(caller : Principal) {
    if (caller.equal(Principal.anonymous())) Runtime.trap("Authenticated caller required");
  };

  func valid(value : Text) : Bool { value != "" and value.size() <= 128 };

  func isGovernor(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and governor.equal(caller)
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
    let entry : Types.TeamEntry = { competition_id; team_id; club_id; status = "registered" };
    entries := entries.concat([entry]);
    #Ok(entry)
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
    let season : Types.Season = { competition_id; name; status = "draft"; revision = 1 };
    seasons := seasons.concat([season]);
    #Ok(season)
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

  public query ({ caller }) func export_state() : async { #Ok : Types.State; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor only");
    #Ok({ schema = 1; governor; roles; competitions; entries; tokens; seasons; matches })
  };
};