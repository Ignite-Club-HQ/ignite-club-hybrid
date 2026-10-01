import Principal "mo:core/Principal";
module {
  type RoleGrant = { user : Principal; role : Text; competition_id : Text; team_id : ?Text };
  type Competition = { id : Text; club_id : Text; name : Text; season : Text; status : Text; revision : Nat64 };
  type TeamEntry = { competition_id : Text; team_id : Text; club_id : Text; status : Text; division_id : ?Text };
  type JoinToken = { id : Text; competition_id : Text; team_id : Text; issued_by : Principal; expires_at_ms : Nat64; used : Bool };
  type Season = { competition_id : Text; name : Text; status : Text; divisions : [Text]; revision : Nat64 };
  type Match = { id : Text; competition_id : Text; home_team : Text; away_team : Text; status : Text; home_score : Nat16; away_score : Nat16; division_id : ?Text; scheduled_at_ms : ?Nat64; venue : ?Text; pitch_number : ?Text; round_number : ?Nat16; duration_minutes : ?Nat16; arrival_minutes_before : ?Nat16; notes : ?Text; revision : Nat64 };
  type ChatSettings = { competition_id : Text; chat_enabled : Bool; revision : Nat64 };
  type CompetitionInvite = { id : Text; competition_id : Text; invitee : Principal; role : Text; team_id : ?Text; status : Text; created_by : Principal; created_at_ms : Nat64; responded_at_ms : ?Nat64 };
  type CompetitionJoinLink = { competition_id : Text; token : Text; role : Text; team_id : ?Text; revoked : Bool; created_by : Principal; created_at_ms : Nat64; revision : Nat64 };
  type OldActor = {
    var governor : Principal;
    var roles : [RoleGrant];
    var competitions : [Competition];
    var entries : [TeamEntry];
    var tokens : [JoinToken];
    var seasons : [Season];
    var matches : [Match];
    var bulkAccessPrincipals : [Principal];
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
  };
  // Adds per-competition chat toggle, invite records (accept/decline
  // lifecycle), and competition-wide join links. All start empty — existing
  // rows are untouched.
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
      var chatSettings = [];
      var competitionInvites = [];
      var competitionJoinLinks = [];
    }
  };
};
