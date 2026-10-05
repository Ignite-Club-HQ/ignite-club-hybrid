import Array "mo:core/Array";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Random "mo:core/Random";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Types "types";

persistent actor class Main(governorInit : Principal) {
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

  func auth(caller : Principal) { if (caller.equal(Principal.anonymous())) Runtime.trap("Authenticated caller required") };
  func valid(value : Text) : Bool { value != "" and value.size() <= 128 };
  func validOpt(value : ?Text, maxLen : Nat) : Bool { switch (value) { case null true; case (?text) text.size() <= maxLen } };
  func nowMs() : Nat64 { Nat.toNat64(Int.abs(Time.now()) / 1_000_000) };

  func validLeagueStatus(value : Text) : Bool { value == "active" or value == "archived" };
  func validSessionStatus(value : Text) : Bool { value == "scheduled" or value == "cancelled" or value == "completed" };
  func validDutyStatus(value : Text) : Bool { value == "open" or value == "claimed" or value == "completed" };
  func validAvailabilityStatus(value : Text) : Bool { value == "available" or value == "unavailable" or value == "maybe" };
  func validInviteStatus(value : Text) : Bool { value == "pending" or value == "claimed" };

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
  func canViewLeague(caller : Principal, league : Types.MiniLeague) : Bool {
    if (caller.equal(Principal.anonymous())) return false;
    if (isLeagueAdmin(caller, league)) return true;
    if (isClubMember(caller, league.club_id)) return true;
    players.any(func(p) = p.mini_league_id == league.id and p.claimed_by == ?caller)
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

  let hexDigits : [Text] = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"];

  // 128 bits of raw_rand entropy, hex-encoded, for bearer tokens (join
  // links, claim invites) — those must be unguessable, unlike the
  // sequential entity ids nextId produces. Update methods only.
  func randomToken(prefix : Text) : async Text {
    let blob = await Random.blob();
    var out = prefix # "-";
    var i = 0;
    label fill for (b in blob.vals()) {
      if (i >= 16) break fill;
      let n = Nat8.toNat(b);
      out #= hexDigits[n / 16] # hexDigits[n % 16];
      i += 1;
    };
    out
  };

  public shared ({ caller }) func transfer_governorship(new_governor : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Only governor can transfer governorship");
    if (new_governor.equal(Principal.anonymous())) return #Err("New governor cannot be anonymous");
    governor := new_governor;
    #Ok
  };

  public shared ({ caller }) func grant_role(principal : Principal, role : Text, club_id : Text, team_id : ?Text) : async { #Ok; #Err : Text } {
    auth(caller); if (not isGovernor(caller)) return #Err("Governor only");
    if (principal.equal(Principal.anonymous()) or not valid(role) or not valid(club_id)) return #Err("Invalid role assignment");
    if (not roles.any(func(item) = item.user.equal(principal) and item.role == role and item.club_id == club_id and item.team_id == team_id)) {
      roles := roles.concat([{ user = principal; role; club_id; team_id }]);
    };
    #Ok
  };

  // ---------------- Mini-leagues ----------------

  public shared ({ caller }) func create_mini_league(club_id : Text, name : Text, description : ?Text, logo_url : ?Text, team_size : Nat16, min_players_per_side : Nat16, minutes_per_half : Nat16, bib_colors : [Text], show_matches_to_members : Bool) : async { #Ok : Types.MiniLeague; #Err : Text } {
    auth(caller);
    if (not valid(club_id) or not valid(name) or not validOpt(description, 2000) or not validOpt(logo_url, 512)) return #Err("Invalid mini-league");
    if (not isClubAdmin(caller, club_id)) return #Err("Club admin required");
    let now = nowMs();
    let created : Types.MiniLeague = {
      id = nextId("mlg-" # club_id, leagues.size()); club_id; name; description; logo_url;
      team_size; min_players_per_side; minutes_per_half; bib_colors; show_matches_to_members;
      status = "active"; created_by = caller; created_at_ms = now; updated_at_ms = now;
    };
    leagues := leagues.concat([created]);
    #Ok(created)
  };

  public shared ({ caller }) func update_mini_league(id : Text, name : Text, description : ?Text, logo_url : ?Text, team_size : Nat16, min_players_per_side : Nat16, minutes_per_half : Nat16, bib_colors : [Text], show_matches_to_members : Bool) : async { #Ok : Types.MiniLeague; #Err : Text } {
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
  };

  public shared ({ caller }) func set_mini_league_status(id : Text, status : Text) : async { #Ok : Types.MiniLeague; #Err : Text } {
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
  };

  public query ({ caller }) func get_mini_league(id : Text) : async { #Ok : Types.MiniLeague; #Err : Text } {
    switch (findLeague(id)) {
      case null #Err("Mini-league not found");
      case (?league) { if (not canViewLeague(caller, league)) #Err("Forbidden") else #Ok(league) };
    }
  };

  public query ({ caller }) func list_mini_leagues_by_club(club_id : Text) : async [Types.MiniLeague] {
    leagues.filter(func(item) = item.club_id == club_id and canViewLeague(caller, item))
  };

  // Caller-scoped: leagues the caller administers, belongs to via a club
  // role grant, or has a claimed player in.
  public query ({ caller }) func my_leagues() : async [Types.MiniLeague] {
    leagues.filter(func(item) = canViewLeague(caller, item))
  };

  // ---------------- Sessions ----------------

  public shared ({ caller }) func create_session(mini_league_id : Text, session_date : Text, start_time : Text, end_time : ?Text, location_name : ?Text, address : ?Text, postcode : ?Text, team_size_override : ?Nat16) : async { #Ok : Types.MiniLeagueSession; #Err : Text } {
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
  };

  public shared ({ caller }) func update_session(id : Text, session_date : Text, start_time : Text, end_time : ?Text, location_name : ?Text, address : ?Text, postcode : ?Text, team_size_override : ?Nat16) : async { #Ok : Types.MiniLeagueSession; #Err : Text } {
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
  };

  // Cancellation kept separate from update_session, mirroring
  // set_event_cancelled, so cancelling cannot clobber other fields.
  public shared ({ caller }) func cancel_session(id : Text) : async { #Ok : Types.MiniLeagueSession; #Err : Text } {
    auth(caller);
    switch (requireSessionAdmin(caller, id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(current)) {
        let updated : Types.MiniLeagueSession = { current with status = "cancelled"; updated_at_ms = nowMs() };
        sessions := sessions.map(func(item) = if (item.id == id) updated else item);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func set_session_status(id : Text, status : Text) : async { #Ok : Types.MiniLeagueSession; #Err : Text } {
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
  };

  public query ({ caller }) func list_sessions(mini_league_id : Text) : async { #Ok : [Types.MiniLeagueSession]; #Err : Text } {
    switch (findLeague(mini_league_id)) {
      case null #Err("Mini-league not found");
      case (?league) {
        if (not canViewLeague(caller, league)) return #Err("Forbidden");
        #Ok(sessions.filter(func(item) = item.mini_league_id == mini_league_id))
      };
    }
  };

  // ---------------- Players ----------------

  public shared ({ caller }) func add_player(mini_league_id : Text, name : Text, child_id : ?Text, parent_user_id : ?Text, ability_rating : ?Nat16, notes : ?Text) : async { #Ok : Types.MiniLeaguePlayer; #Err : Text } {
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
  };

  public shared ({ caller }) func update_player(id : Text, name : Text, ability_rating : ?Nat16, notes : ?Text) : async { #Ok : Types.MiniLeaguePlayer; #Err : Text } {
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
  };

  public shared ({ caller }) func remove_player(id : Text) : async { #Ok; #Err : Text } {
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
  };

  public query ({ caller }) func list_players(mini_league_id : Text) : async { #Ok : [Types.MiniLeaguePlayer]; #Err : Text } {
    switch (findLeague(mini_league_id)) {
      case null #Err("Mini-league not found");
      case (?league) {
        if (not canViewLeague(caller, league)) return #Err("Forbidden");
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
    auth(caller);
    if (not valid(child_id)) return #Err("Invalid child");
    if (guardian_user_id.equal(Principal.anonymous())) return #Err("Invalid guardian principal");
    if (not isChildLeagueAdmin(caller, child_id)) return #Err("Mini-league admin required");
    if (findChild(child_id) == null) {
      children := children.concat([{ id = child_id; parent_user_id = null; claimed_by = null; created_at_ms = nowMs(); updated_at_ms = nowMs() }]);
    };
    if (not guardians.any(func(item) = item.child_id == child_id and item.guardian_user_id.equal(guardian_user_id))) {
      guardians := guardians.concat([{ child_id; guardian_user_id; created_at_ms = nowMs() }]);
    };
    #Ok
  };

  // Matches exactly what ManagePlayersDialog computes client-side from
  // Supabase: pending when the player has no parent_user_id AND (no linked
  // child OR the child has no parent_id AND no child_guardians rows).
  public query ({ caller }) func get_player_guardian_status(player_id : Text) : async { #Ok : Types.PlayerGuardianStatus; #Err : Text } {
    switch (findPlayer(player_id)) {
      case null #Err("Player not found");
      case (?player) {
        switch (findLeague(player.mini_league_id)) {
          case null #Err("Mini-league not found");
          case (?league) {
            if (not canViewLeague(caller, league)) return #Err("Forbidden");
            let childParent : ?Principal = switch (player.child_id) {
              case (?cid) { switch (findChild(cid)) { case (?child) child.parent_user_id; case null null } };
              case null null;
            };
            let guardianCount : Nat = switch (player.child_id) {
              case (?cid) guardians.filter(func(item) = item.child_id == cid).size();
              case null 0;
            };
            let parentLinked = player.parent_user_id != null or childParent != null;
            let pending = player.parent_user_id == null and (player.child_id == null or (childParent == null and guardianCount == 0));
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
    auth(caller);
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        switch (player_id) {
          case (?pid) { if (findPlayer(pid) == null) return #Err("Player not found") };
          case null {};
        };
        if (not validOpt(label_text, 256)) return #Err("Invalid invite");
        let created : Types.MiniLeagueInvite = {
          token = nextId("mli-" # mini_league_id, invites.size()); mini_league_id; player_id; label_text;
          status = "pending"; claimed_by = null; created_by = caller; created_at_ms = nowMs(); claimed_at_ms = null;
        };
        invites := invites.concat([created]);
        #Ok(created)
      };
    }
  };

  // Mirrors claim_mini_league_invite(_token): binds the caller as the
  // claimant of the invite's player (creating one named after the caller's
  // player_name when the invite has no pre-bound player), and returns the
  // (mini_league_id, club_id, player_id) triple like the Postgres function.
  public shared ({ caller }) func claim_invite(token : Text, player_name : Text) : async { #Ok : Types.ClaimedInvite; #Err : Text } {
    auth(caller);
    switch (invites.find(func(item) = item.token == token)) {
      case null #Err("Invite not found");
      case (?invite) {
        if (invite.status != "pending") return #Err("Invite already claimed");
        switch (findLeague(invite.mini_league_id)) {
          case null #Err("Mini-league not found");
          case (?league) {
            let playerId = switch (invite.player_id) {
              case (?pid) {
                switch (findPlayer(pid)) {
                  case null return #Err("Player not found");
                  case (?player) {
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
            invites := invites.map(func(item) = if (item.token == token) { { item with status = "claimed"; claimed_by = ?caller; claimed_at_ms = ?nowMs() } } else item);
            #Ok({ mini_league_id = league.id; club_id = league.club_id; player_id = playerId })
          };
        }
      };
    }
  };

  public query ({ caller }) func list_invites(mini_league_id : Text) : async { #Ok : [Types.MiniLeagueInvite]; #Err : Text } {
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) #Ok(invites.filter(func(item) = item.mini_league_id == mini_league_id));
    }
  };

  // ---------------- Groups ----------------

  public shared ({ caller }) func create_group(session_id : Text, name : Text, ability_band : ?Text, display_order : Nat16, target_size : Nat16, pitch_name : ?Text) : async { #Ok : Types.MiniLeagueGroup; #Err : Text } {
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
  };

  public shared ({ caller }) func update_group(id : Text, name : Text, ability_band : ?Text, display_order : Nat16, target_size : Nat16, pitch_name : ?Text) : async { #Ok : Types.MiniLeagueGroup; #Err : Text } {
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
  };

  public shared ({ caller }) func assign_player_to_group(group_id : Text, player_id : Text, jersey_number : ?Nat16) : async { #Ok : Types.MiniLeagueGroupPlayer; #Err : Text } {
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
  };

  public shared ({ caller }) func unassign_player_from_group(group_id : Text, player_id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (requireGroupAdmin(caller, group_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        groupPlayers := groupPlayers.filter(func(item) = not (item.group_id == group_id and item.player_id == player_id));
        #Ok
      };
    }
  };

  public query ({ caller }) func list_group_players(group_id : Text) : async { #Ok : [Types.MiniLeagueGroupPlayer]; #Err : Text } {
    switch (findGroup(group_id)) {
      case null #Err("Group not found");
      case (?group) {
        switch (groupLeagueId(group)) {
          case null #Err("Session not found");
          case (?leagueId) {
            switch (findLeague(leagueId)) {
              case null #Err("Mini-league not found");
              case (?league) {
                if (not canViewLeague(caller, league)) return #Err("Forbidden");
                #Ok(groupPlayers.filter(func(item) = item.group_id == group_id))
              };
            }
          };
        }
      };
    }
  };

  public query ({ caller }) func list_groups(session_id : Text) : async { #Ok : [Types.MiniLeagueGroup]; #Err : Text } {
    switch (findSession(session_id)) {
      case null #Err("Session not found");
      case (?session) {
        switch (findLeague(session.mini_league_id)) {
          case null #Err("Mini-league not found");
          case (?league) {
            if (not canViewLeague(caller, league)) return #Err("Forbidden");
            #Ok(groups.filter(func(item) = item.session_id == session_id))
          };
        }
      };
    }
  };

  // ---------------- Group duties ----------------

  public shared ({ caller }) func create_duty(group_id : Text, name : Text, points : ?Nat16) : async { #Ok : Types.MiniLeagueGroupDuty; #Err : Text } {
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
  };

  // Any player-linked caller (the claimed parent) or a league admin can
  // claim an open duty for a player — mirrors the member-facing duty claim
  // flow in EventDutiesSection/MatchDutiesDialog.
  public shared ({ caller }) func claim_duty(id : Text, player_id : Text) : async { #Ok : Types.MiniLeagueGroupDuty; #Err : Text } {
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
                    let isPlayerClaimant = switch (player) { case (?p) p.claimed_by == ?caller; case null false };
                    if (not (isLeagueAdmin(caller, league) or isPlayerClaimant)) return #Err("Forbidden");
                    if (player == null) return #Err("Player not found");
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
  };

  public shared ({ caller }) func complete_duty(id : Text, points_awarded : Bool) : async { #Ok : Types.MiniLeagueGroupDuty; #Err : Text } {
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
  };

  public query ({ caller }) func list_duties(group_id : Text) : async { #Ok : [Types.MiniLeagueGroupDuty]; #Err : Text } {
    switch (findGroup(group_id)) {
      case null #Err("Group not found");
      case (?group) {
        switch (groupLeagueId(group)) {
          case null #Err("Session not found");
          case (?leagueId) {
            switch (findLeague(leagueId)) {
              case null #Err("Mini-league not found");
              case (?league) {
                if (not canViewLeague(caller, league)) return #Err("Forbidden");
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
    auth(caller);
    if (not validAvailabilityStatus(status)) return #Err("Invalid availability status");
    switch (findSession(session_id)) {
      case null #Err("Session not found");
      case (?session) {
        switch (findLeague(session.mini_league_id)) {
          case null #Err("Mini-league not found");
          case (?league) {
            let player = findPlayer(player_id);
            let isPlayerClaimant = switch (player) { case (?p) p.claimed_by == ?caller; case null false };
            if (not (isLeagueAdmin(caller, league) or isPlayerClaimant)) return #Err("Forbidden");
            if (player == null) return #Err("Player not found");
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
  };

  public query ({ caller }) func get_availability(session_id : Text, player_id : Text) : async { #Ok : ?Types.MiniLeagueSessionAvailability; #Err : Text } {
    switch (findSession(session_id)) {
      case null #Err("Session not found");
      case (?session) {
        switch (findLeague(session.mini_league_id)) {
          case null #Err("Mini-league not found");
          case (?league) {
            if (not canViewLeague(caller, league)) return #Err("Forbidden");
            #Ok(availability.find(func(item) = item.session_id == session_id and item.player_id == player_id))
          };
        }
      };
    }
  };

  public query ({ caller }) func list_session_availability(session_id : Text) : async { #Ok : [Types.MiniLeagueSessionAvailability]; #Err : Text } {
    switch (findSession(session_id)) {
      case null #Err("Session not found");
      case (?session) {
        switch (findLeague(session.mini_league_id)) {
          case null #Err("Mini-league not found");
          case (?league) {
            if (not canViewLeague(caller, league)) return #Err("Forbidden");
            #Ok(availability.filter(func(item) = item.session_id == session_id))
          };
        }
      };
    }
  };

  // Caller-scoped: availability rows for players the caller has claimed.
  public query ({ caller }) func my_availability() : async [Types.MiniLeagueSessionAvailability] {
    let myPlayerIds = players.filter(func(p) = p.claimed_by == ?caller).map(func(p) = p.id);
    availability.filter(func(item) = myPlayerIds.any(func(pid) = pid == item.player_id))
  };

  // ---------------- Admins ----------------

  public shared ({ caller }) func add_admin(mini_league_id : Text, user_id : Principal) : async { #Ok : Types.MiniLeagueAdmin; #Err : Text } {
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
  };

  public shared ({ caller }) func remove_admin(mini_league_id : Text, user_id : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        admins := admins.filter(func(item) = not (item.mini_league_id == mini_league_id and item.user_id.equal(user_id)));
        #Ok
      };
    }
  };

  public query ({ caller }) func list_admins(mini_league_id : Text) : async { #Ok : [Types.MiniLeagueAdmin]; #Err : Text } {
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
    auth(caller);
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        if (not validJoinLinkRole(role)) return #Err("Invalid join link role");
        if (joinLinks.any(func(item) = item.mini_league_id == mini_league_id and item.role == role and not item.revoked)) return #Err("Active join link already exists");
        let link : Types.MiniLeagueJoinLink = {
          mini_league_id;
          token = nextId("mljl-" # mini_league_id, joinLinks.size());
          role;
          revoked = false;
          created_by = caller;
          created_at_ms = nowMs();
          revision = 1;
        };
        joinLinks := joinLinks.concat([link]);
        #Ok(link)
      };
    }
  };

  public shared ({ caller }) func rotate_mini_league_join_link(mini_league_id : Text, role : Text) : async { #Ok : Types.MiniLeagueJoinLink; #Err : Text } {
    auth(caller);
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        if (not validJoinLinkRole(role)) return #Err("Invalid join link role");
        switch (joinLinks.find(func(item) = item.mini_league_id == mini_league_id and item.role == role and not item.revoked)) {
          case null #Err("No active join link");
          case (?current) {
            let rotated : Types.MiniLeagueJoinLink = { current with token = nextId("mljl-" # mini_league_id, joinLinks.size()); revision = current.revision + 1 };
            joinLinks := joinLinks.map(func(item) = if (item.mini_league_id == mini_league_id and item.role == role and not item.revoked) rotated else item);
            #Ok(rotated)
          };
        }
      };
    }
  };

  public shared ({ caller }) func revoke_mini_league_join_link(mini_league_id : Text, role : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (requireLeagueAdmin(caller, mini_league_id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) {
        if (not validJoinLinkRole(role)) return #Err("Invalid join link role");
        joinLinks := joinLinks.map(func(item) = if (item.mini_league_id == mini_league_id and item.role == role and not item.revoked) { { item with revoked = true } } else item);
        #Ok
      };
    }
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
    auth(caller);
    switch (joinLinks.find(func(item) = item.token == token)) {
      case null #Err("Join link not found");
      case (?link) {
        if (link.revoked) return #Err("Join link revoked");
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
  };

  // Mirrors join_competition_by_token but mints a fresh player record,
  // since mini-league join links are not pre-bound to an existing player.
  public shared ({ caller }) func join_mini_league_by_token(token : Text, player_name : Text) : async { #Ok : Types.ClaimedInvite; #Err : Text } {
    auth(caller);
    switch (joinLinks.find(func(item) = item.token == token)) {
      case null #Err("Join link not found");
      case (?link) {
        if (link.revoked) return #Err("Join link revoked");
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
  };

  public query ({ caller }) func list_mini_league_join_links(mini_league_id : Text) : async { #Ok : [Types.MiniLeagueJoinLink]; #Err : Text } {
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
  };

  // Clones a league with its roster (players keep name/rating/notes and any
  // child/parent links, mirroring the Supabase duplicate flow), under a new
  // id. Sessions, groups, duties and availability are not copied — they are
  // per-session state, same as the Supabase duplicateLeagueMutation.
  public shared ({ caller }) func duplicate_mini_league(mini_league_id : Text, new_name : Text) : async { #Ok : Types.MiniLeague; #Err : Text } {
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
  };
}
