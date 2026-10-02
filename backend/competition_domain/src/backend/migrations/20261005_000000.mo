import Array "mo:core/Array";
import Principal "mo:core/Principal";
module {
  type RoleGrant = { user : Principal; role : Text; competition_id : Text; team_id : ?Text };
  type Competition = { id : Text; club_id : Text; name : Text; season : Text; status : Text; revision : Nat64 };
  type TeamEntry = { competition_id : Text; team_id : Text; club_id : Text; status : Text; division_id : ?Text };
  type JoinToken = { id : Text; competition_id : Text; team_id : Text; issued_by : Principal; expires_at_ms : Nat64; used : Bool };
  type Season = { competition_id : Text; name : Text; status : Text; divisions : [Text]; revision : Nat64 };
  type Match = { id : Text; competition_id : Text; home_team : Text; away_team : Text; status : Text; home_score : Nat16; away_score : Nat16; division_id : ?Text; scheduled_at_ms : ?Nat64; venue : ?Text; pitch_number : ?Text; round_number : ?Nat16; duration_minutes : ?Nat16; arrival_minutes_before : ?Nat16; notes : ?Text; revision : Nat64 };
  type ChatSettings = { competition_id : Text; chat_enabled : Bool; admins_only : Bool; revision : Nat64 };
  type CompetitionInvite = { id : Text; competition_id : Text; invitee : Principal; role : Text; team_id : ?Text; status : Text; created_by : Principal; created_at_ms : Nat64; responded_at_ms : ?Nat64 };
  type CompetitionJoinLink = { competition_id : Text; token : Text; role : Text; team_id : ?Text; revoked : Bool; created_by : Principal; created_at_ms : Nat64; revision : Nat64 };
  type EoiSubmission = {
    id : Text;
    club_id : Text;
    season_id : Text;
    claim_token : Text;
    status : Text;
    source : Text;
    parent_name : Text;
    parent_email : Text;
    parent_mobile : ?Text;
    parent_user_id : ?Principal;
    player_name : Text;
    player_dob : ?Text;
    player_gender : ?Text;
    age_group : ?Text;
    preferred_position : ?Text;
    preferred_teammates : ?Text;
    skill_level : ?Nat16;
    returning_player : Bool;
    game_days : [Text];
    training_days : [Text];
    extra_notes : ?Text;
    notes : ?Text;
    child_id : ?Text;
    assigned_team_id : ?Text;
    invite_sent_count : Nat16;
    invite_sent_at_ms : ?Nat64;
    submitted_at_ms : Nat64;
    created_at_ms : Nat64;
    updated_at_ms : Nat64;
    allocated_at_ms : ?Nat64;
    confirmed_at_ms : ?Nat64;
    registered_at_ms : ?Nat64;
    withdrawn_at_ms : ?Nat64;
    claimed_at_ms : ?Nat64;
    parent_confirmed_at_ms : ?Nat64;
    revision : Nat64;
  };
  type OldActor = {
    var governor : Principal;
    var roles : [RoleGrant];
    var competitions : [Competition];
    var entries : [TeamEntry];
    var tokens : [JoinToken];
    var seasons : [Season];
    var matches : [Match];
    var bulkAccessPrincipals : [Principal];
    var chatSettings : [ChatSettings];
    var competitionInvites : [CompetitionInvite];
    var competitionJoinLinks : [CompetitionJoinLink];
  };
  type NewActor = {
    var governor : Principal;
    var roles : [RoleGrant];
    var competitions : [Competition];
    var entries : [TeamEntry];
    var tokens : [JoinToken];
    var seasons : [Season];
    var matches : [Match];
    var bulkAccessPrincipals : [Principal];
    var chatSettings : [ChatSettings];
    var competitionInvites : [CompetitionInvite];
    var competitionJoinLinks : [CompetitionJoinLink];
    var eoiSubmissions : [EoiSubmission];
  };
  // Adds the EOI (expression-of-interest) submission store. Existing state
  // is carried over unchanged; eoiSubmissions starts empty (new entity, no
  // prior canister rows to migrate from).
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var roles = old.roles;
      var competitions = old.competitions;
      var entries = old.entries;
      var tokens = old.tokens;
      var seasons = old.seasons;
      var matches = old.matches;
      var bulkAccessPrincipals = old.bulkAccessPrincipals;
      var chatSettings = old.chatSettings;
      var competitionInvites = old.competitionInvites;
      var competitionJoinLinks = old.competitionJoinLinks;
      var eoiSubmissions = [];
    }
  };
};
