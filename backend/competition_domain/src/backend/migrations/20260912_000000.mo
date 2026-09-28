import Principal "mo:core/Principal";
module {
  type RoleGrant = { user : Principal; role : Text; competition_id : Text; team_id : ?Text };
  type Competition = { id : Text; club_id : Text; name : Text; season : Text; status : Text; revision : Nat64 };
  type TeamEntry = { competition_id : Text; team_id : Text; club_id : Text; status : Text };
  type JoinToken = { id : Text; competition_id : Text; team_id : Text; issued_by : Principal; expires_at_ms : Nat64; used : Bool };
  type Season = { competition_id : Text; name : Text; status : Text; revision : Nat64 };
  type Match = { id : Text; competition_id : Text; home_team : Text; away_team : Text; status : Text; home_score : Nat16; away_score : Nat16; revision : Nat64 };
  type OldActor = {};
  type NewActor = {
    var governor : Principal;
    var roles : [RoleGrant];
    var competitions : [Competition];
    var entries : [TeamEntry];
    var tokens : [JoinToken];
    var seasons : [Season];
    var matches : [Match];
  };
  public func migration(_old : OldActor) : NewActor {
    { var governor = Principal.anonymous(); var roles = []; var competitions = []; var entries = []; var tokens = []; var seasons = []; var matches = [] }
  };
};