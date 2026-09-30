import Principal "mo:core/Principal";
module {
  // Club/team role grants — mirrors events_domain/competition_domain's ACL
  // model so mini-league admin checks compose with the same club_admin /
  // team_admin / coach role grants used across the other domain canisters.
  public type RoleGrant = { user : Principal; role : Text; club_id : Text; team_id : ?Text };

  // Mirrors public.mini_leagues (13 cols). `status` is a canister-side
  // lifecycle addition (active/archived) — the Supabase table has no
  // lifecycle column today.
  public type MiniLeague = {
    id : Text;
    club_id : Text;
    name : Text;
    description : ?Text;
    logo_url : ?Text;
    team_size : Nat16;
    min_players_per_side : Nat16;
    minutes_per_half : Nat16;
    bib_colors : [Text];
    show_matches_to_members : Bool;
    status : Text; // "active" | "archived"
    created_by : Principal;
    created_at_ms : Nat64;
    updated_at_ms : Nat64;
  };

  // Mirrors public.mini_league_sessions (14 cols).
  public type MiniLeagueSession = {
    id : Text;
    mini_league_id : Text;
    session_date : Text; // ISO date (YYYY-MM-DD)
    start_time : Text; // HH:MM[:SS]
    end_time : ?Text;
    location_name : ?Text;
    address : ?Text;
    postcode : ?Text;
    team_size_override : ?Nat16;
    status : Text; // "scheduled" | "cancelled" | "completed"
    linked_event_id : ?Text;
    created_by : Principal;
    created_at_ms : Nat64;
    updated_at_ms : Nat64;
  };

  // Mirrors public.mini_league_players (9 cols). `claimed_by` is a
  // canister-side addition recording which principal claimed the invite
  // linking them (as parent) to this player — the Supabase equivalent is
  // resolved separately via the generic invites table + parent_user_id.
  public type MiniLeaguePlayer = {
    id : Text;
    mini_league_id : Text;
    name : Text;
    child_id : ?Text;
    parent_user_id : ?Text;
    claimed_by : ?Principal;
    ability_rating : ?Nat16;
    notes : ?Text;
    created_at_ms : Nat64;
    updated_at_ms : Nat64;
  };

  // Canister-side invite token, standing in for the generic Supabase
  // `invites` table rows used by the mini-league join-link flows
  // (AddSecondParentDialog / MiniLeagueParentJoinLinkCard / claim_mini_league_invite).
  public type MiniLeagueInvite = {
    token : Text;
    mini_league_id : Text;
    player_id : ?Text;
    label : ?Text;
    status : Text; // "pending" | "claimed"
    claimed_by : ?Principal;
    created_by : Principal;
    created_at_ms : Nat64;
    claimed_at_ms : ?Nat64;
  };

  // Result shape mirrors the claim_mini_league_invite() Postgres function.
  public type ClaimedInvite = { mini_league_id : Text; club_id : Text; player_id : Text };

  // Mirrors public.mini_league_groups (12 cols).
  public type MiniLeagueGroup = {
    id : Text;
    session_id : Text;
    name : Text;
    ability_band : ?Text;
    display_order : Nat16;
    target_size : Nat16;
    pitch_name : ?Text;
    linked_event_id : ?Text;
    created_at_ms : Nat64;
    updated_at_ms : Nat64;
  };

  // Mirrors public.mini_league_group_players (5 cols).
  public type MiniLeagueGroupPlayer = {
    group_id : Text;
    player_id : Text;
    jersey_number : ?Nat16;
    created_at_ms : Nat64;
  };

  // Mirrors public.mini_league_group_duties (9 cols). `completed` mirrors
  // events_domain's Duty.completed flag; `status` retains the Supabase
  // open/claimed/completed vocabulary.
  public type MiniLeagueGroupDuty = {
    id : Text;
    group_id : Text;
    name : Text;
    assigned_to : ?Text; // player_id
    status : Text; // "open" | "claimed" | "completed"
    completed : Bool;
    points : ?Nat16;
    points_awarded : Bool;
    created_at_ms : Nat64;
    updated_at_ms : Nat64;
  };

  // Mirrors public.mini_league_session_availability (7 cols). `status`
  // mirrors the RSVP vocabulary used by events_domain's Rsvp.state.
  public type MiniLeagueSessionAvailability = {
    id : Text;
    session_id : Text;
    player_id : Text;
    status : Text; // "available" | "unavailable" | "maybe"
    marked_by : ?Principal;
    created_at_ms : Nat64;
    updated_at_ms : Nat64;
  };

  // Mirrors public.mini_league_admins (5 cols).
  public type MiniLeagueAdmin = {
    id : Text;
    mini_league_id : Text;
    user_id : Principal;
    granted_by : ?Principal;
    created_at_ms : Nat64;
  };

  public type State = {
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
  };
}
