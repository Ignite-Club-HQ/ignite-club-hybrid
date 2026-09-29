import Array "mo:core/Array";
import Principal "mo:core/Principal";
module {
  type RoleGrant = { user : Principal; role : Text; competition_id : Text; team_id : ?Text };
  type Competition = { id : Text; club_id : Text; name : Text; season : Text; status : Text; revision : Nat64 };
  type OldTeamEntry = { competition_id : Text; team_id : Text; club_id : Text; status : Text };
  type TeamEntry = { competition_id : Text; team_id : Text; club_id : Text; status : Text; division_id : ?Text };
  type JoinToken = { id : Text; competition_id : Text; team_id : Text; issued_by : Principal; expires_at_ms : Nat64; used : Bool };
  type OldSeason = { competition_id : Text; name : Text; status : Text; revision : Nat64 };
  type Season = { competition_id : Text; name : Text; status : Text; divisions : [Text]; revision : Nat64 };
  type OldMatch = { id : Text; competition_id : Text; home_team : Text; away_team : Text; status : Text; home_score : Nat16; away_score : Nat16; revision : Nat64 };
  type Match = { id : Text; competition_id : Text; home_team : Text; away_team : Text; status : Text; home_score : Nat16; away_score : Nat16; division_id : ?Text; scheduled_at_ms : ?Nat64; venue : ?Text; pitch_number : ?Text; round_number : ?Nat16; duration_minutes : ?Nat16; arrival_minutes_before : ?Nat16; notes : ?Text; revision : Nat64 };
  type OldActor = {
    var governor : Principal;
    var roles : [RoleGrant];
    var competitions : [Competition];
    var entries : [OldTeamEntry];
    var tokens : [JoinToken];
    var seasons : [OldSeason];
    var matches : [OldMatch];
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
  };
  // Adds division assignment (entries, matches), fixture detail fields
  // (matches), and season division structure. Existing rows gain null
  // details and empty division lists — same provisional mapping the
  // frontend used while these fields had no canister shape.
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var roles = old.roles;
      var competitions = old.competitions;
      var entries = Array.map<OldTeamEntry, TeamEntry>(old.entries, func(e) {
        { competition_id = e.competition_id; team_id = e.team_id; club_id = e.club_id; status = e.status; division_id = null }
      });
      var tokens = old.tokens;
      var seasons = Array.map<OldSeason, Season>(old.seasons, func(s) {
        { competition_id = s.competition_id; name = s.name; status = s.status; divisions = []; revision = s.revision }
      });
      var matches = Array.map<OldMatch, Match>(old.matches, func(m) {
        { id = m.id; competition_id = m.competition_id; home_team = m.home_team; away_team = m.away_team; status = m.status; home_score = m.home_score; away_score = m.away_score; division_id = null; scheduled_at_ms = null; venue = null; pitch_number = null; round_number = null; duration_minutes = null; arrival_minutes_before = null; notes = null; revision = m.revision }
      });
      var bulkAccessPrincipals = old.bulkAccessPrincipals;
    }
  };
};