import Principal "mo:core/Principal";
module {
  type RoleGrant = { user : Principal; role : Text; club_id : Text; team_id : ?Text };
  type MiniLeague = {
    id : Text; club_id : Text; name : Text; description : ?Text; logo_url : ?Text;
    team_size : Nat16; min_players_per_side : Nat16; minutes_per_half : Nat16;
    bib_colors : [Text]; show_matches_to_members : Bool; status : Text;
    created_by : Principal; created_at_ms : Nat64; updated_at_ms : Nat64;
  };
  type MiniLeagueSession = {
    id : Text; mini_league_id : Text; session_date : Text; start_time : Text; end_time : ?Text;
    location_name : ?Text; address : ?Text; postcode : ?Text; team_size_override : ?Nat16;
    status : Text; linked_event_id : ?Text; created_by : Principal; created_at_ms : Nat64; updated_at_ms : Nat64;
  };
  type MiniLeaguePlayer = {
    id : Text; mini_league_id : Text; name : Text; child_id : ?Text; parent_user_id : ?Text;
    claimed_by : ?Principal; ability_rating : ?Nat16; notes : ?Text; created_at_ms : Nat64; updated_at_ms : Nat64;
  };
  type MiniLeagueInvite = {
    token : Text; mini_league_id : Text; player_id : ?Text; label_text : ?Text; status : Text;
    claimed_by : ?Principal; created_by : Principal; created_at_ms : Nat64; claimed_at_ms : ?Nat64;
  };
  type MiniLeagueGroup = {
    id : Text; session_id : Text; name : Text; ability_band : ?Text; display_order : Nat16;
    target_size : Nat16; pitch_name : ?Text; linked_event_id : ?Text; created_at_ms : Nat64; updated_at_ms : Nat64;
  };
  type MiniLeagueGroupPlayer = { group_id : Text; player_id : Text; jersey_number : ?Nat16; created_at_ms : Nat64 };
  type MiniLeagueGroupDuty = {
    id : Text; group_id : Text; name : Text; assigned_to : ?Text; status : Text; completed : Bool;
    points : ?Nat16; points_awarded : Bool; created_at_ms : Nat64; updated_at_ms : Nat64;
  };
  type MiniLeagueSessionAvailability = {
    id : Text; session_id : Text; player_id : Text; status : Text; marked_by : ?Principal;
    created_at_ms : Nat64; updated_at_ms : Nat64;
  };
  type MiniLeagueAdmin = { id : Text; mini_league_id : Text; user_id : Principal; granted_by : ?Principal; created_at_ms : Nat64 };
  type MiniLeagueJoinLink = { mini_league_id : Text; token : Text; role : Text; revoked : Bool; created_by : Principal; created_at_ms : Nat64; revision : Nat64 };
  // New: child/guardian tracking (mirrors Supabase `children` + `child_guardians`
  // for the slice used by ManagePlayersDialog's pending-status lookup and the
  // player-delete cascade).
  type MiniLeagueChild = { id : Text; parent_user_id : ?Principal; claimed_by : ?Principal; created_at_ms : Nat64; updated_at_ms : Nat64 };
  type MiniLeagueGuardian = { child_id : Text; guardian_user_id : Principal; created_at_ms : Nat64 };
  type OldActor = {
    var governor : Principal;
    var roles : [RoleGrant];
    var leagues : [MiniLeague];
    var sessions : [MiniLeagueSession];
    var players : [MiniLeaguePlayer];
    var invites : [MiniLeagueInvite];
    var groups : [MiniLeagueGroup];
    var groupPlayers : [MiniLeagueGroupPlayer];
    var duties : [MiniLeagueGroupDuty];
    var availability : [MiniLeagueSessionAvailability];
    var admins : [MiniLeagueAdmin];
    var joinLinks : [MiniLeagueJoinLink];
  };
  type NewActor = {
    var governor : Principal;
    var roles : [RoleGrant];
    var leagues : [MiniLeague];
    var sessions : [MiniLeagueSession];
    var players : [MiniLeaguePlayer];
    var invites : [MiniLeagueInvite];
    var groups : [MiniLeagueGroup];
    var groupPlayers : [MiniLeagueGroupPlayer];
    var duties : [MiniLeagueGroupDuty];
    var availability : [MiniLeagueSessionAvailability];
    var admins : [MiniLeagueAdmin];
    var joinLinks : [MiniLeagueJoinLink];
    var children : [MiniLeagueChild];
    var guardians : [MiniLeagueGuardian];
  };
  // Seeds the new child/guardian tables empty — every player's child_id (if
  // any) is backfilled lazily on first add_player/remove_player touching it,
  // same as every other canister-side addition in this chain. No existing
  // data is lost; every prior field is carried over unchanged.
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var roles = old.roles;
      var leagues = old.leagues;
      var sessions = old.sessions;
      var players = old.players;
      var invites = old.invites;
      var groups = old.groups;
      var groupPlayers = old.groupPlayers;
      var duties = old.duties;
      var availability = old.availability;
      var admins = old.admins;
      var joinLinks = old.joinLinks;
      var children = [];
      var guardians = [];
    }
  };
};
